import { expect, test } from "bun:test";
import {
  createMemoryIndexDb,
  createStubVault,
  describeWithFetchRestore,
  EMPTY_NIMBUS_VAULT,
  silentSyncContextExtras,
  testConnectorSyncNoop,
} from "./connector-sync-test-helpers.ts";
import { createDatadogSyncable } from "./datadog-sync.ts";

describeWithFetchRestore("datadog-sync", () => {
  testConnectorSyncNoop(
    "no-op when keys missing",
    () => createDatadogSyncable({ ensureDatadogMcpRunning: async () => {} }),
    EMPTY_NIMBUS_VAULT,
  );

  test("no-op when app key empty", async () => {
    const sync = createDatadogSyncable({ ensureDatadogMcpRunning: async () => {} });
    const ctx = {
      vault: createStubVault({ "datadog.api_key": "a", "datadog.app_key": "" }),
      db: createMemoryIndexDb(),
      ...silentSyncContextExtras(),
    };
    const r = await sync.sync(ctx, null);
    expect(r.itemsUpserted).toBe(0);
  });
});
