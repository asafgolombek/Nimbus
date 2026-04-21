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
