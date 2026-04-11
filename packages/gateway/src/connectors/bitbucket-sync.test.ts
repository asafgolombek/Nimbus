import { expect, test } from "bun:test";
import { createBitbucketSyncable } from "./bitbucket-sync.ts";
import {
  createMemoryIndexDb,
  createStubVault,
  describeWithFetchRestore,
  expectServiceItemCount,
  type SyncTestFetchParams,
  syncTestContext,
  testConnectorSyncNoop,
  urlFromFetchInput,
} from "./connector-sync-test-helpers.ts";

describeWithFetchRestore("bitbucket-sync", () => {
  testConnectorSyncNoop(
    "no-op when credentials missing",
    () => createBitbucketSyncable({ ensureBitbucketMcpRunning: async () => {} }),
    createStubVault({ "bitbucket.username": null, "bitbucket.app_password": null }),
  );

  test("indexes pull request after repository list and returns cursor", async () => {
    const db = createMemoryIndexDb();
    let call = 0;
    globalThis.fetch = (async (
      input: SyncTestFetchParams[0],
      init?: SyncTestFetchParams[1],
    ): Promise<Response> => {
      const u = urlFromFetchInput(input);
      call += 1;
      if (call === 1) {
        expect(u).toContain("api.bitbucket.org/2.0/repositories");
        expect(u).toContain("role=member");
        const h = new Headers(init?.headers ?? undefined);
        expect((h.get("Authorization") ?? "").startsWith("Basic ")).toBe(true);
        return new Response(
          JSON.stringify({
            values: [{ full_name: "acme/app" }],
            next: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      expect(u).toContain("repositories/acme/app/pullrequests");
      expect(u).toContain("updated_on%3E");
      return new Response(
        JSON.stringify({
          values: [
            {
              id: 7,
              title: "Fix build",
              description: "",
              state: "OPEN",
              updated_on: "2026-04-01T12:00:00.000000+00:00",
              author: {
                display_name: "Dev One",
                uuid: "{a1b2c3d4-e5f6-7890-abcd-ef1234567890}",
              },
              links: { html: { href: "https://bitbucket.org/acme/app/pull-requests/7" } },
            },
          ],
          next: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const sync = createBitbucketSyncable({ ensureBitbucketMcpRunning: async () => {} });
    const r = await sync.sync(
      syncTestContext(
        db,
        createStubVault({ "bitbucket.username": "me", "bitbucket.app_password": "app_pass" }),
      ),
      null,
    );
    expect(r.itemsUpserted).toBe(1);
    expect(r.cursor).toContain("nimbus-bbkt1:");
    expectServiceItemCount(db, "bitbucket", 1);
    const row = db
      .query("SELECT author_id FROM item WHERE service = ? AND external_id = ?")
      .get("bitbucket", "acme/app#7") as { author_id: string | null } | undefined;
    expect(row?.author_id).not.toBeNull();
  });
});
