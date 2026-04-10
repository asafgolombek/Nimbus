import { expect, test } from "bun:test";

import { createConfluenceSyncable } from "./confluence-sync.ts";
import {
  createMemoryIndexDb,
  createStubVault,
  describeWithFetchRestore,
  EMPTY_NIMBUS_VAULT,
  silentSyncContextExtras,
  urlFromFetchInput,
} from "./connector-sync-test-helpers.ts";

describeWithFetchRestore("confluence-sync", () => {
  test("no-op when credentials missing", async () => {
    const db = createMemoryIndexDb();
    const sync = createConfluenceSyncable({ ensureConfluenceMcpRunning: async () => {} });
    const r = await sync.sync(
      { vault: EMPTY_NIMBUS_VAULT, db, ...silentSyncContextExtras() },
      null,
    );
    expect(r.itemsUpserted).toBe(0);
    expect(r.cursor).toBeNull();
  });

  test("indexes pages from Confluence CQL search and advances cursor", async () => {
    const db = createMemoryIndexDb();
    type FetchParams = Parameters<typeof fetch>;
    globalThis.fetch = (async (input: FetchParams[0]): Promise<Response> => {
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
                lastUpdated: { when: "2026-04-01T12:00:00.000+0000" },
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
    const row = db
      .prepare("SELECT COUNT(*) AS c FROM item WHERE service = ?")
      .get("confluence") as {
      c: number;
    };
    expect(row.c).toBe(1);
  });
});
