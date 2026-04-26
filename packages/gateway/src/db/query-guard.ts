/**
 * Read-only SQL guard for `nimbus query --sql` and diagnostics `index.querySql`.
 * Layer 1: keyword blocklist + PRAGMA allowlist. Layer 2: separate SQLite handle
 * opened with `readonly: true`, dispatched to a Bun Worker for wall-clock timeout.
 */

const FORBIDDEN =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|ATTACH|DETACH|REPLACE|CREATE|TRUNCATE|VACUUM)\b/i;

// S5-F2 — Layer 1 PRAGMA gate is now an allowlist, not a deny-list. Any PRAGMA
// not in this set is rejected before the read-only handle even opens. Layer 2
// (SQLITE_OPEN_READONLY) still prevents data mutation; this gate prevents
// observable side-effects (e.g. `PRAGMA optimize` writes to FTS5 shadow tables;
// `PRAGMA mmap_size` perturbs memory).
const ALLOWED_PRAGMA = new Set([
  "query_only",
  "table_info",
  "foreign_key_list",
  "index_list",
  "index_info",
  "function_list",
  "module_list",
  "collation_list",
  "database_list",
  "compile_options",
]);

const PRAGMA_RE = /\bPRAGMA\s+(\w+)/gi;

const DEFAULT_TIMEOUT_MS = 30_000;

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
  PRAGMA_RE.lastIndex = 0;
  while (true) {
    const match = PRAGMA_RE.exec(trimmed);
    if (match === null) break;
    const name = (match[1] ?? "").toLowerCase();
    if (!ALLOWED_PRAGMA.has(name)) {
      throw new SqlGuardError(`Disallowed PRAGMA in statement: ${name}`);
    }
  }
}

/**
 * Runs a single SELECT on a **dedicated** read-only SQLite handle inside a Bun Worker.
 * Times out at `options.timeoutMs` (default 30 s) by terminating the worker — protects
 * the gateway event loop from unbounded recursive CTEs (S5-F3).
 *
 * **Termination semantics.** `worker.terminate()` kills the worker on the OS
 * level; the SQLite C-call running in that worker may continue for a tick or
 * two until it next yields, but it cannot affect the gateway event loop because
 * the worker is in a separate thread context. SQLite's `sqlite3_interrupt()`
 * is not reachable through `bun:sqlite`'s public surface; if a future Bun
 * release exposes it, swap the terminate path for an interrupt-then-await.
 */
export async function runReadOnlySelect(
  dbPath: string,
  sql: string,
  options?: { timeoutMs?: number },
): Promise<Record<string, unknown>[]> {
  assertReadOnlySelectSql(sql);
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const workerUrl = new URL("./query-guard-worker.ts", import.meta.url);
  const worker = new Worker(workerUrl);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      timer = setTimeout(() => {
        worker.terminate();
        reject(new SqlGuardError(`SQL query exceeded ${timeoutMs}ms timeout — aborted`));
      }, timeoutMs);
      worker.onmessage = (e: MessageEvent<unknown>): void => {
        const msg = e.data as {
          ok: boolean;
          rows?: Record<string, unknown>[];
          message?: string;
        };
        if (msg.ok) {
          resolve(msg.rows ?? []);
        } else {
          reject(new Error(msg.message ?? "worker query failed"));
        }
      };
      worker.onerror = (ev): void => {
        reject(new Error(ev.message));
      };
      worker.postMessage({ dbPath, sql });
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    worker.terminate();
  }
}
