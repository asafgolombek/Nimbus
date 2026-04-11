import { expect, test } from "bun:test";

import { createConfluenceSyncable } from "./confluence-sync.ts";
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

describeWithFetchRestore("confluence-sync", () => {
  testConnectorSyncNoop(
    "no-op when credentials missing",
    () => createConfluenceSyncable({ ensureConfluenceMcpRunning: async () => {} }),
    EMPTY_NIMBUS_VAULT,
  );

  test("indexes pages from Confluence CQL search and advances cursor", async () => {
    const db = createMemoryIndexDb();
    globalThis.fetch = (async (input: SyncTestFetchParams[0]): Promise<Response> => {
      const u = urlFromFetchInput(input);
      expect(u).toContain("example.atlassian.net/wiki/rest/api/content/search");
      expect(u).toContain("cql=");
      return new Response(
        JSON.stringify({
          results: [
            {
              type: "page",
              id: "12345",
              title: "Wiki Page",
              history: {
                lastUpdated: {
                  when: "2026-04-01T12:00:00.000+0000",
                  by: {
                    accountId: "atlassian-acct-1",
                    displayName: "Wiki Author",
                    email: "wiki.author@example.com",
                  },
                },
              },
            },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const sync = createConfluenceSyncable({ ensureConfluenceMcpRunning: async () => {} });
    const ctx = {
      vault: createStubVault({
        "confluence.email": "u@example.com",
        "confluence.api_token": "tok",
        "confluence.base_url": "https://example.atlassian.net",
      }),
      db,
      ...silentSyncContextExtras(),
    };
    const r = await sync.sync(ctx, null);
    expect(r.itemsUpserted).toBe(1);
    expect(r.cursor).toContain("nimbus-cfl1:");
    expectServiceItemCount(db, "confluence", 1);
    const row = db
      .prepare("SELECT author_id FROM item WHERE service = 'confluence' LIMIT 1")
      .get() as { author_id: string | null } | undefined;
    expect(row?.author_id).not.toBeNull();
  });
});
