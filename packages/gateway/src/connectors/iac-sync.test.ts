import { expect, test } from "bun:test";
import {
  createMemoryIndexDb,
  createStubVault,
  describeWithFetchRestore,
  EMPTY_NIMBUS_VAULT,
  silentSyncContextExtras,
  testConnectorSyncNoop,
} from "./connector-sync-test-helpers.ts";
import { createIacSyncable } from "./iac-sync.ts";

describeWithFetchRestore("iac-sync", () => {
  testConnectorSyncNoop(
    "no-op when iac not enabled",
    () => createIacSyncable({ ensureIacMcpRunning: async () => {} }),
    EMPTY_NIMBUS_VAULT,
  );

  test("heartbeat when enabled", async () => {
    const sync = createIacSyncable({ ensureIacMcpRunning: async () => {} });
    const db = createMemoryIndexDb();
    const ctx = {
      vault: createStubVault({ "iac.enabled": "1" }),
      db,
      ...silentSyncContextExtras(),
    };
    const r = await sync.sync(ctx, null);
    expect(r.itemsUpserted).toBe(1);
    expect(r.bytesTransferred).toBe(0);
    const row = db
      .query(`SELECT id, type FROM item WHERE service = 'iac' AND external_id = 'drift_baseline'`)
      .get() as { id: string; type: string } | undefined;
    expect(row?.type).toBe("sync_heartbeat");
    expect(row?.id).toBe("iac:drift_baseline");
  });
});
