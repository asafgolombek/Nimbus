import { expect, test } from "bun:test";
import {
  createMemoryIndexDb,
  createStubVault,
  describeWithFetchRestore,
  EMPTY_NIMBUS_VAULT,
  silentSyncContextExtras,
  testConnectorSyncNoop,
} from "./connector-sync-test-helpers.ts";
import { createKubernetesSyncable } from "./kubernetes-sync.ts";

describeWithFetchRestore("kubernetes-sync", () => {
  testConnectorSyncNoop(
    "no-op when kubeconfig missing",
    () => createKubernetesSyncable({ ensureKubernetesMcpRunning: async () => {} }),
    EMPTY_NIMBUS_VAULT,
  );

  test("no-op when kubeconfig path is empty string", async () => {
    const sync = createKubernetesSyncable({ ensureKubernetesMcpRunning: async () => {} });
    const ctx = {
      vault: createStubVault({ "kubernetes.kubeconfig": "" }),
      db: createMemoryIndexDb(),
      ...silentSyncContextExtras(),
    };
    const r = await sync.sync(ctx, null);
    expect(r.itemsUpserted).toBe(0);
  });
});
