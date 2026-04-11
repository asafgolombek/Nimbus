import { expect, test } from "bun:test";

import {
  createMemoryIndexDb,
  createStubVault,
  describeWithFetchRestore,
  expectServiceItemCount,
  type SyncTestFetchParams,
  silentSyncContextExtras,
  testConnectorSyncNoop,
  urlFromFetchInput,
} from "./connector-sync-test-helpers.ts";
import { createLinearSyncable } from "./linear-sync.ts";

describeWithFetchRestore("linear-sync", () => {
  testConnectorSyncNoop(
    "no-op when API key missing",
    () => createLinearSyncable({ ensureLinearMcpRunning: async () => {} }),
    createStubVault({ "linear.api_key": null }),
  );

  test("indexes issues from GraphQL response and advances cursor", async () => {
    const db = createMemoryIndexDb();
    globalThis.fetch = (async (
      input: SyncTestFetchParams[0],
      init?: SyncTestFetchParams[1],
    ): Promise<Response> => {
      const u = urlFromFetchInput(input);
      expect(u).toContain("api.linear.app/graphql");
      const body =
        init?.body !== undefined && typeof init.body === "string" ? JSON.parse(init.body) : {};
      expect(body.query).toContain("issues(");
      expect(body.query).toContain("creator");
      return new Response(
        JSON.stringify({
          data: {
            issues: {
              nodes: [
                {
                  id: "uuid-1",
                  identifier: "NIM-1",
                  title: "Ship Linear",
                  description: "Connector",
                  updatedAt: "2026-04-01T12:00:00.000Z",
                  url: "https://linear.example/NIM-1",
                  creator: {
                    id: "lin-user-1",
                    name: "Lin User",
                    email: "lin@example.com",
                  },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const sync = createLinearSyncable({ ensureLinearMcpRunning: async () => {} });
    const ctx = {
      vault: createStubVault({ "linear.api_key": "lin_api_test" }),
      db,
      ...silentSyncContextExtras(),
    };
    const r = await sync.sync(ctx, null);
    expect(r.itemsUpserted).toBe(1);
    expect(r.cursor).toContain("nimbus-lnr1:");
    expectServiceItemCount(db, "linear", 1);
    const row = db.prepare("SELECT author_id FROM item WHERE service = 'linear' LIMIT 1").get() as
      | { author_id: string | null }
      | undefined;
    expect(row?.author_id).not.toBeNull();
  });
});
