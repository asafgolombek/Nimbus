import { describe, expect, test } from "bun:test";
import { validateInputSchema, zodSchemaFromInputSchema } from "./toolgen-schema.ts";
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

describe("zodSchemaFromInputSchema", () => {
  const schema = validateInputSchema({
    type: "object",
    properties: {
      owner: { type: "string" },
      page: { type: "number" },
      tags: { type: "array", items: { type: "string" } },
    },
    required: ["owner"],
  });

  test("a required property is required", () => {
    expect(zodSchemaFromInputSchema(schema).safeParse({ page: 1 }).success).toBe(false);
  });

  test("a property absent from `required` is optional", () => {
    expect(zodSchemaFromInputSchema(schema).safeParse({ owner: "nimbus" }).success).toBe(true);
  });

  test("declared types are enforced", () => {
    const r = zodSchemaFromInputSchema(schema).safeParse({ owner: "n", page: "not-a-number" });
    expect(r.success).toBe(false);
  });

  test("an array of scalars parses", () => {
    const r = zodSchemaFromInputSchema(schema).safeParse({ owner: "n", tags: ["a", "b"] });
    expect(r.success).toBe(true);
  });

  test("a schema with no `required` makes every property optional", () => {
    const none = validateInputSchema({ type: "object", properties: { a: { type: "string" } } });
    expect(zodSchemaFromInputSchema(none).safeParse({}).success).toBe(true);
  });
});

describe('validateInputSchema and the "__proto__" property name', () => {
  // `__proto__` is a valid JavaScript identifier, so `VALID_IDENTIFIER` admits it, and `JSON.parse`
  // hands it over as an ordinary own key — so a drafting model can reach this. On a plain `{}`
  // accumulator, `properties["__proto__"] = …` invokes `Object.prototype`'s SETTER instead of
  // creating a property: the property disappears from `Object.entries` while `"__proto__" in
  // properties` still answers true through the newly injected prototype. `required` would then
  // validate against a property the returned schema does not declare, and the owner would approve a
  // parameter list that is missing an argument the body intends to read.
  //
  // Built by parsing a JSON STRING, never an object literal. `{ __proto__: … }` in a literal is
  // special-cased by the language into a prototype assignment, so a literal-based fixture here
  // would contain no `__proto__` property at all and the test would pass vacuously against any
  // implementation. `JSON.parse` uses `CreateDataProperty` and produces a genuine own key — which
  // is also exactly how this value reaches `validateInputSchema` in production, from a model's
  // reply through `runLadder`'s `JSON.parse`.
  const RAW_JSON =
    '{"type":"object","properties":{"__proto__":{"type":"string"},"owner":{"type":"string"}},"required":["__proto__"]}';

  test("the property SURVIVES as an own key rather than reparenting the map", () => {
    const s = validateInputSchema(JSON.parse(RAW_JSON));
    expect(Object.hasOwn(s.properties, "__proto__")).toBe(true);
    expect(Object.keys(s.properties).sort()).toEqual(["__proto__", "owner"]);
    expect(s.required).toEqual(["__proto__"]);
    // The map is a normal object, not one whose prototype is a ToolInputProperty.
    expect(Object.getPrototypeOf(s.properties)).toBe(Object.prototype);
  });

  test("it reaches the model-facing zod schema like any other property", () => {
    const s = validateInputSchema(JSON.parse(RAW_JSON));
    // Same trap on the INPUT side: `{ __proto__: "x" }` as a literal would set a prototype rather
    // than supply an argument, so the parsed value is built from JSON here too.
    const parsed = zodSchemaFromInputSchema(s).safeParse(
      JSON.parse('{"__proto__":"x","owner":"n"}'),
    );
    expect(parsed.success).toBe(true);
  });

  test('`required` still REFUSES a name that is only on Object.prototype ("toString")', () => {
    // The `in`-vs-`Object.hasOwn` half. With `in`, `required: ["toString"]` validated happily
    // against every schema, because every plain object inherits it.
    expect(() =>
      validateInputSchema({
        type: "object",
        properties: { owner: { type: "string" } },
        required: ["toString"],
      }),
    ).toThrow(/undeclared property "toString"/);
  });
});
