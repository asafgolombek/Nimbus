// packages/gateway/src/perf/index.ts

export { type BenchCliDeps, runBenchCli } from "./bench-cli.ts";
export { runBench, type SurfaceFn } from "./bench-harness.ts";
export {
  appendHistoryLine,
  type HistoryLine,
  type HistoryLineSurface,
} from "./history-line.ts";
export { computePercentiles, type PercentileResult } from "./percentiles.ts";
export { buildSyntheticIndex, FIXTURE_SEED, FIXTURE_TIER_SIZES } from "./perf-fixture.ts";
export {
  type IncompleteContext,
  installIncompleteSignalHandler,
  writeIncompleteLine,
} from "./signal-handler.ts";
export type {
  BenchRunOptions,
  BenchSurfaceId,
  BenchSurfaceResult,
  CorpusTier,
  RunnerKind,
} from "./types.ts";
