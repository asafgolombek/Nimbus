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
import { createJiraSyncable } from "./jira-sync.ts";

describeWithFetchRestore("jira-sync", () => {
  testConnectorSyncNoop(
    "no-op when credentials missing",
    () => createJiraSyncable({ ensureJiraMcpRunning: async () => {} }),
    EMPTY_NIMBUS_VAULT,
  );

  test("indexes issues from Jira search response and advances cursor", async () => {
    const db = createMemoryIndexDb();
    globalThis.fetch = (async (
      input: SyncTestFetchParams[0],
      init?: SyncTestFetchParams[1],
    ): Promise<Response> => {
      const u = urlFromFetchInput(input);
      expect(u).toContain("example.atlassian.net/rest/api/3/search");
      const body =
        init?.body !== undefined && typeof init.body === "string" ? JSON.parse(init.body) : {};
      expect(body.jql).toContain("updated");
      expect(body.fields).toContain("creator");
      return new Response(
        JSON.stringify({
          issues: [
            {
              id: "10001",
              key: "NIM-1",
              fields: {
                summary: "Ship Jira",
                description: { type: "doc", version: 1, content: [] },
                updated: "2026-04-01T12:00:00.000+0000",
                creator: {
                  accountId: "acct-1",
                  displayName: "Jira Author",
                  emailAddress: "jira.author@example.com",
                },
              },
            },
          ],
          startAt: 0,
          maxResults: 50,
          total: 1,
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const sync = createJiraSyncable({ ensureJiraMcpRunning: async () => {} });
    const ctx = {
      vault: createStubVault({
        "jira.email": "u@example.com",
        "jira.api_token": "tok",
        "jira.base_url": "https://example.atlassian.net",
      }),
      db,
      ...silentSyncContextExtras(),
    };
    const r = await sync.sync(ctx, null);
    expect(r.itemsUpserted).toBe(1);
    expect(r.cursor).toContain("nimbus-jra1:");
    expectServiceItemCount(db, "jira", 1);
    const row = db
      .prepare("SELECT author_id FROM item WHERE service = 'jira' LIMIT 1")
      .get() as { author_id: string | null } | undefined;
    expect(row?.author_id).not.toBeNull();
  });
});
