import { afterEach, describe, expect, test } from "bun:test";
import { itemPrimaryKey } from "../index/item-store.ts";
import { UnauthenticatedError } from "../sync/types.ts";
import {
  createOAuthConnectorTestSetup,
  expectPrefixedCursorCodecRoundTrip,
  registerGlobalFetchRestore,
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
    expectPrefixedCursorCodecRoundTrip(
      samples,
      encodeGooglePhotosSyncCursor,
      decodeGooglePhotosSyncCursor,
      "nimbus-gph1:",
    );
  });
});

describe("createGooglePhotosSyncable", () => {
  registerGlobalFetchRestore(afterEach);

  test("indexes media items from search response", async () => {
    const { db, ctx } = await createOAuthConnectorTestSetup("google");
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

  test("search request uses ALL_MEDIA filter for library-wide listing", async () => {
    const { ctx } = await createOAuthConnectorTestSetup("google");
    const syncable = createGooglePhotosSyncable({ ensureGoogleMcpRunning: async () => {} });

    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      const raw = init?.body;
      expect(typeof raw).toBe("string");
      const body = JSON.parse(raw as string) as Record<string, unknown>;
      expect(body["pageSize"]).toBe(50);
      expect(body["filters"]).toEqual({
        mediaTypeFilter: { mediaTypes: ["ALL_MEDIA"] },
      });
      return new Response(JSON.stringify({ mediaItems: [], nextPageToken: undefined }), {
        status: 200,
      });
    }) as typeof fetch;

    await syncable.sync(ctx, null);
  });

  test("401 throws UnauthenticatedError with API message", async () => {
    const { ctx } = await createOAuthConnectorTestSetup("google");
    const syncable = createGooglePhotosSyncable({ ensureGoogleMcpRunning: async () => {} });

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: "Invalid Credentials" } }), {
        status: 401,
      })) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await syncable.sync(ctx, null);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(UnauthenticatedError);
    expect((caught as Error).message).toMatch(/Invalid Credentials/);
  });
});
