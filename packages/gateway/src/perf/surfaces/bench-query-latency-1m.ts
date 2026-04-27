/**
 * S2-c — Query p95 on the 1 M-row corpus tier (reference-only).
 *
 * Reference-only because generating a 1 M-item SQLite fixture on every CI
 * run would take minutes per run. The skip is enforced at the CLI layer
 * (REFERENCE_ONLY set in bench-cli.ts) — this driver itself has no guard.
 */

import type { BenchRunOptions, CorpusTier } from "../types.ts";
import { type RunOptions as BaseRunOptions, runQueryLatencyOnce } from "./bench-query-latency.ts";

export const S2C_TIER: CorpusTier = "large";

export interface RunOptions extends BaseRunOptions {
  overrideTier?: CorpusTier;
}

export async function runQueryLatency1mOnce(
  opts: BenchRunOptions,
  runOpts: RunOptions = {},
): Promise<number[]> {
  const tier: CorpusTier = runOpts.overrideTier ?? S2C_TIER;
  const baseOpts: BaseRunOptions = {};
  if (runOpts.cacheDir !== undefined) baseOpts.cacheDir = runOpts.cacheDir;
  return runQueryLatencyOnce({ ...opts, corpus: tier }, baseOpts);
}
