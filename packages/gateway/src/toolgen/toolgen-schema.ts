import { z } from "zod";
import type { ToolInputProperty, ToolInputScalar, ToolInputSchema } from "./toolgen-types.ts";
import { ToolgenError } from "./toolgen-types.ts";

/**
 * Keywords rejected EXPLICITLY rather than by not being read.
 *
 * Validating by absence would silently accept a schema carrying `oneOf`, drop it, and present the
 * owner a prompt that does not describe what the model meant. The owner approving the parameters
 * (spec § 5.2) is only meaningful if what they read is the whole schema.
 */
const RESERVED_KEYWORDS = [
  "$ref",
  "$schema",
  "oneOf",
  "anyOf",
  "allOf",
  "additionalProperties",
] as const;

const SCALARS = new Set<string>(["string", "number", "boolean"]);

function fail(message: string): never {
  throw new ToolgenError("ERR_TOOLGEN_SCHEMA_INVALID", message);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/**
 * The tool's OWN argument names, which the model chooses freely — they need not mirror the API's
 * wire names, since the body maps arguments onto query parameters itself.
 *
 * Enforced because `args.repo-name` is VALID JavaScript: it parses as `args.repo - name`, so rung 3
 * compiles it happily and the tool fails only at runtime, after approval. Verified — the
 * AsyncFunction constructor accepts it. A hyphenated API parameter is still perfectly reachable;
 * the model just declares `repoName` and writes `"repo-name"` in the URL it builds.
 */
const VALID_IDENTIFIER = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

function validateProperty(name: string, raw: unknown): ToolInputProperty {
  if (!VALID_IDENTIFIER.test(name)) {
    fail(`property name "${name}" is not a valid JavaScript identifier`);
  }
  const p = asRecord(raw);
  if (p === null) fail(`property "${name}" must be an object`);
  const description = typeof p["description"] === "string" ? p["description"] : undefined;
  const type = p["type"];
  if (typeof type !== "string") fail(`property "${name}" has no type`);

  if (SCALARS.has(type)) {
    return {
      type: type as ToolInputScalar,
      ...(description === undefined ? {} : { description }),
    };
  }
  if (type === "array") {
    const items = asRecord(p["items"]);
    if (items === null) fail(`array property "${name}" must declare items`);
    const itemType = items["type"];
    if (typeof itemType !== "string" || !SCALARS.has(itemType)) {
      fail(`array property "${name}" items must be string, number or boolean`);
    }
    return {
      type: "array",
      items: { type: itemType as ToolInputScalar },
      ...(description === undefined ? {} : { description }),
    };
  }
  // Nested objects land here deliberately: a nested argument crossing the newline-delimited JSON
  // protocol into the sandboxed child is a drafting smell, and refusing it removes a class of
  // disagreement between what the model meant and what arrives (spec § 5.1).
  return fail(`property "${name}" has unsupported type "${type}" (nested objects are not allowed)`);
}

/** Rung 2 of the draft ladder. Returns a NORMALISED copy — never the caller's object. */
export function validateInputSchema(raw: unknown): ToolInputSchema {
  const s = asRecord(raw);
  if (s === null) fail("inputSchema must be a JSON object");
  if (s["type"] !== "object") fail('inputSchema.type must be "object"');

  for (const kw of RESERVED_KEYWORDS) {
    if (kw in s) fail(`keyword "${kw}" is not permitted in a generated tool schema`);
  }

  const props = asRecord(s["properties"]);
  if (props === null) fail("inputSchema.properties must be an object");

  const properties: Record<string, ToolInputProperty> = {};
  for (const [name, def] of Object.entries(props)) {
    properties[name] = validateProperty(name, def);
  }

  const rawRequired = s["required"];
  if (rawRequired === undefined) return { type: "object", properties };
  if (!Array.isArray(rawRequired) || !rawRequired.every((k) => typeof k === "string")) {
    fail("inputSchema.required must be an array of strings");
  }
  for (const key of rawRequired as string[]) {
    if (!(key in properties)) fail(`inputSchema.required names undeclared property "${key}"`);
  }
  // DEDUPLICATED, because this returns the CANONICAL form: the schema goes inside the artifact
  // that `artifactDigest` hashes and PR 3 signs, so two schemas that mean the same thing must not
  // produce two digests. `zodSchemaFromInputSchema` already dedupes via a Set, so this changes no
  // behaviour — only the canonical bytes.
  return { type: "object", properties, required: [...new Set(rawRequired as string[])] };
}

function zodForProperty(prop: ToolInputProperty): z.ZodTypeAny {
  switch (prop.type) {
    case "string":
      return z.string();
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    case "array":
      switch (prop.items.type) {
        case "string":
          return z.array(z.string());
        case "number":
          return z.array(z.number());
        case "boolean":
          return z.array(z.boolean());
        default: {
          const never: never = prop.items.type;
          throw new Error(`unhandled array item type: ${String(never)}`);
        }
      }
    default: {
      // Exhaustive by construction: widening ToolInputProperty without extending this switch is a
      // COMPILE error, not a property silently dropped from the model-facing schema.
      const never: never = prop;
      throw new Error(`unhandled property: ${JSON.stringify(never)}`);
    }
  }
}

/**
 * Build the model-facing zod schema from the schema the OWNER APPROVED.
 *
 * `required` drives optionality and its absence means "all optional". Getting that backwards is
 * invisible in a type test and surfaces only as a model omitting an argument the body then reads
 * as `undefined`.
 */
export function zodSchemaFromInputSchema(
  schema: ToolInputSchema,
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const required = new Set(schema.required ?? []);
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [name, prop] of Object.entries(schema.properties)) {
    let field = zodForProperty(prop);
    if (prop.description !== undefined) field = field.describe(prop.description);
    shape[name] = required.has(name) ? field : field.optional();
  }
  return z.object(shape);
}
