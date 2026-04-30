import { describe, expect, test } from "bun:test";
import { findRiskyAssertions } from "./list-risky-assertions.ts";

describe("findRiskyAssertions", () => {
  test("finds `as Foo` cast", () => {
    const hits = findRiskyAssertions("test.ts", "const x = y as Foo;");
    expect(hits).toEqual([{ file: "test.ts", line: 1, snippet: "const x = y as Foo;" }]);
  });

  test("ignores `as const`", () => {
    expect(findRiskyAssertions("t.ts", "const x = [1, 2] as const;")).toEqual([]);
  });

  test("ignores `as unknown`", () => {
    expect(findRiskyAssertions("t.ts", "const x = y as unknown;")).toEqual([]);
  });

  test("finds nested cast on a multi-statement line", () => {
    expect(findRiskyAssertions("t.ts", "const a = b as A; const c = d as C;")).toHaveLength(2);
  });

  test("includes line number", () => {
    const src = "// line1\n// line2\nconst x = y as Foo;";
    const hits = findRiskyAssertions("t.ts", src);
    expect(hits[0]?.line).toBe(3);
  });
});
