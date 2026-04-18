import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalIndex } from "../index/local-index.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import { runDataExport } from "./data-export.ts";
import { runDataImport } from "./data-import.ts";

function memVault(): NimbusVault {
  const m = new Map<string, string>();
  return {
    get: async (k) => m.get(k) ?? null,
    set: async (k, v) => {
      m.set(k, v);
    },
    delete: async (k) => {
      m.delete(k);
    },
    listKeys: async (prefix) =>
      [...m.keys()].filter((k) => (prefix === undefined ? true : k.startsWith(prefix))),
  };
}

describe("data import", () => {
  const kdfParams = { t: 1, m: 1024, p: 1 } as const;

  test("round-trips vault credentials when passphrase matches", async () => {
    const sourceVault = memVault();
    await sourceVault.set("github.pat", "value_xyz");
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    const idx = new LocalIndex(db);
    const outPath = join(mkdtempSync(join(tmpdir(), "nimbus-import-")), "b.tar.gz");
    await runDataExport({
      output: outPath,
      includeIndex: false,
      passphrase: "pw",
      vault: sourceVault,
      index: idx,
      platform: "linux",
      nimbusVersion: "0.1.0",
      kdfParams,
    });

    const targetVault = memVault();
    const result = await runDataImport({
      bundlePath: outPath,
      passphrase: "pw",
      vault: targetVault,
      index: new LocalIndex(new Database(":memory:")),
    });
    expect(result.credentialsRestored).toBe(1);
    expect(await targetVault.get("github.pat")).toBe("value_xyz");
  });

  test("rollback deletes vault entries written in step 4 when a later step fails", async () => {
    const sourceVault = memVault();
    await sourceVault.set("github.pat", "value_xyz");
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    const idx = new LocalIndex(db);
    const outPath = join(mkdtempSync(join(tmpdir(), "nimbus-import-rollback-")), "b.tar.gz");
    await runDataExport({
      output: outPath,
      includeIndex: false,
      passphrase: "pw",
      vault: sourceVault,
      index: idx,
      platform: "linux",
      nimbusVersion: "0.1.0",
      kdfParams,
    });

    const targetVault = memVault();
    await expect(
      runDataImport({
        bundlePath: outPath,
        passphrase: "pw",
        vault: targetVault,
        index: new LocalIndex(new Database(":memory:")),
        injectFailureAfterVault: true,
      }),
    ).rejects.toThrow("injected failure");

    expect(await targetVault.get("github.pat")).toBeNull();
  });

  test("rejects bundle with tampered manifest hash", async () => {
    const sourceVault = memVault();
    await sourceVault.set("github.pat", "value_xyz");
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    const idx = new LocalIndex(db);
    const outDir = mkdtempSync(join(tmpdir(), "nimbus-import-tamper-"));
    const outPath = join(outDir, "b.tar.gz");
    await runDataExport({
      output: outPath,
      includeIndex: false,
      passphrase: "pw",
      vault: sourceVault,
      index: idx,
      platform: "linux",
      nimbusVersion: "0.1.0",
      kdfParams,
    });

    // Unpack, corrupt watchers.json, repack — manifest hash must no longer match.
    const { unpackBundle, packBundle } = await import("../db/tar-bundle.ts");
    const { writeFileSync } = await import("node:fs");
    const stage = mkdtempSync(join(tmpdir(), "nimbus-import-tamper-stage-"));
    await unpackBundle(outPath, stage);
    writeFileSync(join(stage, "watchers.json"), '[{"tampered":true}]');
    const tamperedPath = join(outDir, "tampered.tar.gz");
    await packBundle(stage, tamperedPath);

    await expect(
      runDataImport({
        bundlePath: tamperedPath,
        passphrase: "pw",
        vault: memVault(),
        index: new LocalIndex(new Database(":memory:")),
      }),
    ).rejects.toThrow(/integrity check failed/);
  });
});
