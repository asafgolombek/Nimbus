// packages/gateway/src/perf/index.ts

export { type RunBenchCiDeps, runBenchCiMain } from "./bench-ci.ts";
export { GhCli, type GhCliOptions, type GhSpawnFn, type GhSpawnResult } from "./bench-ci-gh.ts";
export { type BenchCliDeps, LINUX_ONLY_THRESHOLDS, runBenchCli } from "./bench-cli.ts";
export { runBench, type SurfaceFn } from "./bench-harness.ts";
export {
  SYNTHETIC_TEXT_DEFAULT_SEED,
  type SynthesizeTextOptions,
  synthesizeText,
} from "./fixtures/synthetic-text.ts";
export {
  type SpawnGatewayForBenchOptions,
  type SpawnGatewayResult,
  spawnGatewayForBench,
} from "./gateway-spawn-bench.ts";
export {
  appendHistoryLine,
  type HistoryLine,
  type HistoryLineSurface,
} from "./history-line.ts";
export { computePercentiles, type PercentileResult } from "./percentiles.ts";
export { buildSyntheticIndex, FIXTURE_SEED, FIXTURE_TIER_SIZES } from "./perf-fixture.ts";
export {
  COMMENT_MARKER_PREFIX,
  formatPrComment,
} from "./pr-comment-formatter.ts";
export {
  type SpawnAndTimeOptions,
  type SpawnMode,
  spawnAndTimeToMarker,
} from "./process-spawn-bench.ts";
export {
  type SampleRssOptions,
  type SampleRssResult,
  sampleRss,
} from "./rss-sampler.ts";
export {
  type IncompleteContext,
  installIncompleteSignalHandler,
  writeIncompleteLine,
} from "./signal-handler.ts";
export {
  SLO_THRESHOLDS,
  type SloThreshold,
  thresholdsBySurface,
} from "./slo-thresholds.ts";
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
  type EmbeddingThroughputOptions,
  runEmbeddingThroughputOnce,
} from "./surfaces/bench-embedding-throughput.ts";
export {
  runHitlPopupOnce,
  S5_STUB_REASON,
} from "./surfaces/bench-hitl-popup.ts";
export {
  runLlmRoundtripOnce,
  S9_STUB_REASON,
} from "./surfaces/bench-llm-roundtrip.ts";
export { runQueryLatency1mOnce, S2C_TIER } from "./surfaces/bench-query-latency-1m.ts";
export { runQueryLatency100kOnce, S2B_TIER } from "./surfaces/bench-query-latency-100k.ts";
export {
  type IpcCallFn as RssHeavySyncIpcCallFn,
  type RssHeavySyncRunOptions,
  runRssHeavySyncOnce,
} from "./surfaces/bench-rss-heavy-sync.ts";
export {
  type RssIdleRunOptions,
  runRssIdleOnce,
} from "./surfaces/bench-rss-idle.ts";
export {
  runRssMultiAgentOnce,
  S7C_REFERENCE_ONLY_REASON,
} from "./surfaces/bench-rss-multi-agent.ts";
export {
  runSqliteContentionOnce,
  S10_BUSY_RETRIES,
  type SqliteContentionRunOptions,
} from "./surfaces/bench-sqlite-contention.ts";
export {
  type IpcCallFn as SyncThroughputDriveIpcCallFn,
  runSyncThroughputDriveOnce,
  type SyncThroughputDriveRunOptions,
} from "./surfaces/bench-sync-throughput-drive.ts";
export {
  type IpcCallFn as SyncThroughputGithubIpcCallFn,
  runSyncThroughputGithubOnce,
  type SyncThroughputGithubRunOptions,
} from "./surfaces/bench-sync-throughput-github.ts";
export {
  type IpcCallFn as SyncThroughputGmailIpcCallFn,
  runSyncThroughputGmailOnce,
  type SyncThroughputGmailRunOptions,
} from "./surfaces/bench-sync-throughput-gmail.ts";
export {
  runTuiFirstPaintOnce,
  TUI_FIRST_PAINT_SAMPLES_PER_RUN,
} from "./surfaces/bench-tui-first-paint.ts";
export {
  type ParentMsg as SqliteWorkerParentMsg,
  runWorkerLoop,
  type WorkerLoopDeps,
  type WorkerLoopOptions,
  type WorkerMsg as SqliteWorkerWorkerMsg,
} from "./surfaces/sqlite-worker-shared.ts";
export {
  type ComparisonStatus,
  compareAgainstHistory,
  isFailingComparison,
  type SurfaceComparison,
} from "./threshold-comparator.ts";
export {
  type BenchResultKind,
  type BenchRunOptions,
  type BenchSurfaceId,
  type BenchSurfaceResult,
  type CorpusTier,
  type RunnerKind,
  S8_BATCHES,
  S8_LENGTHS,
  type S8Batch,
  type S8Length,
  type S8SurfaceId,
} from "./types.ts";
export {
  runWorkerBench,
  type WorkerBenchOptions,
  type WorkerBenchResult,
  type WorkerSpec,
} from "./worker-bench.ts";
