import { readFileSync, writeFileSync } from "node:fs";

/**
 * Overwrites the live SQLite file from a `.db.gz` snapshot (Gateway must not hold the DB open).
 */
export function restoreDbFromSnapshot(snapshotPath: string, dbPath: string): void {
  const compressed = readFileSync(snapshotPath);
  const raw = Bun.gunzipSync(compressed);
  writeFileSync(dbPath, raw);
}
