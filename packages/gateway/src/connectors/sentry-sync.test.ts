import { expect, test } from "bun:test";
import {
  createMemoryIndexDb,
  createStubVault,
  describeWithFetchRestore,
  EMPTY_NIMBUS_VAULT,
  silentSyncContextExtras,
  testConnectorSyncNoop,
} from "./connector-sync-test-helpers.ts";
import { createSentrySyncable } from "./sentry-sync.ts";

describeWithFetchRestore("sentry-sync", () => {
  testConnectorSyncNoop(
    "no-op when credentials missing",
    () => createSentrySyncable({ ensureSentryMcpRunning: async () => {} }),
    EMPTY_NIMBUS_VAULT,
  );

  test("no-op when org empty", async () => {
    const sync = createSentrySyncable({ ensureSentryMcpRunning: async () => {} });
    const ctx = {
      vault: createStubVault({ "sentry.auth_token": "t", "sentry.org_slug": "" }),
      db: createMemoryIndexDb(),
      ...silentSyncContextExtras(),
    };
    const r = await sync.sync(ctx, null);
    expect(r.itemsUpserted).toBe(0);
  });
});
