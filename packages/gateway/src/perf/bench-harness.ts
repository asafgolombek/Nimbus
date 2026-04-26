/**
 * Bench harness — runs a surface fn N times, captures samples per run,
 * computes per-run aggregates and the across-runs median (median-of-medians).
 *
 * See docs/superpowers/specs/2026-04-26-perf-audit-design.md §4.5 for the
 * aggregation contract.
 */

import { computePercentiles } from "./percentiles.ts";
import type { BenchRunOptions, BenchSurfaceId, BenchSurfaceResult } from "./types.ts";

export type SurfaceFn = (opts: BenchRunOptions) => Promise<number[]>;

function median(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export interface RunBenchDeps {
  /** Caller-injectable stderr writer (defaults to process.stderr). Tests inject a stub. */
  stderr?: (s: string) => void;
}

export async function runBench(
  surfaceId: BenchSurfaceId,
  fn: SurfaceFn,
  opts: BenchRunOptions,
  deps: RunBenchDeps = {},
): Promise<BenchSurfaceResult> {
  if (opts.runs < 1) {
    throw new Error(`runs must be >= 1 (got ${opts.runs})`);
  }
  const stderr = deps.stderr ?? ((s: string) => process.stderr.write(`${s}\n`));
  const perRunP95: number[] = [];
  const perRunP50: number[] = [];
  const perRunP99: number[] = [];
  const perRunMax: number[] = [];
  let totalSamples = 0;

  for (let i = 0; i < opts.runs; i += 1) {
    let samples: number[];
    try {
      samples = await fn(opts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error && err.stack ? err.stack : "";
      // Emit per-run failure context to stderr immediately so multi-run debugging
      // does not have to wait for the final throw to surface details.
      stderr(
        `[bench:${surfaceId}] run ${i + 1}/${opts.runs} failed: ${msg}${stack ? `\n${stack}` : ""}`,
      );
      throw new Error(`bench surface ${surfaceId} failed on run ${i + 1}/${opts.runs}: ${msg}`);
    }
    totalSamples += samples.length;
    const p = computePercentiles(samples);
    if (p.p50 !== undefined) perRunP50.push(p.p50);
    if (p.p95 !== undefined) perRunP95.push(p.p95);
    if (p.p99 !== undefined) perRunP99.push(p.p99);
    if (p.max !== undefined) perRunMax.push(p.max);
  }

  const p50Ms = median(perRunP50);
  const p95Ms = median(perRunP95);
  const p99Ms = median(perRunP99);
  const maxMs = median(perRunMax);

  return {
    surfaceId,
    samplesCount: totalSamples,
    ...(p50Ms !== undefined && { p50Ms }),
    ...(p95Ms !== undefined && { p95Ms }),
    ...(p99Ms !== undefined && { p99Ms }),
    ...(maxMs !== undefined && { maxMs }),
  };
}
