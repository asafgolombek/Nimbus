import { afterEach, describe, expect, test } from "bun:test";
import { itemPrimaryKey } from "../index/item-store.ts";
import {
  createOAuthConnectorTestSetup,
  expectPrefixedCursorCodecRoundTrip,
  registerGlobalFetchRestore,
  requestUrlString,
} from "../testing/bun-test-support.ts";
import {
  createOutlookSyncable,
  decodeOutlookSyncCursor,
  encodeOutlookSyncCursor,
  type OutlookSyncCursorV1,
} from "./outlook-sync.ts";

describe("Outlook sync cursor codec", () => {
  test("round-trip", () => {
    const samples: OutlookSyncCursorV1[] = [
      { v: 1, nextUrl: null },
      { v: 1, nextUrl: "https://graph.microsoft.com/v1.0/me/messages/delta?$skiptoken=a" },
    ];
    expectPrefixedCursorCodecRoundTrip(
      samples,
      encodeOutlookSyncCursor,
      decodeOutlookSyncCursor,
      "nimbus-outl1:",
    );
  });
});

describe("createOutlookSyncable", () => {
  registerGlobalFetchRestore(afterEach);

  test("indexes messages from delta page", async () => {
    const { db, ctx } = await createOAuthConnectorTestSetup("microsoft");
    const syncable = createOutlookSyncable({ ensureMicrosoftMcpRunning: async () => {} });

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = requestUrlString(input);
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
