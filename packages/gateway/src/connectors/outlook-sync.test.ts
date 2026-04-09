import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import pino from "pino";
import { itemPrimaryKey } from "../index/item-store.ts";
import { LocalIndex } from "../index/local-index.ts";
import { ProviderRateLimiter } from "../sync/rate-limiter.ts";
import type { SyncContext } from "../sync/types.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import {
  createOutlookSyncable,
  decodeOutlookSyncCursor,
  encodeOutlookSyncCursor,
  type OutlookSyncCursorV1,
} from "./outlook-sync.ts";

function createMemoryVault(): NimbusVault {
  const m = new Map<string, string>();
  return {
    async set(key: string, value: string): Promise<void> {
      m.set(key, value);
    },
    async get(key: string): Promise<string | null> {
      return m.get(key) ?? null;
    },
    async delete(key: string): Promise<void> {
      m.delete(key);
    },
    async listKeys(prefix?: string): Promise<string[]> {
      const keys = [...m.keys()].sort();
      if (prefix === undefined || prefix === "") {
        return keys;
      }
      return keys.filter((k) => k.startsWith(prefix));
    },
  };
}

function openDb(): Database {
  const db = new Database(":memory:");
  LocalIndex.ensureSchema(db);
  return db;
}

function testContext(db: Database, vault: NimbusVault): SyncContext {
  return {
    db,
    vault,
    logger: pino({ level: "silent" }),
    rateLimiter: new ProviderRateLimiter(),
  };
}

describe("Outlook sync cursor codec", () => {
  test("round-trip", () => {
    const samples: OutlookSyncCursorV1[] = [
      { v: 1, nextUrl: null },
      { v: 1, nextUrl: "https://graph.microsoft.com/v1.0/me/messages/delta?$skiptoken=a" },
    ];
    for (const s of samples) {
      const enc = encodeOutlookSyncCursor(s);
      expect(enc.startsWith("nimbus-outl1:")).toBe(true);
      expect(decodeOutlookSyncCursor(enc)).toEqual(s);
    }
  });
});

describe("createOutlookSyncable", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("indexes messages from delta page", async () => {
    const vault = createMemoryVault();
    await vault.set(
      "microsoft.oauth",
      JSON.stringify({
        accessToken: "t",
        refreshToken: "r",
        expiresAt: Date.now() + 3_600_000,
      }),
    );
    const db = openDb();
    const ctx = testContext(db, vault);
    const syncable = createOutlookSyncable({ ensureMicrosoftMcpRunning: async () => {} });

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/messages/delta")) {
        return new Response(
          JSON.stringify({
            value: [
              {
                id: "m1",
                subject: "Hi",
                bodyPreview: "Hello",
                lastModifiedDateTime: "2024-05-01T10:00:00Z",
                webLink: "https://outlook.office.com/m1",
              },
            ],
            "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/messages/delta?token=z",
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const r = await syncable.sync(ctx, null);
    expect(r.itemsUpserted).toBe(1);
    expect(r.hasMore).toBe(false);

    const row = db
      .query("SELECT service, type FROM item WHERE id = ?")
      .get(itemPrimaryKey("outlook", "m1")) as { service: string; type: string } | undefined;
    expect(row?.service).toBe("outlook");
    expect(row?.type).toBe("email");
  });
});
