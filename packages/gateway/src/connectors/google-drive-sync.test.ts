import { afterEach, describe, expect, test } from "bun:test";
import { itemPrimaryKey } from "../index/item-store.ts";
import {
  createOAuthConnectorTestSetup,
  expectPrefixedCursorCodecRoundTrip,
  registerGlobalFetchRestore,
  requestUrlString,
} from "../testing/bun-test-support.ts";
import {
  createGoogleDriveSyncable,
  type DriveSyncCursorV1,
  decodeDriveSyncCursor,
  encodeDriveSyncCursor,
} from "./google-drive-sync.ts";

type FetchMockInput = string | URL | Request;

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
    expectPrefixedCursorCodecRoundTrip(
      samples,
      encodeDriveSyncCursor,
      decodeDriveSyncCursor,
      "nimbus-gdrv1:",
    );
  });

  test("rejects invalid prefixed payload", () => {
    expect(decodeDriveSyncCursor("nimbus-gdrv1:not-base64!!!")).toBeUndefined();
  });
});

describe("createGoogleDriveSyncable", () => {
  registerGlobalFetchRestore(afterEach);

  test("null cursor: start token + files.list then drain cursor", async () => {
    const { db, ctx } = await createOAuthConnectorTestSetup("google");
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

    globalThis.fetch = (async (input: FetchMockInput) => {
      const url = requestUrlString(input);
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
    const { db, ctx } = await createOAuthConnectorTestSetup("google");
    const syncable = createGoogleDriveSyncable({ ensureGoogleDriveRunning: async () => {} });

    globalThis.fetch = (async (input: FetchMockInput) => {
      const url = requestUrlString(input);
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
    const { ctx } = await createOAuthConnectorTestSetup("google");
    const syncable = createGoogleDriveSyncable({ ensureGoogleDriveRunning: async () => {} });

    globalThis.fetch = (async (input: FetchMockInput) => {
      const url = requestUrlString(input);
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
    const { ctx } = await createOAuthConnectorTestSetup("google");
    const syncable = createGoogleDriveSyncable({ ensureGoogleDriveRunning: async () => {} });
    globalThis.fetch = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;

    await expect(syncable.sync(ctx, "nimbus-gdrv1:!!!")).rejects.toThrow(/corrupt cursor/);
  });
});
