import { afterEach, describe, expect, test } from "bun:test";
import { itemPrimaryKey } from "../index/item-store.ts";
import {
  createMemoryVault,
  createSyncTestContext,
  openMemoryIndexDatabase,
  requestUrlString,
} from "../testing/bun-test-support.ts";
import {
  createGooglePhotosSyncable,
  decodeGooglePhotosSyncCursor,
  encodeGooglePhotosSyncCursor,
  type GooglePhotosSyncCursorV1,
} from "./google-photos-sync.ts";

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
    const db = openMemoryIndexDatabase();
    const ctx = createSyncTestContext(db, vault);
    const syncable = createGooglePhotosSyncable({ ensureGoogleMcpRunning: async () => {} });

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = requestUrlString(input);
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
