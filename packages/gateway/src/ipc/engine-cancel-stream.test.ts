import { describe, expect, test } from "bun:test";

import { createCancelStreamHandler } from "./engine-cancel-stream.ts";
import { createStreamRegistry } from "./engine-ask-stream.ts";

describe("createCancelStreamHandler", () => {
  test("returns ok=true and aborts the controller for known streamId", () => {
    const registry = createStreamRegistry();
    const ac = new AbortController();
    registry.register("s1", ac);
    const handler = createCancelStreamHandler(registry);
    const result = handler({ streamId: "s1" });
    expect(result).toEqual({ ok: true });
    expect(ac.signal.aborted).toBe(true);
  });

  test("returns ok=true (idempotent) for unknown streamId", () => {
    const registry = createStreamRegistry();
    const handler = createCancelStreamHandler(registry);
    const result = handler({ streamId: "never-existed" });
    expect(result).toEqual({ ok: true });
  });

  test("throws RpcMethodError when streamId is not a non-empty string", () => {
    const registry = createStreamRegistry();
    const handler = createCancelStreamHandler(registry);
    expect(() => handler({ streamId: "" })).toThrow();
    expect(() => handler({ streamId: 42 as unknown as string })).toThrow();
  });
});
