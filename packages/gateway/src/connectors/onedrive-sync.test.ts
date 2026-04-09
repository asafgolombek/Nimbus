import { afterEach, describe, expect, test } from "bun:test";
import { itemPrimaryKey } from "../index/item-store.ts";
import {
  createOAuthConnectorTestSetup,
  expectPrefixedCursorCodecRoundTrip,
  registerGlobalFetchRestore,
  requestUrlString,
} from "../testing/bun-test-support.ts";
import {
  createOneDriveSyncable,
  decodeOneDriveSyncCursor,
  encodeOneDriveSyncCursor,
  type OneDriveSyncCursorV1,
} from "./onedrive-sync.ts";

describe("OneDrive sync cursor codec", () => {
  test("round-trip", () => {
    const samples: OneDriveSyncCursorV1[] = [
      { v: 1, nextUrl: null },
      { v: 1, nextUrl: "https://graph.microsoft.com/v1.0/me/drive/root/delta?token=x" },
    ];
    expectPrefixedCursorCodecRoundTrip(
      samples,
      encodeOneDriveSyncCursor,
      decodeOneDriveSyncCursor,
      "nimbus-odrv1:",
    );
  });
});

describe("createOneDriveSyncable", () => {
  registerGlobalFetchRestore(afterEach);

  test("upserts file items and stores deltaLink cursor", async () => {
    const { db, ctx } = await createOAuthConnectorTestSetup("microsoft");
    const syncable = createOneDriveSyncable({ ensureMicrosoftMcpRunning: async () => {} });

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = requestUrlString(input);
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
    const { db, ctx } = await createOAuthConnectorTestSetup("microsoft");
    const syncable = createOneDriveSyncable({ ensureMicrosoftMcpRunning: async () => {} });

    let call = 0;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = requestUrlString(input);
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
