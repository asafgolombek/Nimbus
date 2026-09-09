import { describe, expect, test } from "bun:test";
import { ToolgenRegistry } from "./toolgen-registry.ts";
import type { ToolgenEnvelope } from "./toolgen-types.ts";

function env(toolId: string, sessionId = "s1"): ToolgenEnvelope {
  return {
    sessionId,
    scriptPath: `/tmp/${toolId}/index.ts`,
    approvedAt: 1,
    artifact: {
      toolId,
      toolName: toolId,
      description: "d",
      body: "b",
      approvedHosts: ["api.example.com"],
      credentialHosts: [],
      manifest: {
        id: `toolgen.${toolId}`,
        version: "0.0.0",
        permissions: { network: [], filesystem: { read: [], write: [] } },
        updateChannel: "stable",
      },
    },
  };
}

describe("ToolgenRegistry", () => {
  test("tools are scoped to their session", () => {
    const r = new ToolgenRegistry();
    r.register(env("tg_a", "s1"), async () => {});
    r.register(env("tg_b", "s2"), async () => {});
    expect(r.forSession("s1").map((e) => e.artifact.toolId)).toEqual(["tg_a"]);
    expect(r.countForSession("s2")).toBe(1);
    expect(r.forSession("s3")).toEqual([]);
  });

  test("a terminated tool is excluded from the session listing", () => {
    const r = new ToolgenRegistry();
    r.register(env("tg_a"), async () => {});
    r.markTerminated("tg_a");
    expect(r.isTerminated("tg_a")).toBe(true);
    expect(r.forSession("s1")).toEqual([]);
  });

  test("revoke calls the close hook and drops the tool", async () => {
    const r = new ToolgenRegistry();
    let closed = false;
    r.register(env("tg_a"), async () => {
      closed = true;
    });
    await r.revoke("tg_a");
    expect(closed).toBe(true);
    expect(r.get("tg_a")).toBeUndefined();
  });

  test("revokeAll drains every session — the shutdown path", async () => {
    const r = new ToolgenRegistry();
    let closes = 0;
    r.register(env("tg_a", "s1"), async () => {
      closes += 1;
    });
    r.register(env("tg_b", "s2"), async () => {
      closes += 1;
    });
    await r.revokeAll();
    expect(closes).toBe(2);
    expect(r.forSession("s1")).toEqual([]);
  });

  test("a close hook that throws does not block the other revocations", async () => {
    const r = new ToolgenRegistry();
    let closed = false;
    r.register(env("tg_a", "s1"), async () => {
      throw new Error("boom");
    });
    r.register(env("tg_b", "s2"), async () => {
      closed = true;
    });
    await r.revokeAll();
    expect(closed).toBe(true);
  });
});

describe("an unknown toolId is a no-op, never a throw", () => {
  // Both arms matter for a real reason: `wireExitCallback` fires `markTerminated` AFTER an
  // owner-initiated `revoke()` has already deleted the entry (see `spawnGeneratedTool`'s doc
  // comment, which calls that sequence "harmless and expected"). If either of these threw or
  // reported a stale value, that ordinary revoke-then-exit race would surface as an error.
  test("markTerminated on a toolId that was never registered does nothing", () => {
    const registry = new ToolgenRegistry();
    expect(() => registry.markTerminated("tg_never")).not.toThrow();
    expect(registry.isTerminated("tg_never")).toBe(false);
  });

  test("markTerminated after revoke() dropped the entry stays a no-op", () => {
    const registry = new ToolgenRegistry();
    registry.register(env("tg_a"), async () => {});
    return registry.revoke("tg_a").then(() => {
      registry.markTerminated("tg_a");
      // Not "terminated" — it is GONE, which `isTerminated` reports as false for an absent id.
      expect(registry.isTerminated("tg_a")).toBe(false);
      expect(registry.get("tg_a")).toBeUndefined();
    });
  });

  test("isTerminated distinguishes registered-and-live from registered-and-terminated", () => {
    const registry = new ToolgenRegistry();
    registry.register(env("tg_a"), async () => {});
    expect(registry.isTerminated("tg_a")).toBe(false);
    registry.markTerminated("tg_a");
    expect(registry.isTerminated("tg_a")).toBe(true);
  });
});
