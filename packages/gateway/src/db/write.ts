/**
 * Central DB write wrapper — catches SQLITE_FULL (error code 13), sets the
 * disk-space warning flag and re-throws as `DiskFullError` so callers can
 * abort cleanly without leaving partial writes.
 *
 * All DB write paths in the gateway MUST go through `dbRun` / `dbExec` so
 * that `SQLITE_FULL` is never swallowed silently.
 */

import type { Database } from "bun:sqlite";

// ─── Disk-full state ────────────────────────────────────────────────────────

let _diskSpaceWarning = false;
const _diskFullListeners: Array<() => void> = [];

/** True after the first SQLITE_FULL event since process start. */
export function isDiskSpaceWarning(): boolean {
  return _diskSpaceWarning;
}

/** Imperatively set (used by polling path in db/health.ts). */
export function setDiskSpaceWarning(value: boolean): void {
  const prev = _diskSpaceWarning;
  _diskSpaceWarning = value;
  if (!prev && value) {
    for (const fn of _diskFullListeners) {
      try {
        fn();
      } catch {
        /* notification errors must never crash the write path */
      }
    }
  }
}

/** Register a one-time-per-transition callback for disk-full events. */
export function onDiskFull(fn: () => void): () => void {
  _diskFullListeners.push(fn);
  return () => {
    const idx = _diskFullListeners.indexOf(fn);
    if (idx !== -1) {
      _diskFullListeners.splice(idx, 1);
    }
  };
}

// ─── DiskFullError ───────────────────────────────────────────────────────────

export class DiskFullError extends Error {
  override readonly cause: unknown;
  constructor(cause: unknown) {
    super("SQLite database is full — free disk space and retry");
    this.name = "DiskFullError";
    this.cause = cause;
  }
}

// ─── SQLITE_FULL detection ───────────────────────────────────────────────────

/** SQLite extended error code for SQLITE_FULL (13). */
const SQLITE_FULL = 13;

function isSqliteFull(err: unknown): boolean {
  if (err === null || typeof err !== "object") {
    return false;
  }
  const e = err as Record<string, unknown>;
  // bun:sqlite throws SQLiteError with a numeric `code` property
  const code = e["code"];
  if (typeof code === "number") {
    return (code & 0xff) === SQLITE_FULL;
  }
  // Fallback: check errno string used by some builds
  if (typeof code === "string") {
    return code === "SQLITE_FULL";
  }
  return false;
}

function handleWriteError(err: unknown): never {
  if (isSqliteFull(err)) {
    setDiskSpaceWarning(true);
    throw new DiskFullError(err);
  }
  throw err;
}

// ─── Public write helpers ────────────────────────────────────────────────────

/**
 * Execute a single parameterised SQL statement.
 * Converts SQLITE_FULL into `DiskFullError`.
 */
export function dbRun(db: Database, sql: string, params?: unknown[]): void {
  try {
    if (params !== undefined && params.length > 0) {
      db.run(sql, params as Parameters<Database["run"]>[1]);
    } else {
      db.run(sql);
    }
  } catch (err) {
    handleWriteError(err);
  }
}

/**
 * Execute one or more SQL statements (no parameters).
 * Converts SQLITE_FULL into `DiskFullError`.
 */
export function dbExec(db: Database, sql: string): void {
  try {
    db.exec(sql);
  } catch (err) {
    handleWriteError(err);
  }
}
