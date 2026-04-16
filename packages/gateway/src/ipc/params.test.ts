import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { parseParams } from "./params.ts";

describe("parseParams", () => {
  test("returns parsed object for valid input", () => {
    const schema = z.object({ name: z.string() });
    expect(parseParams({ name: "x" }, schema)).toEqual({ name: "x" });
  });

  test("throws on invalid input", () => {
    const schema = z.object({ name: z.string() });
    expect(() => parseParams({}, schema)).toThrow();
  });
});
