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
  type SpawnAndTimeOptions,
  type SpawnMode,
  spawnAndTimeToMarker,
} from "./process-spawn-bench.ts";
export {
  type IncompleteContext,
  installIncompleteSignalHandler,
  writeIncompleteLine,
} from "./signal-handler.ts";
export {
  CLI_COLD_SAMPLES_PER_RUN,
  runCliOverheadColdOnce,
} from "./surfaces/bench-cli-overhead-cold.ts";
export {
  CLI_WARM_SAMPLES_PER_RUN,
  runCliOverheadWarmOnce,
} from "./surfaces/bench-cli-overhead-warm.ts";
export {
  COLD_START_SAMPLES_PER_RUN,
  runColdStartOnce,
} from "./surfaces/bench-cold-start.ts";
export {
  runDashboardFirstPaintOnce,
  S3_STUB_REASON,
} from "./surfaces/bench-dashboard-first-paint.ts";
export {
  runHitlPopupOnce,
  S5_STUB_REASON,
} from "./surfaces/bench-hitl-popup.ts";
export { runQueryLatency1mOnce, S2C_TIER } from "./surfaces/bench-query-latency-1m.ts";
export { runQueryLatency100kOnce, S2B_TIER } from "./surfaces/bench-query-latency-100k.ts";
export {
  runTuiFirstPaintOnce,
  TUI_FIRST_PAINT_SAMPLES_PER_RUN,
} from "./surfaces/bench-tui-first-paint.ts";
export type {
  BenchRunOptions,
  BenchSurfaceId,
  BenchSurfaceResult,
  CorpusTier,
  RunnerKind,
} from "./types.ts";
