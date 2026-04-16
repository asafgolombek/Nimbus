/**
 * WAL-style intent record for connector removal.
 *
 * Written to SQLite *before* any removal action (index deletion + Vault deletion)
 * and cleared on success. On Gateway startup, any pending intents indicate a crash
 * mid-removal; the caller should complete the removal to eliminate orphaned credentials.
 *
 * Schema created by migration v15 (CONNECTOR_REMOVE_INTENT_V15_SQL).
 */

import type { Database } from "bun:sqlite";

/** DDL for the intent table — embedded by the v15 migration runner. */
export const CONNECTOR_REMOVE_INTENT_V15_SQL = `
CREATE TABLE IF NOT EXISTS connector_remove_intent (
  service_id  TEXT PRIMARY KEY,
  started_at  INTEGER NOT NULL
);
`;

/** Write or refresh the intent record for `serviceId` inside the caller's transaction. */
export function writeRemoveIntent(db: Database, serviceId: string): void {
  db.run(`INSERT OR REPLACE INTO connector_remove_intent (service_id, started_at) VALUES (?, ?)`, [
    serviceId,
    Date.now(),
  ]);
}

/** Remove the intent record once removal completes successfully. */
export function clearRemoveIntent(db: Database, serviceId: string): void {
  db.run(`DELETE FROM connector_remove_intent WHERE service_id = ?`, [serviceId]);
}

/**
 * Returns all service IDs with a pending remove intent (oldest first).
 * A non-empty result means a previous removal was interrupted.
 */
export function getPendingRemoveIntents(db: Database): string[] {
  const rows = db
    .query<{ service_id: string }, []>(
      `SELECT service_id FROM connector_remove_intent ORDER BY started_at ASC`,
    )
    .all();
  return rows.map((r) => r.service_id);
}
