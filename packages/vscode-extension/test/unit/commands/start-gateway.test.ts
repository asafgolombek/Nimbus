import { describe, expect, test, vi } from "vitest";
import { createStartGatewayCommand } from "../../../src/commands/start-gateway.js";
import type { Logger } from "../../../src/logging.js";

const noLog: Logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };

function mockWindow() {
  return {
    showInformationMessage: vi.fn().mockResolvedValue(undefined),
    showErrorMessage: vi.fn().mockResolvedValue(undefined),
  } as any;
}

describe("createStartGatewayCommand", () => {
  test("shows success message when spawn returns ok", async () => {
    const autoStarter = { spawn: vi.fn().mockResolvedValue({ kind: "ok" }) } as any;
    const window = mockWindow();
    const cmd = createStartGatewayCommand({
      autoStarter,
      getSocketPath: vi.fn().mockResolvedValue("/tmp/nimbus.sock"),
      window,
      log: noLog,
      openLogs: vi.fn(),
    });
    await cmd();
    expect(window.showInformationMessage).toHaveBeenCalledWith("Nimbus Gateway is running.", {});
    expect(window.showErrorMessage).not.toHaveBeenCalled();
  });

  test("calls autoStarter.spawn with the resolved socket path", async () => {
    const spawn = vi.fn().mockResolvedValue({ kind: "ok" });
    const autoStarter = { spawn } as any;
    const cmd = createStartGatewayCommand({
      autoStarter,
      getSocketPath: vi.fn().mockResolvedValue("/var/run/nimbus.sock"),
      window: mockWindow(),
      log: noLog,
      openLogs: vi.fn(),
    });
    await cmd();
    expect(spawn).toHaveBeenCalledWith("/var/run/nimbus.sock");
  });

  test("shows error message on timeout result", async () => {
    const autoStarter = {
      spawn: vi.fn().mockResolvedValue({ kind: "timeout", socketPath: "/tmp/nimbus.sock" }),
    } as any;
    const window = mockWindow();
    const cmd = createStartGatewayCommand({
      autoStarter,
      getSocketPath: vi.fn().mockResolvedValue("/tmp/nimbus.sock"),
      window,
      log: noLog,
      openLogs: vi.fn(),
    });
    await cmd();
    expect(window.showErrorMessage).toHaveBeenCalled();
    const errorMsg = (window.showErrorMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(errorMsg).toContain("timeout");
  });

  test("calls openLogs when user clicks Open Logs on timeout", async () => {
    const autoStarter = {
      spawn: vi.fn().mockResolvedValue({ kind: "timeout", socketPath: "/tmp/nimbus.sock" }),
    } as any;
    const window = {
      showInformationMessage: vi.fn().mockResolvedValue(undefined),
      showErrorMessage: vi.fn().mockResolvedValue("Open Logs"),
    } as any;
    const openLogs = vi.fn();
    const cmd = createStartGatewayCommand({
      autoStarter,
      getSocketPath: vi.fn().mockResolvedValue("/tmp/nimbus.sock"),
      window,
      log: noLog,
      openLogs,
    });
    await cmd();
    expect(openLogs).toHaveBeenCalled();
  });

  test("does not call openLogs when user dismisses timeout error", async () => {
    const autoStarter = {
      spawn: vi.fn().mockResolvedValue({ kind: "timeout", socketPath: "/tmp/nimbus.sock" }),
    } as any;
    const window = {
      showInformationMessage: vi.fn().mockResolvedValue(undefined),
      showErrorMessage: vi.fn().mockResolvedValue(undefined),
    } as any;
    const openLogs = vi.fn();
    const cmd = createStartGatewayCommand({
      autoStarter,
      getSocketPath: vi.fn().mockResolvedValue("/tmp/nimbus.sock"),
      window,
      log: noLog,
      openLogs,
    });
    await cmd();
    expect(openLogs).not.toHaveBeenCalled();
  });

  test("shows error message on spawn-error result with ENOENT message", async () => {
    const autoStarter = {
      spawn: vi.fn().mockResolvedValue({ kind: "spawn-error", message: "ENOENT" }),
    } as any;
    const window = mockWindow();
    const cmd = createStartGatewayCommand({
      autoStarter,
      getSocketPath: vi.fn().mockResolvedValue("/tmp/nimbus.sock"),
      window,
      log: noLog,
      openLogs: vi.fn(),
    });
    await cmd();
    expect(window.showErrorMessage).toHaveBeenCalled();
    const errorMsg = (window.showErrorMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(errorMsg).toContain("ENOENT");
  });

  test("calls openLogs when user clicks Open Logs on spawn-error", async () => {
    const autoStarter = {
      spawn: vi.fn().mockResolvedValue({ kind: "spawn-error", message: "ENOENT" }),
    } as any;
    const window = {
      showInformationMessage: vi.fn().mockResolvedValue(undefined),
      showErrorMessage: vi.fn().mockResolvedValue("Open Logs"),
    } as any;
    const openLogs = vi.fn();
    const cmd = createStartGatewayCommand({
      autoStarter,
      getSocketPath: vi.fn().mockResolvedValue("/tmp/nimbus.sock"),
      window,
      log: noLog,
      openLogs,
    });
    await cmd();
    expect(openLogs).toHaveBeenCalled();
  });

  test("does not call openLogs when user dismisses spawn-error", async () => {
    const autoStarter = {
      spawn: vi.fn().mockResolvedValue({ kind: "spawn-error", message: "ENOENT" }),
    } as any;
    const window = {
      showInformationMessage: vi.fn().mockResolvedValue(undefined),
      showErrorMessage: vi.fn().mockResolvedValue(undefined),
    } as any;
    const openLogs = vi.fn();
    const cmd = createStartGatewayCommand({
      autoStarter,
      getSocketPath: vi.fn().mockResolvedValue("/tmp/nimbus.sock"),
      window,
      log: noLog,
      openLogs,
    });
    await cmd();
    expect(openLogs).not.toHaveBeenCalled();
  });
});
