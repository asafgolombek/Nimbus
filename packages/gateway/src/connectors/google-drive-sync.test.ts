import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import pino from "pino";
import { itemPrimaryKey } from "../index/item-store.ts";
import { LocalIndex } from "../index/local-index.ts";
import { ProviderRateLimiter } from "../sync/rate-limiter.ts";
import type { SyncContext } from "../sync/types.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import {
  createGoogleDriveSyncable,
  type DriveSyncCursorV1,
  decodeDriveSyncCursor,
  encodeDriveSyncCursor,
} from "./google-drive-sync.ts";

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

const sampleFile = {
  id: "f1",
  name: "doc.txt",
  mimeType: "text/plain",
  modifiedTime: new Date().toISOString(),
  webViewLink: "https://example.com/f1",
  size: "10",
  description: "hi",
};

describe("Google Drive sync cursor codec", () => {
  test("round-trip v1 cursors", () => {
    const samples: DriveSyncCursorV1[] = [
      { v: 1, phase: "init_list", t0: "tokA", listToken: "page2" },
      { v: 1, phase: "init_list", t0: "tokA", listToken: null },
      { v: 1, phase: "drain", changePage: "chg1" },
      { v: 1, phase: "delta", pageToken: "d99" },
    ];
    for (const s of samples) {
      const enc = encodeDriveSyncCursor(s);
      expect(enc.startsWith("nimbus-gdrv1:")).toBe(true);
      expect(decodeDriveSyncCursor(enc)).toEqual(s);
    }
  });

  test("rejects invalid prefixed payload", () => {
    expect(decodeDriveSyncCursor("nimbus-gdrv1:not-base64!!!")).toBeUndefined();
  });
});

describe("createGoogleDriveSyncable", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("null cursor: start token + files.list then drain cursor", async () => {
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
    const syncable = createGoogleDriveSyncable({ ensureGoogleDriveRunning: async () => {} });

    const responses: Array<{ url: string; json: unknown }> = [
      {
        url: "startPageToken",
        json: { startPageToken: "t0" },
      },
      {
        url: "files",
        json: { files: [sampleFile], nextPageToken: undefined },
      },
    ];

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const next = responses.shift();
      if (next === undefined) {
        throw new Error(`unexpected fetch: ${url}`);
      }
      if (next.url === "startPageToken" && url.includes("startPageToken")) {
        return new Response(JSON.stringify(next.json), { status: 200 });
      }
      if (next.url === "files") {
        const path = new URL(url).pathname;
        if (path === "/drive/v3/files") {
          return new Response(JSON.stringify(next.json), { status: 200 });
        }
      }
      throw new Error(`unexpected fetch url: ${url}`);
    }) as typeof fetch;

    const r = await syncable.sync(ctx, null);
    expect(r.hasMore).toBe(true);
    const dec = decodeDriveSyncCursor(r.cursor ?? "");
    expect(dec).toEqual({ v: 1, phase: "drain", changePage: "t0" });

    const row = db
      .query("SELECT title FROM item WHERE id = ?")
      .get(itemPrimaryKey("google_drive", "f1")) as { title: string } | null;
    expect(row?.title).toBe("doc.txt");
  });

  test("drain phase applies removal", async () => {
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
    const syncable = createGoogleDriveSyncable({ ensureGoogleDriveRunning: async () => {} });

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/drive/v3/changes")) {
        return new Response(
          JSON.stringify({
            changes: [{ removed: true, fileId: "f1" }],
            newStartPageToken: "next-delta",
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    db.run(
      `INSERT INTO item (id, service, type, external_id, title, body_preview, url, canonical_url, modified_at, author_id, metadata, synced_at, pinned)
       VALUES (?, 'google_drive', 'file', 'f1', 'x', 'x', null, null, 1, null, '{}', 1, 0)`,
      [itemPrimaryKey("google_drive", "f1")],
    );

    const cur = encodeDriveSyncCursor({ v: 1, phase: "drain", changePage: "t0" });
    const r = await syncable.sync(ctx, cur);
    expect(r.itemsDeleted).toBe(1);
    expect(r.hasMore).toBe(false);
    const dec = decodeDriveSyncCursor(r.cursor ?? "");
    expect(dec).toEqual({ v: 1, phase: "delta", pageToken: "next-delta" });
    const row = db
      .query("SELECT id FROM item WHERE id = ?")
      .get(itemPrimaryKey("google_drive", "f1"));
    expect(row).toBeNull();
  });

  test("legacy list page token migrates with fresh start token", async () => {
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
    const syncable = createGoogleDriveSyncable({ ensureGoogleDriveRunning: async () => {} });

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("startPageToken")) {
        return new Response(JSON.stringify({ startPageToken: "freshT0" }), { status: 200 });
      }
      if (url.includes("/drive/v3/files") && url.includes("pageToken=legacyPage")) {
        return new Response(JSON.stringify({ files: [], nextPageToken: undefined }), {
          status: 200,
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const r = await syncable.sync(ctx, "legacyPage");
    expect(r.hasMore).toBe(true);
    expect(decodeDriveSyncCursor(r.cursor ?? "")).toEqual({
      v: 1,
      phase: "drain",
      changePage: "freshT0",
    });
  });

  test("corrupt prefixed cursor throws", async () => {
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
    const syncable = createGoogleDriveSyncable({ ensureGoogleDriveRunning: async () => {} });
    globalThis.fetch = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;

    await expect(syncable.sync(ctx, "nimbus-gdrv1:!!!")).rejects.toThrow(/corrupt cursor/);
  });
});
