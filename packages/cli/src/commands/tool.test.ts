import { describe, expect, test } from "bun:test";
import type { RunToolDeps, ToolClient } from "./tool.ts";
import {
  CLI_TOOLGEN_SESSION_ID,
  exitCodeForTool,
  formatToolApprovalPrompt,
  handleToolApprovalBroadcast,
  parseToolArgs,
  renderToolList,
  renderToolOutcome,
  runTool,
  TOOL_EXIT_CODES,
} from "./tool.ts";

describe("parseToolArgs", () => {
  test("create requires at least one --host", () => {
    expect(() => parseToolArgs(["create", "--description", "d"])).toThrow(/--host/);
  });

  test("create parses repeated --host flags", () => {
    const a = parseToolArgs([
      "create",
      "--description",
      "d",
      "--host",
      "a.example.com",
      "--host",
      "b.example.com",
    ]);
    expect(a).toMatchObject({ sub: "create", hosts: ["a.example.com", "b.example.com"] });
  });

  test("create parses repeatable --credential bindings", () => {
    const a = parseToolArgs([
      "create",
      "--description",
      "d",
      "--host",
      "a.example.com",
      "--credential",
      "a.example.com=tok",
    ]);
    expect(a).toMatchObject({ credentials: [{ host: "a.example.com", token: "tok" }] });
  });

  test("a --credential for a host not in --host is refused", () => {
    expect(() =>
      parseToolArgs([
        "create",
        "--description",
        "d",
        "--host",
        "a.example.com",
        "--credential",
        "b.example.com=tok",
      ]),
    ).toThrow(/not in --host/);
  });

  test("credential set requires a tool id, a host and exactly one scheme", () => {
    expect(() => parseToolArgs(["credential", "set", "tg_a", "a.example.com"])).toThrow(
      /--bearer|--header/,
    );
    expect(() =>
      parseToolArgs([
        "credential",
        "set",
        "tg_a",
        "a.example.com",
        "--bearer",
        "t",
        "--header",
        "X",
        "v",
      ]),
    ).toThrow(/exactly one/);
  });

  test("revoke requires a tool id", () => {
    expect(() => parseToolArgs(["revoke"])).toThrow(/tool id/);
  });

  test("an unknown subcommand is refused, not defaulted", () => {
    expect(() => parseToolArgs(["frobnicate"])).toThrow(/Usage/);
  });

  // Additional coverage beyond the brief's own test block.

  test("create keeps a token containing '=' intact (base64 padding)", () => {
    // Splitting on every "=" rather than the first would truncate a real base64 token.
    const a = parseToolArgs([
      "create",
      "--description",
      "d",
      "--host",
      "a.example.com",
      "--credential",
      "a.example.com=abc==",
    ]);
    expect(a).toMatchObject({ credentials: [{ host: "a.example.com", token: "abc==" }] });
  });

  test("create requires --description", () => {
    expect(() => parseToolArgs(["create", "--host", "a.example.com"])).toThrow(/--description/);
  });

  test("an unknown flag on create throws rather than being ignored", () => {
    expect(() =>
      parseToolArgs(["create", "--description", "d", "--host", "a.example.com", "--allow-net"]),
    ).toThrow(/Unknown flag/);
  });

  test("list parses --json", () => {
    expect(parseToolArgs(["list", "--json"])).toEqual({ sub: "list", json: true });
    expect(parseToolArgs(["list"])).toEqual({ sub: "list", json: false });
  });

  test("credential set parses a bearer scheme", () => {
    const a = parseToolArgs(["credential", "set", "tg_a", "a.example.com", "--bearer", "tok"]);
    expect(a).toEqual({
      sub: "credential-set",
      toolId: "tg_a",
      host: "a.example.com",
      scheme: { type: "bearer", token: "tok" },
    });
  });

  test("credential set parses a header scheme", () => {
    const a = parseToolArgs([
      "credential",
      "set",
      "tg_a",
      "a.example.com",
      "--header",
      "X-Api-Key",
      "secret",
    ]);
    expect(a).toEqual({
      sub: "credential-set",
      toolId: "tg_a",
      host: "a.example.com",
      scheme: { type: "header", headerName: "X-Api-Key", value: "secret" },
    });
  });

  test("credential set parses a basic scheme", () => {
    const a = parseToolArgs([
      "credential",
      "set",
      "tg_a",
      "a.example.com",
      "--basic",
      "user",
      "pass",
    ]);
    expect(a).toEqual({
      sub: "credential-set",
      toolId: "tg_a",
      host: "a.example.com",
      scheme: { type: "basic", username: "user", password: "pass" },
    });
  });

  test("credential set with an unknown subcommand under 'credential' is refused", () => {
    expect(() => parseToolArgs(["credential", "delete", "tg_a"])).toThrow(/Usage/);
  });

  test("empty argv is refused, not defaulted", () => {
    expect(() => parseToolArgs([])).toThrow(/Usage/);
  });
});

describe("TOOL_EXIT_CODES", () => {
  test("denial and refusal are distinguishable and in the reserved band", () => {
    expect(TOOL_EXIT_CODES.denied).toBe(126);
    expect(TOOL_EXIT_CODES.refused).toBe(127);
  });
});

describe("exitCodeForTool", () => {
  test("registered maps to 0, denied and refused map to the reserved band", () => {
    expect(exitCodeForTool({ status: "registered", toolId: "tg_a" })).toBe(0);
    expect(exitCodeForTool({ status: "denied" })).toBe(TOOL_EXIT_CODES.denied);
    expect(exitCodeForTool({ status: "refused", code: "ERR_TOOLGEN_DISABLED" })).toBe(
      TOOL_EXIT_CODES.refused,
    );
  });

  test("an unrecognised status maps to refused, never 0", () => {
    expect(exitCodeForTool({ status: "something-new" })).toBe(TOOL_EXIT_CODES.refused);
  });
});

describe("formatToolApprovalPrompt", () => {
  test("shows the tool body VERBATIM, not a digest", () => {
    const text = formatToolApprovalPrompt({
      toolName: "generated_tg_a",
      description: "fetch weather",
      body: "export default async function main() { return 1; }",
      approvedHosts: ["api.example.com"],
      credentialHosts: [],
    });
    expect(text).toContain("export default async function main() { return 1; }");
  });

  test("lists the approved hosts and credential hosts", () => {
    const text = formatToolApprovalPrompt({
      toolName: "generated_tg_a",
      description: "d",
      body: "1",
      approvedHosts: ["a.example.com", "b.example.com"],
      credentialHosts: ["a.example.com"],
    });
    expect(text).toContain("a.example.com, b.example.com");
    expect(text.toLowerCase()).toContain("credential hosts:");
  });

  test("states an empty credential host list explicitly, not by omission", () => {
    const text = formatToolApprovalPrompt({
      toolName: "generated_tg_a",
      description: "d",
      body: "1",
      approvedHosts: ["a.example.com"],
      credentialHosts: [],
    });
    expect(text.toLowerCase()).toContain("credential hosts: none");
  });
});

describe("handleToolApprovalBroadcast", () => {
  function harness(answer: unknown) {
    const shown: string[] = [];
    const answered: Array<{ requestId: string; approved: boolean }> = [];
    return {
      shown,
      answered,
      ask: async (message: string) => {
        shown.push(message);
        return answer;
      },
      respond: async (requestId: string, approved: boolean) => {
        answered.push({ requestId, approved });
      },
    };
  }

  const REQ = {
    requestId: "r1",
    toolName: "generated_tg_a",
    description: "d",
    body: "console.log(1)",
    approvedHosts: ["a.example.com"],
    credentialHosts: [],
  };

  test("approves only on an explicit true", async () => {
    const h = harness(true);
    await handleToolApprovalBroadcast(REQ, h.ask, h.respond);
    expect(h.answered).toEqual([{ requestId: "r1", approved: true }]);
    expect(h.shown[0]).toContain("console.log(1)");
  });

  test("a plain false is a denial", async () => {
    const h = harness(false);
    await handleToolApprovalBroadcast(REQ, h.ask, h.respond);
    expect(h.answered[0]?.approved).toBe(false);
  });

  test("cancelling the prompt is a denial, never an approval", async () => {
    const cancelSymbol = Symbol.for("clack:cancel");
    const h = harness(cancelSymbol);
    await handleToolApprovalBroadcast(REQ, h.ask, h.respond);
    expect(h.answered[0]?.approved).toBe(false);
  });

  test("a broadcast with no usable requestId is IGNORED, not answered", async () => {
    for (const bad of [{}, { requestId: "" }, { requestId: 7 }, undefined]) {
      const h = harness(true);
      await handleToolApprovalBroadcast(bad, h.ask, h.respond);
      expect(h.answered).toEqual([]);
      expect(h.shown).toEqual([]);
    }
  });

  test("survives non-string / non-array fields rather than throwing before responding", async () => {
    const h = harness(false);
    await handleToolApprovalBroadcast(
      { requestId: "r4", toolName: 7, body: {}, approvedHosts: "nope" },
      h.ask,
      h.respond,
    );
    expect(h.answered[0]?.requestId).toBe("r4");
    expect(h.shown[0]).toContain("none"); // malformed hosts render as "none", not a crash
  });
});

describe("renderToolOutcome — the drafting refusal is surfaced honestly", () => {
  test("the ERR_TOOLGEN_DRAFT_NOT_IMPLEMENTED refusal names the gap and points at the design spec", () => {
    const err: string[] = [];
    renderToolOutcome(
      { status: "refused", code: "ERR_TOOLGEN_DRAFT_NOT_IMPLEMENTED" },
      { out: () => {}, err: (s) => err.push(s) },
    );
    const text = err.join("");
    expect(text).toContain("tool drafting is not implemented in this release");
    expect(text).toContain("gate, sandbox and broker are in place");
    expect(text).toContain(
      "docs/superpowers/specs/2026-09-09-s2-runtime-tool-generation-design.md",
    );
    // Not a bare error code -- a caller reading this must not need to go look the code up.
    expect(text).not.toContain("ERR_TOOLGEN_DRAFT_NOT_IMPLEMENTED");
  });

  test("a different refused code still gets an honest, distinguishable message", () => {
    const err: string[] = [];
    renderToolOutcome(
      { status: "refused", code: "ERR_TOOLGEN_DISABLED" },
      { out: () => {}, err: (s) => err.push(s) },
    );
    expect(err.join("")).toContain("ERR_TOOLGEN_DISABLED");
  });

  test("registered prints the tool id to stdout", () => {
    const out: string[] = [];
    renderToolOutcome(
      { status: "registered", toolId: "tg_a" },
      { out: (s) => out.push(s), err: () => {} },
    );
    expect(out.join("")).toContain("tg_a");
  });
});

describe("renderToolList", () => {
  test("never renders a credential value -- only credential HOST names ever reach the wire shape", () => {
    const text = renderToolList([
      {
        toolId: "tg_a",
        toolName: "generated_tg_a",
        description: "d",
        approvedHosts: ["a.example.com"],
        credentialHosts: ["a.example.com"],
        approvedAt: 0,
      },
    ]);
    expect(text).toContain("credential hosts: a.example.com");
  });

  test("an empty list says so rather than printing nothing", () => {
    expect(renderToolList([])).toContain("No active generated tools");
  });
});

function fakeDeps(over: Partial<RunToolDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const codes: number[] = [];
  const calls: Array<{ method: string; params: unknown }> = [];
  let notify: ((params: unknown) => unknown) | undefined;
  const client: ToolClient = {
    onNotification: (_m, h) => {
      notify = h;
    },
    call: async (method, params) => {
      calls.push({ method, params });
      if (method === "toolgen.create") {
        return { status: "refused", code: "ERR_TOOLGEN_DISABLED" };
      }
      if (method === "toolgen.list") {
        return { tools: [] };
      }
      return { matched: true };
    },
  };
  const base: RunToolDeps = {
    runWithClient: async (fn) => fn(client),
    ask: async () => true,
    sink: { out: (s) => out.push(s), err: (s) => err.push(s) },
    setExitCode: (c) => codes.push(c),
    isInteractiveTty: () => true,
    ...over,
  };
  return { out, err, codes, calls, notifier: () => notify, d: base };
}

describe("runTool create — non-TTY refusal (load-bearing #1)", () => {
  test("a non-interactive stdin refuses BEFORE any gateway call is made", async () => {
    const h = fakeDeps({ isInteractiveTty: () => false });
    await runTool(["create", "--description", "d", "--host", "a.example.com"], h.d);
    // This is the property that matters: if the TTY check were deleted, `calls` would contain a
    // `toolgen.create` entry. Asserting on the CALL LIST, not just the exit code, is what makes
    // this test fail for the right reason.
    expect(h.calls).toEqual([]);
    expect(h.codes).toEqual([TOOL_EXIT_CODES.refused]);
    expect(h.err.join("")).toContain("interactive TTY");
    expect(h.err.join("")).toContain("LAN-forbidden and local-only");
  });

  test("an interactive TTY proceeds to call the gateway", async () => {
    const h = fakeDeps({ isInteractiveTty: () => true });
    await runTool(["create", "--description", "d", "--host", "a.example.com"], h.d);
    expect(h.calls.some((c) => c.method === "toolgen.create")).toBe(true);
  });
});

describe("runTool create — credentials never echoed (load-bearing #2)", () => {
  test("a --credential token never appears in any rendered output, including on failure", async () => {
    const SECRET = "sk_live_super_secret_value_9f8e7d";
    const h = fakeDeps();
    await runTool(
      [
        "create",
        "--description",
        "d",
        "--host",
        "a.example.com",
        "--credential",
        `a.example.com=${SECRET}`,
      ],
      h.d,
    );
    const everything = [...h.out, ...h.err].join("\n");
    expect(everything).not.toContain(SECRET);
  });

  test("a --bearer token given to credential set never appears in the refusal output", async () => {
    const SECRET = "sk_live_another_secret_value";
    const h = fakeDeps();
    await runTool(["credential", "set", "tg_a", "a.example.com", "--bearer", SECRET], h.d);
    const everything = [...h.out, ...h.err].join("\n");
    expect(everything).not.toContain(SECRET);
  });

  test("--json list output never carries a credential value", async () => {
    const client: ToolClient = {
      onNotification: () => {},
      call: async (method) => {
        if (method === "toolgen.list") {
          return {
            tools: [
              {
                toolId: "tg_a",
                toolName: "generated_tg_a",
                description: "d",
                approvedHosts: ["a.example.com"],
                credentialHosts: ["a.example.com"],
                approvedAt: 0,
              },
            ],
          };
        }
        return {};
      },
    };
    const h = fakeDeps({ runWithClient: async (fn) => fn(client) });
    await runTool(["list", "--json"], h.d);
    const text = h.out.join("");
    expect(text).toContain("a.example.com"); // the host is expected to show
    expect(text).not.toMatch(/token|bearer|password|secret/i);
  });
});

describe("runTool revoke — drops both halves via one RPC call (load-bearing #3)", () => {
  test("calls toolgen.revoke with the tool id -- the gateway-side handler drops the registry AND the on-disk script for this one call", async () => {
    const h = fakeDeps();
    await runTool(["revoke", "tg_a"], h.d);
    expect(h.calls).toEqual([{ method: "toolgen.revoke", params: { toolId: "tg_a" } }]);
    expect(h.out.join("")).toContain("Revoked tg_a");
  });
});

describe("runTool credential set — always refuses a live tool", () => {
  test("never calls the gateway, and tells the owner to revoke and recreate", async () => {
    const h = fakeDeps();
    await runTool(["credential", "set", "tg_a", "a.example.com", "--bearer", "t"], h.d);
    expect(h.calls).toEqual([]);
    expect(h.codes).toEqual([TOOL_EXIT_CODES.refused]);
    expect(h.err.join("")).toContain("revoke");
    expect(h.err.join("")).toContain("tg_a");
  });
});

describe("runTool create — the approval prompt shows the VERBATIM body (load-bearing #4)", () => {
  test("the body the owner is asked to approve reaches `ask` unmodified", async () => {
    const BODY = "export default async function main() { return 42; }";
    const shown: string[] = [];
    const client: ToolClient = {
      onNotification: (_m, h) => {
        // Simulate the gateway broadcasting the approval request mid-call, the way
        // `createGeneratedTool` does via `ConsentBroker.request`.
        void h({
          requestId: "r1",
          toolId: "tg_a",
          toolName: "generated_tg_a",
          description: "d",
          body: BODY,
          approvedHosts: ["a.example.com"],
          credentialHosts: [],
          initiator: "owner",
        });
      },
      call: async (method) => {
        if (method === "toolgen.create") return { status: "registered", toolId: "tg_a" };
        return { matched: true };
      },
    };
    const h = fakeDeps({
      runWithClient: async (fn) => fn(client),
      ask: async (message: string) => {
        shown.push(message);
        return true;
      },
    });
    await runTool(["create", "--description", "d", "--host", "a.example.com"], h.d);
    expect(shown[0]).toContain(BODY);
  });
});

describe("runTool — CLI_TOOLGEN_SESSION_ID is stable across invocations", () => {
  test("create and list use the SAME session id, so list can find what create registered", async () => {
    const createH = fakeDeps();
    await runTool(["create", "--description", "d", "--host", "a.example.com"], createH.d);
    const createCall = createH.calls.find((c) => c.method === "toolgen.create");
    if (createCall === undefined) throw new Error("expected a toolgen.create call");
    expect((createCall.params as { sessionId: string }).sessionId).toBe(CLI_TOOLGEN_SESSION_ID);

    const listH = fakeDeps();
    await runTool(["list"], listH.d);
    const listCall = listH.calls.find((c) => c.method === "toolgen.list");
    if (listCall === undefined) throw new Error("expected a toolgen.list call");
    expect((listCall.params as { sessionId: string }).sessionId).toBe(CLI_TOOLGEN_SESSION_ID);
  });
});

describe("runTool orchestration — general", () => {
  test("an ARG error never opens a connection, and exits refused", async () => {
    const h = fakeDeps();
    await runTool(["create", "--allow-net"], h.d);
    expect(h.calls).toEqual([]);
    expect(h.codes).toEqual([TOOL_EXIT_CODES.refused]);
    expect(h.err.join("")).toContain("Unknown flag");
  });

  test("a transport failure is reported and exits refused, never 0", async () => {
    const h = fakeDeps({
      runWithClient: async () => {
        throw new Error("Gateway is not running");
      },
    });
    await runTool(["create", "--description", "d", "--host", "a.example.com"], h.d);
    expect(h.err.join("")).toContain("Gateway is not running");
    expect(h.codes).toEqual([TOOL_EXIT_CODES.refused]);
  });

  test("registers the approval handler, which answers over the SAME client", async () => {
    const h = fakeDeps();
    await runTool(["create", "--description", "d", "--host", "a.example.com"], h.d);
    const notify = h.notifier();
    expect(notify).toBeDefined();
    await notify?.({
      requestId: "r9",
      toolId: "tg_a",
      toolName: "generated_tg_a",
      description: "d",
      body: "1",
      approvedHosts: ["a.example.com"],
      credentialHosts: [],
    });
    const respond = h.calls.find((c) => c.method === "toolgen.approvalRespond");
    expect(respond?.params).toEqual({ requestId: "r9", approved: true });
  });
});
