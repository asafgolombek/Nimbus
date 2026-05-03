import { EventEmitter } from "node:events";
import { describe, expect, test, vi } from "vitest";

import { type AutoStartDeps, createAutoStarter } from "../../src/connection/auto-start.js";

class FakeChild extends EventEmitter {
  killed = false;
  unref = vi.fn();
  kill = vi.fn(() => {
    this.killed = true;
  });
}

function makeDeps(opts: { spawnFails?: boolean; socketAppearsAfterMs?: number }): AutoStartDeps {
  let socketReady = false;
  setTimeout(() => {
    socketReady = true;
  }, opts.socketAppearsAfterMs ?? 5);
  return {
    spawn: vi.fn(() => {
      if (opts.spawnFails === true) {
        const child = new FakeChild();
        setTimeout(() => child.emit("error", new Error("ENOENT")), 1);
        return child as unknown as never;
      }
      return new FakeChild() as unknown as never;
    }),
    pingSocket: vi.fn(async () => socketReady),
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    timeoutMs: 200,
    pollIntervalMs: 5,
  };
}

describe("AutoStarter.spawn", () => {
  test("returns success when socket appears within timeout", async () => {
    const deps = makeDeps({ socketAppearsAfterMs: 20 });
    const starter = createAutoStarter(deps);
    const r = await starter.spawn("/tmp/x.sock");
    expect(r.kind).toBe("ok");
  });

  test("returns timeout when socket never appears", async () => {
    const deps = makeDeps({ socketAppearsAfterMs: 99999 });
    const starter = createAutoStarter(deps);
    const r = await starter.spawn("/tmp/x.sock");
    expect(r.kind).toBe("timeout");
  });

  test("returns spawn-error when binary not found", async () => {
    const deps = makeDeps({ spawnFails: true });
    const starter = createAutoStarter(deps);
    const r = await starter.spawn("/tmp/x.sock");
    expect(r.kind).toBe("spawn-error");
  });
});
