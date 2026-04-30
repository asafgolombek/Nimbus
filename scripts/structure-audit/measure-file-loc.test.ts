import { describe, expect, test } from "bun:test";
import { rawLoc } from "./measure-file-loc.ts";

describe("rawLoc", () => {
  test("counts lines including blanks", () => {
    expect(rawLoc("a\n\nb\n")).toBe(3);
  });
  test("counts a single line without trailing newline", () => {
    expect(rawLoc("a")).toBe(1);
  });
  test("returns 0 for empty string", () => {
    expect(rawLoc("")).toBe(0);
  });
});
