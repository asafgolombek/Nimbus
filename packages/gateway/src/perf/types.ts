/**
 * Shared types for the perf bench harness (Phase 1A scaffolding).
 * See the B2 perf audit design §3 for the
 * surface table this serves.
 */

/** Length tiers for S8 embedding throughput cells (text characters per item). */
export const S8_LENGTHS = [50, 500, 5000] as const;
export type S8Length = (typeof S8_LENGTHS)[number];

/** Batch tiers for S8 embedding throughput cells. */
export const S8_BATCHES = [1, 8, 32, 64] as const;
export type S8Batch = (typeof S8_BATCHES)[number];

/**
 * Cross-product of S8_LENGTHS × S8_BATCHES, e.g. "S8-l50-b1", "S8-l500-b32".
 * Registered in bench-cli.ts via a runtime cross-product loop (spec §6.3).
 */
export type S8SurfaceId = `S8-l${S8Length}-b${S8Batch}`;

export type BenchSurfaceId =
  | "S1"
  | "S2-a"
  | "S2-b"
  | "S2-c"
  | "S3"
  | "S4"
  | "S5"
  | "S6-drive"
  | "S6-gmail"
  | "S6-github"
  | "S7-a"
  | "S7-b"
  | "S7-c"
  | S8SurfaceId
  | "S9"
  | "S10"
  | "S11-a"
  | "S11-b";

export type RunnerKind =
  | "reference-m1air"
  | "gha-ubuntu"
  | "gha-macos"
  | "gha-windows"
  | "local-dev";

export type CorpusTier = "small" | "medium" | "large";

/**
 * How the harness should interpret a driver's `samples[]` return:
 *   - "latency"    — time-percentiles (p50/p95/p99/max in ms). Default.
 *   - "throughput" — each sample is items/sec; result.throughputPerSec = median.
 *   - "rss"        — each sample is RSS bytes; result.rssBytesP95 = p95(samples).
 */
export type BenchResultKind = "latency" | "throughput" | "rss";

export interface BenchRunOptions {
  runs: number;
  runner: RunnerKind;
  corpus?: CorpusTier;
}

export interface BenchSurfaceResult {
  surfaceId: BenchSurfaceId;
  samplesCount: number;
  p50Ms?: number;
  p95Ms?: number;
  p99Ms?: number;
  maxMs?: number;
  throughputPerSec?: number;
  tokensPerSec?: number;
  firstTokenMs?: number;
  rssBytesP95?: number;
  rawSamples?: number[];
  /**
   * S10 only — sum of SQLITE_BUSY retries across all contention Workers.
   * Surfaced so PR-C's threshold logic can choose between raw throughput
   * and retry rate per write. Spec §6.6.
   */
  busyRetries?: number;
}
