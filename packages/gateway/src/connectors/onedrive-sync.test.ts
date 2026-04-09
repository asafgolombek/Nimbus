import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import pino from "pino";
import { itemPrimaryKey } from "../index/item-store.ts";
import { LocalIndex } from "../index/local-index.ts";
import { ProviderRateLimiter } from "../sync/rate-limiter.ts";
import type { SyncContext } from "../sync/types.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import {
  createOneDriveSyncable,
  decodeOneDriveSyncCursor,
  encodeOneDriveSyncCursor,
  type OneDriveSyncCursorV1,
} from "./onedrive-sync.ts";

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

describe("OneDrive sync cursor codec", () => {
  test("round-trip", () => {
    const samples: OneDriveSyncCursorV1[] = [
      { v: 1, nextUrl: null },
      { v: 1, nextUrl: "https://graph.microsoft.com/v1.0/me/drive/root/delta?token=x" },
    ];
    for (const s of samples) {
      const enc = encodeOneDriveSyncCursor(s);
      expect(enc.startsWith("nimbus-odrv1:")).toBe(true);
      expect(decodeOneDriveSyncCursor(enc)).toEqual(s);
    }
  });
});

describe("createOneDriveSyncable", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("upserts file items and stores deltaLink cursor", async () => {
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
    const syncable = createOneDriveSyncable({ ensureMicrosoftMcpRunning: async () => {} });

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/drive/root/delta")) {
        return new Response(
          JSON.stringify({
            value: [
              {
                id: "f1",
                name: "doc.txt",
                file: { mimeType: "text/plain" },
                webUrl: "https://example.com/f1",
                lastModifiedDateTime: "2024-03-01T12:00:00Z",
              },
            ],
            "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/drive/root/delta?token=done",
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const r = await syncable.sync(ctx, null);
    expect(r.itemsUpserted).toBe(1);
    expect(r.hasMore).toBe(false);
    expect(r.cursor).not.toBeNull();

    const row = db
      .query("SELECT service, type, external_id FROM item WHERE id = ?")
      .get(itemPrimaryKey("onedrive", "f1")) as
      | { service: string; type: string; external_id: string }
      | undefined;
    expect(row?.type).toBe("file");
    expect(row?.external_id).toBe("f1");
  });

  test("deletes when @removed present", async () => {
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
    const syncable = createOneDriveSyncable({ ensureMicrosoftMcpRunning: async () => {} });

    let call = 0;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (!url.includes("/drive/root/delta") && !url.includes("graph.example")) {
        throw new Error(`unexpected fetch: ${url}`);
      }
      call += 1;
      if (call === 1) {
        return new Response(
          JSON.stringify({
            value: [
              { id: "x1", name: "a", file: {}, lastModifiedDateTime: "2024-01-01T00:00:00Z" },
            ],
            "@odata.deltaLink": "https://graph.example/delta",
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          value: [{ id: "x1", "@removed": { reason: "deleted" } }],
          "@odata.deltaLink": "https://graph.example/delta2",
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    await syncable.sync(ctx, null);
    const afterInsert = db
      .query("SELECT COUNT(*) as c FROM item WHERE service = ?")
      .get("onedrive") as { c: number };
    expect(afterInsert.c).toBe(1);

    const r2 = await syncable.sync(
      ctx,
      encodeOneDriveSyncCursor({ v: 1, nextUrl: "https://graph.example/delta" }),
    );
    expect(r2.itemsDeleted).toBe(1);
    const afterDelete = db
      .query("SELECT COUNT(*) as c FROM item WHERE service = ?")
      .get("onedrive") as { c: number };
    expect(afterDelete.c).toBe(0);
  });
});
