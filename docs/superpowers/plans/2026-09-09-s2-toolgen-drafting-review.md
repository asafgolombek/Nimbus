# Implementation Plan Review: S2 — Runtime Tool Generation: The Drafting Step

**Date:** 2026-09-09  
**Reviewer:** Antigravity (AI Coding Assistant)  
**Status:** Review Complete — Approved with Critical Implementation Fixes  
**Target Plan:** [`2026-09-09-s2-toolgen-drafting.md`](./2026-09-09-s2-toolgen-drafting.md)  
**Target Spec:** [`../specs/2026-09-09-s2-toolgen-drafting-design.md`](../specs/2026-09-09-s2-toolgen-drafting-design.md)  
**Spine Slot:** [Spine S2 — Local Compute Fleet](../../roadmap.md#active)  
**Tracking Invariant:** Invariant **I39** (Runtime Tool Generation Gate), **I11** (`wrapToolForLlm`), **I29** (`model`/`tool` Egress Ledgering), **I34** (Provider-Derived Locality), Static Rules **D29(a–c)**

---

## 1. Executive Summary & Plan Strengths

The implementation plan translates the drafting design specification into a clean, 12-task, test-driven engineering roadmap. Each task follows strict TDD (failing test -> minimal implementation -> test pass -> commit), preserves the repository's non-negotiable architectural invariants, and adds zero third-party dependencies.

### Notable Strengths of the Plan

1. **Async Function Syntax Verification (Task 3):**  
   Correctly incorporates the `AsyncFunction` constructor for Rung 3 compilation checks, completely avoiding the synchronous `new Function` trap where `await` throws syntax errors on valid tool bodies.
2. **Negative Lookbehind Regex in Rung 4 (Task 3):**  
   Employs `/(?<![\w$.])fetch\s*\(/` rather than naive substring matching, ensuring `nimbusFetch(...)` and `prefetch(...)` are never falsely rejected.
3. **Prompt Specification & Return Type Clarification (Task 5):**  
   The drafting prompt explicitly specifies the `nimbusFetch` return contract (`{ status, statusText, headers, body }` where `body` is already a string), preventing models from emitting broken `await res.json()` calls.
4. **Locality Derived from Provider (Task 7):**  
   `createToolgenDraftLlm` derive `locality: "local" | "remote"` from `provider.isLocal` at generation time (I34) rather than inferring it from config permissions.
5. **Fail-Closed Vault Cleanup (Task 9):**  
   `revokeCredentials(toolId, hosts)` receives the host list explicitly from the gate rather than attempting a registry lookup (which returns `undefined` for unregistered/denied tools), guaranteeing no orphaned secrets linger in the Vault.

---

## 2. Critical Implementation Blockers & Fixes

### 2.1 Phantom Symbols & Credential Resolution in `assemble.ts` (Tasks 6, 9, 11)

- **Context in Plan (Task 11 Step 3, lines 2046–2047):**  
  In `platform/assemble.ts`, the plan writes:

  ```ts
  credentialHostsFor: (hosts) => hosts.filter((h) => vaultHasToolCredential(toolgenPendingCreds, h)),
  ```

- **The Issue:**  
  1. `vaultHasToolCredential` and `toolgenPendingCreds` **do not exist anywhere in the codebase**.
  2. At Step 4 (when `draftTool` executes), credentials have **not yet been written to Vault** (they are bound in Step 5 after drafting succeeds).
  3. `toolgenGateDeps` is assembled once at boot in `assemble.ts`. A static boot closure cannot probe request-scoped credentials via a non-existent in-memory store.
- **Root Cause & Clean Resolution:**  
  The request-scoped credential hosts (`credentialHosts: readonly string[]`) are already known at create time from the `credentials` parameter passed into `createGeneratedTool(req, deps, credentials)`.  
  
  **Required Fix:**
  1. **In `toolgen-gate.ts` (Task 9):** Widen `draftTool` to accept the pre-filtered credential hosts:

     ```ts
     export interface ToolgenGateDeps {
       // ...
       readonly draftTool: (
         req: CreateGeneratedToolRequest,
         credentialHosts: readonly string[],
       ) => Promise<DraftedTool>;
     }
     ```

  2. **In `createGeneratedTool` (Task 9):** Derive `credentialHosts` before drafting and pass them down:

     ```ts
     const approvedHostSet = new Set(hosts);
     const credentialHosts = credentials
       .map((c) => normalizeHost(c.host))
       .filter((h) => approvedHostSet.has(h));

     // Step 4: Draft (receives host names only — zero secret material)
     const draft = await deps.draftTool(req, credentialHosts);
     ```

  3. **In `toolgen-draft.ts` (Task 6):** Pass `credentialHosts` directly to `draftGeneratedTool(req, deps, credentialHosts)` and remove `credentialHostsFor` from `ToolgenDraftDeps`.
  4. **In `platform/assemble.ts` (Task 11):** Wire `draftTool` cleanly without phantom dependencies:

     ```ts
     draftTool: (req, credentialHosts) =>
       draftGeneratedTool(
         req,
         {
           generate: createToolgenDraftLlm(llmRegistry.llmRouter, toolGenerationCfg.drafting),
           findEndpoints: createEndpointFinder(localIndex),
         },
         credentialHosts,
       ),
     ```

---

### 2.2 Anchored `stripFence` Regex Rejects Valid Responses with Conversational Prose (Task 6)

- **Context in Plan (Task 6 Step 3, lines 1136–1140):**  

  ```ts
  function stripFence(raw: string): string {
    const t = raw.trim();
    const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/.exec(t);
    return fenced === null ? t : (fenced[1] ?? "").trim();
  }
  ```

- **The Issue:**  
  Because the regex is strictly anchored with `^` and `$`, if an LLM outputs any introductory or concluding text (e.g. `Here is the requested tool definition:\n```json\n{"inputSchema": ..., "body": "..."}\n````),`stripFence` fails to match and returns the full raw string.
  `JSON.parse(stripFence(raw))` then immediately throws a `SyntaxError`, burning the model's only redraft attempt on a benign formatting artifact.
- **Required Resolution:**  
  Use a resilient extraction pipeline in `toolgen-draft.ts`:

  ```ts
  export function extractJsonPayload(raw: string): string {
    const trimmed = raw.trim();
    // 1. Direct parse attempt
    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch {}

    // 2. Unanchored markdown code block extraction
    const fenced = /```(?:json)?\s*\n([\s\S]*?)\n?```/.exec(trimmed);
    if (fenced !== null && fenced[1] !== undefined) {
      return fenced[1].trim();
    }

    // 3. Outermost JSON object fallback
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return trimmed.slice(firstBrace, lastBrace + 1).trim();
    }

    return trimmed;
  }
  ```

---

## 3. High-Impact Refinements & Suggestions

### 3.1 JavaScript Identifier Validation in Property Names (Task 1)

- **Context:**  
  `validateInputSchema` validates property types, but does not assert that property names are valid JavaScript identifiers.
- **Risk:**  
  If a model emits a property name with hyphens or special characters (e.g. `"repo-name"`), the generated body will attempt to access `args.repo-name` (which evaluates as `args.repo - name`, causing runtime `ReferenceError` or `NaN`).
- **Suggestion:**  
  Add an identifier check in `validateProperty` in `toolgen-schema.ts`:

  ```ts
  const VALID_IDENTIFIER = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
  if (!VALID_IDENTIFIER.test(name)) {
    fail(`property name "${name}" is not a valid JavaScript identifier`);
  }
  ```

---

### 3.2 Deduplication in `inputSchema.required` (Task 1)

- **Context:**  
  If the model emits duplicate entries in `required` (e.g. `["owner", "owner"]`), `validateInputSchema` currently preserves duplicates.
- **Suggestion:**  
  Deduplicate `required` on normalization:

  ```ts
  return {
    type: "object",
    properties,
    required: [...new Set(rawRequired as string[])],
  };
  ```

---

### 3.3 Enhanced Parameter Rendering in CLI Approval Prompt (Task 10)

- **Context (Task 10 Step 4, line 1944):**  
  `formatParams` renders array types as `tags: array?`.
- **Suggestion:**  
  Disclose the item scalar type for array properties (e.g. `tags: string[]?` instead of `tags: array?`):

  ```ts
  const formatPropType = (p: ToolInputProperty): string =>
    p.type === "array" ? `${p.items.type}[]` : p.type;

  const formatParams = (s: ToolInputSchema): string => {
    const required = new Set(s.required ?? []);
    const names = Object.entries(s.properties).map(
      ([n, def]) => `${n}: ${formatPropType(def)}${required.has(n) ? "" : "?"}`,
    );
    return names.length === 0 ? "none" : names.join(", ");
  };
  ```

---

## 4. Task Verification & Invariant Tracking

| Task | Verification Focus | Invariants & Rules Asserted |
|---|---|---|
| **Task 1** | Hand-validated schema subset; rejection of `$ref`, `oneOf`, nested objects | No `any`; strict subset boundaries |
| **Task 2** | Pure Zod conversion mapping required/optional flags | Safe agent tool definition |
| **Task 3** | `AsyncFunction` syntax compilation; word-boundary forbidden global scan | Heuristic pre-consent filter |
| **Task 4** | Ranked index retrieval on `api_endpoint` items with summary truncation | Zero-egress local grounding |
| **Task 5** | Drafting prompt with explicit `nimbusFetch` return contract | Zero credential leakage to LLM |
| **Task 6** | Ladder execution with single bounded redraft | Max 2 LLM attempts; locality derivation |
| **Task 7** | `[tool_generation] drafting` parser; `reasoning` task capability floor | Invariant **I34**; capability floor |
| **Task 8** | `inputSchema` in `GeneratedToolArtifact`, `describe()`, and Mastra tool | Invariant **I11**; tamper detection |
| **Task 9** | `createGeneratedTool` pre-consent ordering; host-based Vault revoke | Invariant **I39**; fail-closed credentials |
| **Task 10** | `toolgen.create` RPC credentials parsing; approval prompt parameters | Zero secret disclosure in prompt |
| **Task 11** | Full e2e test with stub host and positive sandbox escape control | Invariant **I39**, **I29** (`tool` egress class) |
| **Task 12** | Documentation & roadmap synchronization | Platform equality; dual context sync |

---

## 5. Summary of Recommended Edits to the Plan

| Task | Step | Recommended Change |
|---|---|---|
| **Task 6** | Step 3 | Replace anchored `stripFence` with `extractJsonPayload` (unanchored block & outermost brace fallback). |
| **Task 6** | Step 3 | Remove `credentialHostsFor` from `ToolgenDraftDeps`; pass `credentialHosts: readonly string[]` directly to `draftGeneratedTool`. |
| **Task 9** | Step 4 | Update `ToolgenGateDeps.draftTool` signature to `(req, credentialHosts) => Promise<DraftedTool>`. |
| **Task 11** | Step 3 | Replace `vaultHasToolCredential(toolgenPendingCreds, h)` in `assemble.ts` with direct threading of `credentialHosts`. |
| **Task 1** | Step 3 | Add identifier regex check for property keys (`VALID_IDENTIFIER`) and deduplicate `required` array. |
| **Task 10** | Step 4 | Format array properties as `type[]` in `formatParams`. |
