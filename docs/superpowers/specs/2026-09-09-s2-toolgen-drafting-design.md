# S2 — Runtime tool generation: the drafting step

> **Status: DESIGN. Not implemented.**
>
> Sub-slice of [`2026-09-09-s2-runtime-tool-generation-design.md`](./2026-09-09-s2-runtime-tool-generation-design.md)
> ("the parent spec"), whose § 10 deferred this out of PR 1 with a reason rather than a PR
> number: *"Drafting means designing an LLM prompt for the highest-blast-radius capability in the
> repository, whose output is code that then runs with the owner's credentials. That prompt
> deserves its own design pass and its own review."* This is that pass. It gets its own document
> for the same reason the fleet change digest did
> ([`2026-09-07-fleet-change-digest-design.md`](./2026-09-07-fleet-change-digest-design.md)) —
> a sub-slice large enough to review on its own terms.
>
> **Sequencing note the parent spec does not state.** § 10 names PR 2 (agent-initiated) and PR 3
> (persistence), and assigns drafting to neither. Both are in fact downstream of it: an agent that
> proposes a tool still receives no body, and there is nothing for `nimbus tool save` to save. With
> `draftBody` stubbed, **no generated tool can exist in any session**. Drafting is the critical path
> to closing the runtime-tool-generation row, and with it Spine S2.

---

## 1. Goal

Replace the `ERR_TOOLGEN_DRAFT_NOT_IMPLEMENTED` stub so that `nimbus tool create` produces a
working, owner-approved, sandboxed tool instead of walking the entire gate and refusing at the last
step.

"Working" carries two requirements the stub's absence hid:

1. **A body the model can invoke correctly.** PR 1 advertises every generated tool to the model as
   `inputSchema: z.object({}).passthrough()` and `describe()` returns only `{name, description}`,
   so a drafted tool has no parameter contract at all and the calling model must guess what shape
   `__invoke(args)` expects. Drafting a body without drafting its schema produces a tool that is
   registered, approved, confined — and not reliably callable. The schema is therefore part of this
   slice, not follow-up debt.
2. **A tool that can authenticate.** PR 1 wired `bindCredentials` as `async () => []` and
   `toolgen.create`'s RPC params carry no credential material, while the CLI already parses and
   validates `--credential <host>=<token>` and then drops it. Without closing that, the slice would
   ship a drafter whose tools can only reach unauthenticated endpoints. § 9.

## 2. Non-goals

- **Not agent-initiated.** Unchanged from the parent spec: `initiator` stays `"owner"`, and
  `allow_agent_initiated` / `allowed_hosts` remain PR 2's. § 12 records what that boundary means
  for prompt injection.
- **Not persistent.** No `nimbus tool save`, no V61, no signing keypair. PR 3's.
- **Not a new invariant.** This slice rides I39, the existing `model` egress coverage class and the
  existing `tool.generate` audit row. § 10.
- **Not a general code generator.** The model fills one hole in a template it does not control —
  the body of `async function __invoke(args)`. It authors no transport, no manifest, no imports.

## 3. The seam

PR 1 defined the hole precisely, which is most of why this slice is small.
`toolgen-stub.ts`'s `emitToolScript` wraps the model's output as the body of
`async function __invoke(args)`: zero imports (the ephemeral script store has no `node_modules` and
the manifest grants read to nothing else), with `nimbusFetch(url, init)` — Nimbus-authored, in
scope — as the only route out of the process.

### 3.1 The module

New: `packages/gateway/src/toolgen/toolgen-draft.ts`, exporting `draftGeneratedTool(req, deps)`.

The gate dep widens from `draftBody: (req) => Promise<string>` to
`draftTool: (req) => Promise<DraftedTool>`:

```ts
export interface DraftedTool {
  /** The __invoke body, verbatim — these become the bytes the owner approves. */
  readonly body: string;
  readonly inputSchema: ToolInputSchema;   // § 5
  readonly grounding: DraftGrounding;      // § 6
  readonly attempts: 1 | 2;                // § 4.3
}
```

Its deps are injected and narrow — never the `LlmRouter` itself:

```ts
export interface ToolgenDraftDeps {
  readonly generate: (prompt: string) => Promise<string | null>;
  readonly findEndpoints: (query: string, limit: number) => Promise<GroundedEndpoint[]>;
  readonly now: () => number;
}
```

Handing the drafter a narrowed `generate` rather than the router mirrors
`glossary/glossary-llm-adapter.ts`'s `createGlossaryLlm`, and keeps `setTaskPin` out of reach —
I38 rejected router-wide pinning precisely because a background caller must not re-route a
concurrent interactive `nimbus ask`.

### 3.2 Task type: `reasoning`, not a fifth one

The drafting call is `task: "reasoning"`. Two things come free:

- **A capability floor already exists for it.** `LlmRouter.meetsCapabilityFloor` applies
  `minReasoningParams` to `reasoning` and `agent_step` only, so a local model too small to reason
  is already refused, and `reasonFor` already distinguishes `local-below-reasoning-floor` from
  `no-local-provider` — the two refusals an owner most needs told apart here.
- **Egress coverage is already complete.** `egress/model-egress.ts`'s `wrapLedgeredProvider`
  decorates every provider at `LlmRegistry.addRoute`, so a non-local draft appends one
  `model`-class row before the request with no cooperation from this code. **No new coverage
  class.** `egressMethod` is `toolgen.draft`.

A fifth `LlmTaskType` would need its own floor decision and its own `getStatus` row and would buy
nothing: drafting *is* reasoning.

### 3.3 Ordering — no change required

`createGeneratedTool` calls `draftBody` at step 4, ahead of `bindCredentials` (step 5) and the
owner's approval (step 6). Every drafting refusal is therefore already a refusal-before-consent,
satisfying the gate's ordering rule — a capability that cannot draft never advertises itself by
prompting — with no reordering. This is a property to preserve, not one to add: moving drafting
after consent would ask the owner to approve a body that does not exist yet.

## 4. The draft contract and the validation ladder

### 4.1 One call, structured output

The model returns a single JSON object with exactly two keys, `inputSchema` and `body`.

Single call rather than schema-then-body: the two must agree, and they agree more reliably written
together than in two calls with two failure points.

### 4.2 The ladder

Every rung runs **before consent**, in this order. Each rung's failure names itself.

1. **The envelope parses.** A leading/trailing triple-backtick fence is stripped first — models emit
   them constantly. That is normalization, not validation, and is done before the parse rather than
   being retried through.
2. **The schema is inside the restricted subset** (§ 5). `$ref`, `oneOf`, `allOf`, nested objects
   and `additionalProperties` are rejected.
3. **The body compiles.** `new Function("args", body)` inside a `try`/`catch`.
   **Compilation, never invocation** — `new Function` parses and compiles; it does not execute the
   body. It is nonetheless the construction of a code object from model output inside the
   privileged gateway process, so it is confined to `toolgen-draft.ts` and never handed the
   resulting function value (the result is discarded; only the throw/no-throw is read). The
   alternative considered and rejected was skipping the check and letting the post-approval spawn
   fail — which turns `failed_after_approval`, an audit outcome that should be rare, into the
   routine way a bad draft is discovered, after the owner has already spent their judgment.
4. **The body scan.** Rejects `fetch(`, `require(`, `eval(`, `process.`, `Bun.` and a bare
   `import` statement (matched as the keyword followed by whitespace, so an `important` identifier
   is not caught by it).

**Rung 4 is not a security boundary, and must never be described as one.** The sandbox is: a body
calling raw `fetch` fails at the OS on all three platforms because `permissions.network` is `[]` by
construction, and the emitted script has no `require`/`import` available regardless. The scan exists
so the owner is never asked to approve a body that provably cannot work. Calling it a defense would
be the shape recorded in the `airgap-was-inert-while-docs-promised-it` precedent: a documented
protection that does no work, whose existence discourages the real one. The code comment and this
paragraph say the same thing for that reason.

### 4.3 Exactly one redraft

A failure at any rung is fed back to the model — the rung name and its message — for **one**
further attempt. A second failure refuses with `ERR_TOOLGEN_DRAFT_INVALID`, naming the rung.

One, not zero: the single most common failure is a model returning prose or a fenced explanation
instead of the object, and it recovers from that essentially always when told. One, not N: each
attempt is a real model call, a remote one leaves the machine and is ledgered, and an unbounded
loop against a model that cannot satisfy rung 2 is a budget with no owner. `attempts` is recorded
on the audit row so an install that habitually needs two is visible rather than inferred.

## 5. The input schema

### 5.1 A restricted subset, validated by hand

```ts
export interface ToolInputSchema {
  readonly type: "object";
  readonly properties: Readonly<Record<string, ToolInputProperty>>;
  readonly required?: readonly string[];
}

export type ToolInputProperty =
  | { readonly type: "string" | "number" | "boolean"; readonly description?: string }
  | {
      readonly type: "array";
      readonly items: { readonly type: "string" | "number" | "boolean" };
      readonly description?: string;
    };
```

Three reasons for a subset rather than JSON Schema proper:

- **No new dependency.** We convert to zod ourselves; a JSON-Schema-to-zod library for this is a
  supply-chain cost against a surface this narrow.
- **The owner reads it.** It is rendered in the approval prompt beside the body. A schema with
  `$ref` indirection is one the human cannot check at a glance, and the human is the entire
  boundary for this capability.
- **A nested object is a drafting smell** for arguments that cross a newline-delimited JSON
  protocol into a sandboxed child. Refusing it costs a rare legitimate case and removes a class of
  disagreement between what the model meant and what arrives.

`required` entries must name declared properties; an unknown name fails rung 2.

### 5.2 Into the artifact, not beside it

`GeneratedToolArtifact` gains `inputSchema`, **inside** the parent spec's § 4.5 canonical object.
That is the whole reason it belongs there rather than in registry bookkeeping: the artifact is the
one object shared by the approval prompt, the `artifactDigest` on the audit row, and PR 3's
signature. Putting the schema in it means the owner approves the *parameters* — "this tool takes a
repo name and a page number" is part of what is being consented to — and a later change to them
invalidates the approval, exactly as `credentialHosts` already does.

### 5.3 `describe()` echoes the approval

`emitToolScript` interpolates the **approved** schema into the emitted script as a frozen literal,
precisely as it already does `toolName` and `description` via `JSON.stringify`. `describe()`
returns `{name, description, inputSchema}`.

The tool therefore never authors its schema at runtime — it echoes what was approved. This is the
point of widening `describe()` at all: a running process whose `describe()` disagrees with the
registry's artifact means the on-disk script was altered between emission and spawn, which is
precisely the tampering PR 3 is concerned with, detected here for the price of one field.

### 5.4 The agent-facing surface

`toolgen-agent-tools.ts`'s `inputSchema: z.object({}).passthrough()` becomes a zod object built
from the approved schema by a total conversion over `ToolInputProperty` — so a widened subset is a
compile error rather than a silently-dropped property. The I11 `wrap` injection is untouched: a
generated tool returns a remote API's response verbatim into the model's context and remains the
most injection-prone tool surface in the tree.

## 6. Grounding

### 6.1 The local index, and why not the host

A model drafting an API client from a one-line description is largely guessing endpoints, and a
guessed body is one the owner approves and then watches fail.

The repository already indexes the answer. `connectors/openapi-indexer-sync.ts` parses OpenAPI and
AsyncAPI specs found under `[[filesystem.roots]]` into `api_endpoint` rows — `serviceName`, `path`,
`method`, `operationId`, `tags` — plus a searchable body item per endpoint. `openapi` is in
`LOCAL_ONLY_SYNC_SERVICES`, so reading any of it costs **zero egress**.

**Retrieval keys on the description, not the host.** `api_endpoint.serviceName` is derived from the
spec's `info.title`, its enclosing directory, or a `nimbus.openapi.toml` override — never from a
server URL. There is consequently no host-to-spec mapping in the indexed data, and matching
`api.github.com` against a service named `github-rest-api` would be a fuzzy guess dressed as a
lookup. The owner's description already says what they want; the endpoints are indexed as
searchable items; so `findEndpoints(description, 8)` searches the index and returns the top
matches, each contributing method, path, `operationId`, service and body preview to the prompt.
Hosts remain the envelope; the description is the query.

```ts
export interface GroundedEndpoint {
  readonly serviceName: string;
  readonly method: string;
  readonly path: string;
  readonly operationId: string | null;
  readonly summary: string;   // the indexed body preview, truncated for the prompt
}
```

### 6.2 Disclosure

Grounding is best-effort by nature — it finds what the owner happens to have indexed. The owner
must be able to tell a spec-grounded body from a guess, so the draft carries how it was produced:

```ts
export type DraftGrounding =
  | { readonly kind: "endpoints"; readonly count: number; readonly services: readonly string[] }
  | { readonly kind: "description_only" };
```

Rendered in the approval prompt (a count and the service names, not the full endpoint list — the
prompt is already showing an entire body) and recorded in the `tool.generate` audit payload.

**Deliberately not in the signed artifact.** Provenance is a fact about how the body was produced,
not about what the tool does; putting it inside § 4.5's canonical object would make PR 3's
signature invalidate on a re-index for no behavioural reason. It cannot drift from the body it
describes regardless: both are fields of the same `DraftedTool`, produced in one call.

## 7. Locality — `[tool_generation] drafting`

```toml
[tool_generation]
drafting = "local"   # "off" | "local" | "allow-remote"
```

- `"off"` — refuse with `ERR_TOOLGEN_NO_DRAFT_MODEL`. A third lock, under `enabled`.
- `"local"` (default) — resolve only a provider whose `isLocal` is true (I34: derived from the
  provider, never from a vendor id). No local provider, or one below `minReasoningParams`, refuses.
- `"allow-remote"` — the router's normal preference order applies.

This mirrors `[agents] synthesis` (I31) and the fleet's `allow_remote` (I38): the established house
vocabulary for exactly this question, and the reason no new invariant is needed — the decision is
config, and the enforcement it needs (`isLocal`, the ledger row) already exists and is already
pinned.

It matters more here than for synthesis. What leaves the machine on a remote draft is the owner's
description **plus indexed endpoint paths, operation ids and service names drawn from their private
index**. A frontier key configured under `[llm.remote.<vendor>]` for interactive `nimbus ask` grants
drafting nothing on its own — I38's rule, restated because it is the property an owner is most
likely to assume the other way.

## 8. Config, error codes, audit

**Config.** One new key, `[tool_generation] drafting` (§ 7). `enabled` still refuses first, at gate
step 1, so `drafting` is only reachable once the capability is on.

**Error codes.** Adds `ERR_TOOLGEN_NO_DRAFT_MODEL` (drafting off, no eligible provider, local below
floor, or air-gap with only remote routes — the router's `reasonFor` supplies the detail) and
`ERR_TOOLGEN_DRAFT_INVALID` (both attempts failed the ladder; names the rung). Deletes
`ERR_TOOLGEN_DRAFT_NOT_IMPLEMENTED` and, with it, the CLI's special-case explanation block in
`packages/cli/src/commands/tool.ts`, which exists only to explain the stub.

**Audit.** No new row type. The existing `tool.generate` row's payload gains `draftAttempts`,
`draftGrounding` and `draftLocality` (`"local" | "remote"`). A refusal before consent continues to
record `rejected` with the execution id and reason code; `not_required` remains never used on this
action type.

## 9. Credentials — closing PR 1's no-op

PR 1 left two honest no-ops (`bindCredentials: async () => []`, `revokeCredentials: async () => {}`)
because `toolgen.create`'s wire contract carried no credential material. The consequence, once
drafting works, is a drafter whose tools reach only unauthenticated endpoints — most real APIs
excluded.

**Less is missing than the no-ops suggest.** `nimbus tool create` already parses
`--credential <host>=<token>` and already refuses a credential naming a host absent from `--host`,
so that the approval prompt's `credentialHosts` can never disclose a binding for a host the tool
was not approved to reach. `nimbus tool credential set` already parses `--bearer`/`--header`/
`--basic`. `toolgen-credentials.ts` already owns the per-host Vault key (D29(c)), with both a
reader and a writer. `VaultWriter.delete` exists. The gate already calls both deps in the right
order — bind before consent so the prompt names a real host list, revoke on denial so a refused
tool leaves no secret behind.

What this slice adds:

1. `toolgen.create`'s RPC params carry the parsed bindings through to the gate. Today the CLI
   validates the flag and discards it, which is a surface that accepts input and does nothing.
2. `bindCredentials` over `writeToolCredential`, returning the hosts that now hold one.
3. `revokeCredentials` over `vault.delete` for each of the tool's hosts — idempotent, per its
   contract, since it is called on paths where a binding may never have been written.

Credentials stay **per-host, never per-tool** (the tool chooses the URL, so a per-tool binding
would let it choose the recipient of the secret) and are never inherited from a connector. Neither
rule is new; both are the parent spec's, and neither is relaxed here.

## 10. What this slice does not change

Stated so a reviewer can confirm absence rather than infer it:

- **No new invariant.** Rides I39.
- **No new static rule.** D29(a)/(b)/(c) are untouched. `new Function` is confined by review and by
  its single call site, not by a new audit rule — a source-scanning rule for it would be the
  `allowlist-guards-fail-silently` shape unless written as what cannot pass, and one call site in
  one file does not earn that yet. If a second appears, it does.
- **No new egress coverage class.** The `model` class already covers the draft call; the `tool`
  class already covers the brokered request.
- **No schema migration.** Ephemeral remains ephemeral; V61 is PR 3's.
- **No IPC method, no CLI command, no LAN change, no Tauri exposure.** `toolgen.*` stays
  LAN-forbidden and absent from `ALLOWED_METHODS`. `toolgen.create`'s params widen; the method set
  does not.

## 11. Testing

- **One test per ladder rung**, each **red-proved by reverting the rung** rather than by observing
  green — a rung whose test passes with the rung deleted is testing nothing.
- Fakes returning: prose, a fenced object, a nested schema, a `$ref`, a `required` naming an
  undeclared property, a body calling `fetch`, a body with a syntax error. Each must land on its
  named rung, not merely fail.
- **The retry bound both ways**: fail-then-succeed registers with `attempts: 2`; fail-twice refuses
  with `ERR_TOOLGEN_DRAFT_INVALID`.
- **The `describe()` echo property**: the schema the running process reports equals the approved
  artifact's — the check that gives PR 3 its tampering detector.
- **Locality**: `drafting = "local"` with only a remote provider registered refuses **and appends no
  egress row**. The zero-row half is the assertion that matters; without it the test passes for any
  reason at all.
- **Grounding disclosure**: an index with matching endpoints yields `kind: "endpoints"`; an empty
  index yields `kind: "description_only"` and the prompt says so. Both rendered, neither inferred.
- **Credentials**: a denied approval leaves no Vault key under the toolId (the revoke path), and
  `credentialHosts` in the prompt equals the hosts that actually hold a binding.
- **Integration**: an end-to-end create → approve → call against a stub host, with a real schema,
  through the real sandbox. The existing confinement tests must stay green unchanged.

## 12. Stated bounds

Recorded rather than softened.

1. **Prompt injection is out of scope only because this path is owner-initiated.** `description` is
   owner-typed, so no indexed untrusted text reaches the drafting prompt. PR 2's agent-initiated
   path can source that description from indexed content, which walks through the door I33's own
   scope bound names as the first to re-examine when an agent-callable path lands. PR 2 inherits
   this; it is written here so it is inherited rather than rediscovered.
   **Grounding narrows this less than it appears to:** indexed endpoint text already enters the
   prompt today, from the owner's own filesystem specs. The bound is that nothing *the owner did
   not choose to index* does.
2. **The static scan is not a defense.** § 4.2, rung 4.
3. **Grounding quality is whatever the owner happens to have indexed.** The § 6.2 disclosure makes
   that visible; it does not make it better.
4. **`new Function` compiles model output in the privileged process.** Compilation is not execution
   and the value is discarded, but the construction is real and is confined to one file by review
   rather than by a static rule (§ 10).
5. **One approval still covers arbitrary behaviour on an approved host.** I39's residual (1)
   unchanged: the allow-list bounds *where* a tool may send, never *what*. Drafting does not narrow
   it, and a body the owner approves after reading is still a body they may not have understood —
   the same honest limit the terminal lane states.

## 13. Delivery

One PR. The pieces are ordered so each is reviewable against something that already exists:

1. `ToolInputSchema` + the subset validator + the zod conversion (pure, no deps).
2. `toolgen-draft.ts`: the prompt, the ladder, the one retry.
3. Grounding: `findEndpoints` over the `api_endpoint` index read, and `DraftGrounding`.
4. Artifact widening: `inputSchema` into `GeneratedToolArtifact`, `emitToolScript`, `describe()`,
   `toolgen-agent-tools.ts`.
5. `[tool_generation] drafting` + the locality resolution.
6. Credentials (§ 9): RPC params, `bindCredentials`, `revokeCredentials`.
7. Wiring at `platform/assemble.ts` — the stub closure replaced; the CLI's stub-explanation block
   deleted.

---

**Citation bound.** `docs/superpowers/` is excluded from `audit:doc-refs`, so the file and symbol
references above are ungated and will rot silently. They were hand-verified against `main` at
`65bda8ef` on 2026-09-09.
