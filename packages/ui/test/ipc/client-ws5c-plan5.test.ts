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

describe("WS5-C Plan 4 — missing error branches", () => {
  it("auditList throws if Gateway returns non-array", async () => {
    invokeMock.mockResolvedValueOnce({ rows: [] });
    await expect(createIpcClient().auditList()).rejects.toThrow(/expected array/);
  });

  it("diagGetVersion throws if Gateway returns non-object", async () => {
    invokeMock.mockResolvedValueOnce("oops");
    await expect(createIpcClient().diagGetVersion()).rejects.toThrow(/expected object/);
  });
});

describe("WS5-C Plan 5 — data panel IPC wrappers", () => {
  it("dataGetExportPreflight returns the preflight result on valid shape", async () => {
    const fixture = { lastExportAt: null, estimatedSizeBytes: 1024, itemCount: 42 };
    invokeMock.mockResolvedValueOnce(fixture);
    const result = await createIpcClient().dataGetExportPreflight();
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "data.getExportPreflight",
      params: {},
    });
    expect(result).toEqual(fixture);
  });

  it("dataGetExportPreflight throws on shape mismatch (non-object)", async () => {
    invokeMock.mockResolvedValueOnce(null);
    await expect(createIpcClient().dataGetExportPreflight()).rejects.toThrow(/unexpected shape/);
  });

  it("dataGetExportPreflight throws when required fields are missing", async () => {
    invokeMock.mockResolvedValueOnce({ lastExportAt: null });
    await expect(createIpcClient().dataGetExportPreflight()).rejects.toThrow(/unexpected shape/);
  });

  it("dataGetDeletePreflight returns the preflight result on valid shape", async () => {
    const fixture = { service: "github", itemCount: 10, embeddingCount: 5, vaultKeyCount: 2 };
    invokeMock.mockResolvedValueOnce(fixture);
    const result = await createIpcClient().dataGetDeletePreflight({ service: "github" });
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "data.getDeletePreflight",
      params: { service: "github" },
    });
    expect(result).toEqual(fixture);
  });

  it("dataGetDeletePreflight throws on shape mismatch", async () => {
    invokeMock.mockResolvedValueOnce("oops");
    await expect(createIpcClient().dataGetDeletePreflight({ service: "x" })).rejects.toThrow(
      /unexpected shape/,
    );
  });

  it("dataExport returns the export result on valid shape", async () => {
    const fixture = {
      outputPath: "/exports/nimbus-export.tar.gz",
      recoverySeed: "word word word",
      recoverySeedGenerated: true,
      itemsExported: 100,
    };
    invokeMock.mockResolvedValueOnce(fixture);
    const result = await createIpcClient().dataExport({
      output: "/exports/nimbus-export.tar.gz",
      passphrase: "hunter2",
      includeIndex: true,
    });
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "data.export",
      params: {
        output: "/exports/nimbus-export.tar.gz",
        passphrase: "hunter2",
        includeIndex: true,
      },
    });
    expect(result).toEqual(fixture);
  });

  it("dataExport throws on shape mismatch", async () => {
    invokeMock.mockResolvedValueOnce({ outputPath: "/exports/nimbus-x" });
    await expect(
      createIpcClient().dataExport({
        output: "/exports/nimbus-x",
        passphrase: "pw",
        includeIndex: false,
      }),
    ).rejects.toThrow(/unexpected shape/);
  });

  it("dataImport with passphrase sends correct params and returns result", async () => {
    const fixture = { credentialsRestored: 3, oauthEntriesFlagged: 1 };
    invokeMock.mockResolvedValueOnce(fixture);
    const result = await createIpcClient().dataImport({
      bundlePath: "/exports/nimbus-import.tar.gz",
      passphrase: "hunter2",
    });
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "data.import",
      params: { bundlePath: "/exports/nimbus-import.tar.gz", passphrase: "hunter2" },
    });
    expect(result).toEqual(fixture);
  });

  it("dataImport with recoverySeed sends correct params", async () => {
    const fixture = { credentialsRestored: 0, oauthEntriesFlagged: 0 };
    invokeMock.mockResolvedValueOnce(fixture);
    await createIpcClient().dataImport({
      bundlePath: "/exports/nimbus-import.tar.gz",
      recoverySeed: "alpha bravo charlie",
    });
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "data.import",
      params: { bundlePath: "/exports/nimbus-import.tar.gz", recoverySeed: "alpha bravo charlie" },
    });
  });

  it("dataImport throws on shape mismatch", async () => {
    invokeMock.mockResolvedValueOnce("ok");
    await expect(
      createIpcClient().dataImport({ bundlePath: "/exports/nimbus-x", passphrase: "pw" }),
    ).rejects.toThrow(/unexpected shape/);
  });

  it("dataDelete returns the delete result on valid shape", async () => {
    const fixture = {
      deleted: true,
      preflight: { service: "github", itemsToDelete: 5, vaultEntriesToDelete: 1 },
    };
    invokeMock.mockResolvedValueOnce(fixture);
    const result = await createIpcClient().dataDelete({ service: "github", dryRun: false });
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "data.delete",
      params: { service: "github", dryRun: false },
    });
    expect(result).toEqual(fixture);
  });

  it("dataDelete throws on shape mismatch (non-object preflight)", async () => {
    invokeMock.mockResolvedValueOnce({ deleted: true, preflight: null });
    await expect(
      createIpcClient().dataDelete({ service: "github", dryRun: false }),
    ).rejects.toThrow(/unexpected shape/);
  });

  it("dataDelete throws when top-level shape is wrong", async () => {
    invokeMock.mockResolvedValueOnce(null);
    await expect(
      createIpcClient().dataDelete({ service: "github", dryRun: false }),
    ).rejects.toThrow(/unexpected shape/);
  });
});
