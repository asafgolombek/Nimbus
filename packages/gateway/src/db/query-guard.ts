/**
 * Read-only SQL guard for `nimbus query --sql` and diagnostics `index.querySql`.
 * Layer 1: keyword blocklist. Layer 2: separate SQLite handle opened with `readonly: true`.
 */

import { Database } from "bun:sqlite";

const FORBIDDEN =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|ATTACH|DETACH|REPLACE|CREATE|TRUNCATE|VACUUM)\b/i;

/** Rejects obvious write PRAGMAs; allows `PRAGMA query_only` for the guard itself. */
const FORBIDDEN_PRAGMA =
  /\bPRAGMA\s+(?!query_only\b)(?:journal_mode|synchronous|locking_mode|schema_version|user_version|writable_schema|recursive_triggers|foreign_keys)\b/i;

export class SqlGuardError extends Error {
  override readonly name = "SqlGuardError";
}

export function assertReadOnlySelectSql(sql: string): void {
  const trimmed = sql.trim();
  if (trimmed === "") {
    throw new SqlGuardError("SQL statement is empty");
  }
  if (!/^\s*SELECT\b/i.test(trimmed) && !/^\s*WITH\b/i.test(trimmed)) {
    throw new SqlGuardError("Only SELECT (or WITH … SELECT) statements are allowed");
  }
  if (FORBIDDEN.test(trimmed)) {
    throw new SqlGuardError("Statement contains a forbidden keyword");
  }
  if (FORBIDDEN_PRAGMA.test(trimmed)) {
    throw new SqlGuardError("Disallowed PRAGMA in statement");
  }
}

/**
 * Runs a single SELECT on a **dedicated** read-only SQLite handle (opens `dbPath` with
 * `readonly: true`). Avoids toggling `PRAGMA query_only` on a shared read/write connection.
 */
export function runReadOnlySelect(dbPath: string, sql: string): Record<string, unknown>[] {
  assertReadOnlySelectSql(sql);
  const ro = new Database(dbPath, { readonly: true, create: false });
  try {
    return ro.query(sql).all() as Record<string, unknown>[];
  } finally {
    ro.close();
  }
}
