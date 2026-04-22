import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  listenMock.mockResolvedValue(() => {});
});

afterEach(() => {
  __resetIpcClientForTests();
});

describe("WS5-D — watcher IPC wrappers", () => {
  it("watcherList calls watcher.list and returns result", async () => {
    const fixture = { watchers: [{ id: "w1", name: "My Watcher", enabled: 1 }] };
    invokeMock.mockResolvedValueOnce(fixture);
    const result = await createIpcClient().watcherList();
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", { method: "watcher.list", params: {} });
    expect(result).toEqual(fixture);
  });

  it("watcherList throws when response is not an object", async () => {
    invokeMock.mockResolvedValueOnce("bad");
    await expect(createIpcClient().watcherList()).rejects.toThrow(/expected object/);
  });

  it("watcherCreate calls watcher.create with correct params", async () => {
    const fixture = { id: "w2" };
    invokeMock.mockResolvedValueOnce(fixture);
    const params = {
      name: "New Watcher",
      conditionType: "graph",
      conditionJson: "{}",
      actionType: "notify",
      actionJson: "{}",
    };
    const result = await createIpcClient().watcherCreate(params);
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", { method: "watcher.create", params });
    expect(result).toEqual(fixture);
  });

  it("watcherDelete calls watcher.delete with id", async () => {
    invokeMock.mockResolvedValueOnce({ ok: true });
    const result = await createIpcClient().watcherDelete("w1");
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "watcher.delete",
      params: { id: "w1" },
    });
    expect(result).toEqual({ ok: true });
  });

  it("watcherPause calls watcher.pause with id", async () => {
    invokeMock.mockResolvedValueOnce({ ok: true });
    await createIpcClient().watcherPause("w1");
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "watcher.pause",
      params: { id: "w1" },
    });
  });

  it("watcherResume calls watcher.resume with id", async () => {
    invokeMock.mockResolvedValueOnce({ ok: true });
    await createIpcClient().watcherResume("w1");
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "watcher.resume",
      params: { id: "w1" },
    });
  });
});

describe("WS5-D — extension IPC wrappers", () => {
  it("extensionList calls extension.list and returns result", async () => {
    const fixture = { extensions: [{ id: "ext-1", version: "1.0.0", enabled: 1 }] };
    invokeMock.mockResolvedValueOnce(fixture);
    const result = await createIpcClient().extensionList();
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", { method: "extension.list", params: {} });
    expect(result).toEqual(fixture);
  });

  it("extensionList throws when response is not an object", async () => {
    invokeMock.mockResolvedValueOnce(null);
    await expect(createIpcClient().extensionList()).rejects.toThrow(/expected object/);
  });

  it("extensionInstall calls extension.install with sourcePath", async () => {
    const fixture = {
      id: "ext-1",
      version: "1.0.0",
      installPath: "/extensions/ext-1",
      manifestHash: "abc",
      entryHash: "def",
    };
    invokeMock.mockResolvedValueOnce(fixture);
    const result = await createIpcClient().extensionInstall("/some/dir");
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "extension.install",
      params: { sourcePath: "/some/dir" },
    });
    expect(result).toEqual(fixture);
  });

  it("extensionEnable calls extension.enable with id", async () => {
    invokeMock.mockResolvedValueOnce({ ok: true });
    await createIpcClient().extensionEnable("ext-1");
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "extension.enable",
      params: { id: "ext-1" },
    });
  });

  it("extensionDisable calls extension.disable with id", async () => {
    invokeMock.mockResolvedValueOnce({ ok: false });
    await createIpcClient().extensionDisable("ext-1");
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "extension.disable",
      params: { id: "ext-1" },
    });
  });

  it("extensionRemove calls extension.remove with id", async () => {
    invokeMock.mockResolvedValueOnce({ ok: true });
    await createIpcClient().extensionRemove("ext-1");
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "extension.remove",
      params: { id: "ext-1" },
    });
  });
});

describe("WS5-D — workflow IPC wrappers", () => {
  it("workflowList calls workflow.list and returns result", async () => {
    const fixture = { workflows: [{ id: "wf-1", name: "Deploy", description: null }] };
    invokeMock.mockResolvedValueOnce(fixture);
    const result = await createIpcClient().workflowList();
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", { method: "workflow.list", params: {} });
    expect(result).toEqual(fixture);
  });

  it("workflowList throws when response is not an object", async () => {
    invokeMock.mockResolvedValueOnce("bad");
    await expect(createIpcClient().workflowList()).rejects.toThrow(/expected object/);
  });

  it("workflowSave calls workflow.save with name, description, stepsJson", async () => {
    invokeMock.mockResolvedValueOnce({ id: "wf-1" });
    const result = await createIpcClient().workflowSave({
      name: "Deploy",
      description: "Deploys things",
      stepsJson: "[]",
    });
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "workflow.save",
      params: { name: "Deploy", description: "Deploys things", stepsJson: "[]" },
    });
    expect(result).toEqual({ id: "wf-1" });
  });

  it("workflowSave sends null description when omitted", async () => {
    invokeMock.mockResolvedValueOnce({ id: "wf-2" });
    await createIpcClient().workflowSave({ name: "Backup", stepsJson: "[]" });
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "workflow.save",
      params: { name: "Backup", description: null, stepsJson: "[]" },
    });
  });

  it("workflowDelete calls workflow.delete with name", async () => {
    invokeMock.mockResolvedValueOnce({ ok: true });
    await createIpcClient().workflowDelete("Deploy");
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "workflow.delete",
      params: { name: "Deploy" },
    });
  });

  it("workflowRun calls workflow.run with name and dryRun=false", async () => {
    invokeMock.mockResolvedValueOnce({ ok: true, dryRun: false });
    const result = await createIpcClient().workflowRun({ name: "Deploy", dryRun: false });
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "workflow.run",
      params: { name: "Deploy", dryRun: false },
    });
    expect(result).toEqual({ ok: true, dryRun: false });
  });

  it("workflowRun calls workflow.run with dryRun=true", async () => {
    invokeMock.mockResolvedValueOnce({ ok: true, dryRun: true });
    await createIpcClient().workflowRun({ name: "Deploy", dryRun: true });
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "workflow.run",
      params: { name: "Deploy", dryRun: true },
    });
  });
});
