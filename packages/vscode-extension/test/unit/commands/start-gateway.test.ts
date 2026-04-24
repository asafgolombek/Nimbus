import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { createStartGatewayCommand } from "../../../src/commands/start-gateway.js";
import type { Logger } from "../../../src/logging.js";

const SOCK = join(tmpdir(), "nimbus.sock");
const noLog: Logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };

const timeoutResult = { kind: "timeout" as const, socketPath: SOCK };
const spawnErrorResult = { kind: "spawn-error" as const, message: "ENOENT" };

function mockWindow(errorResponse?: string) {
  return {
    showInformationMessage: vi.fn().mockResolvedValue(undefined),
    showErrorMessage: vi.fn().mockResolvedValue(errorResponse),
  } as any;
}

function makeCmd(
  spawn: ReturnType<typeof vi.fn>,
  overrides: { window?: ReturnType<typeof mockWindow>; openLogs?: ReturnType<typeof vi.fn> } = {},
) {
  const window = overrides.window ?? mockWindow();
  const openLogs = overrides.openLogs ?? vi.fn();
  const cmd = createStartGatewayCommand({
    autoStarter: { spawn } as any,
    getSocketPath: vi.fn().mockResolvedValue(SOCK),
    window,
    log: noLog,
    openLogs,
  });
  return { cmd, window, openLogs };
}

describe("createStartGatewayCommand", () => {
  test("shows success message when spawn returns ok", async () => {
    const { cmd, window } = makeCmd(vi.fn().mockResolvedValue({ kind: "ok" }));
    await cmd();
    expect(window.showInformationMessage).toHaveBeenCalledWith("Nimbus Gateway is running.", {});
    expect(window.showErrorMessage).not.toHaveBeenCalled();
  });

  test("calls autoStarter.spawn with the resolved socket path", async () => {
    const spawn = vi.fn().mockResolvedValue({ kind: "ok" });
    const { cmd } = makeCmd(spawn);
    await cmd();
    expect(spawn).toHaveBeenCalledWith(SOCK);
  });

  describe("timeout result", () => {
    test("shows error message containing 'timeout'", async () => {
      const { cmd, window } = makeCmd(vi.fn().mockResolvedValue(timeoutResult));
      await cmd();
      expect(window.showErrorMessage).toHaveBeenCalled();
      expect(
        (window.showErrorMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0]! as string,
      ).toContain("timeout");
    });

    test("calls openLogs when user clicks Open Logs", async () => {
      const openLogs = vi.fn();
      const { cmd } = makeCmd(vi.fn().mockResolvedValue(timeoutResult), {
        window: mockWindow("Open Logs"),
        openLogs,
      });
      await cmd();
      expect(openLogs).toHaveBeenCalled();
    });

    test("does not call openLogs when user dismisses error", async () => {
      const openLogs = vi.fn();
      const { cmd } = makeCmd(vi.fn().mockResolvedValue(timeoutResult), { openLogs });
      await cmd();
      expect(openLogs).not.toHaveBeenCalled();
    });
  });

  describe("spawn-error result", () => {
    test("shows error message containing ENOENT", async () => {
      const { cmd, window } = makeCmd(vi.fn().mockResolvedValue(spawnErrorResult));
      await cmd();
      expect(window.showErrorMessage).toHaveBeenCalled();
      expect(
        (window.showErrorMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0]! as string,
      ).toContain("ENOENT");
    });

    test("calls openLogs when user clicks Open Logs", async () => {
      const openLogs = vi.fn();
      const { cmd } = makeCmd(vi.fn().mockResolvedValue(spawnErrorResult), {
        window: mockWindow("Open Logs"),
        openLogs,
      });
      await cmd();
      expect(openLogs).toHaveBeenCalled();
    });

    test("does not call openLogs when user dismisses error", async () => {
      const openLogs = vi.fn();
      const { cmd } = makeCmd(vi.fn().mockResolvedValue(spawnErrorResult), { openLogs });
      await cmd();
      expect(openLogs).not.toHaveBeenCalled();
    });
  });
});
