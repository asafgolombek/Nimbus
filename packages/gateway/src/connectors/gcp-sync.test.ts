import { expect, test } from "bun:test";
import {
  createMemoryIndexDb,
  createStubVault,
  describeWithFetchRestore,
  EMPTY_NIMBUS_VAULT,
  silentSyncContextExtras,
  testConnectorSyncNoop,
} from "./connector-sync-test-helpers.ts";
import { createGcpSyncable } from "./gcp-sync.ts";

describeWithFetchRestore("gcp-sync", () => {
  testConnectorSyncNoop(
    "no-op when credentials missing",
    () => createGcpSyncable({ ensureGcpMcpRunning: async () => {} }),
    EMPTY_NIMBUS_VAULT,
  );

  test("no-op when project id missing", async () => {
    const sync = createGcpSyncable({ ensureGcpMcpRunning: async () => {} });
    const ctx = {
      vault: createStubVault({ "gcp.credentials_json_path": "/tmp/x.json" }),
      db: createMemoryIndexDb(),
      ...silentSyncContextExtras(),
    };
    const r = await sync.sync(ctx, null);
    expect(r.itemsUpserted).toBe(0);
  });
});
