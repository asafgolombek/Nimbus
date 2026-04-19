import { beforeEach, describe, expect, it, vi } from "vitest";

type InvokeArgs = { method: string; params: unknown };

const { invokeMock, listenMock } = vi.hoisted(() => {
  return {
    invokeMock: vi.fn<(cmd: string, args?: InvokeArgs) => Promise<unknown>>(),
    listenMock: vi.fn<(event: string, handler: (e: { payload: unknown }) => void) => Promise<() => void>>(),
  };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

import { __resetIpcClientForTests, createIpcClient } from "../../src/ipc/client";
import {
  GatewayOfflineError,
  JsonRpcError,
  MethodNotAllowedError,
} from "../../src/ipc/types";

describe("NimbusIpcClient", () => {
  beforeEach(() => {
    __resetIpcClientForTests();
    invokeMock.mockReset();
    listenMock.mockReset();
    listenMock.mockResolvedValue(() => {});
  });

  it("serialises method + params and resolves with the Gateway result", async () => {
    invokeMock.mockResolvedValueOnce({ indexTotalItems: 0, connectorCount: 0 });
    const client = createIpcClient();

    const result = await client.call("diag.snapshot");

    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "diag.snapshot",
      params: null,
    });
    expect(result).toEqual({ indexTotalItems: 0, connectorCount: 0 });
  });

  it("throws MethodNotAllowedError when bridge rejects an unlisted method", async () => {
    invokeMock.mockRejectedValueOnce("ERR_METHOD_NOT_ALLOWED:vault.get");
    const client = createIpcClient();

    await expect(client.call("vault.get")).rejects.toBeInstanceOf(MethodNotAllowedError);
  });

  it("throws GatewayOfflineError when bridge reports disconnected", async () => {
    invokeMock.mockRejectedValueOnce("ERR_GATEWAY_OFFLINE");
    const client = createIpcClient();

    await expect(client.call("diag.snapshot")).rejects.toBeInstanceOf(GatewayOfflineError);
  });

  it("propagates JSON-RPC errors as JsonRpcError", async () => {
    invokeMock.mockRejectedValueOnce(
      JSON.stringify({ code: -32000, message: "boom" }),
    );
    const client = createIpcClient();

    await expect(client.call("diag.snapshot")).rejects.toBeInstanceOf(JsonRpcError);
  });

  it("dispatches notifications to subscribers", async () => {
    const client = createIpcClient();
    let registered: ((e: { payload: unknown }) => void) | undefined;
    listenMock.mockImplementationOnce(async (_event, handler) => {
      registered = handler;
      return () => {};
    });
    const handler = vi.fn();
    const unsubscribe = await client.subscribe(handler);

    registered?.({ payload: { method: "engine.streamToken", params: { text: "hi" } } });

    expect(handler).toHaveBeenCalledWith({
      method: "engine.streamToken",
      params: { text: "hi" },
    });
    unsubscribe();
  });
});
