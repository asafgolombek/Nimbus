import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createMemoryIndexDb,
  EMPTY_NIMBUS_VAULT,
  expectServiceItemCount,
  silentSyncContextExtras,
  syncTestContext,
  testConnectorSyncNoop,
} from "./connector-sync-test-helpers.ts";
import { createFilesystemV2Syncable } from "./filesystem-v2-sync.ts";

testConnectorSyncNoop(
  "no-op when no roots configured",
  () => createFilesystemV2Syncable({ roots: [] }),
  EMPTY_NIMBUS_VAULT,
);

test("indexes dependencies from package.json in a root", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nimbus-fsv2-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      dependencies: { lodash: "^4.17.21" },
      devDependencies: { typescript: "~5.0.0" },
    }),
  );
  const sync = createFilesystemV2Syncable({
    roots: [
      {
        path: dir,
        gitAware: false,
        codeIndex: false,
        dependencyGraph: true,
        exclude: ["node_modules", ".git"],
      },
    ],
  });
  const db = createMemoryIndexDb();
  const r = await sync.sync(syncTestContext(db, EMPTY_NIMBUS_VAULT), null);
  expect(r.itemsUpserted).toBeGreaterThanOrEqual(2);
  expectServiceItemCount(db, "filesystem", 2);
});

test("indexes exported symbol from a TypeScript file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nimbus-fsv2-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "mod.ts"), "export function helloWorld() { return 1; }\n");
  const sync = createFilesystemV2Syncable({
    roots: [
      {
        path: dir,
        gitAware: false,
        codeIndex: true,
        dependencyGraph: false,
        exclude: ["node_modules", ".git"],
      },
    ],
  });
  const db = createMemoryIndexDb();
  const r = await sync.sync({ db, vault: EMPTY_NIMBUS_VAULT, ...silentSyncContextExtras() }, null);
  expect(r.itemsUpserted).toBeGreaterThanOrEqual(1);
  const row = db
    .query("SELECT title FROM item WHERE service = 'filesystem' AND type = 'code_symbol' LIMIT 1")
    .get() as { title: string } | null;
  expect(row?.title).toContain("helloWorld");
});
