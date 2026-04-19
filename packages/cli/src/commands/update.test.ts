import { describe, expect, test } from "bun:test";
import { parseUpdateArgs } from "./update.ts";

describe("parseUpdateArgs", () => {
  test("default form — apply update with prompt", () => {
    expect(parseUpdateArgs([])).toEqual({ mode: "apply", yes: false });
  });

  test("--check flag", () => {
    expect(parseUpdateArgs(["--check"])).toEqual({ mode: "check", yes: false });
  });

  test("--yes suppresses prompt", () => {
    expect(parseUpdateArgs(["--yes"])).toEqual({ mode: "apply", yes: true });
  });

  test("--check with --yes", () => {
    expect(parseUpdateArgs(["--check", "--yes"])).toEqual({ mode: "check", yes: true });
  });

  test("-y short form", () => {
    expect(parseUpdateArgs(["-y"])).toEqual({ mode: "apply", yes: true });
  });

  test("rejects unknown flag", () => {
    expect(() => parseUpdateArgs(["--bogus"])).toThrow(/unknown/i);
  });
});
