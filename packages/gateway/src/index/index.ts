/**
 * Local Index — bun:sqlite metadata store (FTS5 + sqlite-vec embeddings from schema v6)
 *
 * See architecture.md §Local Database Schema.
 */

export {
  type AuditEntry,
  type IndexSearchQuery,
  LocalIndex,
  RAW_META_MAX_BYTES,
} from "./local-index.ts";
export { INITIAL_SCHEMA_SQL } from "./schema-sql.ts";
