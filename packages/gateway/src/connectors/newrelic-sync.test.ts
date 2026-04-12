import { expect, test } from "bun:test";
import {
  createMemoryIndexDb,
  createStubVault,
  describeWithFetchRestore,
  EMPTY_NIMBUS_VAULT,
  silentSyncContextExtras,
  testConnectorSyncNoop,
} from "./connector-sync-test-helpers.ts";
import { createNewrelicSyncable } from "./newrelic-sync.ts";

describeWithFetchRestore("newrelic-sync", () => {
  testConnectorSyncNoop(
    "no-op when api key missing",
    () => createNewrelicSyncable({ ensureNewrelicMcpRunning: async () => {} }),
    EMPTY_NIMBUS_VAULT,
  );

  test("no-op when key empty string", async () => {
    const sync = createNewrelicSyncable({ ensureNewrelicMcpRunning: async () => {} });
    const ctx = {
      vault: createStubVault({ "newrelic.api_key": "" }),
      db: createMemoryIndexDb(),
      ...silentSyncContextExtras(),
    };
    const r = await sync.sync(ctx, null);
    expect(r.itemsUpserted).toBe(0);
  });
});
