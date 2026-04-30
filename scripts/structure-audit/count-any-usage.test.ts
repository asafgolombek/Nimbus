import { describe, expect, test } from "bun:test";
import { countAnyInSource, stripComments } from "./lib.ts";

describe("stripComments", () => {
  test("removes single-line comments", () => {
    expect(stripComments("const x = 1; // any here")).toBe("const x = 1; ");
  });
  test("removes multi-line comments", () => {
    expect(stripComments("/* any here */ const x = 1;")).toBe(" const x = 1;");
  });
  test("preserves any in code", () => {
    expect(stripComments("const x: any = 1;")).toBe("const x: any = 1;");
  });
  test("does not strip inside double-quoted string", () => {
    expect(stripComments('const u = "https://x.com/any";')).toBe('const u = "https://x.com/any";');
  });
  test("does not strip inside single-quoted string", () => {
    expect(stripComments("const u = 'https://x.com/any';")).toBe("const u = 'https://x.com/any';");
  });
  test("does not strip inside template literal", () => {
    expect(stripComments("const u = `https://x.com/any`;")).toBe("const u = `https://x.com/any`;");
  });
  test("honours escaped quote inside string", () => {
    expect(stripComments('const u = "a\\"//not a comment";')).toBe(
      'const u = "a\\"//not a comment";',
    );
  });
  test("strips line comment after a string", () => {
    expect(stripComments('const u = "x"; // any')).toBe('const u = "x"; ');
  });
});

describe("countAnyInSource", () => {
  test("counts type annotation", () => {
    expect(countAnyInSource("const x: any = 1;")).toBe(1);
  });
  test("counts as-cast", () => {
    expect(countAnyInSource("const x = y as any;")).toBe(1);
  });
  test("counts generic", () => {
    expect(countAnyInSource("Promise<any>")).toBe(1);
  });
  test("does not count comments", () => {
    expect(countAnyInSource("// this any is in a comment\nconst x = 1;")).toBe(0);
  });
  test("does not count words containing 'any'", () => {
    expect(countAnyInSource("const company = 1; const many = 2;")).toBe(0);
  });
  test("counts multiple occurrences", () => {
    expect(countAnyInSource("const a: any = 1; const b = c as any;")).toBe(2);
  });
});
