import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "ink-testing-library";

import { App } from "./App.tsx";
import { IpcContext, type IpcContextValue } from "./ipc-context.ts";
import { StubIpcClient } from "./test-helpers/stub-client.ts";

function makeHistoryPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "nimbus-tui-app-"));
  return join(dir, "hist.json");
}

function ctx(stub: StubIpcClient): IpcContextValue {
  return {
    client: stub.asClient(),
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    } as unknown as IpcContextValue["logger"],
  };
}

function setupStub(): StubIpcClient {
  return new StubIpcClient({
    results: {
      "connector.list": [],
      "watcher.list": [],
      "engine.askStream": { streamId: "s-test" },
    },
  });
}

describe("App state machine", () => {
  test("idle → streaming on submit", async () => {
    const stub = setupStub();
    const historyPath = makeHistoryPath();
    const { stdin, lastFrame, unmount } = render(
      <IpcContext.Provider value={ctx(stub)}>
        <App historyPath={historyPath} onExit={() => undefined} />
      </IpcContext.Provider>,
    );
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("hello");
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 60));
    expect(stub.calls.some((c) => c.method === "engine.askStream")).toBe(true);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("hello");
    rmSync(historyPath.replace(/[/\\][^/\\]+$/, ""), { recursive: true, force: true });
    unmount();
  });

  test("streaming → idle on engine.streamDone", async () => {
    const stub = setupStub();
    const historyPath = makeHistoryPath();
    const { stdin, lastFrame, unmount } = render(
      <IpcContext.Provider value={ctx(stub)}>
        <App historyPath={historyPath} onExit={() => undefined} />
      </IpcContext.Provider>,
    );
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("hi");
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 60));
    stub.emit("engine.streamToken", { streamId: "s-test", text: "response" });
    stub.emit("engine.streamDone", { streamId: "s-test" });
    await new Promise((r) => setTimeout(r, 60));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("response");
    expect(frame).toContain("nimbus>");
    rmSync(historyPath.replace(/[/\\][^/\\]+$/, ""), { recursive: true, force: true });
    unmount();
  });

  test("engine.streamError appends an error line and returns to idle", async () => {
    const stub = setupStub();
    const historyPath = makeHistoryPath();
    const { stdin, lastFrame, unmount } = render(
      <IpcContext.Provider value={ctx(stub)}>
        <App historyPath={historyPath} onExit={() => undefined} />
      </IpcContext.Provider>,
    );
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("oops");
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 60));
    stub.emit("engine.streamError", { streamId: "s-test", error: "downstream failed" });
    await new Promise((r) => setTimeout(r, 60));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("downstream failed");
    expect(frame).toContain("❌");
    rmSync(historyPath.replace(/[/\\][^/\\]+$/, ""), { recursive: true, force: true });
    unmount();
  });

  test("disconnect banner appears when an IPC call throws ECONNRESET", async () => {
    const stub = new StubIpcClient({
      errors: { "engine.askStream": new Error("ECONNRESET") },
      results: { "connector.list": [], "watcher.list": [] },
    });
    const historyPath = makeHistoryPath();
    const { stdin, lastFrame, unmount } = render(
      <IpcContext.Provider value={ctx(stub)}>
        <App historyPath={historyPath} onExit={() => undefined} />
      </IpcContext.Provider>,
    );
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("hi");
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 60));
    expect(lastFrame() ?? "").toContain("Gateway disconnected");
    rmSync(historyPath.replace(/[/\\][^/\\]+$/, ""), { recursive: true, force: true });
    unmount();
  });
});
