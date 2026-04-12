import { expect, test } from "bun:test";
import { createAzureSyncable } from "./azure-sync.ts";
import {
  createMemoryIndexDb,
  createStubVault,
  describeWithFetchRestore,
  EMPTY_NIMBUS_VAULT,
  silentSyncContextExtras,
  testConnectorSyncNoop,
} from "./connector-sync-test-helpers.ts";

describeWithFetchRestore("azure-sync", () => {
  testConnectorSyncNoop(
    "no-op when credentials missing",
    () => createAzureSyncable({ ensureAzureMcpRunning: async () => {} }),
    EMPTY_NIMBUS_VAULT,
  );

  test("no-op when tenant empty", async () => {
    const sync = createAzureSyncable({ ensureAzureMcpRunning: async () => {} });
    const ctx = {
      vault: createStubVault({
        "azure.tenant_id": "",
        "azure.client_id": "c",
        "azure.client_secret": "s",
      }),
      db: createMemoryIndexDb(),
      ...silentSyncContextExtras(),
    };
    const r = await sync.sync(ctx, null);
    expect(r.itemsUpserted).toBe(0);
  });
});
