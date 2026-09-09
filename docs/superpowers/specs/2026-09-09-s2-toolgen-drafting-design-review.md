# Design Review: S2 — Runtime Tool Generation: The Drafting Step

**Date:** 2026-09-09  
**Reviewer:** Antigravity (AI Coding Assistant)  
**Status:** Review Complete — Approved with Critical Implementation Resolutions  
**Target Spec:** [`2026-09-09-s2-toolgen-drafting-design.md`](./2026-09-09-s2-toolgen-drafting-design.md)  
**Parent Spec:** [`2026-09-09-s2-runtime-tool-generation-design.md`](./2026-09-09-s2-runtime-tool-generation-design.md)  
**Spine Slot:** [Spine S2 — Local Compute Fleet](../../roadmap.md#active)  
**Relevant Invariants & Rules:** Invariant **I39** (Runtime Tool Generation Gate), **I11** (`wrapToolForLlm`), **I29** (`model`/`tool` Egress Ledgering), **I34** (Locality Derived from Provider), Static Rules **D29(a–c)**

---

## 1. Executive Summary & Architectural Assessment

The design specification provides a precise, minimal, and well-confined design for the critical **drafting step** of runtime tool generation. It directly solves the two remaining gaps that prevented `nimbus tool create` from producing callable tools:

1. **Schema & Body Generation:** Replacing the `ERR_TOOLGEN_DRAFT_NOT_IMPLEMENTED` stub with a single-shot structured LLM call that authors both the parameter schema (`ToolInputSchema`) and the sandboxed body (`__invoke(args)`).
2. **Credential Transmission & Binding:** Widening `toolgen.create`'s IPC contract and wiring `bindCredentials` / `revokeCredentials` to safely attach secrets in Vault without exposing raw credentials to the generated tool or leaking them on denial.

### Key Architectural Strengths

- **Single Structured Call (§ 4.1):** Generating the input schema and function body in one response guarantees agreement between expected arguments and invoked logic without introducing multi-step coordination overhead.
- **Fail-Closed Validation Ladder (§ 4.2):** All validation rungs (JSON envelope parsing, schema subset validation, syntax compilation, and static scanning) execute **strictly before owner consent**, ensuring the owner is never asked to review malformed or broken code.
- **Locality & Capability Alignment (§ 3.2, § 7):** Drafting maps to the existing `"reasoning"` task type, inheriting the `minReasoningParams` floor and existing `model`-class egress ledgering (`toolgen.draft`) without inventing redundant task types or bypassing air-gap controls.
- **Tamper-Evident Artifact Integration (§ 5.2, § 5.3):** Placing `inputSchema` directly inside `GeneratedToolArtifact` ensures the parameter contract is hashed into `artifactDigest`, signed in PR 3, and echoed verbatim by `describe()` in the sandboxed process.
- **Zero-Egress Spec Grounding (§ 6):** Grounding the model using the local `api_endpoint` SQLite index provides API awareness without incurring external network calls.

---

## 2. Critical Implementation Blockers & Code-Level Corrections

### 2.1 Rung 3 Compilation Trap: `new Function("args", body)` vs `AsyncFunction`

- **The Issue in Spec (§ 4.2, Rung 3):**  
  The spec states:
  > *"3. The body compiles. `new Function("args", body)` inside a `try`/`catch`."*
- **The Execution Trap:**  
  In JavaScript / V8 / JavaScriptCore, `new Function("args", body)` constructs a **synchronous** function:

  ```ts
  function anonymous(args) {
    /* body */
  }
  ```

  Every valid tool body calling `nimbusFetch` will use `await` (e.g. `const res = await nimbusFetch(url);`).  
  When `new Function("args", body)` encounters `await` inside a synchronous function declaration, the JS engine throws:

  ```text
  SyntaxError: await is only valid in async functions and the top level bodies of modules
  ```

  **Consequence:** Evaluating `new Function("args", body)` directly will cause **100% of valid async tool drafts to fail Rung 3**, permanently blocking tool creation.
- **Required Resolution:**  
  Construct an `AsyncFunction` or wrap the test compilation in an `async` function body:

  ```ts
  // packages/gateway/src/toolgen/toolgen-draft.ts

  // Option A: Using the AsyncFunction constructor
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as FunctionConstructor;

  export function verifyBodySyntax(body: string): void {
    try {
      // Compiles the async function syntax; function object is discarded without execution.
      new AsyncFunction("args", body);
    } catch (err) {
      throw new ToolgenError(
        "ERR_TOOLGEN_DRAFT_SYNTAX",
        `Tool body syntax error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  ```

  *Alternatively (Option B):* `new Function("args", \`async function __verify() { ${body} }\`);`

---

### 2.2 Rung 4 Substring Collision with `nimbusFetch`

- **The Issue in Spec (§ 4.2, Rung 4):**  
  The spec defines Rung 4 as rejecting: `fetch(`, `require(`, `eval(`, `process.`, `Bun.`, and bare `import`.
- **The Substring Collision Trap:**  
  If implemented with `body.includes("fetch(")` or a naive regex `/[^a-zA-Z0-9]fetch\s*\(/`, any call to the designated communication function `nimbusFetch(...)` could trigger a false positive if not anchored to word boundaries:
  - `"nimbusFetch(".includes("fetch(")` evaluates to `true`.
  - Calling `body.includes("fetch(")` will reject the exact helper function the tool is required to call!
- **Required Resolution:**  
  Use strict word-boundary and negative lookbehind regular expressions:

  ```ts
  // packages/gateway/src/toolgen/toolgen-draft.ts

  const FORBIDDEN_PATTERNS: ReadonlyArray<{ readonly pattern: RegExp; readonly name: string }> = [
    { pattern: /(?<![a-zA-Z0-9_$])fetch\s*\(/, name: "global fetch()" },
    { pattern: /\brequire\s*\(/, name: "require()" },
    { pattern: /\beval\s*\(/, name: "eval()" },
    { pattern: /\bprocess\./, name: "process" },
    { pattern: /\bBun\./, name: "Bun" },
    { pattern: /(?<!\w)import(?:\s+|\s*\()/, name: "import statement/expression" },
  ];

  export function scanBodyForForbiddenPatterns(body: string): void {
    for (const { pattern, name } of FORBIDDEN_PATTERNS) {
      if (pattern.test(body)) {
        throw new ToolgenError(
          "ERR_TOOLGEN_FORBIDDEN_PATTERN",
          `Body contains disallowed pattern: ${name}. Generated tools must use nimbusFetch().`,
        );
      }
    }
  }
  ```

---

### 2.3 `nimbusFetch` Return Contract Mismatch in LLM Prompting

- **Context in Spec & Gateway Implementation (`toolgen-broker.ts`):**  
  `nimbusFetch(url, init)` communicates with the Gateway broker over stdio and resolves to:

  ```ts
  export interface BrokeredFetchResponse {
    readonly status: number;
    readonly statusText: string;
    readonly headers: Record<string, string>;
    readonly body: string; // Plain string! Not a streaming body.
  }
  ```

- **The Problem:**  
  LLMs are heavily fine-tuned on the standard Web `fetch()` API, where `fetch()` returns a `Response` object with `.json()` and `.text()` methods.  
  If the prompt merely says "use `nimbusFetch(url, init)`", models will predictably draft:

  ```js
  const res = await nimbusFetch("https://api.github.com/repos/foo/bar");
  const data = await res.json(); // CRASH: res.json is not a function!
  ```

- **Required Resolution:**  
  The drafting prompt must explicitly define `nimbusFetch`'s return shape and instruct the model that `res.body` is a string (e.g. `const data = JSON.parse(res.body);`).

---

### 2.4 `ToolgenGateDeps.bindCredentials` Signature and Request Widening

- **Context in Spec (§ 9) & `toolgen-gate.ts`:**  
  In PR 1, `createGeneratedTool` received:

  ```ts
  export interface CreateGeneratedToolRequest {
    readonly sessionId: string;
    readonly description: string;
    readonly hosts: readonly string[];
  }
  ```

  And `deps.bindCredentials` had signature: `(toolId: string, hosts: readonly string[]) => Promise<string[]>`.  
  `bindCredentials` did not receive the credential tokens, because the CLI discarded them before sending IPC.
- **Required Widening:**  
  To close PR 1's no-op:
  1. `CreateGeneratedToolRequest` must accept `credentials`:

     ```ts
     export interface ToolCredentialParam {
       readonly host: string;
       readonly binding: ToolCredentialBinding;
     }

     export interface CreateGeneratedToolRequest {
       readonly sessionId: string;
       readonly description: string;
       readonly hosts: readonly string[];
       readonly credentials?: readonly ToolCredentialParam[];
     }
     ```

  2. `ToolgenGateDeps.bindCredentials` must receive the credential bindings:

     ```ts
     readonly bindCredentials: (
       toolId: string,
       credentials: readonly ToolCredentialParam[],
     ) => Promise<string[]>;
     ```

  3. `toolgen-rpc.ts` parses `credentials` from `toolgen.create` params:

     ```ts
     "toolgen.create": async (params, ctx) => {
       const rec = asRecord(params) ?? {};
       const sessionId = requireString(params, "sessionId");
       const description = requireString(params, "description");
       const hosts = stringArray(rec["hosts"]);
       const credentials = parseCredentialsArray(rec["credentials"]);
       return createGeneratedTool({ sessionId, description, hosts, credentials }, ctx.gateDeps);
     }
     ```

---

## 3. Prompt Engineering & Drafting Protocol Specification

### 3.1 Drafting System Prompt Template

Below is the recommended prompt template for `packages/gateway/src/toolgen/toolgen-draft.ts`:

````text
You are Nimbus Tool Drafter, an expert TypeScript/JavaScript code generator.
Your task is to generate a sandboxed tool definition based on a user's description and approved hosts.

### ENVIRONMENT & CONSTRAINTS:
1. The tool will execute inside an offline sandbox (zero network access).
2. The ONLY way to perform HTTP requests is the global asynchronous function:
   `nimbusFetch(url: string, init?: { method?: string, headers?: Record<string, string>, body?: string }): Promise<{ status: number, statusText: string, headers: Record<string, string>, body: string }>`
3. NOTE: `nimbusFetch` returns `{ status, statusText, headers, body }` where `body` is ALREADY a string. Do NOT call `res.json()` or `res.text()`. Use `JSON.parse(res.body)` to parse JSON.
4. The tool MUST only send HTTP requests to the approved hosts: [{{APPROVED_HOSTS}}].
5. Do NOT use `fetch`, `require`, `eval`, `process`, `Bun`, or `import`.
6. Zero dependencies: only standard ECMAScript features (JSON, URL, Math, Array, etc.) are available.

### REQUIRED OUTPUT FORMAT:
You must respond with a SINGLE valid JSON object (enclosed in ```json ... ```) with exactly two keys:
1. "inputSchema": A schema describing the parameters `__invoke(args)` expects.
   - Restricted JSON Schema subset:
     - `type`: "object"
     - `properties`: A map where each property type is "string", "number", "boolean", or an "array" of those primitives.
     - `required`: An optional array of required property names.
   - Nested objects, $ref, oneOf, allOf, and additionalProperties are FORBIDDEN.
2. "body": The JavaScript code inside `async function __invoke(args) { ... }`.
   - Must handle `args` matching `inputSchema`.
   - Must return the final result (e.g., an object, string, or parsed API data).
   - Must throw an Error on API failure (e.g. `if (res.status >= 400) throw new Error(...)`).

### USER REQUEST:
Description: {{DESCRIPTION}}
Approved Hosts: {{APPROVED_HOSTS}}

{{GROUNDING_CONTEXT}}
````

---

### 3.2 Grounding Context Layout (§ 6.1)

When `findEndpoints(description, 8)` returns matches, format them into `{{GROUNDING_CONTEXT}}`:

```text
### RELEVANT LOCAL API ENDPOINTS (from indexed OpenAPI specifications):
- [service: github-api] GET /repos/{owner}/{repo}/issues
  summary: List issues in a repository
- [service: github-api] POST /repos/{owner}/{repo}/issues
  summary: Create an issue
```

When no endpoints are found:

```text
(No local OpenAPI specs matched the description. Draft based on the description and standard REST conventions.)
```

---

### 3.3 Redrafting on Ladder Failure (§ 4.3)

When Attempt 1 fails a ladder rung, the feedback prompt for Attempt 2 should be:

```text
Your previous output failed validation on rung: {{RUNG_NAME}}.
Reason: {{FAILURE_REASON}}

Please fix the issue and return ONLY the corrected JSON object containing "inputSchema" and "body".
```

---

## 4. Schema System & Zod Interop Hardening (§ 5)

### 4.1 Schema Subset Validation Algorithm (`validateInputSchema`)

To satisfy Rung 2, implement a strict, recursive-free schema validator:

```ts
// packages/gateway/src/toolgen/toolgen-draft.ts

const VALID_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const ALLOWED_PRIMITIVES = new Set(["string", "number", "boolean"]);

export function validateInputSchema(schema: unknown): ToolInputSchema {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    throw new ToolgenError("ERR_TOOLGEN_SCHEMA_INVALID", "inputSchema must be a JSON object");
  }

  const s = schema as Record<string, unknown>;
  if (s["type"] !== "object") {
    throw new ToolgenError("ERR_TOOLGEN_SCHEMA_INVALID", 'inputSchema.type must be "object"');
  }

  if (typeof s["properties"] !== "object" || s["properties"] === null || Array.isArray(s["properties"])) {
    throw new ToolgenError("ERR_TOOLGEN_SCHEMA_INVALID", "inputSchema.properties must be an object");
  }

  // Reject unsupported keywords ($ref, oneOf, allOf, anyOf, additionalProperties)
  for (const forbidden of ["$ref", "oneOf", "allOf", "anyOf", "additionalProperties", "$schema"]) {
    if (forbidden in s) {
      throw new ToolgenError(
        "ERR_TOOLGEN_SCHEMA_INVALID",
        `Keyword "${forbidden}" is not permitted in restricted tool schema`,
      );
    }
  }

  const properties = s["properties"] as Record<string, unknown>;
  const validatedProps: Record<string, ToolInputProperty> = {};

  for (const [propName, propDef] of Object.entries(properties)) {
    if (!VALID_IDENTIFIER.test(propName)) {
      throw new ToolgenError(
        "ERR_TOOLGEN_SCHEMA_INVALID",
        `Property name "${propName}" is not a valid JavaScript identifier`,
      );
    }
    if (typeof propDef !== "object" || propDef === null || Array.isArray(propDef)) {
      throw new ToolgenError("ERR_TOOLGEN_SCHEMA_INVALID", `Property "${propName}" definition must be an object`);
    }

    const p = propDef as Record<string, unknown>;
    const type = p["type"];
    const description = typeof p["description"] === "string" ? p["description"] : undefined;

    if (typeof type === "string" && ALLOWED_PRIMITIVES.has(type)) {
      validatedProps[propName] = {
        type: type as "string" | "number" | "boolean",
        ...(description ? { description } : {}),
      };
    } else if (type === "array") {
      const items = p["items"];
      if (typeof items !== "object" || items === null || Array.isArray(items)) {
        throw new ToolgenError("ERR_TOOLGEN_SCHEMA_INVALID", `Array property "${propName}" must define "items"`);
      }
      const itemType = (items as Record<string, unknown>)["type"];
      if (typeof itemType !== "string" || !ALLOWED_PRIMITIVES.has(itemType)) {
        throw new ToolgenError(
          "ERR_TOOLGEN_SCHEMA_INVALID",
          `Array property "${propName}" items must be "string", "number", or "boolean"`,
        );
      }
      validatedProps[propName] = {
        type: "array",
        items: { type: itemType as "string" | "number" | "boolean" },
        ...(description ? { description } : {}),
      };
    } else {
      throw new ToolgenError(
        "ERR_TOOLGEN_SCHEMA_INVALID",
        `Property "${propName}" has unsupported type: "${String(type)}" (nested objects are disallowed)`,
      );
    }
  }

  let validatedRequired: string[] | undefined;
  if (s["required"] !== undefined) {
    if (!Array.isArray(s["required"]) || !s["required"].every((k) => typeof k === "string")) {
      throw new ToolgenError("ERR_TOOLGEN_SCHEMA_INVALID", "inputSchema.required must be an array of strings");
    }
    for (const reqKey of s["required"]) {
      if (!(reqKey in validatedProps)) {
        throw new ToolgenError(
          "ERR_TOOLGEN_SCHEMA_INVALID",
          `inputSchema.required names undeclared property "${reqKey}"`,
        );
      }
    }
    validatedRequired = [...s["required"]];
  }

  return {
    type: "object",
    properties: validatedProps,
    ...(validatedRequired ? { required: validatedRequired } : {}),
  };
}
```

---

### 4.2 Total Conversion to Zod (`toolgen-agent-tools.ts`)

Replace `inputSchema: z.object({}).passthrough()` with a clean, total conversion function:

```ts
// packages/gateway/src/toolgen/toolgen-agent-tools.ts
import { z, type ZodTypeAny } from "zod";
import type { ToolInputProperty, ToolInputSchema } from "./toolgen-types.ts";

export function zodSchemaFromInputSchema(schema: ToolInputSchema): z.ZodObject<Record<string, ZodTypeAny>> {
  const shape: Record<string, ZodTypeAny> = {};
  const requiredSet = new Set(schema.required ?? []);

  for (const [key, prop] of Object.entries(schema.properties)) {
    let fieldSchema: ZodTypeAny;
    if (prop.type === "string") {
      fieldSchema = z.string();
    } else if (prop.type === "number") {
      fieldSchema = z.number();
    } else if (prop.type === "boolean") {
      fieldSchema = z.boolean();
    } else if (prop.type === "array") {
      const itemType = prop.items.type;
      const itemSchema =
        itemType === "string" ? z.string() : itemType === "number" ? z.number() : z.boolean();
      fieldSchema = z.array(itemSchema);
    } else {
      // Compiler-enforced exhaustiveness
      const _exhaustive: never = prop;
      throw new Error(`Unhandled property type in schema conversion: ${JSON.stringify(_exhaustive)}`);
    }

    if (prop.description) {
      fieldSchema = fieldSchema.describe(prop.description);
    }

    if (!requiredSet.has(key)) {
      fieldSchema = fieldSchema.optional();
    }

    shape[key] = fieldSchema;
  }

  return z.object(shape);
}
```

---

## 5. Grounding Implementation & OpenAPI Retrieval (§ 6)

### 5.1 SQLite `findEndpoints` Implementation

`findEndpoints(query, limit)` can query the `api_endpoint` table joined with `item` to produce ranked, relevant matches:

```ts
// packages/gateway/src/toolgen/toolgen-grounding.ts
import type { Database } from "bun:sqlite";

export interface GroundedEndpoint {
  readonly serviceName: string;
  readonly method: string;
  readonly path: string;
  readonly operationId: string | null;
  readonly summary: string;
}

export function createEndpointFinder(db: Database): (query: string, limit: number) => Promise<GroundedEndpoint[]> {
  const stmt = db.query(`
    SELECT
      ae.service_name AS serviceName,
      ae.method AS method,
      ae.path AS path,
      ae.operation_id AS operationId,
      COALESCE(i.body_preview, i.title, '') AS summary
    FROM api_endpoint ae
    LEFT JOIN item i ON i.id = ae.id
    WHERE ae.service_name LIKE ?
       OR ae.path LIKE ?
       OR ae.operation_id LIKE ?
       OR i.title LIKE ?
       OR i.body_preview LIKE ?
    LIMIT ?
  `);

  return async (query: string, limit: number): Promise<GroundedEndpoint[]> => {
    const term = `%${query.trim()}%`;
    const rows = stmt.all(term, term, term, term, term, limit) as Array<{
      serviceName: string;
      method: string;
      path: string;
      operationId: string | null;
      summary: string;
    }>;

    return rows.map((r) => ({
      serviceName: r.serviceName,
      method: r.method,
      path: r.path,
      operationId: r.operationId,
      summary: r.summary.slice(0, 200), // Bound length to protect LLM context
    }));
  };
}
```

---

## 6. Open Questions & Recommendations

### Q1: Handling URL Query String Encoding in Generated Scripts

- **Question:** REST APIs frequently require query parameters (e.g. `?state=open&page=1`). How should the model construct URLs?
- **Recommendation:** Include a brief instruction in the prompt indicating that `new URLSearchParams(...)` or standard string formatting may be used to construct URLs for `nimbusFetch`.

### Q2: Authentication Schemes in `nimbus tool create`

- **Question:** The CLI `--credential` flag parses `<host>=<token>`. How does the Gateway know whether this is Bearer or an API Key?
- **Recommendation:** Default `<host>=<token>` from `nimbus tool create` to `ToolCredentialBinding` of `type: "bearer"`. For custom headers or basic auth, users can continue to use `nimbus tool credential set` prior to recreation.

### Q3: Recovery Guidance on Local Model Inability to Reason

- **Question:** If an owner has a small local model (e.g. 1B-3B parameters) that repeatedly fails Rung 2 or Rung 3, how should the error be communicated?
- **Recommendation:** When `ERR_TOOLGEN_DRAFT_INVALID` occurs on a local model, the CLI should print:
  `"Hint: Local model failed to draft a valid tool. Consider configuring a larger model (min_reasoning_params) or enabling remote drafting via [tool_generation] drafting = 'allow-remote'."`

---

## 7. Verification & Test Plan Additions (§ 11)

In addition to the tests specified in § 11, the test suite must explicitly include:

1. **Async Function Syntax Test:**  
   Verify that a body containing `await nimbusFetch(...)` passes Rung 3 compilation without throwing `SyntaxError`.
2. **Word-Boundary Regex Test for Rung 4:**  
   Verify that `nimbusFetch("https://api.example.com")` is **not** rejected, while `fetch("https://api.example.com")` is rejected with `ERR_TOOLGEN_FORBIDDEN_PATTERN`.
3. **JSON Extraction Robustness:**  
   Verify that responses wrapped in markdown fences (` ```json { ... } ``` `) or conversational text (e.g. `Here is your tool: { ... }`) are properly parsed.
4. **Zod Schema Equality:**  
   Verify that `zodSchemaFromInputSchema` correctly produces required fields vs optional fields matching `schema.required`.
5. **Zero-Endpoint Fallback:**  
   Verify that an empty SQLite index produces `{ kind: "description_only" }` and does not crash `draftGeneratedTool`.

---

## 8. Summary of Suggested Specification Edits

| Spec Section | Proposed Edit |
|---|---|
| **§ 4.2 (Rung 3)** | Replace `new Function("args", body)` with `new AsyncFunction("args", body)` (or async wrapper) to support `await`. |
| **§ 4.2 (Rung 4)** | Specify word-boundary regex (`/(?<!\w)fetch\s*\(/`) to prevent matching `nimbusFetch`. |
| **§ 3.1 & § 9** | Widen `CreateGeneratedToolRequest` and `bindCredentials` to accept `credentials: readonly ToolCredentialParam[]`. |
| **§ 3.1** | Define `nimbusFetch` return shape clearly in prompt design so the model does not attempt `await res.json()`. |
| **§ 5.4** | Add explicit total conversion function (`zodSchemaFromInputSchema`) with `.optional()` handling. |
