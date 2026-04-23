import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";

import { ConnectorHealth } from "./ConnectorHealth.tsx";
import { IpcContext, type IpcContextValue } from "./ipc-context.ts";
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

describe("ConnectorHealth", () => {
  test("renders a line per connector with a status glyph", async () => {
    const stub = new StubIpcClient({
      results: {
        "connector.list": [
          { service: "github", status: "ok" },
          { service: "slack", status: "degraded" },
          { service: "notion", status: "down" },
        ],
      },
    });
    const { lastFrame, unmount } = render(
      <IpcContext.Provider value={ctx(stub)}>
        <ConnectorHealth mode="idle" />
      </IpcContext.Provider>,
    );
    await new Promise((r) => setTimeout(r, 20));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("github");
    expect(frame).toContain("slack");
    expect(frame).toContain("notion");
    expect(frame).toContain("●"); // ok
    expect(frame).toContain("◐"); // degraded
    expect(frame).toContain("○"); // down
    unmount();
  });

  test("prefixes degraded with ⚠", async () => {
    const stub = new StubIpcClient({
      results: { "connector.list": [{ service: "slack", status: "degraded" }] },
    });
    const { lastFrame, unmount } = render(
      <IpcContext.Provider value={ctx(stub)}>
        <ConnectorHealth mode="idle" />
      </IpcContext.Provider>,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(lastFrame() ?? "").toContain("⚠");
    unmount();
  });

  test("shows (stale) marker in the title when disconnected", async () => {
    const stub = new StubIpcClient({ results: { "connector.list": [] } });
    const { lastFrame, unmount } = render(
      <IpcContext.Provider value={ctx(stub)}>
        <ConnectorHealth mode="disconnected" />
      </IpcContext.Provider>,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(lastFrame() ?? "").toContain("(stale)");
    unmount();
  });

  test("shows loading state before first poll response", () => {
    const stub = new StubIpcClient({ results: { "connector.list": [] } });
    const { lastFrame, unmount } = render(
      <IpcContext.Provider value={ctx(stub)}>
        <ConnectorHealth mode="idle" />
      </IpcContext.Provider>,
    );
    expect(lastFrame() ?? "").toContain("Connectors");
    unmount();
  });
});
