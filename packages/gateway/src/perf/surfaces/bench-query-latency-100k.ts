/**
 * S2-b — Query p95 on the 100 K-row corpus tier.
 *
 * Wraps runQueryLatencyOnce with `corpus: "medium"` pinned. The wrapper
 * exists so § 6 acceptance criterion 7 (every SLO row maps to a
 * surfaces/bench-*.ts driver) reads cleanly when scanning the directory.
 */

import type { BenchRunOptions, CorpusTier } from "../types.ts";
import { type RunOptions as BaseRunOptions, runQueryLatencyOnce } from "./bench-query-latency.ts";

export const S2B_TIER: CorpusTier = "medium";

export interface RunOptions extends BaseRunOptions {
  /** Test-only: bypass the pinned tier with a smaller one for fast unit tests. */
  overrideTier?: CorpusTier;
}

export async function runQueryLatency100kOnce(
  opts: BenchRunOptions,
  runOpts: RunOptions = {},
): Promise<number[]> {
  const tier: CorpusTier = runOpts.overrideTier ?? S2B_TIER;
  const baseOpts: BaseRunOptions = {};
  if (runOpts.cacheDir !== undefined) baseOpts.cacheDir = runOpts.cacheDir;
  return runQueryLatencyOnce({ ...opts, corpus: tier }, baseOpts);
}
