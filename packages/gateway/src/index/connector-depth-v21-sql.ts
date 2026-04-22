/**
 * Phase 4 Workstream 5-C — Persistent per-connector `depth` (user_version 21).
 *
 * Adds a `depth` column to `sync_state` so the Connectors panel can read and
 * write a connector's default reindex depth. Existing rows default to 'summary'
 * (the historical implicit default at reindex time).
 *
 * `depth` is consumed by UI-triggered reindex calls as the default when no
 * explicit depth parameter is supplied; routine scheduler sync is unaffected.
 */

export const CONNECTOR_DEPTH_V21_SQL = `
ALTER TABLE sync_state ADD COLUMN depth TEXT NOT NULL DEFAULT 'summary'
  CHECK(depth IN ('metadata_only','summary','full'));
`;
