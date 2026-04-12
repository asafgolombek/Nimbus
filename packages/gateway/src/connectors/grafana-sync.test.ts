import { expect, test } from "bun:test";
import {
  createMemoryIndexDb,
  createStubVault,
  describeWithFetchRestore,
  EMPTY_NIMBUS_VAULT,
  silentSyncContextExtras,
  testConnectorSyncNoop,
} from "./connector-sync-test-helpers.ts";
import { createGrafanaSyncable } from "./grafana-sync.ts";

describeWithFetchRestore("grafana-sync", () => {
  testConnectorSyncNoop(
    "no-op when credentials missing",
    () => createGrafanaSyncable({ ensureGrafanaMcpRunning: async () => {} }),
    EMPTY_NIMBUS_VAULT,
  );

  test("no-op when url empty", async () => {
    const sync = createGrafanaSyncable({ ensureGrafanaMcpRunning: async () => {} });
    const ctx = {
      vault: createStubVault({ "grafana.url": "", "grafana.api_token": "t" }),
      db: createMemoryIndexDb(),
      ...silentSyncContextExtras(),
    };
    const r = await sync.sync(ctx, null);
    expect(r.itemsUpserted).toBe(0);
  });
});
