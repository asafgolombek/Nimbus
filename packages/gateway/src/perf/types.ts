/**
 * Shared types for the perf bench harness (Phase 1A scaffolding).
 * See docs/superpowers/specs/2026-04-26-perf-audit-design.md §3 for the
 * surface table this serves.
 */

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
  | "S8"
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
}
