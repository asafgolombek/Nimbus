import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import pino from "pino";
import { itemPrimaryKey } from "../index/item-store.ts";
import { LocalIndex } from "../index/local-index.ts";
import { ProviderRateLimiter } from "../sync/rate-limiter.ts";
import type { SyncContext } from "../sync/types.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import {
  createGooglePhotosSyncable,
  decodeGooglePhotosSyncCursor,
  encodeGooglePhotosSyncCursor,
  type GooglePhotosSyncCursorV1,
} from "./google-photos-sync.ts";

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

describe("Google Photos sync cursor codec", () => {
  test("round-trip", () => {
    const samples: GooglePhotosSyncCursorV1[] = [
      { v: 1, pageToken: null },
      { v: 1, pageToken: "next" },
    ];
    for (const s of samples) {
      const enc = encodeGooglePhotosSyncCursor(s);
      expect(enc.startsWith("nimbus-gph1:")).toBe(true);
      expect(decodeGooglePhotosSyncCursor(enc)).toEqual(s);
    }
  });
});

describe("createGooglePhotosSyncable", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("indexes media items from search response", async () => {
    const vault = createMemoryVault();
    await vault.set(
      "google.oauth",
      JSON.stringify({
        accessToken: "t",
        refreshToken: "r",
        expiresAt: Date.now() + 3_600_000,
      }),
    );
    const db = openDb();
    const ctx = testContext(db, vault);
    const syncable = createGooglePhotosSyncable({ ensureGoogleMcpRunning: async () => {} });

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("mediaItems:search")) {
        return new Response(
          JSON.stringify({
            mediaItems: [
              {
                id: "p1",
                filename: "a.jpg",
                productUrl: "https://photos.google.com/p1",
                mediaMetadata: { creationTime: "2024-01-02T00:00:00Z" },
              },
            ],
            nextPageToken: "n1",
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const r = await syncable.sync(ctx, null);
    expect(r.itemsUpserted).toBe(1);
    expect(r.hasMore).toBe(true);
    expect(r.cursor).not.toBeNull();

    const row = db
      .query("SELECT id, service, external_id FROM item WHERE id = ?")
      .get(itemPrimaryKey("google_photos", "p1")) as
      | { id: string; service: string; external_id: string }
      | undefined;
    expect(row?.service).toBe("google_photos");
    expect(row?.external_id).toBe("p1");
  });
});
