/**
 * S10 — SQLite write contention.
 *
 * Drives three Workers (sync / watcher / audit) against a shared
 * bun:sqlite database for `durationMs`, sampling `totalThroughputPerSec`
 * across the fleet. `totalBusyRetries` is accumulated onto a
 * module-private sentinel so bench-cli can fold it into the surface
 * entry as `busy_retries` without a samples-array contract change.
 *
 * D-2 (plan): no PRAGMA journal_mode = WAL. Workers call
 * LocalIndex.ensureSchema which leaves the rollback-journal default,
 * matching production and giving the heaviest writer contention.
 *
 * D-5 (plan): the driver does NOT reset the sentinel. bench-cli's
 * processSurface clears `S10_BUSY_RETRIES.value = 0` once before the
 * runBench loop; this driver `+=` accumulates per invocation so after
 * `runs` calls the sentinel holds the SUM of retries across all runs.
 *
 * resultKind = "throughput" → samples[i] is items/sec for run i;
 * harness returns median across runs.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { BenchRunOptions } from "../types.ts";
import { runWorkerBench } from "../worker-bench.ts";

export interface SqliteContentionRunOptions {
  durationMs?: number;
  WorkerCtor?: typeof Worker;
}

const DEFAULT_DURATION_MS = 5_000;

/**
 * Module-private sentinel — bench-cli RESETS once before the runBench
 * loop and READS once after; this driver only ACCUMULATES.
 *
 * The samples[] return contract from `SurfaceFn` is `number[]`, which
 * cannot carry a second metric without a schema change. Spec §6.6
 * permits this side-channel because busyRetries is a single scalar
 * per run-set, not per-sample data.
 */
export const S10_BUSY_RETRIES: { value: number } = { value: 0 };

function workerUrl(name: string): URL {
  // pathToFileURL handles Windows drive letters + percent-encoding per the
  // Node URL spec, replacing the brittle `path.replace(/\\/g, "/")` shim.
  return pathToFileURL(resolve(import.meta.dir, `${name}.ts`));
}

export async function runSqliteContentionOnce(
  _opts: BenchRunOptions,
  runOpts: SqliteContentionRunOptions = {},
): Promise<number[]> {
  const durationMs = runOpts.durationMs ?? DEFAULT_DURATION_MS;
  const home = mkdtempSync(join(tmpdir(), "nimbus-bench-s10-"));
  const dbPath = join(home, "nimbus.db");
  try {
    const result = await runWorkerBench({
      workers: [
        { name: "sync", url: workerUrl("sqlite-worker-sync"), config: { batchSize: 100 } },
        { name: "watcher", url: workerUrl("sqlite-worker-watcher"), config: {} },
        { name: "audit", url: workerUrl("sqlite-worker-audit"), config: {} },
      ],
      durationMs,
      sharedDbPath: dbPath,
      ...(runOpts.WorkerCtor !== undefined && { WorkerCtor: runOpts.WorkerCtor }),
    });
    // D-5: accumulate, do not overwrite. bench-cli owns the reset.
    S10_BUSY_RETRIES.value += result.totalBusyRetries;
    return [result.totalThroughputPerSec];
  } finally {
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {
      // Windows holds the SQLite file lock briefly after Worker.terminate().
      // Leaving the temp dir is not worth retrying — TMPDIR cleanup catches it.
    }
  }
}
