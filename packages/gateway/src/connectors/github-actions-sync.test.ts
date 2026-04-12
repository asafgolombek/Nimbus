import { expect, test } from "bun:test";

import {
  createMemoryIndexDb,
  createStubVault,
  describeWithFetchRestore,
  EMPTY_NIMBUS_VAULT,
  silentSyncContextExtras,
  testConnectorSyncNoop,
} from "./connector-sync-test-helpers.ts";
import { createGithubActionsSyncable } from "./github-actions-sync.ts";

describeWithFetchRestore("github-actions-sync", () => {
  testConnectorSyncNoop(
    "no-op when github PAT missing",
    () => createGithubActionsSyncable({ ensureGithubMcpRunning: async () => {} }),
    EMPTY_NIMBUS_VAULT,
  );

  test("no-op when PAT present but no github repos in index", async () => {
    const sync = createGithubActionsSyncable({ ensureGithubMcpRunning: async () => {} });
    const ctx = {
      vault: createStubVault({ "github.pat": "ghp_test" }),
      db: createMemoryIndexDb(),
      ...silentSyncContextExtras(),
    };
    const r = await sync.sync(ctx, null);
    expect(r.itemsUpserted).toBe(0);
  });
});
