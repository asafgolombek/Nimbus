import { describe, expect, test } from "bun:test";
import { iterateSourceFiles } from "./lib.ts";

describe("iterateSourceFiles", () => {
  test("excludes paths under */testing/*", async () => {
    const visited: string[] = [];
    for await (const f of iterateSourceFiles()) {
      visited.push(f.relPath);
    }
    const testingPaths = visited.filter((p) => p.includes("/testing/"));
    expect(testingPaths).toEqual([]);
  });
});
