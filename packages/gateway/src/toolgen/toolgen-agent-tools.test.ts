import { describe, expect, test } from "bun:test";
import { buildGeneratedTools } from "./toolgen-agent-tools.ts";
import { ToolgenRegistry } from "./toolgen-registry.ts";

const wrap = <T>(_service: string, _tool: string, def: T): T => def;

import type { ToolgenEnvelope } from "./toolgen-types.ts";

function env(toolId: string, sessionId: string): ToolgenEnvelope {
  return {
    sessionId,
    scriptPath: "/tmp",
    approvedAt: 1,
    artifact: {
      toolId,
      toolName: toolId,
      description: "d",
      body: "b",
      approvedHosts: [],
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

describe("buildGeneratedTools", () => {
  test("contributes NOTHING when the session holds no generated tool", () => {
    expect(buildGeneratedTools("s1", new ToolgenRegistry(), async () => null, wrap)).toEqual({});
  });

  test("contributes NOTHING for an undefined session", () => {
    const r = new ToolgenRegistry();
    r.register(env("tg_a", "s1"), async () => {});
    expect(buildGeneratedTools(undefined, r, async () => null, wrap)).toEqual({});
  });

  test("exposes only the CURRENT session's tools", () => {
    const r = new ToolgenRegistry();
    r.register(env("tg_a", "s1"), async () => {});
    r.register(env("tg_b", "s2"), async () => {});
    expect(Object.keys(buildGeneratedTools("s1", r, async () => null, wrap))).toEqual(["tg_a"]);
  });

  test("a terminated tool disappears from the surface", () => {
    const r = new ToolgenRegistry();
    r.register(env("tg_a", "s1"), async () => {});
    r.markTerminated("tg_a");
    expect(buildGeneratedTools("s1", r, async () => null, wrap)).toEqual({});
  });

  test("I11 — every generated tool passes through the envelope wrapper", () => {
    const r = new ToolgenRegistry();
    r.register(env("tg_a", "s1"), async () => {});
    const wrapped: string[] = [];
    const spy = <T>(service: string, tool: string, def: T): T => {
      wrapped.push(`${service}:${tool}`);
      return def;
    };
    buildGeneratedTools("s1", r, async () => null, spy);
    // A generated tool returns a remote API response straight into the model's context. If this
    // ever passes vacuously, an external server can address the agent directly.
    expect(wrapped).toEqual(["toolgen:tg_a"]);
  });
});
