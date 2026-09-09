import { describe, expect, test } from "bun:test";
import { draftGeneratedTool, extractJsonPayload, type ToolgenDraftDeps } from "./toolgen-draft.ts";
import type { ToolgenError } from "./toolgen-types.ts";

const REQ = { sessionId: "s1", description: "list issues", hosts: ["api.github.com"] };
const SUBJECT = { hosts: ["api.github.com"], credentialHosts: [] };

const GOOD = JSON.stringify({
  inputSchema: { type: "object", properties: { owner: { type: "string" } }, required: ["owner"] },
  body: 'const r = await nimbusFetch("https://api.github.com/x"); return JSON.parse(r.body);',
});

function deps(
  replies: (string | null)[],
  extra: Partial<ToolgenDraftDeps> = {},
  isLocal = true,
): ToolgenDraftDeps {
  const queue = [...replies];
  return {
    generate: async () => {
      const next = queue.shift();
      return next === undefined || next === null ? null : { text: next, isLocal };
    },
    findEndpoints: async () => [],
    ...extra,
  };
}

describe("extractJsonPayload", () => {
  const obj = '{"a":1}';

  test.each([
    ["bare JSON", obj],
    ["a fenced block", "```json\n" + obj + "\n```"],
    ["an unlabelled fence", "```\n" + obj + "\n```"],
    // THE case an anchored regex fails: a benign preamble would otherwise burn the single redraft.
    ["a fence with a preamble", "Here is the tool you asked for:\n```json\n" + obj + "\n```"],
    ["a fence with a trailing note", "```json\n" + obj + "\n```\nLet me know if you need changes."],
    ["a bare object with prose around it", "Sure! " + obj + " Hope that helps."],
  ])("extracts the object from %s", (_label, raw) => {
    expect(JSON.parse(extractJsonPayload(raw))).toEqual({ a: 1 });
  });

  test("a closing brace inside a string value does not truncate the object", () => {
    const withBrace = JSON.stringify({ body: "if (x) { return 1; }" });
    expect(JSON.parse(extractJsonPayload("```json\n" + withBrace + "\n```"))).toEqual({
      body: "if (x) { return 1; }",
    });
  });

  test("returns the input unchanged when there is no object to find, so rung 1 still fails", () => {
    expect(extractJsonPayload("no json here")).toBe("no json here");
  });
});

describe("draftGeneratedTool", () => {
  test("returns a validated body and schema on the first attempt", async () => {
    const out = await draftGeneratedTool(REQ, deps([GOOD]), SUBJECT);
    expect(out.attempts).toBe(1);
    expect(out.inputSchema.required).toEqual(["owner"]);
    expect(out.body).toContain("nimbusFetch");
    expect(out.grounding).toEqual({ kind: "description_only" });
  });

  test("a fenced reply with a preamble succeeds on the FIRST attempt", async () => {
    const out = await draftGeneratedTool(
      REQ,
      deps(["Here you go:\n```json\n" + GOOD + "\n```"]),
      SUBJECT,
    );
    // The point is `attempts === 1`: a formatting artifact must not spend the redraft budget that
    // exists for real defects.
    expect(out.attempts).toBe(1);
  });

  test.each([
    ["prose instead of JSON", "Here is your tool!"],
    [
      "a nested-object schema",
      JSON.stringify({
        inputSchema: { type: "object", properties: { a: { type: "object" } } },
        body: "return 1;",
      }),
    ],
    [
      "a syntax error in the body",
      JSON.stringify({ inputSchema: { type: "object", properties: {} }, body: "const = ;" }),
    ],
    [
      "a forbidden global",
      JSON.stringify({
        inputSchema: { type: "object", properties: {} },
        body: 'await fetch("https://x");',
      }),
    ],
    ["a missing body key", JSON.stringify({ inputSchema: { type: "object", properties: {} } })],
  ])("redrafts once after %s, then succeeds", async (_label, bad) => {
    const out = await draftGeneratedTool(REQ, deps([bad, GOOD]), SUBJECT);
    expect(out.attempts).toBe(2);
  });

  test("refuses after two failures with ERR_TOOLGEN_DRAFT_INVALID", async () => {
    try {
      await draftGeneratedTool(REQ, deps(["nope", "still nope"]), SUBJECT);
      throw new Error("expected a throw");
    } catch (e) {
      expect((e as ToolgenError).code).toBe("ERR_TOOLGEN_DRAFT_INVALID");
    }
  });

  test("never makes a third attempt", async () => {
    let calls = 0;
    const d: ToolgenDraftDeps = {
      generate: async () => {
        calls += 1;
        return { text: "nope", isLocal: true };
      },
      findEndpoints: async () => [],
    };
    await expect(draftGeneratedTool(REQ, d, SUBJECT)).rejects.toThrow();
    expect(calls).toBe(2);
  });

  test("locality is DERIVED from the provider, not from the config mode", async () => {
    const remote = await draftGeneratedTool(REQ, deps([GOOD], {}, false), SUBJECT);
    expect(remote.locality).toBe("remote");
    const local = await draftGeneratedTool(REQ, deps([GOOD], {}, true), SUBJECT);
    expect(local.locality).toBe("local");
  });

  test("refuses with ERR_TOOLGEN_NO_DRAFT_MODEL when no provider answers", async () => {
    try {
      await draftGeneratedTool(REQ, deps([null]), SUBJECT);
      throw new Error("expected a throw");
    } catch (e) {
      expect((e as ToolgenError).code).toBe("ERR_TOOLGEN_NO_DRAFT_MODEL");
    }
  });

  test("reports endpoint grounding when the finder returns rows", async () => {
    const out = await draftGeneratedTool(
      REQ,
      deps([GOOD], {
        findEndpoints: async () => [
          { serviceName: "github-api", method: "GET", path: "/x", operationId: null, summary: "" },
        ],
      }),
      SUBJECT,
    );
    expect(out.grounding).toEqual({ kind: "endpoints", count: 1, services: ["github-api"] });
  });

  test("names credential HOSTS in the prompt and never a secret", async () => {
    // The types cannot carry a secret here at all (spec § 9.1) — `DraftSubject` holds names. This
    // asserts the rendered prompt too, since that is the artefact that would actually leave.
    let prompt = "";
    await draftGeneratedTool(
      REQ,
      // biome-ignore lint/complexity/noCommaOperator: capture the prompt inline, at the exact call site under test
      // biome-ignore lint/suspicious/noAssignInExpressions: same — the assignment IS the assertion fixture
      deps([GOOD], { generate: async (p) => ({ text: ((prompt = p), GOOD), isLocal: true }) }),
      { hosts: ["api.github.com"], credentialHosts: ["api.github.com"] },
    );
    expect(prompt).toContain("api.github.com");
    expect(prompt).not.toContain("s3cret");
  });

  test("the prompt names the NORMALISED hosts the broker will match", async () => {
    // The gate normalises before drafting, so a prompt built from raw `req.hosts` would tell the
    // model about a host (`https://api.github.com/v1`) the broker's `url.hostname` never matches.
    let prompt = "";
    await draftGeneratedTool(
      { ...REQ, hosts: ["https://api.github.com/v1"] },
      // biome-ignore lint/complexity/noCommaOperator: capture the prompt inline, at the exact call site under test
      // biome-ignore lint/suspicious/noAssignInExpressions: same — the assignment IS the assertion fixture
      deps([GOOD], { generate: async (p) => ({ text: ((prompt = p), GOOD), isLocal: true }) }),
      SUBJECT,
    );
    expect(prompt).toContain("api.github.com");
    expect(prompt).not.toContain("https://api.github.com/v1");
  });
});
