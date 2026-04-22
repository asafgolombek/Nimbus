import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { restartApp } from "../../src/lib/restart";

describe("restartApp", () => {
  it("calls tauri invoke plugin:app|restart on success", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await restartApp();
    expect(invokeMock).toHaveBeenCalledWith("plugin:app|restart");
  });

  it("falls back to location.reload() when invoke throws and location is defined", async () => {
    invokeMock.mockRejectedValueOnce(new Error("no tauri"));
    const reloadMock = vi.fn();
    const originalLocation = globalThis.location;
    Object.defineProperty(globalThis, "location", {
      value: { reload: reloadMock },
      configurable: true,
      writable: true,
    });
    await restartApp();
    expect(reloadMock).toHaveBeenCalledOnce();
    Object.defineProperty(globalThis, "location", {
      value: originalLocation,
      configurable: true,
      writable: true,
    });
  });

  it("does not throw when invoke throws and location is undefined", async () => {
    invokeMock.mockRejectedValueOnce(new Error("no tauri"));
    const originalLocation = globalThis.location;
    Object.defineProperty(globalThis, "location", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    await expect(restartApp()).resolves.toBeUndefined();
    Object.defineProperty(globalThis, "location", {
      value: originalLocation,
      configurable: true,
      writable: true,
    });
  });
});
