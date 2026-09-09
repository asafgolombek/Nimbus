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

  test("compiles the body without invoking it", () => {
    // Synchronous side effects in async function bodies RUN immediately when called,
    // so this test detects invocation. If verifyBodySyntax were to call the constructed
    // function, the probe would fire and fail the test.
    const calls: string[] = [];
    (globalThis as unknown as { __toolgenProbe?: () => void }).__toolgenProbe = () => {
      calls.push("invoked");
    };
    try {
      verifyBodySyntax("globalThis.__toolgenProbe(); return 1;");
      expect(calls).toEqual([]); // compiled, never called
    } finally {
      delete (globalThis as unknown as { __toolgenProbe?: () => void }).__toolgenProbe;
    }
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
    ["const prerequire = 1;", "word boundary: require has preceding letter"],
    ["const myeval = 1;", "word boundary: eval has preceding letter"],
    ["const myBun = {}; myBun.x;", "word boundary: Bun has preceding letter"],
    ["obj.require('x');", "word boundary: require in property access"],
    ["x.eval('y');", "word boundary: eval in property access"],
    ["const myprocess = 1;", "word boundary: process has preceding letter"],
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
    ["globalThis.fetch", 'globalThis.fetch("https://x");'],
    ["window.fetch", 'window.fetch("https://x");'],
    ["self.fetch", 'self.fetch("https://x");'],
    ["globalThis.require", 'globalThis.require("fs");'],
    ["window.require", 'window.require("fs");'],
    ["self.require", 'self.require("fs");'],
    ["globalThis.eval", 'globalThis.eval("1+1");'],
    ["window.eval", 'window.eval("1+1");'],
    ["self.eval", 'self.eval("1+1");'],
    ["globalThis.process", "globalThis.process.env.HOME;"],
    ["window.process", "window.process.env.HOME;"],
    ["self.process", "self.process.env.HOME;"],
    ["globalThis.Bun", "globalThis.Bun.file('/etc');"],
    ["window.Bun", "window.Bun.file('/etc');"],
    ["self.Bun", "self.Bun.file('/etc');"],
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
