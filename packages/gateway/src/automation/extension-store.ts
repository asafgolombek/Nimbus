import type { Database } from "bun:sqlite";

import { readIndexedUserVersion } from "../index/migrations/runner.ts";

export type ExtensionRow = {
  id: string;
  version: string;
  install_path: string;
  manifest_hash: string;
  entry_hash: string;
  enabled: number;
  installed_at: number;
  last_verified_at: number;
};

export function listExtensions(db: Database): ExtensionRow[] {
  if (readIndexedUserVersion(db) < 10) {
    return [];
  }
  return db
    .query(
      `SELECT id, version, install_path, manifest_hash, entry_hash, enabled, installed_at, last_verified_at
       FROM extension ORDER BY id`,
    )
    .all() as ExtensionRow[];
}

export function touchExtensionVerifiedAt(db: Database, id: string, ts: number): void {
  if (readIndexedUserVersion(db) < 10) {
    return;
  }
  db.run(`UPDATE extension SET last_verified_at = ? WHERE id = ?`, [ts, id]);
}
