import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  type AuditEntry,
  type ConnectionState,
  type ConnectorConfigPatch,
  type ConnectorStatus,
  GatewayOfflineError,
  type IndexMetrics,
  JsonRpcError,
  type JsonRpcErrorPayload,
  type JsonRpcNotification,
  type LlmAvailabilityResult,
  type LlmListModelsResult,
  type LlmPullStartedResult,
  type LlmTaskType,
  MethodNotAllowedError,
  type ProfileListResult,
  type RouterStatusResult,
  type TelemetryStatus,
} from "./types";

export interface NimbusIpcClient {
  call<TResult>(method: string, params?: unknown): Promise<TResult>;
  subscribe(handler: (n: JsonRpcNotification) => void): Promise<() => void>;
  onConnectionState(handler: (s: ConnectionState) => void): Promise<() => void>;
  connectorListStatus(): Promise<ConnectorStatus[]>;
  indexMetrics(): Promise<IndexMetrics>;
  auditList(limit?: number): Promise<AuditEntry[]>;
  consentRespond(requestId: string, approved: boolean): Promise<void>;
  /** WS5-C Plan 2 additions. */
  profileList(): Promise<ProfileListResult>;
  profileCreate(name: string): Promise<{ name: string }>;
  profileSwitch(name: string): Promise<{ active: string }>;
  profileDelete(name: string): Promise<{ deleted: string }>;
  telemetryGetStatus(): Promise<TelemetryStatus>;
  telemetrySetEnabled(enabled: boolean): Promise<{ enabled: boolean }>;
  /** WS5-C Plan 3 additions — Connectors + Model panels. */
  connectorSetConfig(
    service: string,
    patch: ConnectorConfigPatch,
  ): Promise<{
    service: string;
    intervalMs: number | null;
    depth: "metadata_only" | "summary" | "full" | null;
    enabled: boolean | null;
  }>;
  llmListModels(): Promise<LlmListModelsResult>;
  llmGetStatus(): Promise<LlmAvailabilityResult>;
  llmGetRouterStatus(): Promise<RouterStatusResult>;
  llmPullModel(provider: "ollama" | "llamacpp", modelName: string): Promise<LlmPullStartedResult>;
  llmCancelPull(pullId: string): Promise<{ cancelled: boolean }>;
  llmLoadModel(provider: "ollama" | "llamacpp", modelName: string): Promise<{ isLoaded: true }>;
  llmUnloadModel(provider: "ollama" | "llamacpp", modelName: string): Promise<{ isLoaded: false }>;
  llmSetDefault(
    taskType: LlmTaskType,
    provider: "ollama" | "llamacpp" | "remote",
    modelName: string,
  ): Promise<{ taskType: LlmTaskType; provider: string; modelName: string }>;
}

const FORBIDDEN_VALUE_KEYS: readonly string[] = [
  "passphrase",
  "recoverySeed",
  "mnemonic",
  "privateKey",
  "encryptedVaultManifest",
];

function redactSensitiveSubstrings(input: string): string {
  let out = input;
  for (const key of FORBIDDEN_VALUE_KEYS) {
    // `key=<run-of-non-whitespace-non-comma-non-brace>` — covers raw strings and JSON shards.
    const assignRe = new RegExp(`${key}\\s*[=:]\\s*"?([^\\s",}]+)"?`, "gi");
    out = out.replace(assignRe, `${key}=[REDACTED]`);
    // `"key":"value"` explicit JSON form (assignRe alone can miss quoted JSON).
    const jsonRe = new RegExp(`"${key}"\\s*:\\s*"[^"]*"`, "gi");
    out = out.replace(jsonRe, `"${key}":"[REDACTED]"`);
  }
  return out;
}

function parseError(err: unknown): Error {
  let msg: string;
  if (typeof err === "string") {
    msg = err;
  } else if (err instanceof Error) {
    msg = err.message;
  } else {
    msg = JSON.stringify(err);
  }
  msg = redactSensitiveSubstrings(msg);
  if (msg.startsWith("ERR_METHOD_NOT_ALLOWED")) {
    const method = msg.split(":")[1] ?? "unknown";
    return new MethodNotAllowedError(method);
  }
  if (msg.startsWith("ERR_GATEWAY_OFFLINE")) return new GatewayOfflineError();
  try {
    const parsed = JSON.parse(msg) as JsonRpcErrorPayload;
    if (typeof parsed.code === "number" && typeof parsed.message === "string") {
      return new JsonRpcError(parsed);
    }
  } catch {
    /* not a JSON-RPC error payload */
  }
  return new Error(msg);
}

let singleton: NimbusIpcClient | null = null;

export function createIpcClient(): NimbusIpcClient {
  if (singleton) return singleton;

  const client: NimbusIpcClient = {
    async call<TResult>(method: string, params: unknown = null): Promise<TResult> {
      try {
        const result = await invoke<TResult>("rpc_call", { method, params });
        return result;
      } catch (err) {
        throw parseError(err);
      }
    },
    async subscribe(handler): Promise<() => void> {
      return listen<JsonRpcNotification>("gateway://notification", (evt) => handler(evt.payload));
    },
    async onConnectionState(handler): Promise<() => void> {
      return listen<ConnectionState>("gateway://connection-state", (evt) => handler(evt.payload));
    },
    async connectorListStatus(): Promise<ConnectorStatus[]> {
      const res = await this.call<unknown>("connector.listStatus", {});
      if (!Array.isArray(res)) throw new Error("connector.listStatus: expected array");
      return res as ConnectorStatus[];
    },
    async indexMetrics(): Promise<IndexMetrics> {
      const res = await this.call<unknown>("index.metrics", {});
      if (typeof res !== "object" || res === null)
        throw new Error("index.metrics: expected object");
      return res as IndexMetrics;
    },
    async auditList(limit = 25): Promise<AuditEntry[]> {
      const res = await this.call<unknown>("audit.list", { limit });
      if (!Array.isArray(res)) throw new Error("audit.list: expected array");
      return res as AuditEntry[];
    },
    async consentRespond(requestId: string, approved: boolean): Promise<void> {
      await this.call<unknown>("consent.respond", { requestId, approved });
      // Notify Rust to clear its inbox and fan `consent://resolved` out to all windows.
      await invoke("hitl_resolved", { requestId, approved });
    },
    async profileList(): Promise<ProfileListResult> {
      const res = await this.call<unknown>("profile.list", {});
      if (typeof res !== "object" || res === null) throw new Error("profile.list: expected object");
      return res as ProfileListResult;
    },
    async profileCreate(name: string): Promise<{ name: string }> {
      return await this.call<{ name: string }>("profile.create", { name });
    },
    async profileSwitch(name: string): Promise<{ active: string }> {
      return await this.call<{ active: string }>("profile.switch", { name });
    },
    async profileDelete(name: string): Promise<{ deleted: string }> {
      return await this.call<{ deleted: string }>("profile.delete", { name });
    },
    async telemetryGetStatus(): Promise<TelemetryStatus> {
      const res = await this.call<unknown>("telemetry.getStatus", {});
      if (typeof res !== "object" || res === null)
        throw new Error("telemetry.getStatus: expected object");
      return res as TelemetryStatus;
    },
    async telemetrySetEnabled(enabled: boolean): Promise<{ enabled: boolean }> {
      return await this.call<{ enabled: boolean }>("telemetry.setEnabled", { enabled });
    },
    async connectorSetConfig(service, patch) {
      const params: Record<string, unknown> = { service };
      if (patch.intervalMs !== undefined) params.intervalMs = patch.intervalMs;
      if (patch.depth !== undefined) params.depth = patch.depth;
      if (patch.enabled !== undefined) params.enabled = patch.enabled;
      return await this.call("connector.setConfig", params);
    },
    async llmListModels(): Promise<LlmListModelsResult> {
      const res = await this.call<unknown>("llm.listModels", {});
      if (typeof res !== "object" || res === null)
        throw new Error("llm.listModels: expected object");
      return res as LlmListModelsResult;
    },
    async llmGetStatus(): Promise<LlmAvailabilityResult> {
      const res = await this.call<unknown>("llm.getStatus", {});
      if (typeof res !== "object" || res === null)
        throw new Error("llm.getStatus: expected object");
      return res as LlmAvailabilityResult;
    },
    async llmGetRouterStatus(): Promise<RouterStatusResult> {
      const res = await this.call<unknown>("llm.getRouterStatus", {});
      if (typeof res !== "object" || res === null)
        throw new Error("llm.getRouterStatus: expected object");
      return res as RouterStatusResult;
    },
    async llmPullModel(provider, modelName) {
      return await this.call("llm.pullModel", { provider, modelName });
    },
    async llmCancelPull(pullId) {
      return await this.call("llm.cancelPull", { pullId });
    },
    async llmLoadModel(provider, modelName) {
      return await this.call("llm.loadModel", { provider, modelName });
    },
    async llmUnloadModel(provider, modelName) {
      return await this.call("llm.unloadModel", { provider, modelName });
    },
    async llmSetDefault(taskType, provider, modelName) {
      return await this.call("llm.setDefault", { taskType, provider, modelName });
    },
  };
  singleton = client;
  return client;
}

/** For tests only. Resets the singleton so each suite starts clean. */
export function __resetIpcClientForTests(): void {
  singleton = null;
}
