import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    const credDir = mkdtempSync(join(tmpdir(), "nimbus-gcp-sync-test-"));
    const ctx = {
      vault: createStubVault({ "gcp.credentials_json_path": join(credDir, "x.json") }),
      db: createMemoryIndexDb(),
      ...silentSyncContextExtras(),
    };
    const r = await sync.sync(ctx, null);
    expect(r.itemsUpserted).toBe(0);
  });
});
