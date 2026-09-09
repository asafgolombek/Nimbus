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

  test("falls back to String(err) when the constructor throws a non-Error value", () => {
    // `new AsyncFunction("args", body)` calls ToString(body) internally, so a `body`-shaped value
    // whose own `toString()` throws a non-Error reaches the catch block's `err instanceof Error`
    // false arm. This is a real, reachable path (not a contrived mock of the constructor) — it is
    // exactly what happens if a caller's body value is not a plain string.
    const notReallyAString = {
      toString(): string {
        throw "not an Error instance";
      },
    };
    try {
      verifyBodySyntax(notReallyAString as unknown as string);
      throw new Error("expected a throw");
    } catch (e) {
      expect((e as ToolgenError).code).toBe("ERR_TOOLGEN_DRAFT_SYNTAX");
      expect((e as ToolgenError).message).toBe("tool body does not parse: not an Error instance");
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
    ["const prerequire = (x) => x; prerequire('fs');", "word boundary: require preceded by e"],
    ["const myeval = (x) => x; myeval('1+1');", "word boundary: eval preceded by y"],
    ["const myBun = {}; myBun.x;", "word boundary: Bun preceded by y"],
    ["obj.require('x');", "word boundary: require in property access"],
    ["x.eval('y');", "word boundary: eval in property access"],
    ["const myprocess = {}; return myprocess.env;", "word boundary: process preceded by y"],
    ["const reimport = (x) => x; reimport(y);", "word boundary: import preceded by e"],
    ["const myself = this; return myself.fetch(u);", "aliased this should not match globalThis"],
    ["const itself = obj; return itself.eval(code);", "aliased obj should not match globalThis"],
    [
      "const notglobalThis = {}; notglobalThis.fetch(u);",
      "substring should not match with lookbehind",
    ],
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
