/**
 * Local Index — bun:sqlite metadata store (FTS5 name search in Q1; sqlite-vec in Q3)
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
