/**
 * Phase 3 Migration 6 — embedding store (`vec_items_384` + `embedding_chunk`).
 * Requires the sqlite-vec extension to be loaded before this SQL runs.
 * See docs/roadmap.md (Phase 3 — Intelligence, semantic layer) for context.
 */
export const EMBEDDING_V6_MIGRATION_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS vec_items_384
  USING vec0(embedding float[384]);

CREATE TABLE IF NOT EXISTS embedding_chunk (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id      TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  chunk_index  INTEGER NOT NULL,
  chunk_text   TEXT NOT NULL,
  vec_rowid    INTEGER NOT NULL,
  model        TEXT NOT NULL,
  dims         INTEGER NOT NULL,
  embedded_at  INTEGER NOT NULL,
  UNIQUE(item_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_embedding_chunk_item_id ON embedding_chunk(item_id);
CREATE INDEX IF NOT EXISTS idx_embedding_chunk_model ON embedding_chunk(model);

-- Remove the vector row when a chunk row is deleted (including CASCADE from item).
CREATE TRIGGER IF NOT EXISTS embedding_chunk_ad_delete_vec384
AFTER DELETE ON embedding_chunk
FOR EACH ROW
BEGIN
  DELETE FROM vec_items_384 WHERE rowid = OLD.vec_rowid;
END;
`;

/**
 * Fallback v6 schema used when sqlite-vec cannot be loaded on the current platform
 * (e.g. macOS CI without a notarised native extension).  The embedding_chunk table
 * is created with a nullable vec_rowid so the rest of the schema (FTS5, graph, sync,
 * people, …) continues to work.  Vector-specific columns/triggers are omitted; tests
 * that genuinely exercise sqlite-vec will skip themselves via isVecLoaded().
 */
export const EMBEDDING_V6_NO_VEC_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS embedding_chunk (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id      TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  chunk_index  INTEGER NOT NULL,
  chunk_text   TEXT NOT NULL,
  vec_rowid    INTEGER,
  model        TEXT NOT NULL,
  dims         INTEGER NOT NULL,
  embedded_at  INTEGER NOT NULL,
  UNIQUE(item_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_embedding_chunk_item_id ON embedding_chunk(item_id);
CREATE INDEX IF NOT EXISTS idx_embedding_chunk_model ON embedding_chunk(model);
`;
