/**
 * S11-b — CLI invocation overhead (warm).
 *
 * Approximates "second invocation in the same shell" by running one
 * discarded warm-up invocation before the measurement loop. This warms
 * the OS file cache for the CLI entry; Bun runtime caches are inherently
 * per-process so the warm/cold distinction here is dominated by
 * file-system caching.
 *
 * Uses `nimbus help` (same as S11-a) so cold-vs-warm differs only in
 * file-cache state, not in the work the CLI does post-startup.
 *
 * 20 samples per run — each sample is one cheap invocation.
 */

import { resolve } from "node:path";

import { spawnAndTimeToMarker } from "../process-spawn-bench.ts";
import type { BenchRunOptions } from "../types.ts";

export const CLI_WARM_SAMPLES_PER_RUN = 20;
const CLI_TIMEOUT_MS = 15_000;

export interface RunOptions {
  spawn?: typeof Bun.spawn;
  cliEntry?: string;
}

function defaultCliEntry(): string {
  return resolve(import.meta.dir, "..", "..", "..", "..", "cli", "src", "index.ts");
}

export async function runCliOverheadWarmOnce(
  _opts: BenchRunOptions,
  runOpts: RunOptions = {},
): Promise<number[]> {
  const samples: number[] = [];
  const entry = runOpts.cliEntry ?? defaultCliEntry();
  const args = [entry, "help"];

  // One discarded invocation outside the loop primes the file cache.
  await spawnAndTimeToMarker({
    cmd: process.execPath,
    args,
    mode: "exit",
    timeoutMs: CLI_TIMEOUT_MS,
    ...(runOpts.spawn !== undefined && { spawn: runOpts.spawn }),
  });

  for (let i = 0; i < CLI_WARM_SAMPLES_PER_RUN; i += 1) {
    const ms = await spawnAndTimeToMarker({
      cmd: process.execPath,
      args,
      mode: "exit",
      timeoutMs: CLI_TIMEOUT_MS,
      ...(runOpts.spawn !== undefined && { spawn: runOpts.spawn }),
    });
    samples.push(ms);
  }
  return samples;
}
