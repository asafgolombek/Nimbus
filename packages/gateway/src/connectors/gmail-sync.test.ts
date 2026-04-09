import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import pino from "pino";
import { itemPrimaryKey } from "../index/item-store.ts";
import { LocalIndex } from "../index/local-index.ts";
import { ProviderRateLimiter } from "../sync/rate-limiter.ts";
import type { SyncContext } from "../sync/types.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import {
  createGmailSyncable,
  decodeGmailSyncCursor,
  encodeGmailSyncCursor,
  type GmailSyncCursorV1,
} from "./gmail-sync.ts";

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

describe("Gmail sync cursor codec", () => {
  test("round-trip v1 cursors", () => {
    const samples: GmailSyncCursorV1[] = [
      { v: 1, phase: "list", q: "newer_than:30d", pageToken: "pt2" },
      { v: 1, phase: "list", q: "newer_than:30d", pageToken: null },
      { v: 1, phase: "delta", startHistoryId: "100", pageToken: "hp1" },
      { v: 1, phase: "delta", startHistoryId: "100", pageToken: null },
    ];
    for (const s of samples) {
      const enc = encodeGmailSyncCursor(s);
      expect(enc.startsWith("nimbus-gml1:")).toBe(true);
      expect(decodeGmailSyncCursor(enc)).toEqual(s);
    }
  });

  test("rejects invalid prefixed payload", () => {
    expect(decodeGmailSyncCursor("nimbus-gml1:not-base64!!!")).toBeUndefined();
  });
});

describe("createGmailSyncable", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("null cursor: messages.list page + profile historyId → delta cursor", async () => {
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
    const syncable = createGmailSyncable({ ensureGoogleMcpRunning: async () => {} });

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/gmail/v1/users/me/messages?")) {
        return new Response(
          JSON.stringify({
            messages: [{ id: "m1", threadId: "th1" }],
            nextPageToken: "",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/gmail/v1/users/me/messages/m1")) {
        return new Response(
          JSON.stringify({
            id: "m1",
            threadId: "th1",
            snippet: "hello",
            internalDate: "1700000000000",
            labelIds: ["INBOX"],
            payload: {
              headers: [
                { name: "Subject", value: "Hi" },
                { name: "From", value: "a@b.com" },
                { name: "To", value: "c@d.com" },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/gmail/v1/users/me/profile")) {
        return new Response(JSON.stringify({ historyId: "999" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const result = await syncable.sync(ctx, null);
    expect(result.hasMore).toBe(false);
    expect(result.itemsUpserted).toBe(1);
    const dec = decodeGmailSyncCursor(result.cursor ?? "");
    expect(dec?.phase).toBe("delta");
    if (dec?.phase === "delta") {
      expect(dec.startHistoryId).toBe("999");
    }

    const row = db
      .query("SELECT title, service FROM item WHERE id = ?")
      .get(itemPrimaryKey("gmail", "m1")) as { title: string; service: string } | null;
    expect(row?.service).toBe("gmail");
    expect(row?.title).toBe("Hi");
  });
});
