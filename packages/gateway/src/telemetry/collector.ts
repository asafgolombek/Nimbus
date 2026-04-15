/**
 * Opt-in telemetry (Phase 3.5) — aggregate counters only; disabled by default.
 * `buildTelemetryPreview()` is safe to call for `nimbus telemetry show` before opt-in.
 */

export type TelemetryPreviewPayload = {
  session_id: string;
  nimbus_version: string;
  platform: "win32" | "darwin" | "linux";
  connector_error_rate: Record<string, number>;
  connector_health_transitions: Record<string, number>;
  query_latency_p50_ms: number;
  query_latency_p95_ms: number;
  query_latency_p99_ms: number;
  agent_invocation_latency_p50_ms: number;
  agent_invocation_latency_p95_ms: number;
  sync_duration_p50_ms: Record<string, number>;
  cold_start_ms: number;
  extension_installs_by_id: Record<string, number>;
  extension_uninstalls_by_id: Record<string, number>;
};

export function buildTelemetryPreview(params: {
  nimbusVersion: string;
  queryLatencyP50Ms: number;
  queryLatencyP95Ms: number;
  queryLatencyP99Ms: number;
}): TelemetryPreviewPayload {
  const plat = process.platform;
  const platform: TelemetryPreviewPayload["platform"] =
    plat === "win32" || plat === "darwin" || plat === "linux" ? plat : "linux";
  return {
    session_id: "preview-not-persisted",
    nimbus_version: params.nimbusVersion,
    platform,
    connector_error_rate: {},
    connector_health_transitions: {},
    query_latency_p50_ms: params.queryLatencyP50Ms,
    query_latency_p95_ms: params.queryLatencyP95Ms,
    query_latency_p99_ms: params.queryLatencyP99Ms,
    agent_invocation_latency_p50_ms: 0,
    agent_invocation_latency_p95_ms: 0,
    sync_duration_p50_ms: {},
    cold_start_ms: 0,
    extension_installs_by_id: {},
    extension_uninstalls_by_id: {},
  };
}
