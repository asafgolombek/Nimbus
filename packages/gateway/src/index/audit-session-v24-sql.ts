/**
 * V24 migration — adds `session_id` column to `audit_log` and a supporting
 * index so Task 10 (`engine.getSessionTranscript`) can efficiently filter
 * audit rows by session.
 *
 * `session_id` is intentionally NOT included in the BLAKE3 audit-chain hash
 * (`computeAuditRowHash`). It is metadata for rehydration; including it
 * would invalidate every historical row and break `nimbus audit verify`.
 *
 * Purely additive — no backfill required. Existing rows get `session_id = NULL`.
 */

export const AUDIT_SESSION_V24_SCHEMA_SQL = `
ALTER TABLE audit_log ADD COLUMN session_id TEXT;
CREATE INDEX IF NOT EXISTS idx_audit_log_session_id ON audit_log(session_id);
`;
