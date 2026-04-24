import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  createConnectionManager,
  type ConnectionDeps,
  type ConnectionState,
} from "../../src/connection/connection-manager.js";

class FakeClient {
  closed = false;
  async close(): Promise<void> {
    this.closed = true;
  }
}

describe("ConnectionManager", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("transitions connecting → connected on success", async () => {
    const deps: ConnectionDeps = {
      open: async () => new FakeClient() as unknown as never,
      discoverSocket: async () => ({ socketPath: "/tmp/test.sock", source: "default" as const }),
      log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
      reconnectDelayMs: 5,
    };
    const mgr = createConnectionManager(deps);
    const collected: ConnectionState[] = [];
    mgr.onState((s) => collected.push(s));
    await mgr.start();
    expect(collected.map((s) => s.kind)).toContain("connected");
    await mgr.dispose();
  });

  test("transitions to permission-denied on EACCES", async () => {
    const deps: ConnectionDeps = {
      open: async () => {
        const err = new Error("permission denied") as NodeJS.ErrnoException;
        err.code = "EACCES";
        throw err;
      },
      discoverSocket: async () => ({ socketPath: "/tmp/x.sock", source: "default" as const }),
      log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
      reconnectDelayMs: 1000,
    };
    const mgr = createConnectionManager(deps);
    const states: ConnectionState[] = [];
    mgr.onState((s) => states.push(s));
    await mgr.start();
    const last = states[states.length - 1];
    expect(last?.kind).toBe("permission-denied");
    if (last?.kind === "permission-denied") {
      expect(last.socketPath).toBe("/tmp/x.sock");
    }
    await mgr.dispose();
  });

  test("retries on ENOENT until success", async () => {
    let i = 0;
    const deps: ConnectionDeps = {
      open: async () => {
        i += 1;
        if (i < 3) {
          const err = new Error("nope") as NodeJS.ErrnoException;
          err.code = "ENOENT";
          throw err;
        }
        return new FakeClient() as unknown as never;
      },
      discoverSocket: async () => ({ socketPath: "/tmp/y.sock", source: "default" as const }),
      log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
      reconnectDelayMs: 1,
    };
    const mgr = createConnectionManager(deps);
    const states: ConnectionState[] = [];
    mgr.onState((s) => states.push(s));
    await mgr.start();
    await new Promise((r) => setTimeout(r, 50));
    const kinds = states.map((s) => s.kind);
    expect(kinds).toContain("connected");
    await mgr.dispose();
  });
});
