/**
 * Shared loop + message-protocol types for the S10 SQLite contention
 * Worker scripts. Each per-role worker (sync/watcher/audit) supplies a
 * `doOneWrite` callback; this module owns:
 *  - the time-bounded loop (durationMs deadline + AbortSignal);
 *  - the BEGIN IMMEDIATE + 100 ms retry budget on SQLITE_BUSY;
 *  - the writes / busyRetries counters;
 *  - the message-protocol shape that runWorkerBench (../worker-bench.ts) drives.
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

/**
 * Minimal Worker-globals shape — `self.postMessage` + `self.onmessage`.
 * Each per-role worker script imports `self` from its Worker context and
 * passes it here so `runWorkerEntry` can drive the protocol without
 * reaching into module-global state itself.
 */
export interface WorkerSelf {
  postMessage: (msg: WorkerMsg) => void;
  onmessage: ((e: MessageEvent<unknown>) => Promise<void> | void) | null;
}

export interface WorkerEntryHooks<TConfig> {
  /** Called once during init. Should construct/seed the DB and return the per-write fn. */
  init: (config: TConfig, dbPath: string) => { doOneWrite: () => void };
}

/**
 * Wires the standard init → ready → start → done|error message protocol on
 * `worker`. Each per-role worker file (sync/watcher/audit) collapses to:
 *   import { runWorkerEntry } from "./sqlite-worker-shared.ts";
 *   runWorkerEntry(self as unknown as WorkerSelf, { init: ... });
 * Owns the AbortController, stop-flag, error-shape mapping, and timing.
 */
export function runWorkerEntry<TConfig>(
  worker: WorkerSelf,
  hooks: WorkerEntryHooks<TConfig>,
): void {
  let doOneWrite: (() => void) | null = null;
  let stopRequested = false;

  const post = (msg: WorkerMsg): void => worker.postMessage(msg);

  worker.onmessage = async (e: MessageEvent<unknown>): Promise<void> => {
    const msg = e.data as ParentMsg;
    try {
      if (msg.kind === "init") {
        const r = hooks.init(msg.config as TConfig, msg.dbPath);
        doOneWrite = r.doOneWrite;
        post({ kind: "ready" });
        return;
      }
      if (msg.kind === "stop") {
        stopRequested = true;
        return;
      }
      if (msg.kind === "start") {
        if (doOneWrite === null) throw new Error("doOneWrite not initialised");
        const fn = doOneWrite;
        const ac = new AbortController();
        const checkStop = setInterval(() => {
          if (stopRequested) ac.abort();
        }, 50);
        try {
          const result = await runWorkerLoop({
            durationMs: msg.durationMs,
            signal: ac.signal,
            deps: {
              doOneWrite: fn,
              now: () => performance.now(),
              sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
            },
          });
          post({ kind: "done", writes: result.writes, busyRetries: result.busyRetries });
        } finally {
          clearInterval(checkStop);
        }
      }
    } catch (err) {
      post({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
        ...(err instanceof Error && err.stack !== undefined ? { stack: err.stack } : {}),
      });
    }
  };
}
