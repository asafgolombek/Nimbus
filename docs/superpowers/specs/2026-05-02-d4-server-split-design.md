# D4 Split — `ipc/server.ts` → namespace directory

**Date:** 2026-05-02
**Phase:** Phase 4 / B3 structure audit — Phase 2 follow-up (D4 deferred-backlog candidate)
**Source:** [`docs/structure-audit/deferred-backlog.md`](../../structure-audit/deferred-backlog.md) "D4 — large files (split candidates)" / `ipc/server.ts:1239` row.
**Predecessor specs (sibling D4 splits — same pattern):**
- [`2026-05-02-d4-rpc-handlers-split-design.md`](./2026-05-02-d4-rpc-handlers-split-design.md) — `connector-rpc-handlers.ts` (PRs [#159](https://github.com/asafgolombek/Nimbus/pull/159) / [#160](https://github.com/asafgolombek/Nimbus/pull/160))
- [`2026-05-02-d4-lazy-mesh-split-design.md`](./2026-05-02-d4-lazy-mesh-split-design.md) — `lazy-mesh.ts` (PRs [#162](https://github.com/asafgolombek/Nimbus/pull/162) / [#163](https://github.com/asafgolombek/Nimbus/pull/163) / [#164](https://github.com/asafgolombek/Nimbus/pull/164))

---

## 1 — Goal

Split the 1239-LOC `packages/gateway/src/ipc/server.ts` into a directory of concern-focused sibling files, with **zero behavioral change** and **minimum churn at consumer call sites**. The file is the third of six D4 split candidates in `deferred-backlog.md` and the highest-churn file (56 commits in last 90d) — splitting it has the largest expected long-term maintenance benefit.

After this PR:

- The largest resulting file is `dispatchers.ts` at ~580 LOC, well under the 800 D4 threshold.
- The full public surface (`createIpcServer` factory, `CreateIpcServerOptions` type, `dispatchVaultGated` function) keeps its exact names + signatures.
- The 4 consumer files (`ipc/index.ts`, `engine-ask-stream.test.ts`, `ipc.test.ts`, `server-vault-gated.test.ts`) get a one-token import-path edit each (`./server.ts` → `./server/index.ts`).
- All audit gates (D4, D10, D11, lint, typecheck, tests) stay green.

This is the **third** of six D4 splits in the deferred-backlog. Three remaining after this: `cli/commands/connector.ts` (1238 LOC), `index/local-index.ts` (987 LOC), `auth/pkce.ts` (886 LOC).

## 2 — Non-goals

- **No behavioral changes.** Every function migrates verbatim — same logic, same imports (trimmed to per-file scope), same control flow. The only mechanical changes to function bodies are `this`-style closure access → `ctx.X` substitutions for the dispatcher functions that move to free functions; see § 3.4.
- **No changes to JSON-RPC method routing or dispatch order.** `dispatchMethod` keeps its exact decision tree: session → automation → connector → diagnostics → people → phase4 → switch{ping/searchRanked/agent.invoke/consent/audit.list/askStream} → vault-or-method-not-found.
- **No changes to the `tryDispatchXxxRpc` skip-symbol pattern.** Each per-namespace dispatcher keeps its current contract: returns either a sentinel `Symbol("xxxRpcSkipped")` to mean "this isn't my method" or the dispatched value/throws an `RpcMethodError`. The skip symbols stay module-internal.
- **No new tests.** The four existing test files (`ipc.test.ts`, `engine-ask-stream.test.ts`, `server-vault-gated.test.ts`, plus indirect coverage from each `*-rpc.test.ts`) cover the surface; the move is mechanical.
- **No D4 split of the 3 remaining large files.** Each gets its own design spec.
- **No collapsing of the per-namespace dispatchers into a generic registry.** A unified `Map<string, Handler>` indexed by method prefix would change the throwing-vs-skipping semantics in subtle ways (specifically the `phase4RpcSkipped` chain that intentionally tries multiple Phase-4 dispatchers in order). Captured as future follow-up; out of scope here.

## 3 — Architecture changes

### 3.1 Directory replaces file

Delete `packages/gateway/src/ipc/server.ts`. Create `packages/gateway/src/ipc/server/` containing:

| File | Responsibility | LOC est. |
|---|---|---|
| `index.ts` | Pure re-export shim. Re-exports `createIpcServer` (value), `CreateIpcServerOptions` (type), and `dispatchVaultGated` (value) for the 4 existing consumers. | ~10 |
| `rpc-error.ts` | `RpcMethodError` class (lines 52–63 in the source) — the universal error type used by every dispatcher and helper in the directory. Standalone, no internal deps. | ~20 |
| `options.ts` | `CreateIpcServerOptions` type (lines 168–218) + `BunSessionData` type. Pure type module. | ~70 |
| `context.ts` | `ServerCtx` interface (§ 3.3) + the 6 skip-symbol exports (`connectorRpcSkipped`, `peopleRpcSkipped`, `sessionRpcSkipped`, `automationRpcSkipped`, `phase4RpcSkipped`, `diagnosticsRpcSkipped`). Internal-only — not re-exported from `index.ts`. | ~50 |
| `vault-dispatch.ts` | Vault gated dispatch + helpers: `VaultDispatchHit/Miss/Outcome` types, `assertWellFormedVaultKey`, `dispatchVaultIfPresent`, `dispatchVaultGated` (exported), `rpcVaultOrMethodNotFound`. The `dispatchVaultGated` export is the only function in this file that's also re-exported from `index.ts`. | ~110 |
| `socket-listeners.ts` | Socket+listener helpers: `removeStaleUnixSocketIfPresent`, `chmodListenSocketBestEffort`, `attachWin32Socket`, `startWin32NetServer`, `startBunUnixListener`. Take a small `SocketListenerCtx` (subset of `ServerCtx` exposing `attachSession` callback + state holders for `bunListener`/`netServer`/`winSockets`). | ~120 |
| `inline-handlers.ts` | Direct method handlers that aren't `tryDispatchXxxRpc`-shaped: `rpcGatewayPing`, `rpcIndexSearchRanked`, `rpcConsentRespond`, `rpcAuditList`, plus the agent/workflow extraction (`sendAgentChunkIfStreaming`, `dispatchAgentInvoke`, `parseOptionalString`, `parseWorkflowRunParamsOverride`, `buildWorkflowRunContext`, `dispatchWorkflowRunRpc`, `dispatchEngineAskStream`). `dispatchEngineAskStream` takes `(ctx, session, params, clientId)` and uses `ctx.getAgentInvokeHandler()` so the `setAgentInvokeHandler` setter (§ 3.5) takes effect on the next dispatched call (verified 2026-05-02 by re-reading the source — the original `engine.askStream` switch case captured `agentInvokeHandler` via the closure; the getter preserves the same reactive read). The two helpers `requireNonEmptyRpcString` and `parseOptionalString` stay file-private — both are only used by `buildWorkflowRunContext` in this file. | ~360 |
| `dispatchers.ts` | All 14 namespace dispatchers + the inline `assertDiagnosticsRpcAccess` they share + the LAN local helpers (`requireLanIndex`, `requireLanPairingWindow`, `extractPeerId`, `handleLanLocalRpc`): `tryDispatchLlmRpc`, `tryDispatchVoiceRpc`, `tryDispatchUpdaterRpc`, `tryDispatchAuditRpc`, `tryDispatchReindexRpc`, `tryDispatchProfileRpc`, `tryDispatchDataRpc`, `tryDispatchLanRpc`, `tryDispatchPhase4Rpc` (orchestrator), `tryDispatchSessionRpc`, `tryDispatchAutomationRpc`, `tryDispatchPeopleRpc`, `tryDispatchConnectorRpc`, `tryDispatchDiagnosticsRpc`. All take `ServerCtx`. | ~580 |
| `server.ts` | The `createIpcServer` factory itself (the only thing that owns mutable state): closure state + `broadcastNotification` + `voiceService` mic hook + `handleRpc` (parses JSON-RPC envelope) + `dispatchMethod` (thin — calls into namespace dispatchers + 6-case switch + vault-or-method-not-found fallback) + `attachSession` + the public `IPCServer` object literal returned at the end. | ~280 |

Total: ~1600 LOC across 9 files. Slightly higher than the current 1239 due to:
- Per-file imports (each file repeats some imports — Biome doesn't deduplicate across files).
- The `ServerCtx` interface boilerplate.
- Extra context-building logic in `createIpcServer` to construct the context object.

Largest file: `dispatchers.ts` at ~580 LOC, well under the 800 D4 threshold. No new D4 violations.

### 3.2 Public surface preservation

The `ipc/server/index.ts` shim re-exports everything currently imported from `./server.ts`:

```ts
// packages/gateway/src/ipc/server/index.ts
export type { CreateIpcServerOptions } from "./options.ts";
export { createIpcServer } from "./server.ts";
export { dispatchVaultGated } from "./vault-dispatch.ts";
```

(Order: alphabetical-by-source-file. Final ordering may shift if Biome reformats.)

These three are the existing public surface (verified 2026-05-02 via `grep -rn 'from.*"./server'`). Nothing else is exported.

### 3.3 The `ServerCtx` interface (key design decision)

Mirroring the `MeshSpawnContext` pattern from the lazy-mesh split (PR #163 / #164). The `createIpcServer` factory currently uses a closure to share state across ~14 inner functions; extracting any of them as free functions requires that closure state be passed explicitly via a context interface.

```ts
// packages/gateway/src/ipc/server/context.ts

import type { ConsentCoordinatorImpl } from "../consent.ts";
import type { AgentInvokeHandler } from "../agent-invoke.ts";
import type { WorkflowRunHandler } from "../workflow-invoke.ts";
import type { CreateIpcServerOptions } from "./options.ts";

/**
 * Internal collaborator interface — wraps the closure state of `createIpcServer`
 * so per-namespace dispatchers can live in sibling files without `this`-style
 * closure access. Not exported from `index.ts`.
 *
 * `getAgentInvokeHandler` and `getWorkflowRunHandler` are getters (not direct
 * fields) because the factory's `setAgentInvokeHandler` / `setWorkflowRunHandler`
 * public methods mutate the underlying `let` bindings; capturing the value at
 * context-construction time would freeze the handler to whatever was passed at
 * `createIpcServer(...)` time and break the setter API.
 */
export interface ServerCtx {
  readonly options: CreateIpcServerOptions;
  readonly consentImpl: ConsentCoordinatorImpl;
  readonly startedAtMs: number;
  broadcastNotification(method: string, params: Record<string, unknown>): void;
  getAgentInvokeHandler(): AgentInvokeHandler | undefined;
  getWorkflowRunHandler(): WorkflowRunHandler | undefined;
}

// Skip-symbol sentinels — module-private, exported here so dispatchers.ts and
// server.ts can both reference the same identity. Not re-exported from index.ts.
export const connectorRpcSkipped: unique symbol = Symbol("connectorRpcSkipped");
export const peopleRpcSkipped: unique symbol = Symbol("peopleRpcSkipped");
export const sessionRpcSkipped: unique symbol = Symbol("sessionRpcSkipped");
export const automationRpcSkipped: unique symbol = Symbol("automationRpcSkipped");
export const phase4RpcSkipped: unique symbol = Symbol("phase4RpcSkipped");
export const diagnosticsRpcSkipped: unique symbol = Symbol("diagnosticsRpcSkipped");
```

`createIpcServer` builds a single stable `ServerCtx` object once in the factory body — same pattern as `MeshSpawnContext` in `mesh.ts`. Constructor-bound (rather than per-call getter) avoids per-RPC allocation on the hot dispatch path.

### 3.4 Free-function dispatcher shape

Each `tryDispatchXxxRpc` becomes a module-level free function. Example (verbatim apart from `options.X` → `ctx.options.X` and `consentImpl` → `ctx.consentImpl`):

```ts
// packages/gateway/src/ipc/server/dispatchers.ts
export async function tryDispatchLlmRpc(
  ctx: ServerCtx,
  method: string,
  params: unknown,
): Promise<unknown> {
  if (!method.startsWith("llm.") || ctx.options.llmRegistry === undefined) {
    return phase4RpcSkipped;
  }
  try {
    const out = await dispatchLlmRpc(method, params, {
      registry: ctx.options.llmRegistry,
      notify: (m, p) => ctx.broadcastNotification(m, p as Record<string, unknown>),
    });
    if (out.kind === "hit") return out.value;
  } catch (e) {
    if (e instanceof LlmRpcError) {
      throw new RpcMethodError(e.rpcCode, e.message);
    }
    throw e;
  }
  throw new RpcMethodError(-32601, `Method not found: ${method}`);
}
```

The body migrates verbatim with the substitutions:
- `options.X` → `ctx.options.X`
- `broadcastNotification(...)` → `ctx.broadcastNotification(...)`
- `consentImpl` → `ctx.consentImpl`
- `startedAtMs` → `ctx.startedAtMs`
- `agentInvokeHandler` (closure variable read) → `ctx.getAgentInvokeHandler()` (so the call sees the current value, not a frozen one)
- `workflowRunHandler` (closure variable read) → `ctx.getWorkflowRunHandler()` (same reason)

The `tryDispatchPhase4Rpc` orchestrator becomes:

```ts
export async function tryDispatchPhase4Rpc(
  ctx: ServerCtx,
  method: string,
  params: unknown,
  clientId: string,
): Promise<unknown> {
  const llmOutcome = await tryDispatchLlmRpc(ctx, method, params);
  if (llmOutcome !== phase4RpcSkipped) return llmOutcome;
  // ... 7 more dispatcher calls ...
  return tryDispatchReindexRpc(ctx, method, params, clientId);
}
```

`dispatchMethod` in `server.ts` keeps its exact structure but each `tryDispatchXxxRpc` call now passes `ctx` as the first argument.

### 3.5 Mutable handler accessors (`agentInvokeHandler`, `workflowRunHandler`)

The factory's public API (`setAgentInvokeHandler`, `setWorkflowRunHandler`) mutates two `let` bindings inside the `createIpcServer` closure. Currently these bindings are read directly by `dispatchAgentInvoke`, `dispatchWorkflowRunRpc`, and the `engine.askStream` switch case — all of which see the latest value because they're inside the same closure.

After extraction, these dispatchers are module-level functions and cannot read the `let` bindings directly. To preserve the "setter changes affect future dispatch calls" semantic, the context exposes them as getters:

```ts
// In createIpcServer, building the ctx:
const ctx: ServerCtx = {
  options,
  consentImpl,
  startedAtMs,
  broadcastNotification,
  getAgentInvokeHandler: () => agentInvokeHandler,
  getWorkflowRunHandler: () => workflowRunHandler,
};
```

The setters keep their behavior:

```ts
return {
  // ...
  setAgentInvokeHandler(handler) { agentInvokeHandler = handler; },
  setWorkflowRunHandler(handler) { workflowRunHandler = handler; },
  // ...
};
```

Each call to `ctx.getAgentInvokeHandler()` reads the *current* value of the `let` binding, so changes via the setter take effect on the next dispatch — same as today.

This is a meaningful design choice and is the **only** non-mechanical aspect of the refactor. The alternative (passing the handler as a parameter to each dispatcher) would require threading it through `dispatchMethod` and is uglier; the alternative-alternative (storing a holder object `{ handler: AgentInvokeHandler | undefined }` and mutating its field) is functionally equivalent to the getter but harder to read.

### 3.6 Consumer call-site impact

4 files currently import from `./server.ts`:

1. `packages/gateway/src/ipc/index.ts` — `CreateIpcServerOptions`, `createIpcServer` (re-export).
2. `packages/gateway/src/ipc/engine-ask-stream.test.ts` — `CreateIpcServerOptions`, `createIpcServer`.
3. `packages/gateway/src/ipc/ipc.test.ts` — `CreateIpcServerOptions`, `createIpcServer`.
4. `packages/gateway/src/ipc/server-vault-gated.test.ts` — `dispatchVaultGated`.

**Impact strategy:** identical to the predecessor splits. Bun keeps the `.ts` suffix explicit; `./server.ts` does NOT auto-resolve to `./server/index.ts`. All 4 consumers update their import path string from `./server.ts` to `./server/index.ts`. The list of imported symbols stays unchanged.

`bun run typecheck` after the move is the gate; if it surfaces any unresolved import, the consumer file is updated in the same commit.

## 4 — Behavioral guarantees

The split is a pure code-rearrangement refactor. Specifically:

- **`dispatchMethod` decision order unchanged.** Session → automation → connector → diagnostics → people → phase4 → switch → vault-or-method-not-found.
- **Skip-symbol semantics unchanged.** Each `tryDispatchXxxRpc` returns the same skip symbol (or value/throws) it returns today.
- **Phase-4 dispatcher chain unchanged.** `tryDispatchPhase4Rpc` calls Llm → Voice → Updater → Audit → Data → Lan → Profile → Reindex in that order.
- **Function bodies unchanged** apart from the substitutions documented in § 3.4.
- **Public class signatures unchanged.** `createIpcServer(options)`, `dispatchVaultGated(vault, toolExecutor, method, params)`, `CreateIpcServerOptions` shape.
- **Listener startup order unchanged.** Win32 net path vs. Bun unix path detection at the same `platform() === "win32"` branch in `start()`.
- **Stop sequence unchanged.** `consentImpl.rejectAllPending()` → close win32/bun listener → cleanup sockets → unlink listenPath.
- **Test files unchanged in location and name.** Only the 4 import paths change (one token each).
- **Audit invariants unchanged.** `bun run audit:invariants` exits 0; D11 allow-list (6 entries) untouched; D10 spawn rule satisfied (no spawns in this file).
- **Mutable handler setters preserve their effect.** Calling `setAgentInvokeHandler(newHandler)` after `start()` causes subsequent `agent.invoke` and `engine.askStream` calls to use `newHandler` — same as today.

## 5 — Tests

No new tests are added. Existing coverage:

- `ipc.test.ts` — end-to-end IPC dispatch through `createIpcServer` (broadest test).
- `engine-ask-stream.test.ts` — `engine.askStream` lifecycle (`streamId`, `streamToken`, `streamDone`, `streamError`).
- `server-vault-gated.test.ts` — `dispatchVaultGated` HITL gate for `vault.set` / `vault.delete`.
- Per-namespace `*-rpc.test.ts` files — exercise each `dispatchXxxRpc` directly (not through the server's `tryDispatchXxxRpc` wrapper).

**Test verification matrix during plan execution:**

| Suite | Expected |
|---|---|
| `bun test packages/gateway/src/ipc/ipc.test.ts` | Pass count unchanged from main. |
| `bun test packages/gateway/src/ipc/engine-ask-stream.test.ts` | Pass count unchanged from main. |
| `bun test packages/gateway/src/ipc/server-vault-gated.test.ts` | Pass count unchanged from main. |
| `bun test packages/gateway/` | Full gateway-suite pass count unchanged from main. |
| `bun run typecheck` | Clean across all packages. |
| `bun run lint` | Clean. |
| `bun run audit:invariants` | Exits 0; D10 = 0, D11 = 0. |
| `bun run test:ci` | Full CI parity — gateway/scripts/sdk/mcp suites pass (modulo known UI vitest V8 coverage flake). |

## 6 — Acceptance criteria

- [ ] `packages/gateway/src/ipc/server.ts` deleted.
- [ ] `packages/gateway/src/ipc/server/` directory exists with 9 files (`index.ts`, `rpc-error.ts`, `options.ts`, `context.ts`, `vault-dispatch.ts`, `socket-listeners.ts`, `inline-handlers.ts`, `dispatchers.ts`, `server.ts`).
- [ ] Each sibling file's LOC is within ~15% of the estimates in § 3.1.
- [ ] No file in the new directory exceeds 800 LOC (D4 threshold).
- [ ] `index.ts` re-exports `createIpcServer`, `CreateIpcServerOptions` (type), `dispatchVaultGated`.
- [ ] Each of the 4 consumer files gets its `./server.ts` import updated to `./server/index.ts`.
- [ ] All test gates in § 5 pass.
- [ ] `ServerCtx` and the 6 skip symbols are module-internal — not present in `index.ts`'s export surface.
- [ ] `setAgentInvokeHandler` / `setWorkflowRunHandler` setter behavior is preserved (verified by existing tests if they exercise it; otherwise asserted in self-review).

## 7 — Rollout

Single atomic PR. Branch: `dev/asafgolombek/d4-server-split`. Title: `refactor(ipc): D4 — split server.ts into namespace directory`. The PR may contain 1–2 commits depending on how the engineer organises the move. All commits land together in a single squash-merge or merge-commit.

Spec → review → plan → review → impl follows the predecessor sibling pattern (PRs #159/#160 for rpc-handlers, #162/#163 for lazy-mesh).

## 8 — Out of scope, captured for future specs

- **`createIpcToolExecutor(ctx, clientId)` helper.** Four sites (`tryDispatchReindexRpc`, `tryDispatchDataRpc`, `tryDispatchConnectorRpc`, `rpcVaultOrMethodNotFound`) each construct the same `new ToolExecutor(bindConsentChannel(consentImpl, clientId), localIndex, stubDispatcher)` pattern (~7 lines × 4 sites = ~28 LOC of duplication). A small helper in `vault-dispatch.ts` or `context.ts` would deduplicate this cleanly. Out of scope here per the same rationale as the lazy-mesh `spawnIfConfigured` deferral (PR #163 spec § 8): mixing a DRY refactor with the structural split makes the diff harder to review, and a regression in shared boilerplate is harder to bisect when the file boundaries also moved. Tracked as future follow-up.
- **Generic registry-based dispatch.** A `Map<methodPrefix, Handler>` indexed table that `dispatchMethod` walks would simplify the per-namespace skip-symbol pattern but changes the throw-vs-skip semantics in subtle ways (specifically the `phase4RpcSkipped` chain that intentionally tries multiple Phase-4 dispatchers in order, with each potentially deferring to the next). Captured as future follow-up.
- **D4 splits of the 3 remaining large files.** `cli/commands/connector.ts`, `index/local-index.ts`, `auth/pkce.ts` each get their own design spec.
- **Cleanup of TODOs / unused parameters / cosmetic improvements.** Strict mechanical move; cosmetic improvements live in their own follow-up.
- **Further `dispatchers.ts` decomposition.** If it grows past 800 LOC organically (a 15th namespace dispatcher landing), a follow-up D4 split can break it into per-namespace sub-files.
- **Uniform `clientId` parameter on every dispatcher.** Spec-review §2.3 suggested adding `clientId` to all `tryDispatchXxxRpc` signatures even when unused (so the shape is uniform). Declined — different dispatchers have legitimately different needs (`tryDispatchLlmRpc` doesn't use `clientId`), and adding unused params is a mild code smell that linters routinely flag. Each dispatcher's signature reflects what it actually consumes from the surrounding context.

## 9 — Review dispositions (2026-05-02 Gemini CLI review)

Recorded for traceability. Source: [`2026-05-02-d4-server-split-feedback.md`](./2026-05-02-d4-server-split-feedback.md).

- **§ 1.1 — `createIpcToolExecutor(ctx, clientId)` helper → DEFER.** Real DRY opportunity (~28 LOC across 4 sites) but mixing DRY with a structural split increases review burden and makes regressions harder to bisect. Captured in § 8 as a future follow-up. Same rationale as lazy-mesh PR #163 § 8 deferral of `spawnIfConfigured`.
- **§ 1.2 — `requireNonEmptyRpcString` placement → FIX (spec bug).** The spec's claim that this helper was "used by both [inline-handlers] and `dispatchers.ts`" was wrong — verified by re-grepping the source: `requireNonEmptyRpcString` is only used by `buildWorkflowRunContext`, which lives in `inline-handlers.ts`. § 3.1 corrected to mark it (and `parseOptionalString`) as file-private to `inline-handlers.ts`.
- **§ 1.3 — `dispatchEngineAskStream` extraction → FIX (clarity).** Spec § 3.5 covers the reactive-getter pattern in general but didn't specifically call out `dispatchEngineAskStream`. § 3.1 now explicitly notes the `(ctx, session, params, clientId)` signature and the `ctx.getAgentInvokeHandler()` call, with a brief verification that the original code captured `agentInvokeHandler` via closure (the getter preserves the same read).
- **§ 1.4 — Skip-symbol count → FIX (spec bug).** § 3.1 said "the 5 skip-symbol exports" then enumerated 6. Corrected to "the 6 skip-symbol exports". The § 3.3 code block already had all 6.
- **§ 2.1 — `VaultDispatchOutcome` exports → NOTE (already covered).** Reviewer was concerned that `server.ts` would need to import `VaultDispatchOutcome` if `rpcVaultOrMethodNotFound` lived elsewhere. The spec already co-locates `rpcVaultOrMethodNotFound` with the outcome types in `vault-dispatch.ts` (§ 3.1), so no cross-file export is needed. No change.
- **§ 2.2 — `agentRequestContext` import in `inline-handlers.ts` → NOTE (plan-level).** Implementation-plan detail; the plan's per-file imports section will list `agentRequestContext` from `../engine/agent-request-context.ts` for `inline-handlers.ts`. No spec change.
- **§ 2.3 — Uniform `clientId` parameter on every dispatcher → DECLINE.** See § 8 entry above; signature uniformity for its own sake adds unused parameters that linters flag. Each dispatcher's signature reflects what it actually consumes.

## 10 — Provenance

- Phase 2 deferred-backlog: [`docs/structure-audit/deferred-backlog.md`](../../structure-audit/deferred-backlog.md) "D4 — large files" / `ipc/server.ts:1239 churn 56 (p80+) Refactor candidate: extract per-namespace handler registries; dispatcher stays thin — own design spec`.
- Current file: `packages/gateway/src/ipc/server.ts` (1239 LOC at commit `9ae63c8`).
- Existing consumers: 4 files (enumerated in § 3.6).
- Sibling D4 splits (predecessor pattern):
  - [`2026-05-02-d4-rpc-handlers-split-design.md`](./2026-05-02-d4-rpc-handlers-split-design.md), PRs [#159](https://github.com/asafgolombek/Nimbus/pull/159) (spec) / [#160](https://github.com/asafgolombek/Nimbus/pull/160) (impl).
  - [`2026-05-02-d4-lazy-mesh-split-design.md`](./2026-05-02-d4-lazy-mesh-split-design.md), PRs [#162](https://github.com/asafgolombek/Nimbus/pull/162) (spec) / [#163](https://github.com/asafgolombek/Nimbus/pull/163) (impl) / [#164](https://github.com/asafgolombek/Nimbus/pull/164) (MeshLogger move follow-up).
