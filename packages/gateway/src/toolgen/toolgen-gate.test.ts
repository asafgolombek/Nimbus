import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { DEFAULT_NIMBUS_TOOL_GENERATION_TOML } from "../config/nimbus-toml.ts";
import { CURRENT_SCHEMA_VERSION } from "../index/local-index.ts";
import { runIndexedSchemaMigrations } from "../index/migrations/runner.ts";
import { createGeneratedTool, normalizeHost } from "./toolgen-gate.ts";
import { ToolgenRegistry } from "./toolgen-registry.ts";

function deps(over: Record<string, unknown> = {}) {
  const db = new Database(":memory:");
  runIndexedSchemaMigrations(db, CURRENT_SCHEMA_VERSION);
  return {
    db,
    config: { ...DEFAULT_NIMBUS_TOOL_GENERATION_TOML, enabled: true },
    enforced: { capabilitiesDisabled: new Set<string>() },
    registry: new ToolgenRegistry(),
    draftBody: async () => "return 1;",
    assertConfinement: async () => {},
    writeScript: async () => "/tmp/tg/index.ts",
    scriptDir: () => "/tmp/tg",
    bindCredentials: async () => [],
    spawn: async () => ({
      describe: async () => ({ name: "t", description: "d" }),
      call: async () => null,
      close: async () => {},
    }),
    requestApproval: async () => true,
    now: () => 1,
    newId: () => "tg_a",
    approvalCalls: 0,
    ...over,
  };
}

const req = { sessionId: "s1", description: "list open PRs", hosts: ["api.example.com"] };

function auditRows(db: Database) {
  return db
    .query<{ hitl_status: string; action_json: string }, []>(
      "SELECT hitl_status, action_json FROM audit_log WHERE action_type = 'tool.generate'",
    )
    .all();
}

describe("createGeneratedTool refusals happen BEFORE consent", () => {
  test("config off refuses and never prompts", async () => {
    let prompted = false;
    const d = deps({
      config: DEFAULT_NIMBUS_TOOL_GENERATION_TOML,
      requestApproval: async () => {
        prompted = true;
        return true;
      },
    });
    expect(await createGeneratedTool(req, d as never)).toEqual({
      status: "refused",
      code: "ERR_TOOLGEN_DISABLED",
    });
    expect(prompted).toBe(false);
  });

  test("org policy off refuses and never prompts", async () => {
    let prompted = false;
    const d = deps({
      enforced: { capabilitiesDisabled: new Set(["tool_generation"]) },
      requestApproval: async () => {
        prompted = true;
        return true;
      },
    });
    expect((await createGeneratedTool(req, d as never)).status).toBe("refused");
    expect(prompted).toBe(false);
  });

  test("an ABSENT policy accessor refuses fail-closed, it does not default to enabled", async () => {
    const d = deps({ enforced: undefined });
    expect((await createGeneratedTool(req, d as never)).status).toBe("refused");
  });

  test("session budget refuses and never prompts", async () => {
    let prompted = false;
    const registry = new ToolgenRegistry();
    for (const id of ["a", "b", "c"]) {
      registry.register(
        {
          sessionId: "s1",
          scriptPath: "/tmp",
          approvedAt: 1,
          artifact: {
            toolId: id,
            toolName: id,
            description: "",
            body: "",
            approvedHosts: [],
            credentialHosts: [],
            manifest: {
              id: `toolgen.${id}`,
              version: "0.0.0",
              permissions: { network: [], filesystem: { read: [], write: [] } },
              updateChannel: "stable",
            },
          },
        },
        async () => {},
      );
    }
    const d = deps({
      registry,
      requestApproval: async () => {
        prompted = true;
        return true;
      },
    });
    const outcome = await createGeneratedTool(req, d as never);
    expect(outcome.status).toBe("refused");
    if (outcome.status !== "refused") throw new Error("unreachable");
    expect(outcome.code).toBe("ERR_TOOLGEN_SESSION_BUDGET_EXCEEDED");
    expect(prompted).toBe(false);
  });

  test("a failed confinement probe refuses and never prompts", async () => {
    let prompted = false;
    const d = deps({
      assertConfinement: async () => {
        throw new Error("degraded");
      },
      requestApproval: async () => {
        prompted = true;
        return true;
      },
    });
    expect((await createGeneratedTool(req, d as never)).status).toBe("refused");
    expect(prompted).toBe(false);
  });

  test("an unsafe minted tool id refuses and never prompts", async () => {
    let prompted = false;
    const d = deps({
      newId: () => "a\nb",
      requestApproval: async () => {
        prompted = true;
        return true;
      },
    });
    const outcome = await createGeneratedTool(req, d as never);
    expect(outcome).toEqual({ status: "refused", code: "ERR_TOOLGEN_INTERNAL" });
    expect(prompted).toBe(false);
  });
});

describe("normalizeHost", () => {
  test.each([
    ["https://api.example.com/v1", "api.example.com"],
    ["API.Example.COM", "api.example.com"],
    ["api.example.com:443", "api.example.com"],
    ["  api.example.com  ", "api.example.com"],
  ])("%s -> %s", (raw, want) => {
    expect(normalizeHost(raw)).toBe(want);
  });

  test.each([[""], ["   "]])("refuses %p", (raw) => {
    expect(() => normalizeHost(raw)).toThrow();
  });
});

describe("createGeneratedTool outcomes", () => {
  test("approval registers the tool and audits approved", async () => {
    const d = deps();
    expect(await createGeneratedTool(req, d as never)).toEqual({
      status: "registered",
      toolId: "tg_a",
    });
    expect(d.registry.forSession("s1")).toHaveLength(1);
    expect(auditRows(d.db)[0]?.hitl_status).toBe("approved");
  });

  test("a denial registers NOTHING and audits rejected", async () => {
    const d = deps({ requestApproval: async () => false });
    expect(await createGeneratedTool(req, d as never)).toEqual({ status: "denied" });
    expect(d.registry.forSession("s1")).toHaveLength(0);
    expect(auditRows(d.db)[0]?.hitl_status).toBe("rejected");
  });

  test("the audit row carries the VERBATIM body, and never hitl_status not_required", async () => {
    const d = deps({ draftBody: async () => "VERBATIM-BODY" });
    await createGeneratedTool(req, d as never);
    const row = auditRows(d.db)[0];
    expect(row?.action_json).toContain("VERBATIM-BODY");
    expect(row?.hitl_status).not.toBe("not_required");
  });

  test("the approval prompt names the hosts that will receive a CREDENTIAL", async () => {
    let seen: { credentialHosts: readonly string[] } | undefined;
    const d = deps({
      bindCredentials: async () => ["api.example.com"],
      requestApproval: async (input: { credentialHosts: readonly string[] }) => {
        seen = input;
        return true;
      },
    });
    await createGeneratedTool(req, d as never);
    // Vacuous before credentials moved to create time: nothing could be in the Vault under a
    // toolId that did not exist yet, so this list was ALWAYS empty and disclosed nothing.
    expect(seen?.credentialHosts).toEqual(["api.example.com"]);
  });

  test("a refusal before consent still audits, as rejected with its own outcome tag", async () => {
    const d = deps({ config: DEFAULT_NIMBUS_TOOL_GENERATION_TOML });
    await createGeneratedTool(req, d as never);
    const row = auditRows(d.db)[0];
    expect(row?.hitl_status).toBe("rejected");
    expect(row?.action_json).toContain("refused_before_consent");
  });
});
