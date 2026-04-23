import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";

import { IpcContext, type IpcContextValue } from "./ipc-context.ts";
import { SubTaskPane } from "./SubTaskPane.tsx";
import { StubIpcClient } from "./test-helpers/stub-client.ts";

function ctx(client: StubIpcClient): IpcContextValue {
  return {
    client: client.asClient(),
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    } as unknown as IpcContextValue["logger"],
  };
}

describe("SubTaskPane", () => {
  test("renders 'No active sub-tasks' when empty", () => {
    const stub = new StubIpcClient();
    const { lastFrame, unmount } = render(
      <IpcContext.Provider value={ctx(stub)}>
        <SubTaskPane clearKey={0} />
      </IpcContext.Provider>,
    );
    expect(lastFrame() ?? "").toContain("No active sub-tasks");
    unmount();
  });

  test("renders a progress bar per sub-task on agent.subTaskProgress", async () => {
    const stub = new StubIpcClient();
    const { lastFrame, unmount } = render(
      <IpcContext.Provider value={ctx(stub)}>
        <SubTaskPane clearKey={0} />
      </IpcContext.Provider>,
    );
    stub.emit("agent.subTaskProgress", {
      subTaskId: "t1",
      name: "planner",
      status: "running",
      progress: 0.4,
    });
    stub.emit("agent.subTaskProgress", {
      subTaskId: "t2",
      name: "github-mcp",
      status: "completed",
      progress: 1,
    });
    await new Promise((r) => setTimeout(r, 10));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("planner");
    expect(frame).toContain("github-mcp");
    expect(frame).toContain("[");
    expect(frame).toContain("]");
    unmount();
  });

  test("updates progress bar when the same sub-task emits a new progress value", async () => {
    const stub = new StubIpcClient();
    const { lastFrame, unmount } = render(
      <IpcContext.Provider value={ctx(stub)}>
        <SubTaskPane clearKey={0} />
      </IpcContext.Provider>,
    );
    stub.emit("agent.subTaskProgress", {
      subTaskId: "t1",
      name: "planner",
      status: "running",
      progress: 0,
    });
    await new Promise((r) => setTimeout(r, 10));
    stub.emit("agent.subTaskProgress", {
      subTaskId: "t1",
      name: "planner",
      status: "running",
      progress: 1,
    });
    await new Promise((r) => setTimeout(r, 10));
    expect((lastFrame() ?? "").match(/planner/g)?.length).toBe(1);
    unmount();
  });

  test("clears when clearKey changes", async () => {
    const stub = new StubIpcClient();
    const { lastFrame, rerender, unmount } = render(
      <IpcContext.Provider value={ctx(stub)}>
        <SubTaskPane clearKey={0} />
      </IpcContext.Provider>,
    );
    stub.emit("agent.subTaskProgress", {
      subTaskId: "t1",
      name: "planner",
      status: "running",
      progress: 0.4,
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(lastFrame() ?? "").toContain("planner");
    rerender(
      <IpcContext.Provider value={ctx(stub)}>
        <SubTaskPane clearKey={1} />
      </IpcContext.Provider>,
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(lastFrame() ?? "").toContain("No active sub-tasks");
    unmount();
  });

  test("truncates beyond SUBTASK_PANE_ROW_LIMIT with a '…N more (M total)' summary", async () => {
    const { SUBTASK_PANE_ROW_LIMIT } = await import("./constants.ts");
    const stub = new StubIpcClient();
    const { lastFrame, unmount } = render(
      <IpcContext.Provider value={ctx(stub)}>
        <SubTaskPane clearKey={0} />
      </IpcContext.Provider>,
    );
    const total = SUBTASK_PANE_ROW_LIMIT + 5;
    for (let i = 0; i < total; i++) {
      stub.emit("agent.subTaskProgress", {
        subTaskId: `t${String(i)}`,
        name: `task-${String(i)}`,
        status: "running",
        progress: 0.5,
      });
    }
    await new Promise((r) => setTimeout(r, 20));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("task-0");
    expect(frame).toContain(`task-${String(SUBTASK_PANE_ROW_LIMIT - 1)}`);
    expect(frame).not.toContain(`task-${String(SUBTASK_PANE_ROW_LIMIT)}`);
    expect(frame).toContain(`…5 more (${String(total)} total)`);
    unmount();
  });
});
