import { expect, test } from "bun:test";
import {
  createMemoryIndexDb,
  createStubVault,
  describeWithFetchRestore,
  EMPTY_NIMBUS_VAULT,
  silentSyncContextExtras,
  testConnectorSyncNoop,
} from "./connector-sync-test-helpers.ts";
import { createPagerdutySyncable } from "./pagerduty-sync.ts";

describeWithFetchRestore("pagerduty-sync", () => {
  testConnectorSyncNoop(
    "no-op when credentials missing",
    () => createPagerdutySyncable({ ensurePagerdutyMcpRunning: async () => {} }),
    EMPTY_NIMBUS_VAULT,
  );

  test("no-op when token is empty string", async () => {
    const sync = createPagerdutySyncable({ ensurePagerdutyMcpRunning: async () => {} });
    const ctx = {
      vault: createStubVault({ "pagerduty.api_token": "" }),
      db: createMemoryIndexDb(),
      ...silentSyncContextExtras(),
    };
    const r = await sync.sync(ctx, null);
    expect(r.itemsUpserted).toBe(0);
  });
});
