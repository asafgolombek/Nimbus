# Toolgen Drafting Step — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `ERR_TOOLGEN_DRAFT_NOT_IMPLEMENTED` stub so `nimbus tool create` produces a working, owner-approved, sandboxed tool with a real parameter schema and working credential bindings.

**Architecture:** A new `toolgen/toolgen-draft.ts` implements the `draftTool` dep the gate already calls at step 4 (before consent). It asks `LlmRouter` for the `reasoning` task, grounds the prompt on `api_endpoint` items already in the local index, and runs a four-rung validation ladder with exactly one redraft. The drafted `inputSchema` enters `GeneratedToolArtifact`, so the owner approves the parameters and `describe()` echoes them back from the sandboxed process.

**Tech Stack:** Bun 1.2+, TypeScript 7.x strict, `bun:sqlite`, zod, Biome. No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-09-09-s2-toolgen-drafting-design.md`](../specs/2026-09-09-s2-toolgen-drafting-design.md)
Review + response: [`…-design-review.md`](../specs/2026-09-09-s2-toolgen-drafting-design-review.md), [`…-design-review-response.md`](../specs/2026-09-09-s2-toolgen-drafting-design-review-response.md)

## Global Constraints

- **No `any`.** External data is `unknown` and narrowed by a guard, never a type assertion. `bun run audit:any` enforces this.
- **No new dependency.** The schema subset is validated by hand and converted to zod by hand.
- **Default off.** `[tool_generation] enabled` stays `false`; the new `drafting` key defaults to `"local"`.
- **No new invariant, no new static rule, no new egress coverage class, no schema migration.** If a task seems to need one, stop and re-read spec § 10.
- **The drafter never receives credential material.** `draftTool` takes `CreateGeneratedToolRequest` only; credentials enter `createGeneratedTool` as a separate parameter (spec § 9.1).
- **Rung 4's scan is not a security boundary.** Every comment describing it must say so — the sandbox is the boundary.
- **Test placement:** unit tests sit beside the source as `<name>.test.ts`; integration tests live under `packages/gateway/test/integration/toolgen/`.
- **Run before pushing:** `bun run preflight:fast`. Never commit on `main` — this plan executes on `dev/asaf/s2-toolgen-drafting`.
- **Commit after every task.** The PR title carries the conventional-commit type; local commit messages are discarded on squash-merge.

## File Structure

**Create:**

- `packages/gateway/src/toolgen/toolgen-schema.ts` — `ToolInputSchema`, `validateInputSchema`, `zodSchemaFromInputSchema`. Pure; no I/O, no deps beyond zod.
- `packages/gateway/src/toolgen/toolgen-body-checks.ts` — `verifyBodySyntax` (rung 3), `scanBodyForForbiddenGlobals` (rung 4). The **only** file permitted to construct a function from model output.
- `packages/gateway/src/toolgen/toolgen-grounding.ts` — `GroundedEndpoint`, `createEndpointFinder`.
- `packages/gateway/src/toolgen/toolgen-prompt.ts` — `buildDraftPrompt`, `buildRedraftPrompt`.
- `packages/gateway/src/toolgen/toolgen-draft.ts` — `draftGeneratedTool`, the ladder and the single retry.
- `packages/gateway/src/toolgen/toolgen-draft-llm.ts` — `createToolgenDraftLlm`, the narrowed router adapter enforcing `[tool_generation] drafting`.
- `packages/gateway/test/integration/toolgen/toolgen-draft-e2e.test.ts` — create → approve → call.

**Modify:**

- `packages/gateway/src/toolgen/toolgen-types.ts` — `inputSchema` on `GeneratedToolArtifact`; `ToolCredentialParam`.
- `packages/gateway/src/toolgen/toolgen-stub.ts` — `emitToolScript` interpolates the approved schema; `describe` returns it.
- `packages/gateway/src/toolgen/toolgen-client.ts` — `GeneratedToolHandle.describe()` returns `inputSchema`.
- `packages/gateway/src/toolgen/toolgen-agent-tools.ts` — real zod schema instead of `passthrough()`.
- `packages/gateway/src/toolgen/toolgen-gate.ts` — `draftTool` dep, credentials parameter, `bindCredentials` signature.
- `packages/gateway/src/toolgen/toolgen-credentials.ts` — `deleteToolCredential`.
- `packages/gateway/src/config/nimbus-toml.ts` — the `drafting` key.
- `packages/gateway/src/ipc/toolgen-rpc.ts` — parse `credentials`.
- `packages/gateway/src/platform/assemble.ts` — replace the stub closure; real `bindCredentials`/`revokeCredentials`.
- `packages/cli/src/commands/tool.ts` — send credentials; delete the stub message; local-model hint.
- `docs/cli-reference.md`, `docs/CHANGELOG.md`, `docs/roadmap.md`, `CLAUDE.md`, `GEMINI.md`.

---

## Task 1: The input-schema subset and its validator

**Files:**

- Create: `packages/gateway/src/toolgen/toolgen-schema.ts`
- Test: `packages/gateway/src/toolgen/toolgen-schema.test.ts`

**Interfaces:**

- Consumes: `ToolgenError` from `./toolgen-types.ts`.
- Produces: `ToolInputSchema`, `ToolInputProperty`, `validateInputSchema(raw: unknown): ToolInputSchema`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/gateway/src/toolgen/toolgen-schema.test.ts
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
    ["a required naming an undeclared property", { type: "object", properties: {}, required: ["x"] }],
    ["a non-string required entry", { type: "object", properties: {}, required: [1] }],
    // `args.repo-name` is VALID JS — it parses as subtraction — so rung 3 compiles it and the tool
    // fails only at runtime, after the owner approved it. Rejected here or nowhere.
    ["a hyphenated property name", { type: "object", properties: { "repo-name": { type: "string" } } }],
    ["a property name starting with a digit", { type: "object", properties: { "1st": { type: "string" } } }],
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bun test packages/gateway/src/toolgen/toolgen-schema.test.ts`
Expected: FAIL — `Cannot find module './toolgen-schema.ts'`.

- [ ] **Step 3: Implement the validator**

```ts
// packages/gateway/src/toolgen/toolgen-schema.ts
import { ToolgenError } from "./toolgen-types.ts";

export type ToolInputScalar = "string" | "number" | "boolean";

export type ToolInputProperty =
  | { readonly type: ToolInputScalar; readonly description?: string }
  | {
      readonly type: "array";
      readonly items: { readonly type: ToolInputScalar };
      readonly description?: string;
    };

export interface ToolInputSchema {
  readonly type: "object";
  readonly properties: Readonly<Record<string, ToolInputProperty>>;
  readonly required?: readonly string[];
}

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
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun test packages/gateway/src/toolgen/toolgen-schema.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/toolgen/toolgen-schema.ts packages/gateway/src/toolgen/toolgen-schema.test.ts
git commit -m "feat(toolgen): restricted input-schema subset and its validator"
```

---

## Task 2: Zod conversion

**Files:**

- Modify: `packages/gateway/src/toolgen/toolgen-schema.ts`
- Test: `packages/gateway/src/toolgen/toolgen-schema.test.ts`

**Interfaces:**

- Consumes: `ToolInputSchema`, `ToolInputProperty` (Task 1).
- Produces: `zodSchemaFromInputSchema(schema: ToolInputSchema): z.ZodObject<Record<string, z.ZodTypeAny>>`.

- [ ] **Step 1: Write the failing test**

Append to `toolgen-schema.test.ts`:

```ts
import { zodSchemaFromInputSchema } from "./toolgen-schema.ts";

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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bun test packages/gateway/src/toolgen/toolgen-schema.test.ts`
Expected: FAIL — `zodSchemaFromInputSchema is not a function`.

- [ ] **Step 3: Implement the conversion**

Append to `toolgen-schema.ts` (and add `import { z } from "zod";` at the top):

```ts
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
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun test packages/gateway/src/toolgen/toolgen-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/toolgen/toolgen-schema.ts packages/gateway/src/toolgen/toolgen-schema.test.ts
git commit -m "feat(toolgen): convert the approved input schema to zod"
```

---

## Task 3: Body checks — rungs 3 and 4

**Files:**

- Create: `packages/gateway/src/toolgen/toolgen-body-checks.ts`
- Test: `packages/gateway/src/toolgen/toolgen-body-checks.test.ts`

**Interfaces:**

- Consumes: `ToolgenError`.
- Produces: `verifyBodySyntax(body: string): void`, `scanBodyForForbiddenGlobals(body: string): void`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/gateway/src/toolgen/toolgen-body-checks.test.ts
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

  test("does not execute the body", () => {
    // If this compiled body ever RAN, it would throw. Compilation must not invoke it.
    expect(() => verifyBodySyntax('throw new Error("executed");')).not.toThrow();
  });

  test("reports ERR_TOOLGEN_DRAFT_SYNTAX", () => {
    try {
      verifyBodySyntax("function (");
      throw new Error("expected a throw");
    } catch (e) {
      expect((e as ToolgenError).code).toBe("ERR_TOOLGEN_DRAFT_SYNTAX");
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bun test packages/gateway/src/toolgen/toolgen-body-checks.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the checks**

```ts
// packages/gateway/src/toolgen/toolgen-body-checks.ts
import { ToolgenError } from "./toolgen-types.ts";

/**
 * The AsyncFunction constructor.
 *
 * `new Function` builds a SYNCHRONOUS function, so `await nimbusFetch(...)` — which every useful
 * generated body contains — throws `SyntaxError` before any real defect is reached. A rung that
 * fails 100% of correct inputs is not strict, it is broken. Verified on Bun; see spec § 4.2 rung 3.
 */
const AsyncFunction = Object.getPrototypeOf(async function () {
  /* probe */
}).constructor as new (...args: string[]) => unknown;

/**
 * Rung 3: does the model-authored body PARSE?
 *
 * This is the only place in the gateway that constructs a function from model output. It COMPILES
 * and never invokes: the constructed value is discarded unread and only the throw/no-throw is
 * used. Do not add a call, and do not return the function — a second call site here is what would
 * earn this a static rule (spec § 10).
 */
export function verifyBodySyntax(body: string): void {
  try {
    new AsyncFunction("args", body);
  } catch (err) {
    throw new ToolgenError(
      "ERR_TOOLGEN_DRAFT_SYNTAX",
      `tool body does not parse: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Rung 4: reject constructs the sandbox would refuse anyway.
 *
 * NOT A SECURITY BOUNDARY. The sandbox is: `permissions.network` is `[]` by construction, so a raw
 * `fetch()` fails at the OS on all three platforms, and the emitted skeleton makes no
 * `require`/`import` available regardless. This exists so the owner is never asked to approve a
 * body that provably cannot work. Describing it as a defense would be the shape recorded in
 * `airgap-was-inert-while-docs-promised-it`.
 *
 * Matched on word boundaries, never by substring: `prefetch(` and `client.fetch(` both CONTAIN
 * `fetch(` and are legitimate.
 */
const FORBIDDEN: ReadonlyArray<{ readonly re: RegExp; readonly what: string }> = [
  { re: /(?<![\w$.])fetch\s*\(/, what: "the global fetch()" },
  { re: /(?<![\w$.])require\s*\(/, what: "require()" },
  { re: /(?<![\w$.])eval\s*\(/, what: "eval()" },
  { re: /(?<![\w$.])process\s*\./, what: "process" },
  { re: /(?<![\w$.])Bun\s*\./, what: "Bun" },
  { re: /(?<![\w$.])import\s*[\s(]/, what: "an import" },
];

export function scanBodyForForbiddenGlobals(body: string): void {
  for (const { re, what } of FORBIDDEN) {
    if (re.test(body)) {
      throw new ToolgenError(
        "ERR_TOOLGEN_DRAFT_FORBIDDEN",
        `tool body uses ${what}, which is unavailable in the sandbox — use nimbusFetch(url, init) for network access and standard ECMAScript globals for everything else`,
      );
    }
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun test packages/gateway/src/toolgen/toolgen-body-checks.test.ts`
Expected: PASS.

- [ ] **Step 5: Red-prove rung 3**

Temporarily change `AsyncFunction` to `Function` in the source and re-run. Expected: the "accepts a body that awaits" test FAILS. Revert the change and confirm PASS again. This proves the test actually guards the defect rather than passing incidentally.

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/toolgen/toolgen-body-checks.ts packages/gateway/src/toolgen/toolgen-body-checks.test.ts
git commit -m "feat(toolgen): body syntax and forbidden-global checks for the draft ladder"
```

---

## Task 4: Grounding over the local index

**Files:**

- Create: `packages/gateway/src/toolgen/toolgen-grounding.ts`
- Test: `packages/gateway/src/toolgen/toolgen-grounding.test.ts`

**Interfaces:**

- Consumes: `LocalIndex` from `../index/local-index.ts` (only `searchRankedAsync`).
- Produces: `GroundedEndpoint`, `DraftGrounding`, `createEndpointFinder(index): (query, limit) => Promise<GroundedEndpoint[]>`, `groundingOf(endpoints): DraftGrounding`.

**Background the implementer needs:** `connectors/openapi-indexer-sync.ts` writes each endpoint as an item of `type: "api_endpoint"` with `title` set to `` `${method} ${path}` `` and metadata `{service_name, operation_id, tags, deprecated, spec_file, spec_version}`. `LocalIndex` puts all metadata on `item.rawMeta`, so **no join to the `api_endpoint` table is needed** — everything comes off the ranked item.

- [ ] **Step 1: Write the failing test**

```ts
// packages/gateway/src/toolgen/toolgen-grounding.test.ts
import { describe, expect, test } from "bun:test";
import type { RankedIndexItem } from "../index/ranked-item.ts";
import { createEndpointFinder, groundingOf } from "./toolgen-grounding.ts";

function rankedItem(title: string, meta: Record<string, unknown>): RankedIndexItem {
  return {
    id: title,
    service: "openapi",
    itemType: "api_endpoint",
    name: title,
    rawMeta: meta,
    score: 1,
    indexPrimaryKey: title,
    indexedType: "api_endpoint",
  } as unknown as RankedIndexItem;
}

describe("createEndpointFinder", () => {
  test("queries api_endpoint items with the description as the search term", async () => {
    const calls: unknown[] = [];
    const index = {
      searchRankedAsync: async (q: unknown) => {
        calls.push(q);
        return [rankedItem("GET /repos/{owner}/{repo}/issues", {
          service_name: "github-api",
          operation_id: "listIssues",
          tags: ["issues"],
        })];
      },
    };
    const find = createEndpointFinder(index as never);
    const out = await find("list issues in a repo", 8);

    expect(calls[0]).toEqual({ itemType: "api_endpoint", name: "list issues in a repo", limit: 8 });
    expect(out).toEqual([
      {
        serviceName: "github-api",
        method: "GET",
        path: "/repos/{owner}/{repo}/issues",
        operationId: "listIssues",
        summary: "issues",
      },
    ]);
  });

  test("skips an item whose title is not METHOD PATH rather than emitting a broken row", async () => {
    const index = { searchRankedAsync: async () => [rankedItem("malformed", {})] };
    expect(await createEndpointFinder(index as never)("q", 8)).toEqual([]);
  });

  test("an index error yields no grounding rather than failing the draft", async () => {
    const index = {
      searchRankedAsync: async () => {
        throw new Error("index unavailable");
      },
    };
    expect(await createEndpointFinder(index as never)("q", 8)).toEqual([]);
  });
});

describe("groundingOf", () => {
  test("reports description_only for an empty result", () => {
    expect(groundingOf([])).toEqual({ kind: "description_only" });
  });

  test("reports a count and DEDUPLICATED service names", () => {
    const ep = (serviceName: string) => ({
      serviceName,
      method: "GET",
      path: "/x",
      operationId: null,
      summary: "",
    });
    expect(groundingOf([ep("a"), ep("a"), ep("b")])).toEqual({
      kind: "endpoints",
      count: 3,
      services: ["a", "b"],
    });
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bun test packages/gateway/src/toolgen/toolgen-grounding.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement grounding**

```ts
// packages/gateway/src/toolgen/toolgen-grounding.ts
import type { LocalIndex } from "../index/local-index.ts";
import type { RankedIndexItem } from "../index/ranked-item.ts";

export interface GroundedEndpoint {
  readonly serviceName: string;
  readonly method: string;
  readonly path: string;
  readonly operationId: string | null;
  readonly summary: string;
}

export type DraftGrounding =
  | { readonly kind: "endpoints"; readonly count: number; readonly services: readonly string[] }
  | { readonly kind: "description_only" };

/** Titles are written by `openapi-indexer-sync.ts` as `${method} ${path}`. */
const TITLE = /^([A-Z]+) (\/\S*)$/;

const SUMMARY_MAX = 200;

function toEndpoint(item: RankedIndexItem): GroundedEndpoint | null {
  const m = TITLE.exec(item.name);
  if (m === null) return null;
  const meta = (item.rawMeta ?? {}) as Record<string, unknown>;
  const tags = Array.isArray(meta["tags"])
    ? meta["tags"].filter((t): t is string => typeof t === "string")
    : [];
  return {
    serviceName: typeof meta["service_name"] === "string" ? meta["service_name"] : item.service,
    method: m[1] as string,
    path: m[2] as string,
    operationId: typeof meta["operation_id"] === "string" ? meta["operation_id"] : null,
    summary: tags.join(" ").slice(0, SUMMARY_MAX),
  };
}

/**
 * Retrieval for the drafting prompt.
 *
 * Uses the index's HYBRID search (BM25/FTS5 + vector, fused by RRF) filtered to `api_endpoint`.
 * Deliberately NOT a `LIKE '%' || description || '%'` query: that asks whether a natural-language
 * sentence occurs verbatim inside a URL path, which is never true, so grounding would report
 * `description_only` on every request while the disclosure stayed truthful and every test passed.
 * See spec § 6.1.
 *
 * A retrieval failure yields NO grounding rather than failing the draft: grounding widens what the
 * model knows and is never load-bearing for correctness, and the § 6.2 disclosure tells the owner
 * which case they are in.
 */
export function createEndpointFinder(
  index: Pick<LocalIndex, "searchRankedAsync">,
): (query: string, limit: number) => Promise<GroundedEndpoint[]> {
  return async (query, limit) => {
    let items: RankedIndexItem[];
    try {
      items = await index.searchRankedAsync({ itemType: "api_endpoint", name: query, limit });
    } catch {
      return [];
    }
    const out: GroundedEndpoint[] = [];
    for (const item of items) {
      const ep = toEndpoint(item);
      if (ep !== null) out.push(ep);
    }
    return out;
  };
}

export function groundingOf(endpoints: readonly GroundedEndpoint[]): DraftGrounding {
  if (endpoints.length === 0) return { kind: "description_only" };
  return {
    kind: "endpoints",
    count: endpoints.length,
    services: [...new Set(endpoints.map((e) => e.serviceName))].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    ),
  };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun test packages/gateway/src/toolgen/toolgen-grounding.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/toolgen/toolgen-grounding.ts packages/gateway/src/toolgen/toolgen-grounding.test.ts
git commit -m "feat(toolgen): ground the draft prompt on indexed api_endpoint items"
```

---

## Task 5: The prompt

**Files:**

- Create: `packages/gateway/src/toolgen/toolgen-prompt.ts`
- Test: `packages/gateway/src/toolgen/toolgen-prompt.test.ts`

**Interfaces:**

- Consumes: `GroundedEndpoint` (Task 4).
- Produces: `buildDraftPrompt(input): string`, `buildRedraftPrompt(previous, rung, reason): string`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/gateway/src/toolgen/toolgen-prompt.test.ts
import { describe, expect, test } from "bun:test";
import type { GroundedEndpoint } from "./toolgen-grounding.ts";
import { buildDraftPrompt, buildRedraftPrompt } from "./toolgen-prompt.ts";

const ENDPOINTS: GroundedEndpoint[] = [
  {
    serviceName: "github-api",
    method: "GET",
    path: "/repos/{owner}/{repo}/issues",
    operationId: "listIssues",
    summary: "issues",
  },
];

describe("buildDraftPrompt", () => {
  const base = { description: "list open issues", hosts: ["api.github.com"], credentialHosts: [] };

  // Spec § 4.4: each of these is a fact about the emitted skeleton, not a matter of phrasing.
  test.each([
    ["the nimbusFetch signature", "nimbusFetch"],
    ["that body is already a string", "JSON.parse(res.body)"],
    ["that .json() does not exist", "res.json()"],
    ["the forbidden globals", "process"],
    ["the zero-import rule", "no imports"],
    ["URLSearchParams as the query-string route", "URLSearchParams"],
    ["the output envelope", "inputSchema"],
    ["the approved hosts", "api.github.com"],
  ])("states %s", (_label, needle) => {
    expect(buildDraftPrompt({ ...base, endpoints: [] })).toContain(needle);
  });

  test("includes grounded endpoints when present", () => {
    const p = buildDraftPrompt({ ...base, endpoints: ENDPOINTS });
    expect(p).toContain("GET /repos/{owner}/{repo}/issues");
    expect(p).toContain("listIssues");
  });

  test("says so explicitly when no endpoints were found", () => {
    expect(buildDraftPrompt({ ...base, endpoints: [] })).toContain("No indexed API specification");
  });

  test("names credential hosts WITHOUT any credential value", () => {
    const p = buildDraftPrompt({ ...base, credentialHosts: ["api.github.com"], endpoints: [] });
    expect(p).toContain("credential is attached automatically");
    expect(p).not.toContain("Authorization: Bearer");
  });
});

describe("buildRedraftPrompt", () => {
  test("carries the rung and the reason so the model can correct itself", () => {
    const p = buildRedraftPrompt("previous prompt", "rung 3 (syntax)", "unexpected token");
    expect(p).toContain("previous prompt");
    expect(p).toContain("rung 3 (syntax)");
    expect(p).toContain("unexpected token");
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bun test packages/gateway/src/toolgen/toolgen-prompt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the prompt**

```ts
// packages/gateway/src/toolgen/toolgen-prompt.ts
import type { GroundedEndpoint } from "./toolgen-grounding.ts";

export interface DraftPromptInput {
  readonly description: string;
  readonly hosts: readonly string[];
  /** Hosts that will carry a credential. NAMES ONLY — this module never sees a secret value. */
  readonly credentialHosts: readonly string[];
  readonly endpoints: readonly GroundedEndpoint[];
}

function groundingBlock(endpoints: readonly GroundedEndpoint[]): string {
  if (endpoints.length === 0) {
    return "No indexed API specification matched this description. Draft from the description and standard REST conventions, and prefer conservative assumptions.";
  }
  const lines = endpoints.map(
    (e) =>
      `- [${e.serviceName}] ${e.method} ${e.path}${e.operationId === null ? "" : ` (operationId: ${e.operationId})`}${e.summary === "" ? "" : `\n  ${e.summary}`}`,
  );
  return `These endpoints come from OpenAPI specifications indexed on this machine. Prefer them over guessed paths:\n${lines.join("\n")}`;
}

function credentialBlock(credentialHosts: readonly string[]): string {
  if (credentialHosts.length === 0) {
    return "No credential is configured. Do not invent an Authorization header.";
  }
  return `For these hosts a credential is attached automatically by the gateway, outside your code: ${credentialHosts.join(", ")}. Do NOT write an Authorization header yourself — you cannot see the secret and any header you write would be stripped.`;
}

/**
 * The drafting prompt.
 *
 * Its REQUIRED CONTENT is a contract (spec § 4.4) because each item is a fact about the emitted
 * skeleton rather than a matter of phrasing. The `nimbusFetch` return shape is the load-bearing
 * one: models are trained on the Web `fetch` API and will otherwise draft `await res.json()`,
 * which passes every ladder rung and fails only at runtime, after the owner has approved it.
 */
export function buildDraftPrompt(input: DraftPromptInput): string {
  return [
    "You author the body of a sandboxed Nimbus tool. Return code, not prose.",
    "",
    "ENVIRONMENT",
    "- Your code becomes the body of: async function __invoke(args) { <your body> }",
    "- The process has NO network. The only way out is the injected global:",
    "    nimbusFetch(url, init?) -> Promise<{ status, statusText, headers, body }>",
    "- IMPORTANT: `body` is ALREADY a decoded string. There is no res.json() and no res.text().",
    "  Parse JSON with JSON.parse(res.body).",
    "- There are no imports and no node_modules. Only standard ECMAScript globals exist",
    "  (JSON, URL, URLSearchParams, Math, Date, Array, String, Number). Build query strings",
    "  with URLSearchParams.",
    "- Do not use fetch, require, import, eval, process or Bun. They are unavailable and the",
    "  draft will be rejected.",
    `- Requests may only go to these hosts: ${input.hosts.join(", ")}`,
    `- ${credentialBlock(input.credentialHosts)}`,
    "- Throw an Error when the API responds with status >= 400. Return a JSON-serialisable value.",
    "",
    "OUTPUT",
    "Reply with ONE JSON object and nothing else, with exactly these two keys:",
    '  "inputSchema": {"type":"object","properties":{...},"required":[...]}',
    '  "body": "<the JavaScript body of __invoke, as a string>"',
    "Each property type must be string, number, boolean, or an array of those. Nested objects,",
    "$ref, oneOf, anyOf, allOf and additionalProperties are not allowed.",
    "",
    "REQUEST",
    input.description,
    "",
    "INDEXED API REFERENCE",
    groundingBlock(input.endpoints),
  ].join("\n");
}

export function buildRedraftPrompt(previous: string, rung: string, reason: string): string {
  return [
    previous,
    "",
    "YOUR PREVIOUS REPLY WAS REJECTED",
    `Failed check: ${rung}`,
    `Reason: ${reason}`,
    "Return only the corrected JSON object with the two keys. Do not explain the change.",
  ].join("\n");
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun test packages/gateway/src/toolgen/toolgen-prompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/toolgen/toolgen-prompt.ts packages/gateway/src/toolgen/toolgen-prompt.test.ts
git commit -m "feat(toolgen): drafting prompt with the nimbusFetch contract stated"
```

---

## Task 6: The ladder and the single redraft

**Files:**

- Create: `packages/gateway/src/toolgen/toolgen-draft.ts`
- Test: `packages/gateway/src/toolgen/toolgen-draft.test.ts`

**Interfaces:**

- Consumes: `validateInputSchema` (Task 1), `verifyBodySyntax` / `scanBodyForForbiddenGlobals` (Task 3), `createEndpointFinder` / `groundingOf` / `GroundedEndpoint` / `DraftGrounding` (Task 4), `buildDraftPrompt` / `buildRedraftPrompt` (Task 5).
- Produces: `DraftedTool`, `DraftGeneration`, `ToolgenDraftDeps`, `DraftSubject`, `extractJsonPayload(raw: string): string`, `draftGeneratedTool(req, deps, subject): Promise<DraftedTool>`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/gateway/src/toolgen/toolgen-draft.test.ts
import { describe, expect, test } from "bun:test";
import {
  draftGeneratedTool,
  extractJsonPayload,
  type ToolgenDraftDeps,
} from "./toolgen-draft.ts";
import { ToolgenError } from "./toolgen-types.ts";

const REQ = { sessionId: "s1", description: "list issues", hosts: ["api.github.com"] };
const SUBJECT = { hosts: ["api.github.com"], credentialHosts: [] };

const GOOD = JSON.stringify({
  inputSchema: { type: "object", properties: { owner: { type: "string" } }, required: ["owner"] },
  body: 'const r = await nimbusFetch("https://api.github.com/x"); return JSON.parse(r.body);',
});

function deps(
  replies: (string | null)[],
  extra: Partial<ToolgenDraftDeps> = {},
  isLocal = true,
): ToolgenDraftDeps {
  const queue = [...replies];
  return {
    generate: async () => {
      const next = queue.shift();
      return next === undefined || next === null ? null : { text: next, isLocal };
    },
    findEndpoints: async () => [],
    ...extra,
  };
}

describe("extractJsonPayload", () => {
  const obj = '{"a":1}';

  test.each([
    ["bare JSON", obj],
    ["a fenced block", "```json\n" + obj + "\n```"],
    ["an unlabelled fence", "```\n" + obj + "\n```"],
    // THE case an anchored regex fails: a benign preamble would otherwise burn the single redraft.
    ["a fence with a preamble", "Here is the tool you asked for:\n```json\n" + obj + "\n```"],
    ["a fence with a trailing note", "```json\n" + obj + "\n```\nLet me know if you need changes."],
    ["a bare object with prose around it", "Sure! " + obj + " Hope that helps."],
  ])("extracts the object from %s", (_label, raw) => {
    expect(JSON.parse(extractJsonPayload(raw))).toEqual({ a: 1 });
  });

  test("a closing brace inside a string value does not truncate the object", () => {
    const withBrace = JSON.stringify({ body: "if (x) { return 1; }" });
    expect(JSON.parse(extractJsonPayload("```json\n" + withBrace + "\n```"))).toEqual({
      body: "if (x) { return 1; }",
    });
  });

  test("returns the input unchanged when there is no object to find, so rung 1 still fails", () => {
    expect(extractJsonPayload("no json here")).toBe("no json here");
  });
});

describe("draftGeneratedTool", () => {
  test("returns a validated body and schema on the first attempt", async () => {
    const out = await draftGeneratedTool(REQ, deps([GOOD]), SUBJECT);
    expect(out.attempts).toBe(1);
    expect(out.inputSchema.required).toEqual(["owner"]);
    expect(out.body).toContain("nimbusFetch");
    expect(out.grounding).toEqual({ kind: "description_only" });
  });

  test("a fenced reply with a preamble succeeds on the FIRST attempt", async () => {
    const out = await draftGeneratedTool(
      REQ,
      deps(["Here you go:\n```json\n" + GOOD + "\n```"]),
      SUBJECT,
    );
    // The point is `attempts === 1`: a formatting artifact must not spend the redraft budget that
    // exists for real defects.
    expect(out.attempts).toBe(1);
  });

  test.each([
    ["prose instead of JSON", "Here is your tool!"],
    ["a nested-object schema", JSON.stringify({ inputSchema: { type: "object", properties: { a: { type: "object" } } }, body: "return 1;" })],
    ["a syntax error in the body", JSON.stringify({ inputSchema: { type: "object", properties: {} }, body: "const = ;" })],
    ["a forbidden global", JSON.stringify({ inputSchema: { type: "object", properties: {} }, body: 'await fetch("https://x");' })],
    ["a missing body key", JSON.stringify({ inputSchema: { type: "object", properties: {} } })],
  ])("redrafts once after %s, then succeeds", async (_label, bad) => {
    const out = await draftGeneratedTool(REQ, deps([bad, GOOD]), SUBJECT);
    expect(out.attempts).toBe(2);
  });

  test("refuses after two failures with ERR_TOOLGEN_DRAFT_INVALID", async () => {
    try {
      await draftGeneratedTool(REQ, deps(["nope", "still nope"]), SUBJECT);
      throw new Error("expected a throw");
    } catch (e) {
      expect((e as ToolgenError).code).toBe("ERR_TOOLGEN_DRAFT_INVALID");
    }
  });

  test("never makes a third attempt", async () => {
    let calls = 0;
    const d: ToolgenDraftDeps = {
      generate: async () => {
        calls += 1;
        return { text: "nope", isLocal: true };
      },
      findEndpoints: async () => [],
    };
    await expect(draftGeneratedTool(REQ, d, SUBJECT)).rejects.toThrow();
    expect(calls).toBe(2);
  });

  test("locality is DERIVED from the provider, not from the config mode", async () => {
    const remote = await draftGeneratedTool(REQ, deps([GOOD], {}, false), SUBJECT);
    expect(remote.locality).toBe("remote");
    const local = await draftGeneratedTool(REQ, deps([GOOD], {}, true), SUBJECT);
    expect(local.locality).toBe("local");
  });

  test("refuses with ERR_TOOLGEN_NO_DRAFT_MODEL when no provider answers", async () => {
    try {
      await draftGeneratedTool(REQ, deps([null]), SUBJECT);
      throw new Error("expected a throw");
    } catch (e) {
      expect((e as ToolgenError).code).toBe("ERR_TOOLGEN_NO_DRAFT_MODEL");
    }
  });

  test("reports endpoint grounding when the finder returns rows", async () => {
    const out = await draftGeneratedTool(
      REQ,
      deps([GOOD], {
        findEndpoints: async () => [
          { serviceName: "github-api", method: "GET", path: "/x", operationId: null, summary: "" },
        ],
      }),
      SUBJECT,
    );
    expect(out.grounding).toEqual({ kind: "endpoints", count: 1, services: ["github-api"] });
  });

  test("names credential HOSTS in the prompt and never a secret", async () => {
    // The types cannot carry a secret here at all (spec § 9.1) — `DraftSubject` holds names. This
    // asserts the rendered prompt too, since that is the artefact that would actually leave.
    let prompt = "";
    await draftGeneratedTool(
      REQ,
      deps([GOOD], { generate: async (p) => ({ text: ((prompt = p), GOOD), isLocal: true }) }),
      { hosts: ["api.github.com"], credentialHosts: ["api.github.com"] },
    );
    expect(prompt).toContain("api.github.com");
    expect(prompt).not.toContain("s3cret");
  });

  test("the prompt names the NORMALISED hosts the broker will match", async () => {
    // The gate normalises before drafting, so a prompt built from raw `req.hosts` would tell the
    // model about a host (`https://api.github.com/v1`) the broker's `url.hostname` never matches.
    let prompt = "";
    await draftGeneratedTool(
      { ...REQ, hosts: ["https://api.github.com/v1"] },
      deps([GOOD], { generate: async (p) => ({ text: ((prompt = p), GOOD), isLocal: true }) }),
      SUBJECT,
    );
    expect(prompt).toContain("api.github.com");
    expect(prompt).not.toContain("https://api.github.com/v1");
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bun test packages/gateway/src/toolgen/toolgen-draft.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the ladder**

```ts
// packages/gateway/src/toolgen/toolgen-draft.ts
import { scanBodyForForbiddenGlobals, verifyBodySyntax } from "./toolgen-body-checks.ts";
import type { CreateGeneratedToolRequest } from "./toolgen-gate.ts";
import { type DraftGrounding, groundingOf } from "./toolgen-grounding.ts";
import type { GroundedEndpoint } from "./toolgen-grounding.ts";
import { buildDraftPrompt, buildRedraftPrompt } from "./toolgen-prompt.ts";
import { type ToolInputSchema, validateInputSchema } from "./toolgen-schema.ts";
import { ToolgenError } from "./toolgen-types.ts";

const GROUNDING_LIMIT = 8;

export interface DraftedTool {
  readonly body: string;
  readonly inputSchema: ToolInputSchema;
  readonly grounding: DraftGrounding;
  readonly attempts: 1 | 2;
  /**
   * Whether the model that authored this body was local. DERIVED from `provider.isLocal` (I34),
   * never from a vendor id or a config value — `drafting = "allow-remote"` permits a remote draft
   * but does not mean one happened. Recorded on the audit row and used by the CLI to decide
   * whether "configure a larger local model" is useful advice.
   */
  readonly locality: "local" | "remote";
}

export interface DraftGeneration {
  readonly text: string;
  readonly isLocal: boolean;
}

export interface ToolgenDraftDeps {
  /** Narrowed router view. `null` means no eligible provider — never an empty string. */
  readonly generate: (prompt: string) => Promise<DraftGeneration | null>;
  readonly findEndpoints: (query: string, limit: number) => Promise<GroundedEndpoint[]>;
}

/**
 * Pull the JSON object out of whatever the model wrapped it in. NORMALISATION, not a ladder rung.
 *
 * Three widening attempts, in order. An ANCHORED fence regex is not enough: a reply reading
 * "Here is the tool:\n```json\n{…}\n```" matches nothing, falls through as raw text, fails
 * `JSON.parse`, and burns the single redraft on a formatting artifact — spending the retry budget
 * that exists for real defects.
 *
 * Widening is safe because `JSON.parse` downstream remains the actual gate: an over-eager slice
 * that grabs prose simply fails rung 1, exactly as no extraction would have. This can make a
 * malformed reply parse; it cannot make a non-object one pass.
 */
export function extractJsonPayload(raw: string): string {
  const trimmed = raw.trim();
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // Not bare JSON — fall through to the wrapped forms.
  }
  // Unanchored, so surrounding prose does not defeat it.
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n?```/.exec(trimmed);
  if (fenced?.[1] !== undefined) return fenced[1].trim();

  // Outermost braces. `lastIndexOf` and not the first closing brace, so a `}` inside the body
  // string does not truncate the object.
  const open = trimmed.indexOf("{");
  const close = trimmed.lastIndexOf("}");
  if (open >= 0 && close > open) return trimmed.slice(open, close + 1).trim();

  return trimmed;
}

interface LadderFailure {
  readonly rung: string;
  readonly reason: string;
}

/** What the ladder itself can determine. `grounding`, `attempts` and `locality` are the caller's. */
type LadderPass = Pick<DraftedTool, "body" | "inputSchema">;

function runLadder(raw: string): LadderPass | LadderFailure {
  // Rung 1 — the envelope parses.
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonPayload(raw));
  } catch (err) {
    return {
      rung: "rung 1 (output envelope)",
      reason: `reply is not JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { rung: "rung 1 (output envelope)", reason: "reply is not a JSON object" };
  }
  const obj = parsed as Record<string, unknown>;
  const body = obj["body"];
  if (typeof body !== "string" || body.trim() === "") {
    return { rung: "rung 1 (output envelope)", reason: '"body" must be a non-empty string' };
  }

  // Rung 2 — the schema is inside the restricted subset.
  let inputSchema: ToolInputSchema;
  try {
    inputSchema = validateInputSchema(obj["inputSchema"]);
  } catch (err) {
    return { rung: "rung 2 (input schema)", reason: (err as Error).message };
  }

  // Rung 3 — the body parses.
  try {
    verifyBodySyntax(body);
  } catch (err) {
    return { rung: "rung 3 (body syntax)", reason: (err as Error).message };
  }

  // Rung 4 — no construct the sandbox would refuse. NOT a security boundary; see the module.
  try {
    scanBodyForForbiddenGlobals(body);
  } catch (err) {
    return { rung: "rung 4 (forbidden globals)", reason: (err as Error).message };
  }

  return { body, inputSchema };
}

function isFailure(v: LadderPass | LadderFailure): v is LadderFailure {
  return "rung" in v;
}

/**
 * What the gate has already resolved by the time it drafts. Both lists are NORMALISED host names
 * and `credentialHosts` is a subset of `hosts`.
 */
export interface DraftSubject {
  readonly hosts: readonly string[];
  /** Hosts that will carry a credential. NAMES ONLY — never a secret (spec § 9.1). */
  readonly credentialHosts: readonly string[];
}

/**
 * Draft one tool: ground, prompt, validate, and redraft AT MOST once.
 *
 * One retry and not zero because the commonest failure is a model returning prose, which it
 * recovers from when told. One and not N because every attempt is a real model call that a remote
 * route ledgers and that spends the owner's budget (spec § 4.3).
 *
 * Takes `CreateGeneratedToolRequest` plus a host SUBJECT and nothing else: credential material must
 * never reach a drafting prompt, since a secret in a remote model's context has left the machine
 * (spec § 9.1). `credentialHosts` is a list of NAMES, resolved by the gate from the credentials it
 * holds — this function is never handed the credentials themselves and has no type that could
 * carry one.
 */
export async function draftGeneratedTool(
  req: CreateGeneratedToolRequest,
  deps: ToolgenDraftDeps,
  subject: DraftSubject,
): Promise<DraftedTool> {
  const endpoints = await deps.findEndpoints(req.description, GROUNDING_LIMIT);
  const grounding = groundingOf(endpoints);
  const prompt = buildDraftPrompt({
    description: req.description,
    // NORMALISED hosts, from the gate. Passing `req.hosts` here would show the model what the
    // owner TYPED (`https://api.github.com/v1`) while the broker matches `url.hostname`
    // (`api.github.com`) — the prompt would name a host the tool cannot actually reach.
    hosts: subject.hosts,
    credentialHosts: subject.credentialHosts,
    endpoints,
  });

  let current = prompt;
  let last: LadderFailure | null = null;
  for (const attempt of [1, 2] as const) {
    const generated = await deps.generate(current);
    if (generated === null) {
      throw new ToolgenError(
        "ERR_TOOLGEN_NO_DRAFT_MODEL",
        "no model is available to draft a tool body",
      );
    }
    const result = runLadder(generated.text);
    if (!isFailure(result)) {
      return {
        ...result,
        grounding,
        attempts: attempt,
        locality: generated.isLocal ? "local" : "remote",
      };
    }
    last = result;
    current = buildRedraftPrompt(prompt, result.rung, result.reason);
  }

  throw new ToolgenError(
    "ERR_TOOLGEN_DRAFT_INVALID",
    `the drafted tool failed validation twice — ${last?.rung ?? "unknown"}: ${last?.reason ?? ""}`,
  );
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun test packages/gateway/src/toolgen/toolgen-draft.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/toolgen/toolgen-draft.ts packages/gateway/src/toolgen/toolgen-draft.test.ts
git commit -m "feat(toolgen): draft ladder with exactly one bounded redraft"
```

---

## Task 7: The `drafting` config key and the locality-enforcing adapter

**Files:**

- Modify: `packages/gateway/src/config/nimbus-toml.ts:1074-1091` (type + defaults), `:1093-1125` (key parser)
- Create: `packages/gateway/src/toolgen/toolgen-draft-llm.ts`
- Test: `packages/gateway/src/toolgen/toolgen-draft-llm.test.ts`, and extend the existing `packages/gateway/src/config/nimbus-toml.test.ts`

**Interfaces:**

- Consumes: `LlmRouter` from `../llm/router.ts` (only `selectProvider`), `NimbusToolGenerationToml`.
- Produces: `ToolgenDraftingMode = "off" | "local" | "allow-remote"` on the config type; `createToolgenDraftLlm(router, mode): (prompt: string) => Promise<string | null>`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/gateway/src/toolgen/toolgen-draft-llm.test.ts
import { describe, expect, test } from "bun:test";
import { createToolgenDraftLlm } from "./toolgen-draft-llm.ts";

function router(provider: { isLocal: boolean } | undefined) {
  const calls: unknown[] = [];
  return {
    calls,
    selectProvider: async (task: string) => {
      calls.push(task);
      return provider === undefined
        ? undefined
        : { ...provider, generate: async () => ({ text: "drafted" }) };
    },
  };
}

describe("createToolgenDraftLlm", () => {
  test('mode "off" never asks the router at all', async () => {
    const r = router({ isLocal: true });
    expect(await createToolgenDraftLlm(r as never, "off")("p")).toBeNull();
    expect(r.calls).toEqual([]);
  });

  test('mode "local" uses a local provider and reports isLocal', async () => {
    expect(await createToolgenDraftLlm(router({ isLocal: true }) as never, "local")("p")).toEqual({
      text: "drafted",
      isLocal: true,
    });
  });

  test('mode "local" REFUSES a remote provider rather than using it', async () => {
    expect(await createToolgenDraftLlm(router({ isLocal: false }) as never, "local")("p")).toBeNull();
  });

  test('mode "allow-remote" uses a remote provider and reports isLocal false', async () => {
    expect(
      await createToolgenDraftLlm(router({ isLocal: false }) as never, "allow-remote")("p"),
    ).toEqual({ text: "drafted", isLocal: false });
  });

  test("no provider at all yields null", async () => {
    expect(await createToolgenDraftLlm(router(undefined) as never, "local")("p")).toBeNull();
  });

  test('asks for the "reasoning" task so the capability floor applies', async () => {
    const r = router({ isLocal: true });
    await createToolgenDraftLlm(r as never, "local")("p");
    expect(r.calls).toEqual(["reasoning"]);
  });
});
```

Add to `packages/gateway/src/config/nimbus-toml.test.ts`:

```ts
test("[tool_generation] drafting defaults to local and accepts the three modes", () => {
  expect(parseNimbusToolGenerationToml("").drafting).toBe("local");
  expect(parseNimbusToolGenerationToml('[tool_generation]\ndrafting = "off"\n').drafting).toBe("off");
  expect(
    parseNimbusToolGenerationToml('[tool_generation]\ndrafting = "allow-remote"\n').drafting,
  ).toBe("allow-remote");
});

test("[tool_generation] drafting keeps the default on an unrecognised value", () => {
  // Mirrors the positive-number keys: a bad value leaves the safer default rather than widening.
  expect(parseNimbusToolGenerationToml('[tool_generation]\ndrafting = "yolo"\n').drafting).toBe(
    "local",
  );
});
```

- [ ] **Step 2: Run both and confirm they fail**

Run: `bun test packages/gateway/src/toolgen/toolgen-draft-llm.test.ts packages/gateway/src/config/nimbus-toml.test.ts`
Expected: FAIL — module not found; `drafting` is `undefined`.

- [ ] **Step 3: Add the config key**

In `nimbus-toml.ts`, extend the type and defaults:

```ts
export type ToolgenDraftingMode = "off" | "local" | "allow-remote";

export type NimbusToolGenerationToml = {
  enabled: boolean;
  /**
   * Which model may author a tool body. Mirrors `[agents] synthesis` (I31) and `[fleet]
   * allow_remote` (I38): a frontier key configured for interactive use grants drafting nothing.
   * Defaults to "local" because a remote draft sends the owner's description AND indexed endpoint
   * paths drawn from their private index.
   */
  drafting: ToolgenDraftingMode;
  maxToolsPerSession: number;
  maxRequestsPerTool: number;
  requestTimeoutMs: number;
};

export const DEFAULT_NIMBUS_TOOL_GENERATION_TOML: NimbusToolGenerationToml = {
  enabled: false,
  drafting: "local",
  maxToolsPerSession: 3,
  maxRequestsPerTool: 50,
  requestTimeoutMs: 10_000,
};
```

In `applyNimbusToolGenerationKey`, add a case before `default`:

```ts
    case "drafting": {
      // An unrecognised value leaves the default in place, matching the positive-number keys
      // above: a typo must never widen what may draft.
      const v = valRaw.trim().toLowerCase().replace(/^["']|["']$/g, "");
      if (v === "off" || v === "local" || v === "allow-remote") {
        out.drafting = v;
      }
      break;
    }
```

- [ ] **Step 4: Implement the adapter**

```ts
// packages/gateway/src/toolgen/toolgen-draft-llm.ts
import type { ToolgenDraftingMode } from "../config/nimbus-toml.ts";
import type { LlmRouter } from "../llm/router.ts";

/**
 * The narrowed router view the drafter receives.
 *
 * Narrowed rather than handed the router because `setTaskPin` is router-WIDE — I38 rejected it for
 * exactly this reason, since a background caller must not re-route a concurrent `nimbus ask`.
 *
 * Locality is enforced HERE and derived from `provider.isLocal` (I34), never from a vendor id. A
 * remote provider under `drafting = "local"` is REFUSED, not silently used: the same fail-closed
 * posture as `enforce_air_gap`.
 *
 * Asks for the `"reasoning"` task, which is what makes `minReasoningParams` apply and what puts
 * the call under the existing `model` egress class via `wrapLedgeredProvider` — no new coverage
 * class, and no cooperation required from this file.
 */
export function createToolgenDraftLlm(
  router: Pick<LlmRouter, "selectProvider">,
  mode: ToolgenDraftingMode,
): (prompt: string) => Promise<DraftGeneration | null> {
  return async (prompt) => {
    if (mode === "off") return null;
    const provider = await router.selectProvider("reasoning", {
      preferLocal: mode === "local",
    });
    if (provider === undefined) return null;
    if (mode === "local" && !provider.isLocal) return null;
    const result = await provider.generate({
      task: "reasoning",
      prompt,
      temperature: 0,
      egressMethod: "toolgen.draft",
    });
    // `isLocal` travels WITH the text so the caller records what actually answered, not what the
    // config permitted: `allow-remote` with a local provider registered still drafts locally.
    return { text: result.text, isLocal: provider.isLocal };
  };
}
```

- [ ] **Step 5: Run both test files and confirm they pass**

Run: `bun test packages/gateway/src/toolgen/toolgen-draft-llm.test.ts packages/gateway/src/config/nimbus-toml.test.ts`
Expected: PASS. If `selectProvider`'s options or `generate`'s fields differ, read `packages/gateway/src/llm/router.ts` and `llm/types.ts` and match them exactly — do **not** cast.

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/config/nimbus-toml.ts packages/gateway/src/config/nimbus-toml.test.ts packages/gateway/src/toolgen/toolgen-draft-llm.ts packages/gateway/src/toolgen/toolgen-draft-llm.test.ts
git commit -m "feat(toolgen): [tool_generation] drafting locality mode and its router adapter"
```

---

## Task 8: The schema enters the artifact, the script and `describe()`

**Files:**

- Modify: `packages/gateway/src/toolgen/toolgen-types.ts` (`GeneratedToolArtifact`), `toolgen-stub.ts` (`emitToolScript`), `toolgen-client.ts` (`GeneratedToolHandle.describe`), `toolgen-agent-tools.ts`
- Test: extend `toolgen-stub.test.ts`, `toolgen-client.test.ts`, and the existing agent-tools test

**Interfaces:**

- Consumes: `ToolInputSchema` (Task 1), `zodSchemaFromInputSchema` (Task 2).
- Produces: `GeneratedToolArtifact.inputSchema`; `describe(): Promise<{name, description, inputSchema}>`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/gateway/src/toolgen/toolgen-stub.test.ts`:

```ts
test("emitToolScript embeds the APPROVED schema so describe() echoes the approval", () => {
  const src = emitToolScript({
    toolId: "t1",
    toolName: "generated_t1",
    description: "d",
    body: "return 1;",
    inputSchema: { type: "object", properties: { owner: { type: "string" } }, required: ["owner"] },
  });
  // Embedded as a literal the same way toolName is, NOT computed at runtime: a describe() that
  // disagrees with the registry's artifact then means the on-disk script was altered.
  expect(src).toContain('"owner"');
  expect(src).toContain('"required":["owner"]');
});
```

Add to `packages/gateway/src/toolgen/toolgen-agent-tools.test.ts` (create the file if absent, following the existing toolgen test style):

```ts
test("a generated tool advertises its approved parameters, not a passthrough schema", () => {
  const schema = { type: "object", properties: { owner: { type: "string" } }, required: ["owner"] };
  const registry = {
    forSession: () => [
      { artifact: { toolId: "t1", description: "d", inputSchema: schema } },
    ],
  };
  const tools = buildGeneratedTools("s1", registry as never, async () => ({}), (_s, _t, def) => def);
  const tool = (tools as Record<string, { inputSchema: { safeParse(v: unknown): { success: boolean } } }>)["t1"];
  expect(tool.inputSchema.safeParse({}).success).toBe(false);
  expect(tool.inputSchema.safeParse({ owner: "nimbus" }).success).toBe(true);
});
```

- [ ] **Step 2: Run and confirm they fail**

Run: `bun test packages/gateway/src/toolgen/`
Expected: FAIL — `emitToolScript` rejects the extra property / the passthrough schema accepts `{}`.

- [ ] **Step 3: Widen the artifact type**

In `toolgen-types.ts`, add to `GeneratedToolArtifact` (import `ToolInputSchema` from `./toolgen-schema.ts`):

```ts
  /**
   * The parameters the owner approved.
   *
   * INSIDE the canonical artifact, not beside it: "this tool takes a repo name and a page number"
   * is part of what is being consented to, it is covered by `artifactDigest`, and PR 3 signs it —
   * so a later change to the parameters invalidates the approval, exactly as `credentialHosts`
   * already does.
   */
  readonly inputSchema: ToolInputSchema;
```

- [ ] **Step 4: Interpolate the schema into the emitted script**

In `toolgen-stub.ts`, add `inputSchema: ToolInputSchema` to `emitToolScript`'s input, and change the `describe` reply line to:

```ts
    if (msg.method === "describe") {
      __send({ id: msg.id, result: { name: ${JSON.stringify(input.toolName)}, description: ${JSON.stringify(input.description)}, inputSchema: ${JSON.stringify(input.inputSchema)} } });
    } else if (msg.method === "call") {
```

- [ ] **Step 5: Widen the handle**

In `toolgen-client.ts`, change `GeneratedToolHandle.describe`'s return type to
`Promise<{ name: string; description: string; inputSchema: unknown }>` and add to the returned object:

```ts
        // `unknown`, deliberately: this crosses a process boundary and is untrusted until a caller
        // validates it. The REGISTRY's artifact remains the source of truth; this value exists so a
        // caller can COMPARE the two and detect an altered on-disk script.
        inputSchema: o["inputSchema"],
```

- [ ] **Step 6: Build a real zod schema for the model**

In `toolgen-agent-tools.ts`, replace the `inputSchema` line:

```ts
        inputSchema: zodSchemaFromInputSchema(envelope.artifact.inputSchema),
```

adding `import { zodSchemaFromInputSchema } from "./toolgen-schema.ts";` and destructuring `inputSchema` alongside `toolId, description`.

- [ ] **Step 7: Run the toolgen suite and typecheck**

Run: `bun test packages/gateway/src/toolgen/ && bun run typecheck`
Expected: PASS. Existing call sites that build a `GeneratedToolArtifact` in tests will now fail typecheck until they supply `inputSchema` — fix each with a minimal `{ type: "object", properties: {} }`.

- [ ] **Step 8: Commit**

```bash
git add packages/gateway/src/toolgen/
git commit -m "feat(toolgen): carry the approved input schema into the artifact, script and describe()"
```

---

## Task 9: Gate — the `draftTool` dep and credentials as a separate parameter

**Files:**

- Modify: `packages/gateway/src/toolgen/toolgen-gate.ts`, `packages/gateway/src/toolgen/toolgen-credentials.ts`, `packages/gateway/src/toolgen/toolgen-types.ts`
- Test: extend `packages/gateway/src/toolgen/toolgen-gate.test.ts`, `toolgen-credentials.test.ts`

**Interfaces:**

- Consumes: `DraftedTool` (Task 6).
- Produces: `ToolCredentialParam`; `ToolgenGateDeps.draftTool`; `createGeneratedTool(req, deps, credentials?)`; `deleteToolCredential(vault, toolId, host)`.

- [ ] **Step 1: Write the failing tests**

Add to `toolgen-gate.test.ts` (follow the existing file's fake-deps helper):

```ts
test("the drafted schema reaches the approval prompt and the artifact", async () => {
  const prompts: ToolgenApprovalInput[] = [];
  const deps = fakeDeps({
    draftTool: async () => ({
      body: "return 1;",
      inputSchema: { type: "object", properties: { owner: { type: "string" } } },
      grounding: { kind: "description_only" },
      attempts: 1,
    }),
    requestApproval: async (input) => {
      prompts.push(input);
      return true;
    },
  });
  const out = await createGeneratedTool(REQ, deps);
  expect(out.status).toBe("registered");
  expect(prompts[0]?.inputSchema).toEqual({ type: "object", properties: { owner: { type: "string" } } });
});

test("credentials are bound before consent and NOT passed to the drafter", async () => {
  let draftArg: unknown;
  const bound: unknown[] = [];
  const deps = fakeDeps({
    draftTool: async (req) => {
      draftArg = req;
      return OK_DRAFT;
    },
    bindCredentials: async (_toolId, creds) => {
      bound.push(creds);
      return creds.map((c) => c.host);
    },
  });
  await createGeneratedTool(REQ, deps, [
    { host: "api.github.com", binding: { type: "bearer", token: "s3cret" } },
  ]);
  expect(JSON.stringify(draftArg)).not.toContain("s3cret");
  expect(bound).toHaveLength(1);
});

test("a denial revokes the bound credentials", async () => {
  const revoked: string[] = [];
  const deps = fakeDeps({
    draftTool: async () => OK_DRAFT,
    requestApproval: async () => false,
    bindCredentials: async (_id, creds) => creds.map((c) => c.host),
    revokeCredentials: async (id) => {
      revoked.push(id);
    },
  });
  const out = await createGeneratedTool(REQ, deps, [
    { host: "api.github.com", binding: { type: "bearer", token: "s3cret" } },
  ]);
  expect(out.status).toBe("denied");
  expect(revoked).toHaveLength(1);
});

test("the audit row records the draft attempts, grounding and locality", async () => {
  // Read the appended `tool.generate` row and assert the three payload fields exist.
});
```

Add to `toolgen-credentials.test.ts`:

```ts
test("deleteToolCredential removes the per-host key and tolerates an absent one", async () => {
  const store = new Map<string, string>();
  const vault = {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => void store.set(k, v),
    delete: async (k: string) => void store.delete(k),
  };
  await writeToolCredential(vault as never, "t1", "api.github.com", { type: "bearer", token: "x" });
  await deleteToolCredential(vault as never, "t1", "api.github.com");
  expect(await readToolCredential(vault as never, "t1", "api.github.com")).toBeNull();
  await deleteToolCredential(vault as never, "t1", "api.github.com"); // idempotent
});
```

- [ ] **Step 2: Run and confirm they fail**

Run: `bun test packages/gateway/src/toolgen/toolgen-gate.test.ts packages/gateway/src/toolgen/toolgen-credentials.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add `ToolCredentialParam` and `deleteToolCredential`**

In `toolgen-types.ts`:

```ts
/** One host's credential, as it crosses `toolgen.create`. NEVER reaches a drafting prompt. */
export interface ToolCredentialParam {
  readonly host: string;
  readonly binding: ToolCredentialBinding;
}
```

In `toolgen-credentials.ts`:

```ts
export async function deleteToolCredential(
  vault: VaultWriter,
  toolId: string,
  host: string,
): Promise<void> {
  await vault.delete(toolCredentialKey(toolId, host));
}
```

- [ ] **Step 4: Rework the gate**

In `toolgen-gate.ts`:

1. Replace the `draftBody` dep with `draftTool`, which takes the resolved host subject as its
   second argument:

```ts
  /**
   * `subject` carries the NORMALISED approved hosts and the subset that will hold a credential —
   * names only. It is a second parameter rather than a field of `req` because `req` is the object
   * the drafting prompt is built from, and a `credentials` field there would place raw tokens in a
   * model's context (spec § 9.1).
   */
  readonly draftTool: (
    req: CreateGeneratedToolRequest,
    subject: DraftSubject,
  ) => Promise<DraftedTool>;
```

1. Change `bindCredentials`:

```ts
  readonly bindCredentials: (
    toolId: string,
    credentials: readonly ToolCredentialParam[],
  ) => Promise<string[]>;
```

1. Add the third parameter to `createGeneratedTool` and thread it:

```ts
export async function createGeneratedTool(
  req: CreateGeneratedToolRequest,
  deps: ToolgenGateDeps,
  // A SEPARATE parameter, never a field of `req`: the gate hands `req` straight to `draftTool`,
  // so a `credentials` field there would place raw tokens on the drafting prompt's input, and a
  // secret in a remote model's context has left the machine (spec § 9.1).
  credentials: readonly ToolCredentialParam[] = [],
): Promise<ToolgenOutcome> {
```

1. **Move the host normalisation ABOVE the draft.** In PR 1 it sits after `assertConfinement`,
   which was fine when nothing before it needed hosts. Two things now do — the prompt must name the
   hosts the broker will actually match, and the credential filter must run before drafting — and
   moving it up is independently better: `normalizeHost` throws `ERR_TOOLGEN_HOST_NOT_ALLOWED`, and
   refusing a malformed host *before* spending a model call beats refusing after. Everything stays
   pre-consent, so the gate's ordering rule is untouched.

   Lift this block (currently just after `assertConfinement`) to sit immediately after the session
   budget check, keeping its comments verbatim:

```ts
    const hosts = [...new Set(req.hosts.map(normalizeHost))].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    if (hosts.length === 0) {
      throw new ToolgenError("ERR_TOOLGEN_HOST_NOT_ALLOWED", "at least one --host is required");
    }
    // Only hosts the owner also granted via --host. The CLI already enforces this, but the gate is
    // the boundary: the prompt and the artifact must never name a host the tool cannot reach.
    const forApprovedHosts = credentials.filter((c) => hosts.includes(normalizeHost(c.host)));
```

1. Then draft, handing over the resolved subject and keeping the draft for the artifact:

```ts
    const draft = await deps.draftTool(req, {
      hosts,
      // NAMES the credentials will be bound under, derived from `forApprovedHosts` rather than
      // from the Vault — nothing has been written there yet at this point, since `bindCredentials`
      // runs after drafting.
      credentialHosts: forApprovedHosts.map((c) => normalizeHost(c.host)),
    });
    const body = draft.body;
```

1. Bind after the draft, unchanged in position. `bindCredentials`' return stays authoritative for
   the artifact — it reports what a write actually succeeded for, which the pre-draft list cannot:

```ts
    const credentialHosts = await deps.bindCredentials(toolId, forApprovedHosts);
```

1. Add `inputSchema: draft.inputSchema` to the `artifact` literal and `inputSchema: artifact.inputSchema` to the `requestApproval` input.

2. Add the three disclosure fields to both the `registered` and `denied_by_owner` audit payloads:

```ts
      draftAttempts: draft.attempts,
      draftGrounding: draft.grounding,
      draftLocality: draft.locality,
```

All three come off the `DraftedTool` Task 6 already returns — no amendment to earlier tasks.

1. Change `revokeCredentials` to take the host list explicitly:

```ts
  /**
   * Undo `bindCredentials` for a toolId that will never register.
   *
   * Takes `hosts` rather than looking them up: this runs on paths where the tool was NEVER
   * registered — an owner denial, or a failure between approval and `registry.register` — so
   * `registry.get(toolId)` returns `undefined` on exactly the calls that matter and a lookup would
   * silently delete nothing, leaving the secret in the Vault forever. MUST be idempotent.
   */
  readonly revokeCredentials: (toolId: string, hosts: readonly string[]) => Promise<void>;
```

`hosts` is in scope at both call sites. `safeRevokeCredentials` and its two callers pass it through.

1. Add `inputSchema: ToolInputSchema` and `grounding: DraftGrounding` to `ToolgenApprovalInput` in
   `toolgen-consent-broker.ts`, and broadcast both — the CLI renders them in Task 10.

- [ ] **Step 5: Run the toolgen suite and typecheck**

Run: `bun test packages/gateway/src/toolgen/ && bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/toolgen/
git commit -m "feat(toolgen): gate consumes draftTool and binds credentials off the drafting path"
```

---

## Task 10: RPC and CLI

**Files:**

- Modify: `packages/gateway/src/ipc/toolgen-rpc.ts:85-91`, `packages/cli/src/commands/tool.ts`
- Test: extend `packages/gateway/src/ipc/toolgen-rpc.test.ts`, `packages/cli/src/commands/tool.test.ts`

**Interfaces:**

- Consumes: `ToolCredentialParam` (Task 9).
- Produces: `toolgen.create` accepting `credentials`; the approval prompt rendering parameters.

- [ ] **Step 1: Write the failing tests**

Add to `toolgen-rpc.test.ts`:

```ts
test("toolgen.create parses credentials and forwards them as the third argument", async () => {
  const seen: unknown[] = [];
  const ctx = fakeCtx({ create: (req, _deps, creds) => void seen.push([req, creds]) });
  await dispatchToolgenRpc("toolgen.create", {
    sessionId: "s1",
    description: "d",
    hosts: ["api.github.com"],
    credentials: [{ host: "api.github.com", token: "s3cret" }],
  }, ctx);
  expect(seen[0]).toEqual([
    { sessionId: "s1", description: "d", hosts: ["api.github.com"] },
    [{ host: "api.github.com", binding: { type: "bearer", token: "s3cret" } }],
  ]);
});

test("toolgen.create drops a malformed credential entry rather than throwing", async () => {
  // Every field crossing this boundary is unknown until validated — no casts on params.
});
```

Add to `tool.test.ts`:

```ts
test("the approval prompt shows the parameters the owner is approving", () => {
  const out = formatToolApprovalPrompt({
    toolName: "generated_t1",
    description: "d",
    body: "return 1;",
    approvedHosts: ["api.github.com"],
    credentialHosts: [],
    inputSchema: { type: "object", properties: { owner: { type: "string" } }, required: ["owner"] },
    grounding: { kind: "endpoints", count: 3, services: ["github-api"] },
  });
  expect(out).toContain("owner");
  expect(out).toContain("required");
  expect(out).toContain("3 indexed endpoint");
});

test("the prompt discloses when the draft was NOT grounded", () => {
  const out = formatToolApprovalPrompt({
    /* …same, with */ grounding: { kind: "description_only" },
  } as never);
  expect(out).toContain("no indexed API specification");
});

test("ERR_TOOLGEN_DRAFT_INVALID from a local model names both ways out", () => {
  const sink = fakeSink();
  renderToolOutcome({ status: "refused", code: "ERR_TOOLGEN_DRAFT_INVALID", locality: "local" }, sink);
  expect(sink.errText).toContain("allow-remote");
  expect(sink.errText).toContain("min_reasoning_params");
});

test("ERR_TOOLGEN_DRAFT_NOT_IMPLEMENTED is gone from the CLI", () => {
  expect(readFileSync("packages/cli/src/commands/tool.ts", "utf8")).not.toContain(
    "DRAFT_NOT_IMPLEMENTED",
  );
});
```

- [ ] **Step 2: Run and confirm they fail**

Run: `bun test packages/gateway/src/ipc/toolgen-rpc.test.ts packages/cli/src/commands/tool.test.ts`
Expected: FAIL.

- [ ] **Step 3: Parse credentials in the RPC**

In `toolgen-rpc.ts`, add a validator and widen the handler:

```ts
/**
 * `<host>=<token>` from `nimbus tool create` means a BEARER binding (spec § 9.2). `header` and
 * `basic` bindings are reachable from no user-facing path in this slice — a stated bound, not an
 * oversight: the broker applies them correctly and nothing yet writes one.
 *
 * A malformed entry is DROPPED rather than throwing: a partially-typed credential must not abort a
 * create the owner is about to be asked to approve, and the approval prompt shows the hosts that
 * actually got one, so a dropped entry is visible there.
 */
function parseCredentials(raw: unknown): ToolCredentialParam[] {
  if (!Array.isArray(raw)) return [];
  const out: ToolCredentialParam[] = [];
  for (const entry of raw) {
    const rec = asRecord(entry);
    if (rec === null) continue;
    const host = rec["host"];
    const token = rec["token"];
    if (typeof host !== "string" || host === "") continue;
    if (typeof token !== "string" || token === "") continue;
    out.push({ host, binding: { type: "bearer", token } });
  }
  return out;
}
```

and:

```ts
  "toolgen.create": async (params, ctx) => {
    const rec = asRecord(params) ?? {};
    const sessionId = requireString(params, "sessionId");
    const description = requireString(params, "description");
    const hosts = stringArray(rec["hosts"]);
    return createGeneratedTool(
      { sessionId, description, hosts },
      ctx.gateDeps,
      parseCredentials(rec["credentials"]),
    );
  },
```

- [ ] **Step 4: Update the CLI**

1. Send the credentials in `runCreateCmd`, replacing the long "deliberately NOT sent here" comment with:

```ts
        // Sent now that the gateway consumes them: `toolgen.create` binds per-host at create time,
        // because the toolId does not exist until create runs and adding one to a LIVE tool would
        // change the artifact the owner approved.
        credentials: parsed.credentials.map((c) => ({ host: c.host, token: c.token })),
```

1. Extend `ToolApprovalPrompt` with `inputSchema` and `grounding`, and render them in
   `formatToolApprovalPrompt` between the description and the body:

```ts
    `  parameters:       ${formatParams(p.inputSchema)}`,
    `  grounding:        ${formatGrounding(p.grounding)}`,
```

with:

```ts
// `string[]` rather than a bare `array`: the element type is part of what the owner is approving,
// and this prompt is the security boundary — it should say the most it can in the space it has.
const formatPropType = (p: ToolInputProperty): string =>
  p.type === "array" ? `${p.items.type}[]` : p.type;

const formatParams = (s: ToolInputSchema): string => {
  const required = new Set(s.required ?? []);
  const names = Object.entries(s.properties).map(
    ([n, def]) => `${n}: ${formatPropType(def)}${required.has(n) ? "" : "?"}`,
  );
  return names.length === 0 ? "none" : names.join(", ");
};

/**
 * Whether the body was written against real indexed endpoints or guessed from the description
 * alone. Without this the owner cannot tell those two apart, and they are very different things
 * to be approving (spec § 6.2).
 */
const formatGrounding = (g: DraftGrounding): string =>
  g.kind === "description_only"
    ? "no indexed API specification matched — drafted from the description alone"
    : `${g.count} indexed endpoint(s) from ${g.services.join(", ")}`;
```

1. Validate both in `handleToolApprovalBroadcast` the way the existing fields are validated — a
   malformed `inputSchema` renders as `none`, a malformed `grounding` as `description_only`.

2. Delete `DRAFT_NOT_IMPLEMENTED_MESSAGE` and its branch in `renderToolOutcome`, and add:

```ts
  if (outcome.code === "ERR_TOOLGEN_DRAFT_INVALID" && outcome.locality === "local") {
    sink.err(
      "hint: the local model could not produce a valid tool. Either configure a larger local\n" +
        "      model (see [llm] min_reasoning_params) or allow remote drafting with\n" +
        '      [tool_generation] drafting = "allow-remote".\n',
    );
  }
```

- [ ] **Step 5: Run both suites**

Run: `bun test packages/gateway/src/ipc/toolgen-rpc.test.ts packages/cli/src/commands/tool.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/ipc/toolgen-rpc.ts packages/cli/src/commands/tool.ts packages/gateway/src/ipc/toolgen-rpc.test.ts packages/cli/src/commands/tool.test.ts
git commit -m "feat(toolgen): carry credentials on the wire and disclose parameters and grounding at approval"
```

---

## Task 11: Wiring, and the end-to-end test

**Files:**

- Modify: `packages/gateway/src/platform/assemble.ts:3819-3862`
- Create: `packages/gateway/test/integration/toolgen/toolgen-draft-e2e.test.ts`

**Interfaces:**

- Consumes: everything above. `localIndex`, `llmRegistry.llmRouter`, `vault` and `db` are all in scope inside `assemblePlatformServices`.
- Produces: a `[tool_generation] enabled = true` install where `nimbus tool create` registers a callable tool.

- [ ] **Step 1: Write the failing integration test**

```ts
// packages/gateway/test/integration/toolgen/toolgen-draft-e2e.test.ts
// A real SQLite db in a fresh temp dir, a fake `generate` returning a fixed valid draft, a stub
// HTTP host, and the REAL sandbox — no mocks below the gate.
import { describe, expect, test } from "bun:test";

describe("toolgen drafting end to end", () => {
  test("create → approve → call returns the stub host's payload", async () => {
    // 1. Start a stub HTTPS-shaped server; register its host as approved.
    // 2. Build gate deps with a `draftTool` backed by the REAL draftGeneratedTool over a fake
    //    `generate` that returns a valid {inputSchema, body} envelope calling nimbusFetch.
    // 3. Approve via a requestApproval that returns true.
    // 4. Assert: status "registered"; describe() reports the approved schema; call({...}) returns
    //    the stub's payload; exactly one `tool`-class egress row was appended.
  });

  test("a body calling raw fetch() fails at the OS even though nothing scanned it", async () => {
    // Bypass the ladder deliberately — hand the gate a draftTool returning a raw-fetch body — and
    // assert the CALL fails. This is what makes "the scan is not the boundary" a tested claim
    // rather than a comment.
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `bun test packages/gateway/test/integration/toolgen/toolgen-draft-e2e.test.ts`
Expected: FAIL.

- [ ] **Step 3: Wire it up**

In `assemble.ts`, replace the `draftBody` stub closure:

```ts
    // `subject` is resolved by the GATE and passed through. It cannot be computed here: this
    // closure is built once at boot, while the approved hosts and their credential subset are
    // per-request — and at draft time nothing has been written to the Vault yet, since
    // `bindCredentials` runs after drafting, so probing the Vault here would report nothing even
    // if a boot closure could see the request.
    draftTool: (req, subject) =>
      draftGeneratedTool(
        req,
        {
          generate: createToolgenDraftLlm(llmRegistry.llmRouter, toolGenerationCfg.drafting),
          findEndpoints: createEndpointFinder(localIndex),
        },
        subject,
      ),
```

and replace the credential no-ops:

```ts
    bindCredentials: async (toolId, credentials) => {
      const bound: string[] = [];
      for (const c of credentials) {
        await writeToolCredential(vault, toolId, c.host, c.binding);
        bound.push(c.host);
      }
      return bound;
    },
    // Idempotent by contract: called on paths where a binding may never have been written, and
    // `vault.delete` on an absent key is a no-op. Hosts come from the GATE (Task 9 step 8), not a
    // registry lookup — the tool is by definition unregistered on every path that calls this.
    revokeCredentials: async (toolId, hosts) => {
      for (const host of hosts) {
        await deleteToolCredential(vault, toolId, host);
      }
    },
```

- [ ] **Step 4: Run the integration test and the whole toolgen surface**

Run: `bun test packages/gateway/src/toolgen packages/gateway/test/integration/toolgen packages/cli/src/commands/tool.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the security-invariant and static audits**

Run: `bun test packages/gateway/src/security-invariants.test.ts && bun run audit:invariants && bun run audit:any`
Expected: PASS. D29(a)/(b)/(c) must still hold — this slice adds no static rule.

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/platform/assemble.ts packages/gateway/test/integration/toolgen/
git commit -m "feat(toolgen): wire real drafting and credential binding into the platform"
```

---

## Task 12: Documentation

**Files:**

- Modify: `docs/cli-reference.md`, `docs/CHANGELOG.md`, `docs/roadmap.md`, `CLAUDE.md`, `GEMINI.md`, `docs/architecture.md`

- [ ] **Step 1: Update the CLI reference**

Document `[tool_generation] drafting` (three values, default `"local"`, and that a `[llm.remote.*]` key does not enable remote drafting on its own). Correct the `nimbus tool create --credential` entry: the value **is** now transmitted and binds a bearer credential per host. State that `header`/`basic` bindings are unreachable and that `nimbus tool credential set` is a refusal stub.

- [ ] **Step 2: Update `CHANGELOG.md`**

One entry naming: drafting shipped; the input schema now reaches the model and the approval prompt; credentials bind at create time; `ERR_TOOLGEN_DRAFT_NOT_IMPLEMENTED` removed; no migration, no new invariant.

- [ ] **Step 3: Update `roadmap.md` and both context files**

In `roadmap.md` § Active, mark the runtime-tool-generation row's drafting step delivered and state what did NOT ship (agent-initiated, persistence, `header`/`basic` bindings). Mirror the one-line status in `CLAUDE.md` and `GEMINI.md` — **both**, per the non-negotiable that they stay in sync.

- [ ] **Step 4: Run the doc audits**

Run: `bun run audit:doc-refs && bun run audit:status-drift && bun run lint:markdown`
Expected: PASS.

- [ ] **Step 5: Full preflight**

Run: `bun run preflight`
Expected: PASS. If the coverage floor fails on a new file, add targeted tests — do not add an exclusion.

- [ ] **Step 6: Commit**

```bash
git add docs/ CLAUDE.md GEMINI.md
git commit -m "docs: record the toolgen drafting step"
```

---

## Self-Review Notes

**Spec coverage.** § 3.1 → Tasks 6, 9. § 3.2 → Task 7. § 3.3 → unchanged, asserted in Task 9. § 4.1–4.2 → Tasks 1, 3, 6. § 4.3 → Task 6. § 4.4 → Task 5. § 5.1–5.2 → Tasks 1, 8. § 5.3 → Task 8. § 5.4 → Tasks 2, 8. § 6.1–6.2 → Tasks 4, 10. § 7 → Task 7. § 8 → Tasks 7, 9, 10. § 9–9.2 → Tasks 9, 10, 11. § 10 → asserted in Task 11 step 5. § 11 → distributed across every task. § 12 → Task 12.

**Type consistency.** Two inconsistencies were found on review and fixed at their source rather than
patched downstream:

- `DraftedTool.locality` and `ToolgenDraftDeps.generate`'s `DraftGeneration` return are defined in
  Task 6 and produced in Task 7, so Task 9 consumes them without amending an earlier task. Locality
  is derived from `provider.isLocal` (I34) and travels with the text, so an `allow-remote` install
  that happened to draft locally records `local` — the config permission and the fact are different
  things and the audit row records the fact.
- `revokeCredentials(toolId, hosts)` takes its host list from the gate. The first draft looked it up
  via `registry.get(toolId)`, which returns `undefined` on precisely the paths that call it — an
  owner denial and a post-approval failure both run before `registry.register` — so it would have
  deleted nothing and left the secret in the Vault, silently, on exactly the path the parameter
  exists to protect.

**Third pass — external review** ([`…-drafting-review.md`](./2026-09-09-s2-toolgen-drafting-review.md),
answered in [`…-drafting-review-response.md`](./2026-09-09-s2-toolgen-drafting-review-response.md)).
It caught a genuine plan failure: Task 11's wiring named `vaultHasToolCredential` and
`toolgenPendingCreds`, neither of which exists anywhere — and no arrangement of them could have
worked, because that closure is built once at boot while the credential hosts are per-request, and
at draft time nothing has been written to the Vault regardless. The credential hosts are now
resolved by the gate and passed as a `DraftSubject`. That fix pulled host normalisation above the
draft, which also repaired a second defect nobody had flagged: the prompt was being built from raw
`req.hosts`, so it would have named `https://api.github.com/v1` while the broker matches
`api.github.com`.

**One deliberate omission.** Task 11's integration test is specified as intent plus assertions rather
than finished code, because it needs a stub host and sandbox fixtures whose helpers must be read
from the existing `packages/gateway/test/integration/toolgen/toolgen-network-denied.test.ts` rather
than invented here. Its second case — a raw-`fetch` body handed straight to the gate, bypassing the
ladder, and failing at the OS — is what turns "the scan is not the boundary" from a comment into a
tested claim, and must not be dropped.
