import { beforeEach, describe, expect, it, vi } from "vitest";

type InvokeArgs = { method: string; params: unknown };

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn<(cmd: string, args?: InvokeArgs) => Promise<unknown>>(),
  listenMock:
    vi.fn<(event: string, handler: (e: { payload: unknown }) => void) => Promise<() => void>>(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

import { __resetIpcClientForTests, createIpcClient } from "../../src/ipc/client";

beforeEach(() => {
  __resetIpcClientForTests();
  invokeMock.mockReset();
  listenMock.mockReset();
  listenMock.mockResolvedValue(() => {});
});

describe("NimbusIpcClient — Profile wrappers", () => {
  it("profileList calls rpc_call with method=profile.list, params={}", async () => {
    invokeMock.mockResolvedValueOnce({ profiles: [{ name: "default" }], active: "default" });
    const client = createIpcClient();
    const result = await client.profileList();
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", { method: "profile.list", params: {} });
    expect(result).toEqual({ profiles: [{ name: "default" }], active: "default" });
  });

  it("profileCreate passes { name } as params", async () => {
    invokeMock.mockResolvedValueOnce({ name: "scratch" });
    await createIpcClient().profileCreate("scratch");
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "profile.create",
      params: { name: "scratch" },
    });
  });

  it("profileSwitch passes { name } as params", async () => {
    invokeMock.mockResolvedValueOnce({ active: "work" });
    await createIpcClient().profileSwitch("work");
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "profile.switch",
      params: { name: "work" },
    });
  });

  it("profileDelete passes { name } as params", async () => {
    invokeMock.mockResolvedValueOnce({ deleted: "scratch" });
    await createIpcClient().profileDelete("scratch");
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "profile.delete",
      params: { name: "scratch" },
    });
  });
});

describe("NimbusIpcClient — Telemetry wrappers", () => {
  it("telemetryGetStatus returns disabled shape unchanged", async () => {
    invokeMock.mockResolvedValueOnce({ enabled: false });
    const result = await createIpcClient().telemetryGetStatus();
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "telemetry.getStatus",
      params: {},
    });
    expect(result).toEqual({ enabled: false });
  });

  it("telemetryGetStatus returns enabled + preview payload intact", async () => {
    invokeMock.mockResolvedValueOnce({
      enabled: true,
      session_id: "preview-not-persisted",
      nimbus_version: "0.1.0",
      platform: "linux",
      connector_error_rate: {},
      connector_health_transitions: {},
      query_latency_p50_ms: 5,
      query_latency_p95_ms: 20,
      query_latency_p99_ms: 40,
      agent_invocation_latency_p50_ms: 0,
      agent_invocation_latency_p95_ms: 0,
      sync_duration_p50_ms: {},
      cold_start_ms: 120,
      extension_installs_by_id: {},
      extension_uninstalls_by_id: {},
    });
    const result = await createIpcClient().telemetryGetStatus();
    expect(result.enabled).toBe(true);
    if (result.enabled) {
      expect(result.query_latency_p95_ms).toBe(20);
    }
  });

  it("telemetrySetEnabled passes { enabled: boolean }", async () => {
    invokeMock.mockResolvedValueOnce({ enabled: false });
    await createIpcClient().telemetrySetEnabled(false);
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "telemetry.setEnabled",
      params: { enabled: false },
    });
  });
});

describe("NimbusIpcClient — Connector setConfig wrapper", () => {
  it("passes a full patch with service + all optional fields", async () => {
    invokeMock.mockResolvedValueOnce({
      service: "github",
      intervalMs: 120000,
      depth: "summary",
      enabled: true,
    });
    const client = createIpcClient();
    const res = await client.connectorSetConfig("github", {
      intervalMs: 120000,
      depth: "summary",
      enabled: true,
    });
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "connector.setConfig",
      params: { service: "github", intervalMs: 120000, depth: "summary", enabled: true },
    });
    expect(res).toEqual({
      service: "github",
      intervalMs: 120000,
      depth: "summary",
      enabled: true,
    });
  });

  it("allows partial patches (enabled only)", async () => {
    invokeMock.mockResolvedValueOnce({
      service: "slack",
      intervalMs: null,
      depth: null,
      enabled: false,
    });
    await createIpcClient().connectorSetConfig("slack", { enabled: false });
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "connector.setConfig",
      params: { service: "slack", enabled: false },
    });
  });
});

describe("NimbusIpcClient — LLM wrappers", () => {
  it("llmListModels rejects non-object responses", async () => {
    invokeMock.mockResolvedValueOnce("not an object");
    await expect(createIpcClient().llmListModels()).rejects.toThrow(/expected object/);
  });

  it("llmListModels returns the parsed envelope", async () => {
    invokeMock.mockResolvedValueOnce({
      models: [{ provider: "ollama", modelName: "gemma:2b" }],
    });
    const res = await createIpcClient().llmListModels();
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "llm.listModels",
      params: {},
    });
    expect(res.models).toEqual([{ provider: "ollama", modelName: "gemma:2b" }]);
  });

  it("llmGetStatus returns the availability map", async () => {
    invokeMock.mockResolvedValueOnce({ available: { ollama: true, llamacpp: false } });
    const res = await createIpcClient().llmGetStatus();
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "llm.getStatus",
      params: {},
    });
    expect(res.available).toEqual({ ollama: true, llamacpp: false });
  });

  it("llmGetRouterStatus returns the decisions map", async () => {
    invokeMock.mockResolvedValueOnce({
      decisions: {
        classification: { providerId: "ollama", modelName: "gemma:2b", reason: "default" },
      },
    });
    const res = await createIpcClient().llmGetRouterStatus();
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "llm.getRouterStatus",
      params: {},
    });
    expect(res.decisions.classification?.modelName).toBe("gemma:2b");
  });

  it("llmPullModel passes provider + modelName and returns pullId", async () => {
    invokeMock.mockResolvedValueOnce({ pullId: "pull_abc" });
    const res = await createIpcClient().llmPullModel("ollama", "gemma:2b");
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "llm.pullModel",
      params: { provider: "ollama", modelName: "gemma:2b" },
    });
    expect(res).toEqual({ pullId: "pull_abc" });
  });

  it("llmCancelPull passes pullId and returns cancelled boolean", async () => {
    invokeMock.mockResolvedValueOnce({ cancelled: true });
    const res = await createIpcClient().llmCancelPull("pull_abc");
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "llm.cancelPull",
      params: { pullId: "pull_abc" },
    });
    expect(res.cancelled).toBe(true);
  });

  it("llmLoadModel passes provider + modelName", async () => {
    invokeMock.mockResolvedValueOnce({ isLoaded: true });
    await createIpcClient().llmLoadModel("ollama", "gemma:2b");
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "llm.loadModel",
      params: { provider: "ollama", modelName: "gemma:2b" },
    });
  });

  it("llmUnloadModel passes provider + modelName", async () => {
    invokeMock.mockResolvedValueOnce({ isLoaded: false });
    await createIpcClient().llmUnloadModel("llamacpp", "llama3:8b-q4");
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "llm.unloadModel",
      params: { provider: "llamacpp", modelName: "llama3:8b-q4" },
    });
  });

  it("llmSetDefault passes taskType + provider + modelName", async () => {
    invokeMock.mockResolvedValueOnce({
      taskType: "reasoning",
      provider: "ollama",
      modelName: "gemma:2b",
    });
    await createIpcClient().llmSetDefault("reasoning", "ollama", "gemma:2b");
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "llm.setDefault",
      params: { taskType: "reasoning", provider: "ollama", modelName: "gemma:2b" },
    });
  });
});
