import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Logger } from "pino";

import { insertExtensionRow } from "../automation/extension-store.ts";
import { LocalIndex } from "../index/local-index.ts";
import { verifyExtensionsBestEffort } from "./verify-extensions.ts";

function memoryLogger(): { logger: Logger; warns: unknown[] } {
  const warns: unknown[] = [];
  const logger = {
    warn: (o: unknown, msg?: string) => {
      warns.push({ o, msg });
    },
  } as Logger;
  return { logger, warns };
}

describe("verifyExtensionsBestEffort", () => {
  test("no-op below schema v10", () => {
    const db = new Database(":memory:");
    const { logger, warns } = memoryLogger();
    verifyExtensionsBestEffort(db, logger);
    expect(warns.length).toBe(0);
  });

  test("warns on manifest hash mismatch", () => {
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
      manifest_hash: "deadbeef",
      entry_hash: "deadbeef",
      installed_at: t,
      last_verified_at: t,
    });

    const { logger, warns } = memoryLogger();
    verifyExtensionsBestEffort(db, logger);
    expect(warns.some((w) => JSON.stringify(w).includes("manifest hash mismatch"))).toBe(true);
  });
});
