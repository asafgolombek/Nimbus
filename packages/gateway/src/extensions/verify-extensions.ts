import type { Database } from "bun:sqlite";
import type { Logger } from "pino";

import { readIndexedUserVersion } from "../index/migrations/runner.ts";

/**
 * Phase 3 stub — full manifest + entry hash verification ships with Extension Registry CLI.
 * Currently logs enabled rows for observability.
 */
export function verifyExtensionsBestEffort(db: Database, logger: Logger): void {
  if (readIndexedUserVersion(db) < 10) {
    return;
  }
  const rows = db
    .query(`SELECT id, version, enabled, install_path FROM extension WHERE enabled = 1`)
    .all() as Array<{ id: string; version: string; enabled: number; install_path: string }>;
  if (rows.length === 0) {
    return;
  }
  logger.info({ count: rows.length }, "extensions: enabled rows present (hash verify deferred)");
}
