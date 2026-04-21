import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetIpcClientForTests, createIpcClient } from "../../src/ipc/client";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  __resetIpcClientForTests();
  invokeMock.mockReset();
});

afterEach(() => {
  __resetIpcClientForTests();
});

describe("WS5-C Plan 4 IPC wrappers", () => {
  it("auditGetSummary forwards to audit.getSummary and returns the object verbatim", async () => {
    invokeMock.mockResolvedValueOnce({
      byOutcome: { approved: 3 },
      byService: { github: 2 },
      total: 3,
    });
    const result = await createIpcClient().auditGetSummary();
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", { method: "audit.getSummary", params: {} });
    expect(result).toEqual({ byOutcome: { approved: 3 }, byService: { github: 2 }, total: 3 });
  });

  it("auditGetSummary throws if Gateway returns non-object", async () => {
    invokeMock.mockResolvedValueOnce("oops");
    await expect(createIpcClient().auditGetSummary()).rejects.toThrow(/expected object/);
  });

  it("auditVerify defaults `full` to false and forwards", async () => {
    invokeMock.mockResolvedValueOnce({ ok: true, lastVerifiedId: 42, totalChecked: 42 });
    const result = await createIpcClient().auditVerify();
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "audit.verify",
      params: { full: false },
    });
    expect(result).toEqual({ ok: true, lastVerifiedId: 42, totalChecked: 42 });
  });

  it("auditVerify(true) forwards `full: true`", async () => {
    invokeMock.mockResolvedValueOnce({
      ok: false,
      brokenAtId: 7,
      expectedHash: "a",
      actualHash: "b",
    });
    await createIpcClient().auditVerify(true);
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "audit.verify",
      params: { full: true },
    });
  });

  it("auditExport returns the array verbatim", async () => {
    const rows = [
      {
        id: 1,
        actionType: "github.sync",
        hitlStatus: "not_required",
        actionJson: "{}",
        timestamp: 1,
        rowHash: "x",
        prevHash: "0",
      },
    ];
    invokeMock.mockResolvedValueOnce(rows);
    const result = await createIpcClient().auditExport();
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", { method: "audit.export", params: {} });
    expect(result).toEqual(rows);
  });

  it("auditExport throws if Gateway returns non-array", async () => {
    invokeMock.mockResolvedValueOnce({ rows: [] });
    await expect(createIpcClient().auditExport()).rejects.toThrow(/expected array/);
  });

  it("updaterGetStatus returns the object verbatim", async () => {
    const status = { state: "idle", currentVersion: "0.1.0", configUrl: "https://x" };
    invokeMock.mockResolvedValueOnce(status);
    const result = await createIpcClient().updaterGetStatus();
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "updater.getStatus",
      params: {},
    });
    expect(result).toEqual(status);
  });

  it("updaterCheckNow returns the object verbatim", async () => {
    const check = {
      currentVersion: "0.1.0",
      latestVersion: "0.2.0",
      updateAvailable: true,
      notes: "hello",
    };
    invokeMock.mockResolvedValueOnce(check);
    const result = await createIpcClient().updaterCheckNow();
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", { method: "updater.checkNow", params: {} });
    expect(result).toEqual(check);
  });

  it("updaterApplyUpdate returns the jobId object", async () => {
    invokeMock.mockResolvedValueOnce({ jobId: "abc123" });
    const result = await createIpcClient().updaterApplyUpdate();
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "updater.applyUpdate",
      params: {},
    });
    expect(result).toEqual({ jobId: "abc123" });
  });

  it("updaterRollback returns { ok: true }", async () => {
    invokeMock.mockResolvedValueOnce({ ok: true });
    const result = await createIpcClient().updaterRollback();
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", { method: "updater.rollback", params: {} });
    expect(result).toEqual({ ok: true });
  });

  it("updaterRollback throws if Gateway returns non-object", async () => {
    invokeMock.mockResolvedValueOnce("oops");
    await expect(createIpcClient().updaterRollback()).rejects.toThrow(/expected object/);
  });

  it("diagGetVersion returns the object verbatim", async () => {
    invokeMock.mockResolvedValueOnce({ version: "0.1.0" });
    const result = await createIpcClient().diagGetVersion();
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", { method: "diag.getVersion", params: {} });
    expect(result).toEqual({ version: "0.1.0" });
  });
});
