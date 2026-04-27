/**
 * S1 — Gateway cold start (spawn → IPC ready).
 *
 * Spawns a fresh `bun packages/gateway/src/index.ts` per sample and times
 * from spawn to the existing readiness line emitted at the end of main():
 *
 *   [gateway] ready (0.1.0) IPC /path/to/socket
 *
 * Per-sample cost is dominated by Bun runtime warm-up + PAL init + IPC bind.
 * 5 samples per run keeps each run under ~12 s.
 */

import { resolve } from "node:path";

import { spawnAndTimeToMarker } from "../process-spawn-bench.ts";
import type { BenchRunOptions } from "../types.ts";

export const COLD_START_SAMPLES_PER_RUN = 5;
const READY_MARKER = /\[gateway\] ready/;
const COLD_START_TIMEOUT_MS = 30_000;

export interface RunOptions {
  /** Test-injectable spawn (defaults to Bun.spawn). */
  spawn?: typeof Bun.spawn;
  /** Override the gateway entry path (test-only). */
  gatewayEntry?: string;
}

function defaultGatewayEntry(): string {
  // packages/gateway/src/perf/surfaces/bench-cold-start.ts → packages/gateway/src/index.ts
  return resolve(import.meta.dir, "..", "..", "index.ts");
}

export async function runColdStartOnce(
  _opts: BenchRunOptions,
  runOpts: RunOptions = {},
): Promise<number[]> {
  const samples: number[] = [];
  const entry = runOpts.gatewayEntry ?? defaultGatewayEntry();

  for (let i = 0; i < COLD_START_SAMPLES_PER_RUN; i += 1) {
    const ms = await spawnAndTimeToMarker({
      cmd: process.execPath,
      args: [entry],
      mode: "marker",
      marker: READY_MARKER,
      timeoutMs: COLD_START_TIMEOUT_MS,
      ...(runOpts.spawn !== undefined && { spawn: runOpts.spawn }),
    });
    samples.push(ms);
  }
  return samples;
}
