import { describe, expect, test, vi } from "vitest";
import { createRunWorkflowCommand } from "../../../src/commands/run-workflow.js";
import type { Logger } from "../../../src/logging.js";

const noLog: Logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };

describe("createRunWorkflowCommand", () => {
  test("shows No workflows message when list is empty array", async () => {
    const window = {
      showInformationMessage: vi.fn().mockResolvedValue(undefined),
      showErrorMessage: vi.fn(),
    } as any;
    const cmd = createRunWorkflowCommand({
      call: vi.fn().mockResolvedValue([]),
      window,
      log: noLog,
      showQuickPick: vi.fn(),
      showProgressToast: vi.fn(),
    });
    await cmd();
    expect(window.showInformationMessage).toHaveBeenCalledWith("No workflows defined", {});
  });

  test("shows No workflows message when workflow.list returns non-array", async () => {
    const window = {
      showInformationMessage: vi.fn().mockResolvedValue(undefined),
      showErrorMessage: vi.fn(),
    } as any;
    const cmd = createRunWorkflowCommand({
      call: vi.fn().mockResolvedValue(null),
      window,
      log: noLog,
      showQuickPick: vi.fn(),
      showProgressToast: vi.fn(),
    });
    await cmd();
    expect(window.showInformationMessage).toHaveBeenCalledWith("No workflows defined", {});
  });

  test("returns early when user cancels quick pick", async () => {
    const callFn = vi.fn().mockResolvedValue([{ name: "deploy", description: "deploy to prod" }]);
    const showProgressToast = vi.fn();
    const cmd = createRunWorkflowCommand({
      call: callFn,
      window: { showInformationMessage: vi.fn(), showErrorMessage: vi.fn() } as any,
      log: noLog,
      showQuickPick: vi.fn().mockResolvedValue(undefined),
      showProgressToast,
    });
    await cmd();
    expect(callFn).toHaveBeenCalledWith("workflow.list");
    expect(showProgressToast).not.toHaveBeenCalled();
  });

  test("calls workflow.run and shows progress toast when workflow is selected", async () => {
    const callFn = vi.fn().mockImplementation((method: string) => {
      if (method === "workflow.list") {
        return Promise.resolve([{ name: "deploy", description: "deploy to prod" }]);
      }
      return Promise.resolve({});
    });
    const showProgressToast = vi.fn().mockResolvedValue(undefined);
    const cmd = createRunWorkflowCommand({
      call: callFn,
      window: { showInformationMessage: vi.fn(), showErrorMessage: vi.fn() } as any,
      log: noLog,
      showQuickPick: vi.fn().mockResolvedValue({ label: "deploy", description: "deploy to prod" }),
      showProgressToast,
    });
    await cmd();
    expect(callFn).toHaveBeenCalledWith("workflow.run", { name: "deploy" });
    expect(showProgressToast).toHaveBeenCalled();
    const toastMsg = showProgressToast.mock.calls[0]![0]! as string;
    expect(toastMsg).toContain("deploy");
  });

  test("passes workflow name (not description) in label for quick pick", async () => {
    const workflows = [{ name: "alpha", description: "first" }, { name: "beta" }];
    const callFn = vi.fn().mockResolvedValue(workflows);
    const showQuickPick = vi.fn().mockResolvedValue(undefined);
    const cmd = createRunWorkflowCommand({
      call: callFn,
      window: { showInformationMessage: vi.fn(), showErrorMessage: vi.fn() } as any,
      log: noLog,
      showQuickPick,
      showProgressToast: vi.fn(),
    });
    await cmd();
    const picksArg = showQuickPick.mock.calls[0]![0]! as Array<{
      label: string;
      description: string;
    }>;
    expect(picksArg[0]).toEqual({ label: "alpha", description: "first" });
    expect(picksArg[1]).toEqual({ label: "beta", description: "" });
  });

  test("logs error when workflow.run rejects", async () => {
    const errorLog = vi.fn();
    const log: Logger = { error: errorLog, warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    const callFn = vi.fn().mockImplementation((method: string) => {
      if (method === "workflow.list") return Promise.resolve([{ name: "bad" }]);
      return Promise.reject(new Error("run failed"));
    });
    const cmd = createRunWorkflowCommand({
      call: callFn,
      window: { showInformationMessage: vi.fn(), showErrorMessage: vi.fn() } as any,
      log,
      showQuickPick: vi.fn().mockResolvedValue({ label: "bad", description: "" }),
      showProgressToast: vi.fn().mockResolvedValue(undefined),
    });
    // Allow the void fire-and-forget to settle
    await cmd();
    await new Promise((r) => setTimeout(r, 10));
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("run failed"));
  });
});
