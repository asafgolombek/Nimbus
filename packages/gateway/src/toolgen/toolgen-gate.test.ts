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
  // Spy counters on the three "reaches outside the process" effects: writing the script, spawning
  // the child, and undoing a Vault bind. A test overriding one of these fakes loses its counter for
  // that dep only -- the other two keep counting, which is what lets a single override (e.g.
  // `requestApproval`) still prove "nothing was written or spawned" via the untouched defaults.
  const calls = { writeScript: 0, spawn: 0, revokeCredentials: 0 };
  return {
    db,
    config: { ...DEFAULT_NIMBUS_TOOL_GENERATION_TOML, enabled: true },
    enforced: { capabilitiesDisabled: new Set<string>() },
    registry: new ToolgenRegistry(),
    draftBody: async () => "return 1;",
    assertConfinement: async () => {},
    writeScript: async () => {
      calls.writeScript++;
      return "/tmp/tg/index.ts";
    },
    scriptDir: () => "/tmp/tg",
    bindCredentials: async () => [],
    revokeCredentials: async () => {
      calls.revokeCredentials++;
    },
    spawn: async () => {
      calls.spawn++;
      return {
        describe: async () => ({ name: "t", description: "d" }),
        call: async () => null,
        close: async () => {},
      };
    },
    requestApproval: async () => true,
    now: () => 1,
    newId: () => "tg_a",
    calls,
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
  test("config off refuses, never prompts, and reaches nothing outside the process", async () => {
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
    // Proves non-spawn / non-write, not just non-registration: a gate that wrote the script or
    // spawned the child and only skipped `registry.register` would still pass a
    // `forSession(...).length === 0` check.
    expect(d.calls.writeScript).toBe(0);
    expect(d.calls.spawn).toBe(0);
    expect(d.calls.revokeCredentials).toBe(0);
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

  test("an ABSENT policy accessor refuses fail-closed, it does not default to enabled, and never prompts", async () => {
    let prompted = false;
    const d = deps({
      enforced: undefined,
      requestApproval: async () => {
        prompted = true;
        return true;
      },
    });
    const outcome = await createGeneratedTool(req, d as never);
    expect(outcome.status).toBe("refused");
    if (outcome.status !== "refused") throw new Error("unreachable");
    // Weakest possible assertion here would be `.status === "refused"` alone -- that also passes for
    // a gate that crashed on `undefined.capabilitiesDisabled`, or one that prompted and THEN refused.
    // Pin the exact code and prove the prompt was never reached.
    expect(outcome.code).toBe("ERR_TOOLGEN_POLICY_DISABLED");
    expect(prompted).toBe(false);
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
            inputSchema: { type: "object", properties: {} },
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

describe("the manifest granted to the sandbox", () => {
  test("grants read to the script dir AND the runtime's own read paths, never node_modules", async () => {
    let seenRead: string[] | undefined;
    const d = deps({
      assertConfinement: async (manifest: { permissions: { filesystem: { read: string[] } } }) => {
        seenRead = manifest.permissions.filesystem.read;
      },
    });
    await createGeneratedTool(req, d as never);
    expect(seenRead).toBeDefined();
    const read = seenRead ?? [];
    // The script directory (Task 11's grant) ...
    expect(read).toContain("/tmp/tg");
    // ... AND the interpreter's own paths (`ExecRuntime.requiredReadPaths()`), without which the
    // Windows AppContainer helper leaves bun itself unreadable and the child dies at exit 68 before
    // running a line, no stdout, no stderr.
    expect(read.length).toBeGreaterThan(1);
    expect(read.some((p) => p.toLowerCase().includes("node_modules"))).toBe(false);
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

  test.each([
    [""],
    ["   "],
    // A non-https scheme must be refused, not silently accepted with an empty hostname: `unix:///x`
    // parses cleanly (its own scheme, an empty authority) and `new URL(...).hostname` comes back as
    // `""`, which sails past the leading blank-string guard because that guard runs on the RAW input,
    // not the parsed result.
    ["unix:///x"],
    ["http://api.example.com"],
    ["ftp://api.example.com"],
  ])("refuses %p", (raw) => {
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

  test("a denial registers NOTHING, writes and spawns nothing, revokes any bound credential, and audits rejected", async () => {
    const d = deps({
      bindCredentials: async () => ["api.example.com"],
      requestApproval: async () => false,
    });
    expect(await createGeneratedTool(req, d as never)).toEqual({ status: "denied" });
    expect(d.registry.forSession("s1")).toHaveLength(0);
    // Proves non-spawn / non-write, not just non-registration.
    expect(d.calls.writeScript).toBe(0);
    expect(d.calls.spawn).toBe(0);
    // The credential was bound BEFORE the prompt (so the prompt can name a real host list) -- a
    // denial must not leave it behind under a toolId nothing will ever call again.
    expect(d.calls.revokeCredentials).toBe(1);
    expect(auditRows(d.db)[0]?.hitl_status).toBe("rejected");
  });

  test("a THROWING revokeCredentials on the denial path still returns 'denied' and still audits — the outcome is not lost (load-bearing #4)", async () => {
    // A previous version of the gate called `deps.revokeCredentials` unguarded on this path. If
    // that throws, it escapes into the outer `catch`, which then sees `credentialsBound` still
    // `true` and calls `revokeCredentials` again -- also unguarded -- and a SECOND throw there
    // escapes `createGeneratedTool` entirely, so no `audit()` call ever runs for a denial the
    // owner actually gave. This test fails on that regression: the `throw` below is designed to
    // hit exactly that unguarded second call if `safeRevokeCredentials`'s swallow is ever removed.
    const d = deps({
      bindCredentials: async () => ["api.example.com"],
      requestApproval: async () => false,
      revokeCredentials: async () => {
        throw new Error("vault unavailable");
      },
    });
    const outcome = await createGeneratedTool(req, d as never);
    expect(outcome).toEqual({ status: "denied" });
    const row = auditRows(d.db)[0];
    expect(row?.hitl_status).toBe("rejected");
    expect(row?.action_json).toContain("denied_by_owner");
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

  test("a failure AFTER approval is audited hitl_status APPROVED (not rejected), tagged failed_after_approval, and still revokes the bound credential", async () => {
    // Deleting the `approved ? ... : ...` branch in the gate's catch block leaves every one of the
    // other 16 tests green -- this is the one test that fails if that sentinel regresses. An owner
    // who approved and then hit a write/spawn failure must not be recorded as though they were never
    // asked: an auditor filtering `hitl_status='approved'` on `tool.generate` would otherwise miss a
    // run they actually consented to, where a process may already have spawned.
    const d = deps({
      bindCredentials: async () => ["api.example.com"],
      writeScript: async () => {
        throw new Error("disk full");
      },
    });
    const outcome = await createGeneratedTool(req, d as never);
    expect(outcome.status).toBe("refused");
    if (outcome.status !== "refused") throw new Error("unreachable");
    expect(outcome.code).toBe("ERR_TOOLGEN_INTERNAL");
    const row = auditRows(d.db)[0];
    expect(row?.hitl_status).toBe("approved");
    expect(row?.action_json).toContain("failed_after_approval");
    expect(row?.action_json).not.toContain("refused_before_consent");
    // The toolId will never register (writeScript failed), so its bound credential must not survive.
    expect(d.calls.revokeCredentials).toBe(1);
  });
});
