/**
 * Shared loop + message-protocol types for the S10 SQLite contention
 * Worker scripts. Each per-role worker (sync/watcher/audit) supplies a
 * `doOneWrite` callback; this module owns:
 *  - the time-bounded loop (durationMs deadline + AbortSignal);
 *  - the BEGIN IMMEDIATE + 100 ms retry budget on SQLITE_BUSY;
 *  - the writes / busyRetries counters;
 *  - the message-protocol shape that runWorkerBench (../worker-bench.ts) drives.
 *
 * See docs/superpowers/specs/2026-04-27-perf-audit-cluster-c-design.md §6.5.
 */

const SQLITE_BUSY = 5;
const BUSY_RETRY_MS = 100;

export type ParentMsg =
  | { kind: "init"; config: Record<string, unknown>; dbPath: string }
  | { kind: "start"; durationMs: number }
  | { kind: "stop" };

export type WorkerMsg =
  | { kind: "ready" }
  | { kind: "done"; writes: number; busyRetries: number }
  | { kind: "error"; message: string; stack?: string };

function isSqliteBusy(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === "number") return (code & 0xff) === SQLITE_BUSY;
  if (typeof code === "string") return code === "SQLITE_BUSY";
  // bun:sqlite SQLiteError messages also include "database is locked"
  const msg = (err as { message?: unknown }).message;
  return typeof msg === "string" && /database is locked/i.test(msg);
}

export interface WorkerLoopDeps {
  /** Performs one write inside its own BEGIN IMMEDIATE. Must throw on SQLITE_BUSY. */
  doOneWrite: () => void;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export interface WorkerLoopOptions {
  durationMs: number;
  signal?: AbortSignal;
  deps: WorkerLoopDeps;
}

export async function runWorkerLoop(
  opts: WorkerLoopOptions,
): Promise<{ writes: number; busyRetries: number }> {
  const start = opts.deps.now();
  const deadline = start + opts.durationMs;
  let writes = 0;
  let busyRetries = 0;
  while (opts.deps.now() < deadline) {
    if (opts.signal?.aborted === true) break;
    try {
      opts.deps.doOneWrite();
      writes += 1;
    } catch (err) {
      if (!isSqliteBusy(err)) {
        throw err;
      }
      busyRetries += 1;
      await opts.deps.sleep(BUSY_RETRY_MS);
    }
  }
  return { writes, busyRetries };
}
