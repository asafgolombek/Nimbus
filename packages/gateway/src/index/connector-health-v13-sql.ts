/**
 * Phase 3.5 Workstream 2 — Connector health state columns + history table (user_version 13).
 *
 * Adds health tracking columns to `sync_state` and a new `connector_health_history`
 * table so the scheduler, diag, and doctor commands can observe connector health
 * transitions over time.
 */

export const CONNECTOR_HEALTH_V13_SQL = `
ALTER TABLE sync_state ADD COLUMN health_state TEXT NOT NULL DEFAULT 'healthy'
  CHECK(health_state IN ('healthy','degraded','error','rate_limited','unauthenticated','paused'));
ALTER TABLE sync_state ADD COLUMN retry_after INTEGER;
ALTER TABLE sync_state ADD COLUMN backoff_until INTEGER;
ALTER TABLE sync_state ADD COLUMN backoff_attempt INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sync_state ADD COLUMN last_error TEXT;

CREATE TABLE IF NOT EXISTS connector_health_history (
  id           INTEGER PRIMARY KEY,
  connector_id TEXT NOT NULL,
  from_state   TEXT,
  to_state     TEXT NOT NULL,
  reason       TEXT,
  occurred_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chh_connector_occurred
  ON connector_health_history(connector_id, occurred_at DESC);
`;
