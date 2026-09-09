import { describe, expect, test } from "bun:test";
import { validateInputSchema } from "./toolgen-schema.ts";
import { ToolgenError } from "./toolgen-types.ts";

const ok = {
  type: "object",
  properties: {
    owner: { type: "string", description: "repo owner" },
    page: { type: "number" },
    tags: { type: "array", items: { type: "string" } },
  },
  required: ["owner"],
};

describe("validateInputSchema", () => {
  test("accepts the restricted subset and returns a normalised copy", () => {
    const out = validateInputSchema(ok);
    expect(out.type).toBe("object");
    expect(out.properties["owner"]).toEqual({ type: "string", description: "repo owner" });
    expect(out.properties["tags"]).toEqual({ type: "array", items: { type: "string" } });
    expect(out.required).toEqual(["owner"]);
  });

  test("omits `required` entirely when absent rather than defaulting to []", () => {
    const out = validateInputSchema({ type: "object", properties: {} });
    expect(out.required).toBeUndefined();
  });

  test.each([
    ["not an object", "nope"],
    ["an array", []],
    ["a non-object type", { type: "string", properties: {} }],
    ["missing properties", { type: "object" }],
    ["a nested object property", { type: "object", properties: { a: { type: "object" } } }],
    ["an unknown property type", { type: "object", properties: { a: { type: "null" } } }],
    ["an array without items", { type: "object", properties: { a: { type: "array" } } }],
    [
      "an array of objects",
      { type: "object", properties: { a: { type: "array", items: { type: "object" } } } },
    ],
    [
      "a required naming an undeclared property",
      { type: "object", properties: {}, required: ["x"] },
    ],
    ["a non-string required entry", { type: "object", properties: {}, required: [1] }],
    // `args.repo-name` is VALID JS — it parses as subtraction — so rung 3 compiles it and the tool
    // fails only at runtime, after the owner approved it. Rejected here or nowhere.
    [
      "a hyphenated property name",
      { type: "object", properties: { "repo-name": { type: "string" } } },
    ],
    [
      "a property name starting with a digit",
      { type: "object", properties: { "1st": { type: "string" } } },
    ],
  ])("rejects %s", (_label, input) => {
    expect(() => validateInputSchema(input)).toThrow(ToolgenError);
  });

  test("deduplicates `required` so the canonical artifact has one form", () => {
    const out = validateInputSchema({
      type: "object",
      properties: { owner: { type: "string" } },
      required: ["owner", "owner"],
    });
    expect(out.required).toEqual(["owner"]);
  });

  test.each(["$ref", "$schema", "oneOf", "anyOf", "allOf", "additionalProperties"])(
    "rejects the reserved keyword %s",
    (kw) => {
      expect(() => validateInputSchema({ type: "object", properties: {}, [kw]: true })).toThrow(
        /not permitted/,
      );
    },
  );

  test("throws ERR_TOOLGEN_SCHEMA_INVALID, not a bare Error", () => {
    try {
      validateInputSchema("nope");
      throw new Error("expected a throw");
    } catch (e) {
      expect((e as ToolgenError).code).toBe("ERR_TOOLGEN_SCHEMA_INVALID");
    }
  });
});
