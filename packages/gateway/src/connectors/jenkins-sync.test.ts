import { expect, test } from "bun:test";

import {
  createMemoryIndexDb,
  createStubVault,
  describeWithFetchRestore,
  EMPTY_NIMBUS_VAULT,
  silentSyncContextExtras,
  testConnectorSyncNoop,
} from "./connector-sync-test-helpers.ts";
import { createJenkinsSyncable } from "./jenkins-sync.ts";

describeWithFetchRestore("jenkins-sync", () => {
  testConnectorSyncNoop(
    "no-op when credentials missing",
    () => createJenkinsSyncable({ ensureJenkinsMcpRunning: async () => {} }),
    EMPTY_NIMBUS_VAULT,
  );

  test("no-op when any Jenkins vault key is empty", async () => {
    const sync = createJenkinsSyncable({ ensureJenkinsMcpRunning: async () => {} });
    const ctx = {
      vault: createStubVault({
        "jenkins.base_url": "https://ci.example",
        "jenkins.username": "",
        "jenkins.api_token": "tok",
      }),
      db: createMemoryIndexDb(),
      ...silentSyncContextExtras(),
    };
    const r = await sync.sync(ctx, null);
    expect(r.itemsUpserted).toBe(0);
  });
});
