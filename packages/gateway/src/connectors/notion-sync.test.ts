import { expect, test } from "bun:test";

import {
  createMemoryIndexDb,
  createStubVault,
  describeWithFetchRestore,
  EMPTY_NIMBUS_VAULT,
  expectServiceItemCount,
  type SyncTestFetchParams,
  silentSyncContextExtras,
  testConnectorSyncNoop,
  urlFromFetchInput,
} from "./connector-sync-test-helpers.ts";
import { createNotionSyncable } from "./notion-sync.ts";

describeWithFetchRestore("notion-sync", () => {
  testConnectorSyncNoop(
    "no-op when notion.oauth missing",
    () => createNotionSyncable({ ensureNotionMcpRunning: async () => {} }),
    EMPTY_NIMBUS_VAULT,
  );

  test("indexes pages from Notion search and advances cursor", async () => {
    const db = createMemoryIndexDb();
    globalThis.fetch = (async (
      input: SyncTestFetchParams[0],
      init?: SyncTestFetchParams[1],
    ): Promise<Response> => {
      const u = urlFromFetchInput(input);
      expect(u).toContain("api.notion.com/v1/search");
      const body =
        init?.body !== undefined && typeof init.body === "string" ? JSON.parse(init.body) : {};
      expect(body.filter?.value).toBe("page");
      return new Response(
        JSON.stringify({
          results: [
            {
              object: "page",
              id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
              last_edited_time: "2026-04-01T12:00:00.000Z",
              created_by: { object: "user", id: "notion-user-abc" },
              properties: {
                title: {
                  type: "title",
                  title: [{ type: "text", text: { content: "Hello" } }],
                },
              },
            },
          ],
          has_more: false,
          next_cursor: null,
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const oauthPayload = JSON.stringify({
      accessToken: "notion_secret_test",
      refreshToken: "refresh_test",
      expiresAt: Date.now() + 86_400_000,
      scopes: [] as string[],
    });
    const sync = createNotionSyncable({ ensureNotionMcpRunning: async () => {} });
    const ctx = {
      vault: createStubVault({ "notion.oauth": oauthPayload }),
      db,
      ...silentSyncContextExtras(),
    };
    const r = await sync.sync(ctx, null);
    expect(r.itemsUpserted).toBe(1);
    expect(r.cursor).toContain("nimbus-ntn1:");
    expectServiceItemCount(db, "notion", 1);
    const row = db.prepare("SELECT author_id FROM item WHERE service = 'notion' LIMIT 1").get() as
      | { author_id: string | null }
      | undefined;
    expect(row?.author_id).not.toBeNull();
  });
});
