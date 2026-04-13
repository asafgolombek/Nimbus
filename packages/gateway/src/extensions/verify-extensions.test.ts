import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Logger } from "pino";

import { insertExtensionRow } from "../automation/extension-store.ts";
import { LocalIndex } from "../index/local-index.ts";
import { verifyExtensionsBestEffort } from "./verify-extensions.ts";

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
    const dir = mkdtempSync(join(tmpdir(), "nimbus-ext-vfy-"));
    const manifestPath = join(dir, "nimbus.extension.json");
    const manifestBody = JSON.stringify({ id: "bad", version: "1.0.0", name: "Bad" });
    writeFileSync(manifestPath, manifestBody, "utf8");
    const entryPath = join(dir, "dist/index.js");
    mkdirSync(join(dir, "dist"), { recursive: true });
    writeFileSync(entryPath, "console.log(1)\n", "utf8");

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
    const dir = mkdtempSync(join(tmpdir(), "nimbus-ext-vfy-entry-"));
    const manifestPath = join(dir, "nimbus.extension.json");
    const manifestBody = JSON.stringify({ id: "ent", version: "1.0.0", name: "Ent" });
    writeFileSync(manifestPath, manifestBody, "utf8");
    const entryPath = join(dir, "dist/index.js");
    mkdirSync(join(dir, "dist"), { recursive: true });
    writeFileSync(entryPath, "export {}\n", "utf8");
    const manifestBytes = readFileSync(manifestPath);
    const manifestHex = createHash("sha256").update(manifestBytes).digest("hex");

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
