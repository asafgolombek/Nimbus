import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Logger } from "pino";

import { insertExtensionRow } from "../automation/extension-store.ts";
import { LocalIndex } from "../index/local-index.ts";
import { verifyExtensionsBestEffort, verifyOneExtensionStrict } from "./verify-extensions.ts";

function memoryLogger(): { logger: Logger; warns: unknown[]; errors: unknown[] } {
  const warns: unknown[] = [];
  const errors: unknown[] = [];
  const logger = {
    warn: (o: unknown, msg?: string) => {
      warns.push({ o, msg });
    },
    error: (o: unknown, msg?: string) => {
      errors.push({ o, msg });
    },
  } as Logger;
  return { logger, warns, errors };
}

function makeExtensionDir(
  prefix: string,
  id: string,
  entryContent: string,
): { dir: string; manifestHex: string; entryPath: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const manifestPath = join(dir, "nimbus.extension.json");
  writeFileSync(manifestPath, JSON.stringify({ id, version: "1.0.0", name: id }), "utf8");
  mkdirSync(join(dir, "dist"), { recursive: true });
  const entryPath = join(dir, "dist/index.js");
  writeFileSync(entryPath, entryContent, "utf8");
  const manifestHex = createHash("sha256").update(readFileSync(manifestPath)).digest("hex");
  return { dir, manifestHex, entryPath };
}

describe("verifyExtensionsBestEffort", () => {
  test("no-op below schema v10", () => {
    const db = new Database(":memory:");
    const { logger, warns } = memoryLogger();
    verifyExtensionsBestEffort(db, logger);
    expect(warns.length).toBe(0);
  });

  test("manifest hash mismatch logs error and disables extension", () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    const { dir } = makeExtensionDir("nimbus-ext-vfy-", "bad", "console.log(1)\n");

    const t = Date.now();
    insertExtensionRow(db, {
      id: "bad",
      version: "1.0.0",
      install_path: dir,
      manifest_hash: "0".repeat(64),
      entry_hash: "0".repeat(64),
      installed_at: t,
      last_verified_at: t,
    });

    const { logger, warns, errors } = memoryLogger();
    verifyExtensionsBestEffort(db, logger);
    expect(errors.some((w) => JSON.stringify(w).includes("manifest hash mismatch"))).toBe(true);
    expect(warns.length).toBe(0);
    const row = db.query("SELECT enabled FROM extension WHERE id = ?").get("bad") as {
      enabled: number;
    };
    expect(row.enabled).toBe(0);
  });

  test("entry hash mismatch logs error and disables extension", () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    const { dir, manifestHex } = makeExtensionDir("nimbus-ext-vfy-entry-", "ent", "export {}\n");

    const t = Date.now();
    insertExtensionRow(db, {
      id: "ent",
      version: "1.0.0",
      install_path: dir,
      manifest_hash: manifestHex,
      entry_hash: "0".repeat(64),
      installed_at: t,
      last_verified_at: t,
    });

    const { logger, errors } = memoryLogger();
    verifyExtensionsBestEffort(db, logger);
    expect(errors.some((w) => JSON.stringify(w).includes("entry hash mismatch"))).toBe(true);
    const row = db.query("SELECT enabled FROM extension WHERE id = ?").get("ent") as {
      enabled: number;
    };
    expect(row.enabled).toBe(0);
  });
});

describe("verifyOneExtensionStrict (S7-F3)", () => {
  test("returns true when files match, false after entry mutation", () => {
    const initialEntry = "/* original */";
    const { dir, manifestHex, entryPath } = makeExtensionDir(
      "nimbus-strict-",
      "ext.strict",
      initialEntry,
    );
    const entryHex = createHash("sha256").update(readFileSync(entryPath)).digest("hex");
    const row = {
      id: "ext.strict",
      version: "1.0.0",
      install_path: dir,
      manifest_hash: manifestHex,
      entry_hash: entryHex,
      enabled: 1 as const,
      installed_at: 0,
      last_verified_at: 0,
    };
    expect(verifyOneExtensionStrict(row)).toBe(true);
    writeFileSync(entryPath, "/* TAMPERED */", "utf8");
    expect(verifyOneExtensionStrict(row)).toBe(false);
  });

  test("returns false when manifest is mutated", () => {
    const { dir, manifestHex, entryPath } = makeExtensionDir(
      "nimbus-strict-2-",
      "ext.strict.m",
      "x",
    );
    const entryHex = createHash("sha256").update(readFileSync(entryPath)).digest("hex");
    const row = {
      id: "ext.strict.m",
      version: "1.0.0",
      install_path: dir,
      manifest_hash: manifestHex,
      entry_hash: entryHex,
      enabled: 1 as const,
      installed_at: 0,
      last_verified_at: 0,
    };
    expect(verifyOneExtensionStrict(row)).toBe(true);
    writeFileSync(
      join(dir, "nimbus.extension.json"),
      JSON.stringify({ id: "ext.strict.m", version: "1.0.0", name: "tampered" }),
      "utf8",
    );
    expect(verifyOneExtensionStrict(row)).toBe(false);
  });
});
