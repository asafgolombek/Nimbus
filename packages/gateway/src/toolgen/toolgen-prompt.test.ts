import { describe, expect, test } from "bun:test";
import type { GroundedEndpoint } from "./toolgen-grounding.ts";
import { buildDraftPrompt, buildRedraftPrompt } from "./toolgen-prompt.ts";

const ENDPOINTS: GroundedEndpoint[] = [
  {
    serviceName: "github-api",
    method: "GET",
    path: "/repos/{owner}/{repo}/issues",
    operationId: "listIssues",
    summary: "issues",
  },
];

describe("buildDraftPrompt", () => {
  const base = { description: "list open issues", hosts: ["api.github.com"], credentialHosts: [] };

  // Spec § 4.4: each of these is a fact about the emitted skeleton, not a matter of phrasing.
  test.each([
    ["the nimbusFetch signature", "nimbusFetch"],
    ["that body is already a string", "JSON.parse(res.body)"],
    ["that .json() does not exist", "res.json()"],
    ["the forbidden globals", "process"],
    ["the zero-import rule", "no imports"],
    ["URLSearchParams as the query-string route", "URLSearchParams"],
    ["the output envelope", "inputSchema"],
    ["the approved hosts", "api.github.com"],
  ])("states %s", (_label, needle) => {
    expect(buildDraftPrompt({ ...base, endpoints: [] })).toContain(needle);
  });

  test("includes grounded endpoints when present", () => {
    const p = buildDraftPrompt({ ...base, endpoints: ENDPOINTS });
    expect(p).toContain("GET /repos/{owner}/{repo}/issues");
    expect(p).toContain("listIssues");
  });

  test("says so explicitly when no endpoints were found", () => {
    expect(buildDraftPrompt({ ...base, endpoints: [] })).toContain("No indexed API specification");
  });

  test("names credential hosts WITHOUT any credential value", () => {
    const p = buildDraftPrompt({ ...base, credentialHosts: ["api.github.com"], endpoints: [] });
    expect(p).toContain("credential is attached automatically");
    expect(p).not.toContain("Authorization: Bearer");
  });

  // FINDING 1: headers is a plain Record with lowercase keys, no .get() method
  test("states that headers is a plain object of lower-cased header names", () => {
    expect(buildDraftPrompt({ ...base, endpoints: [] })).toContain('res.headers["content-type"]');
  });

  test("states that headers has no .get() method", () => {
    expect(buildDraftPrompt({ ...base, endpoints: [] })).toContain("with no .get() method");
  });

  // FINDING 2: broker is https:// only
  test("states that every request must use https://", () => {
    expect(buildDraftPrompt({ ...base, endpoints: [] })).toContain("https://");
  });

  test("states that http:// is refused even for approved hosts", () => {
    expect(buildDraftPrompt({ ...base, endpoints: [] })).toContain("gateway refuses http://");
  });

  // FINDING 3: $schema is in the reserved keywords list
  test("includes $schema in the reserved keywords list", () => {
    expect(buildDraftPrompt({ ...base, endpoints: [] })).toContain("$schema");
  });
});

describe("buildRedraftPrompt", () => {
  test("carries the rung and the reason so the model can correct itself", () => {
    const p = buildRedraftPrompt("previous prompt", "rung 3 (syntax)", "unexpected token");
    expect(p).toContain("previous prompt");
    expect(p).toContain("rung 3 (syntax)");
    expect(p).toContain("unexpected token");
  });
});
