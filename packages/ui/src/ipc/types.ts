export type ConnectionState = "initializing" | "connecting" | "connected" | "disconnected";

export interface DiagSnapshot {
  readonly indexTotalItems: number;
  readonly connectorCount: number;
}

export type ConnectorHealth =
  | "healthy"
  | "degraded"
  | "error"
  | "rate_limited"
  | "unauthenticated"
  | "paused";

export interface ConnectorSummary {
  readonly name: string;
  readonly state: ConnectorHealth;
}

export interface JsonRpcNotification {
  readonly method: string;
  readonly params: unknown;
}

export interface JsonRpcErrorPayload {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export class MethodNotAllowedError extends Error {
  constructor(public readonly method: string) {
    super(`ERR_METHOD_NOT_ALLOWED: ${method}`);
    this.name = "MethodNotAllowedError";
  }
}

export class GatewayOfflineError extends Error {
  constructor(message = "Gateway is not connected") {
    super(message);
    this.name = "GatewayOfflineError";
  }
}

export class JsonRpcError extends Error {
  constructor(public readonly payload: JsonRpcErrorPayload) {
    super(payload.message);
    this.name = "JsonRpcError";
  }
}

// ---- WS5-B additions ----

export type ConnectorStatus = {
  name: string;
  health: ConnectorHealth;
  lastSyncAt?: string;
  degradationReason?: string;
  itemCount?: number;
  /** Current sync interval in milliseconds — surfaced by `connector.listStatus`. */
  intervalMs?: number;
  /** Default reindex depth — surfaced by `connector.listStatus`. */
  depth?: "metadata_only" | "summary" | "full";
  /** `false` when paused. Surfaced by `connector.listStatus`. */
  enabled?: boolean;
};

export interface IndexMetrics {
  itemsTotal: number;
  embeddingCoveragePct: number;
  queryP95Ms: number;
  indexSizeBytes: number;
}

export interface AuditEntry {
  id: number;
  ts: string;
  action: string;
  outcome: "approved" | "rejected" | "auto" | "info";
  subject?: string;
  hitlRejectReason?: string;
}

export interface HitlRequest {
  requestId: string;
  prompt: string;
  details?: Record<string, unknown>;
  receivedAtMs: number;
}

// ---- WS5-C Plan 2 additions (Profiles + Telemetry) ----

/** `profile.list` response row. */
export interface ProfileSummary {
  /** Profile name as stored on disk. */
  readonly name: string;
  /** ISO timestamp of last switch; optional because the active profile may never have been switched. */
  readonly lastSwitchedAt?: string;
}

export interface ProfileListResult {
  readonly profiles: ReadonlyArray<ProfileSummary>;
  /** Active profile name; `null` when no active profile exists on a fresh install. */
  readonly active: string | null;
}

/** `telemetry.getStatus` returns either `{ enabled: false }` or `{ enabled: true, ...TelemetryPreviewPayload }`. */
export interface TelemetryStatusDisabled {
  readonly enabled: false;
}

export interface TelemetryPreviewPayload {
  readonly session_id: string;
  readonly nimbus_version: string;
  readonly platform: "win32" | "darwin" | "linux";
  readonly connector_error_rate: Readonly<Record<string, number>>;
  readonly connector_health_transitions: Readonly<Record<string, number>>;
  readonly query_latency_p50_ms: number;
  readonly query_latency_p95_ms: number;
  readonly query_latency_p99_ms: number;
  readonly agent_invocation_latency_p50_ms: number;
  readonly agent_invocation_latency_p95_ms: number;
  readonly sync_duration_p50_ms: Readonly<Record<string, number>>;
  readonly cold_start_ms: number;
  readonly extension_installs_by_id: Readonly<Record<string, number>>;
  readonly extension_uninstalls_by_id: Readonly<Record<string, number>>;
}

export interface TelemetryStatusEnabled extends TelemetryPreviewPayload {
  readonly enabled: true;
}

export type TelemetryStatus = TelemetryStatusDisabled | TelemetryStatusEnabled;

// ---- WS5-C Plan 3 additions (Connectors + Model panels) ----

/** Router decision for one task type — shape returned by `llm.getRouterStatus`. */
export interface RouterDecision {
  readonly providerId: "ollama" | "llamacpp" | "remote";
  readonly modelName: string;
  readonly reason: string;
}

export type LlmTaskType = "classification" | "reasoning" | "summarisation" | "agent_step";

/** `llm.getRouterStatus` — `decisions` is a partial map; `undefined` means no provider available for that task. */
export interface RouterStatusResult {
  readonly decisions: Readonly<Partial<Record<LlmTaskType, RouterDecision | undefined>>>;
}

/** One row from `llm.listModels` — mirrors the Gateway's `LlmModelInfo`. */
export interface LlmModelInfo {
  readonly provider: "ollama" | "llamacpp" | "remote";
  readonly modelName: string;
  readonly parameterCount?: number;
  readonly contextWindow?: number;
  readonly quantization?: string;
  readonly vramEstimateMb?: number;
}

export interface LlmListModelsResult {
  readonly models: ReadonlyArray<LlmModelInfo>;
}

/** `llm.getStatus` — per-provider availability used by PullDialog to filter the provider radio. */
export interface LlmAvailabilityResult {
  readonly available: Readonly<Record<string, boolean>>;
}

/** `llm.pullModel` response — progress is streamed via `llm.pullProgress` notifications. */
export interface LlmPullStartedResult {
  readonly pullId: string;
}

/** `llm.pullProgress` notification payload. */
export interface LlmPullProgressPayload {
  readonly pullId: string;
  readonly provider: "ollama" | "llamacpp";
  readonly modelName: string;
  readonly status: string;
  readonly completedBytes?: number;
  readonly totalBytes?: number;
}

/** `llm.pullCompleted` / `llm.pullFailed` shared envelope. `error` is only present on failure. */
export interface LlmPullTerminalPayload {
  readonly pullId: string;
  readonly provider: "ollama" | "llamacpp";
  readonly modelName: string;
  readonly error?: string;
}

/** `llm.modelLoaded` / `llm.modelUnloaded` shared payload. */
export interface LlmModelLoadPayload {
  readonly provider: "ollama" | "llamacpp";
  readonly modelName: string;
}

/** Patch accepted by `connector.setConfig` — every field is optional (partial update). */
export interface ConnectorConfigPatch {
  readonly intervalMs?: number;
  readonly depth?: "metadata_only" | "summary" | "full";
  readonly enabled?: boolean;
}

/** `connector.configChanged` notification payload emitted by the Gateway after any successful setConfig. */
export interface ConnectorConfigChangedPayload {
  readonly service: string;
  readonly intervalMs: number;
  readonly depth: "metadata_only" | "summary" | "full";
  readonly enabled: boolean;
}

// ---- WS5-C Plan 4 additions (Audit + Updates panels) ----

/** `audit.getSummary` response — counts by outcome and by first-segment service. */
export interface AuditSummary {
  readonly byOutcome: Readonly<Record<string, number>>;
  readonly byService: Readonly<Record<string, number>>;
  readonly total: number;
}

/** `audit.verify` success result. */
export interface AuditVerifyOk {
  readonly ok: true;
  readonly lastVerifiedId: number;
  readonly totalChecked: number;
}

/** `audit.verify` failure result — chain broken at `brokenAtId`. */
export interface AuditVerifyBroken {
  readonly ok: false;
  readonly brokenAtId: number;
  readonly expectedHash: string;
  readonly actualHash: string;
}

export type AuditVerifyResult = AuditVerifyOk | AuditVerifyBroken;

/**
 * One row from `audit.export` — includes the BLAKE3 row hash and prev hash.
 * Distinct from `AuditEntry` (the lighter `audit.list` shape), which omits hashes
 * and remaps fields for the Dashboard's audit feed.
 */
export interface AuditExportRow {
  readonly id: number;
  readonly actionType: string;
  readonly hitlStatus: "approved" | "rejected" | "not_required";
  readonly actionJson: string;
  readonly timestamp: number;
  readonly rowHash: string;
  readonly prevHash: string;
}

/** `updater.getStatus` response — mirrors `UpdaterStatus` in `packages/gateway/src/updater/types.ts`. */
export type UpdaterStateName =
  | "idle"
  | "checking"
  | "downloading"
  | "verifying"
  | "applying"
  | "rolled_back"
  | "failed";

export interface UpdaterStatus {
  readonly state: UpdaterStateName;
  readonly currentVersion: string;
  readonly configUrl: string;
  readonly lastCheckAt?: string;
  readonly lastError?: string;
}

/** `updater.checkNow` response. */
export interface UpdaterCheckResult {
  readonly currentVersion: string;
  readonly latestVersion: string;
  readonly updateAvailable: boolean;
  readonly notes?: string;
}

/** `updater.applyUpdate` response — `jobId` is opaque, used only for log correlation. */
export interface UpdaterApplyStarted {
  readonly jobId: string;
}

/** `updater.rollback` response. */
export interface UpdaterRollbackResult {
  readonly ok: true;
}

/** `updater.updateAvailable` notification payload. */
export interface UpdaterUpdateAvailablePayload {
  readonly version: string;
  readonly notes?: string;
}

/** `updater.downloadProgress` notification payload. */
export interface UpdaterDownloadProgressPayload {
  readonly receivedBytes: number;
  readonly totalBytes?: number;
}

/** `updater.restarting` notification payload — fires *before* the Gateway socket closes. */
export interface UpdaterRestartingPayload {
  readonly fromVersion: string;
  readonly toVersion: string;
}

/** `updater.rolledBack` notification payload. */
export interface UpdaterRolledBackPayload {
  readonly reason: "download_failed" | "hash_mismatch" | "signature_invalid" | "installer_failed";
}

/** `updater.verifyFailed` notification payload. */
export interface UpdaterVerifyFailedPayload {
  readonly reason: "hash_mismatch" | "signature_invalid";
}

/** `diag.getVersion` response. */
export interface DiagVersionResult {
  readonly version: string;
}
