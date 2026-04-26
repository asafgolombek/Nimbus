import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "pino";

import {
  type ExtensionRow,
  listExtensions,
  setExtensionEnabled,
  touchExtensionVerifiedAt,
} from "../automation/extension-store.ts";
import { readIndexedUserVersion } from "../index/migrations/runner.ts";
import { parseExtensionManifestJson, resolveExtensionManifestPath } from "./manifest.ts";

function sha256HexOfBytes(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function verifyOneExtension(db: Database, logger: Logger, row: ExtensionRow, now: number): void {
  const manifestPath = resolveExtensionManifestPath(row.install_path);
  try {
    if (manifestPath === undefined) {
      logger.warn(
        { extensionId: row.id, installPath: row.install_path },
        "extensions: manifest file missing",
      );
      touchExtensionVerifiedAt(db, row.id, now);
      return;
    }
    const manifestBytes = readFileSync(manifestPath);
    const manifestHex = sha256HexOfBytes(manifestBytes);
    if (manifestHex !== row.manifest_hash) {
      logger.error(
        { extensionId: row.id, expected: row.manifest_hash, actual: manifestHex },
        "extensions: manifest hash mismatch — extension disabled",
      );
      setExtensionEnabled(db, row.id, false);
      touchExtensionVerifiedAt(db, row.id, now);
      return;
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
      logger.error(
        { extensionId: row.id, expected: row.entry_hash, actual: entryHex },
        "extensions: entry hash mismatch — extension disabled",
      );
      setExtensionEnabled(db, row.id, false);
      touchExtensionVerifiedAt(db, row.id, now);
      return;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn({ extensionId: row.id, err: msg }, "extensions: verify failed");
  }
  touchExtensionVerifiedAt(db, row.id, now);
}

/**
 * S7-F3 — strict re-verify, intended for the moment immediately before a child
 * spawn. Returns `true` when manifest+entry hashes still match the row, `false`
 * otherwise (in which case the caller must refuse to spawn). Does NOT mutate
 * the row (no side effect on enabled flag); the caller decides remediation.
 */
export function verifyOneExtensionStrict(row: ExtensionRow): boolean {
  const manifestPath = resolveExtensionManifestPath(row.install_path);
  if (manifestPath === undefined) return false;
  let manifestBytes: Buffer;
  try {
    manifestBytes = readFileSync(manifestPath);
  } catch {
    return false;
  }
  if (sha256HexOfBytes(manifestBytes) !== row.manifest_hash) return false;
  const manifest = parseExtensionManifestJson(manifestBytes.toString("utf8"));
  const entryRel =
    manifest.entry !== undefined && manifest.entry !== "" ? manifest.entry : "dist/index.js";
  const entryPath = join(row.install_path, entryRel);
  if (!existsSync(entryPath)) return false;
  let entryBytes: Buffer;
  try {
    entryBytes = readFileSync(entryPath);
  } catch {
    return false;
  }
  return sha256HexOfBytes(entryBytes) === row.entry_hash;
}

/**
 * Verifies enabled extensions: manifest + entry file SHA-256 vs registry columns.
 * Logs warnings on most issues; manifest or entry hash mismatch logs ERROR and disables the extension.
 * Updates `last_verified_at` when checks complete.
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
