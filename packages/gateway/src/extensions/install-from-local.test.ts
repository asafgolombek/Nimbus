import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { listExtensions } from "../automation/extension-store.ts";
import { LocalIndex } from "../index/local-index.ts";
import {
  assertSafeExtensionId,
  extensionInstallDirectory,
  installExtensionFromLocalDirectory,
} from "./install-from-local.ts";

function createExtensionInstallFixture(
  tmpPrefix: string,
  sourceBasename: string,
): {
  extensionsDir: string;
  src: string;
  db: Database;
} {
  const tmp = mkdtempSync(join(tmpdir(), tmpPrefix));
  const extensionsDir = join(tmp, "extensions");
  const src = join(tmp, sourceBasename);
  mkdirSync(join(src, "dist"), { recursive: true });
  const db = new Database(":memory:");
  LocalIndex.ensureSchema(db);
  return { extensionsDir, src, db };
}

describe("install-from-local", () => {
  test("assertSafeExtensionId rejects path traversal", () => {
    expect(() => assertSafeExtensionId("../evil")).toThrow();
    expect(() => assertSafeExtensionId("a/../b")).toThrow();
    expect(() => assertSafeExtensionId("@scope/pkg")).not.toThrow();
  });

  test("extensionInstallDirectory joins scoped id safely", () => {
    const root = join(tmpdir(), "nimbus-ext-test");
    expect(extensionInstallDirectory(root, "@acme/demo")).toBe(join(root, "@acme", "demo"));
  });

  test("installExtensionFromLocalDirectory copies, hashes, and inserts row", () => {
    const { extensionsDir, src, db } = createExtensionInstallFixture(
      "nimbus-install-ext-",
      "src-ext",
    );
    writeFileSync(
      join(src, "nimbus.extension.json"),
      JSON.stringify({
        id: "test.ext.sample",
        version: "1.0.0",
        entry: "dist/index.js",
      }),
      "utf8",
    );
    writeFileSync(join(src, "dist", "index.js"), "export {}\n", "utf8");

    const r = installExtensionFromLocalDirectory({
      db,
      extensionsDir,
      sourcePath: src,
    });
    expect(r.id).toBe("test.ext.sample");
    expect(r.version).toBe("1.0.0");
    expect(
      readFileSync(join(extensionsDir, "test.ext.sample", "dist", "index.js"), "utf8"),
    ).toContain("export {}");

    const rows = listExtensions(db);
    expect(rows.length).toBe(1);
    expect(rows[0]?.id).toBe("test.ext.sample");
    expect(rows[0]?.install_path).toBe(join(extensionsDir, "test.ext.sample"));
    expect(rows[0]?.manifest_hash.length).toBe(64);
    expect(rows[0]?.entry_hash.length).toBe(64);
  });

  test("legacy nimbus-extension.json is accepted", () => {
    const { extensionsDir, src, db } = createExtensionInstallFixture(
      "nimbus-install-legacy-",
      "src",
    );
    writeFileSync(
      join(src, "nimbus-extension.json"),
      JSON.stringify({ id: "legacy.pkg", version: "0.1.0", entry: "dist/index.js" }),
      "utf8",
    );
    writeFileSync(join(src, "dist", "index.js"), "1\n", "utf8");

    installExtensionFromLocalDirectory({ db, extensionsDir, sourcePath: src });
    expect(listExtensions(db).length).toBe(1);
  });

  test("installExtensionFromLocalDirectory accepts .tar.gz bundle", () => {
    const { extensionsDir, src, db } = createExtensionInstallFixture(
      "nimbus-install-tgz-",
      "pkg-root",
    );
    writeFileSync(
      join(src, "nimbus.extension.json"),
      JSON.stringify({ id: "bundle.tar.ext", version: "1.0.0", entry: "dist/index.js" }),
      "utf8",
    );
    writeFileSync(join(src, "dist", "index.js"), "export {}\n", "utf8");
    // Write the archive outside the tree being packed — creating a .tgz next to the
    // source folder can make Windows tar exit non-zero while the archive grows in the same directory.
    const archive = join(tmpdir(), `nimbus-ext-test-${process.pid}-${Date.now()}.tgz`);
    const tarBin = process.platform === "win32" ? "tar.exe" : "tar";
    try {
      const pack = spawnSync(tarBin, ["-czf", archive, "-C", dirname(src), basename(src)], {
        windowsHide: true,
      });
      expect(pack.status).toBe(0);

      const r = installExtensionFromLocalDirectory({
        db,
        extensionsDir,
        sourcePath: archive,
      });
      expect(r.id).toBe("bundle.tar.ext");
      expect(listExtensions(db).length).toBe(1);
    } finally {
      try {
        rmSync(archive, { force: true });
      } catch {
        /* ignore */
      }
    }
  });
});
