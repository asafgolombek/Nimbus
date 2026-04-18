import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalIndex } from "../index/local-index.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import { runDataExport } from "./data-export.ts";

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

describe("data export", () => {
  test("produces a tarball with manifest.json and writes the recovery seed on first run", async () => {
    const vault = memVault();
    await vault.set("github.pat", "secret_value_xyz");
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    const idx = new LocalIndex(db);
    const outPath = join(mkdtempSync(join(tmpdir(), "nimbus-export-")), "backup.tar.gz");

    const result = await runDataExport({
      output: outPath,
      includeIndex: false,
      passphrase: "passphrase",
      vault,
      index: idx,
      platform: "linux",
      nimbusVersion: "0.1.0",
      kdfParams: { t: 1, m: 1024, p: 1 },
    });

    expect(result.outputPath).toBe(outPath);
    expect(result.recoverySeedGenerated).toBe(true);
    expect(result.recoverySeed.split(" ")).toHaveLength(24);
  });

  test("second export reuses the existing seed (generated=false)", async () => {
    const vault = memVault();
    const db2 = new Database(":memory:");
    LocalIndex.ensureSchema(db2);
    const idx = new LocalIndex(db2);
    const outDir = mkdtempSync(join(tmpdir(), "nimbus-export2-"));

    await runDataExport({
      output: join(outDir, "a.tar.gz"),
      includeIndex: false,
      passphrase: "pw",
      vault,
      index: idx,
      platform: "linux",
      nimbusVersion: "0.1.0",
      kdfParams: { t: 1, m: 1024, p: 1 },
    });
    const second = await runDataExport({
      output: join(outDir, "b.tar.gz"),
      includeIndex: false,
      passphrase: "pw",
      vault,
      index: idx,
      platform: "linux",
      nimbusVersion: "0.1.0",
      kdfParams: { t: 1, m: 1024, p: 1 },
    });
    expect(second.recoverySeedGenerated).toBe(false);
    expect(readdirSync(outDir).sort()).toEqual(["a.tar.gz", "b.tar.gz"]);
  });
});
