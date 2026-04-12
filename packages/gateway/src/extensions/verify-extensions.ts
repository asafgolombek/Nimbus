import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "pino";

import {
  type ExtensionRow,
  listExtensions,
  touchExtensionVerifiedAt,
} from "../automation/extension-store.ts";
import { readIndexedUserVersion } from "../index/migrations/runner.ts";
import { EXTENSION_MANIFEST_FILENAME, parseExtensionManifestJson } from "./manifest.ts";

function sha256HexOfBytes(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function verifyOneExtension(db: Database, logger: Logger, row: ExtensionRow, now: number): void {
  const manifestPath = join(row.install_path, EXTENSION_MANIFEST_FILENAME);
  try {
    if (!existsSync(manifestPath)) {
      logger.warn({ extensionId: row.id, manifestPath }, "extensions: manifest file missing");
      touchExtensionVerifiedAt(db, row.id, now);
      return;
    }
    const manifestBytes = readFileSync(manifestPath);
    const manifestHex = sha256HexOfBytes(manifestBytes);
    if (manifestHex !== row.manifest_hash) {
      logger.warn(
        { extensionId: row.id, expected: row.manifest_hash, actual: manifestHex },
        "extensions: manifest hash mismatch",
      );
    }
    const manifest = parseExtensionManifestJson(manifestBytes.toString("utf8"));
    if (manifest.id !== row.id || manifest.version !== row.version) {
      logger.warn(
        { extensionId: row.id, manifestId: manifest.id, manifestVersion: manifest.version },
        "extensions: manifest id/version differs from registry",
      );
    }
    const entryRel =
      manifest.entry !== undefined && manifest.entry !== "" ? manifest.entry : "dist/index.js";
    const entryPath = join(row.install_path, entryRel);
    if (!existsSync(entryPath)) {
      logger.warn({ extensionId: row.id, entryPath }, "extensions: entry file missing");
      touchExtensionVerifiedAt(db, row.id, now);
      return;
    }
    const entryBytes = readFileSync(entryPath);
    const entryHex = sha256HexOfBytes(entryBytes);
    if (entryHex !== row.entry_hash) {
      logger.warn(
        { extensionId: row.id, expected: row.entry_hash, actual: entryHex },
        "extensions: entry hash mismatch",
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn({ extensionId: row.id, err: msg }, "extensions: verify failed");
  }
  touchExtensionVerifiedAt(db, row.id, now);
}

/**
 * Verifies enabled extensions: manifest + entry file SHA-256 vs registry columns.
 * Logs warnings on mismatch; updates `last_verified_at` when checks complete.
 */
export function verifyExtensionsBestEffort(db: Database, logger: Logger): void {
  if (readIndexedUserVersion(db) < 10) {
    return;
  }
  const rows = listExtensions(db).filter((r) => r.enabled === 1);
  if (rows.length === 0) {
    return;
  }
  const now = Date.now();
  for (const row of rows) {
    verifyOneExtension(db, logger, row, now);
  }
}
