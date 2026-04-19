export const AUDIT_CHAIN_V18_SCHEMA_SQL = `
ALTER TABLE audit_log ADD COLUMN row_hash TEXT;
ALTER TABLE audit_log ADD COLUMN prev_hash TEXT;

CREATE TABLE IF NOT EXISTS _meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO _meta (key, value) VALUES ('audit_verified_through_id', '0');
`;
