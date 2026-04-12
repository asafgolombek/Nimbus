import { expect, test } from "bun:test";

import { createCircleciSyncable } from "./circleci-sync.ts";
import {
  createMemoryIndexDb,
  createStubVault,
  describeWithFetchRestore,
  EMPTY_NIMBUS_VAULT,
  silentSyncContextExtras,
  testConnectorSyncNoop,
} from "./connector-sync-test-helpers.ts";

describeWithFetchRestore("circleci-sync", () => {
  testConnectorSyncNoop(
    "no-op when credentials missing",
    () => createCircleciSyncable({ ensureCircleciMcpRunning: async () => {} }),
    EMPTY_NIMBUS_VAULT,
  );

  test("no-op when token is empty string", async () => {
    const sync = createCircleciSyncable({ ensureCircleciMcpRunning: async () => {} });
    const ctx = {
      vault: createStubVault({ "circleci.api_token": "" }),
      db: createMemoryIndexDb(),
      ...silentSyncContextExtras(),
    };
    const r = await sync.sync(ctx, null);
    expect(r.itemsUpserted).toBe(0);
  });
});
