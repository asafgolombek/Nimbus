import { expect, test } from "bun:test";
import { createAwsSyncable } from "./aws-sync.ts";
import {
  createMemoryIndexDb,
  createStubVault,
  describeWithFetchRestore,
  EMPTY_NIMBUS_VAULT,
  silentSyncContextExtras,
  testConnectorSyncNoop,
} from "./connector-sync-test-helpers.ts";

describeWithFetchRestore("aws-sync", () => {
  testConnectorSyncNoop(
    "no-op when credentials missing",
    () => createAwsSyncable({ ensureAwsMcpRunning: async () => {} }),
    EMPTY_NIMBUS_VAULT,
  );

  test("no-op when access key empty", async () => {
    const sync = createAwsSyncable({ ensureAwsMcpRunning: async () => {} });
    const ctx = {
      vault: createStubVault({
        "aws.access_key_id": "",
        "aws.secret_access_key": "x",
        "aws.default_region": "us-east-1",
      }),
      db: createMemoryIndexDb(),
      ...silentSyncContextExtras(),
    };
    const r = await sync.sync(ctx, null);
    expect(r.itemsUpserted).toBe(0);
  });
});
