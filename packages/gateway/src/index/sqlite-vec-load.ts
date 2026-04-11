import type { Database } from "bun:sqlite";
import { load as loadSqliteVec } from "sqlite-vec";

/**
 * Loads the sqlite-vec extension into this connection.
 * @returns false if the platform has no prebuilt binary or load fails (embeddings stay disabled).
 */
export function tryLoadSqliteVec(db: Database): boolean {
  try {
    loadSqliteVec(db);
    return true;
  } catch {
    return false;
  }
}

/**
 * Loads sqlite-vec or throws with a short, actionable message (Gateway / tests).
 */
export function loadSqliteVecOrThrow(db: Database): void {
  try {
    loadSqliteVec(db);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `sqlite-vec could not be loaded (${msg}). Embeddings require a supported platform (see sqlite-vec npm optionalDependencies).`,
    );
  }
}

/**
 * Ensures sqlite-vec is loaded on this connection when the schema includes vector tables (v6+).
 * Migrations load the extension once; reopening `nimbus.db` requires loading again per connection.
 */
export function ensureSqliteVecForConnection(db: Database, indexedUserVersion: number): boolean {
  if (indexedUserVersion < 6) {
    return true;
  }
  try {
    db.query("SELECT vec_version()").get();
    return true;
  } catch {
    return tryLoadSqliteVec(db);
  }
}
