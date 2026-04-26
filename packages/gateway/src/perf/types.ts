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
  | "S6"
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
