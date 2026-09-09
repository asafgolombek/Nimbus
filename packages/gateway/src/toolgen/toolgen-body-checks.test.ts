import { describe, expect, test } from "bun:test";
import { scanBodyForForbiddenGlobals, verifyBodySyntax } from "./toolgen-body-checks.ts";
import { ToolgenError } from "./toolgen-types.ts";

describe("verifyBodySyntax", () => {
  // THE test for this rung. Every INVALID input still fails correctly under a synchronous
  // `new Function`, so only a VALID awaiting body distinguishes a strict rung from a broken one.
  test("accepts a body that awaits — the whole point of the AsyncFunction constructor", () => {
    expect(() =>
      verifyBodySyntax('const r = await nimbusFetch("https://x"); return JSON.parse(r.body);'),
    ).not.toThrow();
  });

  test("accepts a body with no await", () => {
    expect(() => verifyBodySyntax("return { ok: true };")).not.toThrow();
  });

  test("rejects a genuine syntax error", () => {
    expect(() => verifyBodySyntax("const = ;")).toThrow(ToolgenError);
  });

  test("does not execute the body", () => {
    // If this compiled body ever RAN, it would throw. Compilation must not invoke it.
    expect(() => verifyBodySyntax('throw new Error("executed");')).not.toThrow();
  });

  test("reports ERR_TOOLGEN_DRAFT_SYNTAX", () => {
    try {
      verifyBodySyntax("function (");
      throw new Error("expected a throw");
    } catch (e) {
      expect((e as ToolgenError).code).toBe("ERR_TOOLGEN_DRAFT_SYNTAX");
    }
  });
});

describe("scanBodyForForbiddenGlobals", () => {
  test.each([
    ['const r = await nimbusFetch("https://x");', "nimbusFetch is the REQUIRED helper"],
    ["const r = await prefetch(u);", "prefetch merely contains the substring"],
    ["const r = await client.fetch(u);", "a method call is not the global"],
    ["const important = 1; return important;", "`important` is not an import"],
    ["const processed = 1; return processed;", "`processed` is not `process.`"],
  ])("accepts %s — %s", (body) => {
    expect(() => scanBodyForForbiddenGlobals(body)).not.toThrow();
  });

  test.each([
    ["bare fetch", 'const r = await fetch("https://x");'],
    ["require", 'const x = require("fs");'],
    ["eval", 'eval("1+1");'],
    ["process", "return process.env.HOME;"],
    ["Bun", "return Bun.file('/etc/passwd');"],
    ["import statement", 'import x from "fs";'],
    ["dynamic import", 'const x = await import("fs");'],
  ])("rejects %s", (_label, body) => {
    expect(() => scanBodyForForbiddenGlobals(body)).toThrow(ToolgenError);
  });

  test("names the offending construct so a redraft can fix it", () => {
    try {
      scanBodyForForbiddenGlobals('await fetch("https://x");');
      throw new Error("expected a throw");
    } catch (e) {
      expect((e as ToolgenError).message).toContain("fetch");
      expect((e as ToolgenError).message).toContain("nimbusFetch");
    }
  });
});
