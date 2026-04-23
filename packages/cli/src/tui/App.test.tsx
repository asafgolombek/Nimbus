import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";

import { App } from "./App.tsx";
import { IpcContext } from "./ipc-context.ts";
import { ipcContextFor, makeHistoryPath } from "./test-helpers/context.ts";
import { StubIpcClient } from "./test-helpers/stub-client.ts";

function setupStub(): StubIpcClient {
  return new StubIpcClient({
    results: {
      "connector.list": [],
      "watcher.list": [],
      "engine.askStream": { streamId: "s-test" },
    },
  });
}

/** Standard App render + cleanup lifecycle; returns the render handles and a teardown fn. */
function renderApp(stub: StubIpcClient): {
  readonly stdin: ReturnType<typeof render>["stdin"];
  readonly lastFrame: ReturnType<typeof render>["lastFrame"];
  readonly teardown: () => void;
} {
  const history = makeHistoryPath("nimbus-tui-app-");
  const ink = render(
    <IpcContext.Provider value={ipcContextFor(stub)}>
      <App historyPath={history.path} onExit={() => undefined} />
    </IpcContext.Provider>,
  );
  return {
    stdin: ink.stdin,
    lastFrame: ink.lastFrame,
    teardown: () => {
      ink.unmount();
      history.cleanup();
    },
  };
}

const SETTLE_MS = 20;
const SUBMIT_SETTLE_MS = 60;

async function settle(ms = SETTLE_MS): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

describe("App state machine", () => {
  test("idle → streaming on submit", async () => {
    const stub = setupStub();
    const { stdin, lastFrame, teardown } = renderApp(stub);
    await settle();
    stdin.write("hello");
    stdin.write("\r");
    await settle(SUBMIT_SETTLE_MS);
    expect(stub.calls.some((c) => c.method === "engine.askStream")).toBe(true);
    expect(lastFrame() ?? "").toContain("hello");
    teardown();
  });

  test("streaming → idle on engine.streamDone", async () => {
    const stub = setupStub();
    const { stdin, lastFrame, teardown } = renderApp(stub);
    await settle();
    stdin.write("hi");
    stdin.write("\r");
    await settle(SUBMIT_SETTLE_MS);
    stub.emit("engine.streamToken", { streamId: "s-test", text: "response" });
    stub.emit("engine.streamDone", { streamId: "s-test" });
    await settle(SUBMIT_SETTLE_MS);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("response");
    expect(frame).toContain("nimbus>");
    teardown();
  });

  test("engine.streamError appends an error line and returns to idle", async () => {
    const stub = setupStub();
    const { stdin, lastFrame, teardown } = renderApp(stub);
    await settle();
    stdin.write("oops");
    stdin.write("\r");
    await settle(SUBMIT_SETTLE_MS);
    stub.emit("engine.streamError", { streamId: "s-test", error: "downstream failed" });
    await settle(SUBMIT_SETTLE_MS);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("downstream failed");
    expect(frame).toContain("❌");
    teardown();
  });

  test("disconnect banner appears when an IPC call throws ECONNRESET", async () => {
    const stub = new StubIpcClient({
      errors: { "engine.askStream": new Error("ECONNRESET") },
      results: { "connector.list": [], "watcher.list": [] },
    });
    const { stdin, lastFrame, teardown } = renderApp(stub);
    await settle();
    stdin.write("hi");
    stdin.write("\r");
    await settle(SUBMIT_SETTLE_MS);
    expect(lastFrame() ?? "").toContain("Gateway disconnected");
    teardown();
  });
});
