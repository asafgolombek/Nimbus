# D4 Split — `connector-rpc-handlers.ts` → namespace directory

**Date:** 2026-05-02
**Phase:** Phase 4 / B3 structure audit — Phase 2 follow-up (D4 deferred-backlog candidate)
**Source:** [`docs/structure-audit/deferred-backlog.md`](../../structure-audit/deferred-backlog.md) "D4 — large files (split candidates)" / `connector-rpc-handlers.ts:1103` row.
**Predecessor specs:**
- [`2026-04-30-structure-audit-design.md`](./2026-04-30-structure-audit-design.md)
- [`2026-05-02-d11-bucket-c-design.md`](./2026-05-02-d11-bucket-c-design.md)
- [`2026-05-02-d11-manifest-derived-audit-design.md`](./2026-05-02-d11-manifest-derived-audit-design.md)
**Predecessor PRs:** [#149](https://github.com/asafgolombek/Nimbus/pull/149), [#151](https://github.com/asafgolombek/Nimbus/pull/151), [#154](https://github.com/asafgolombek/Nimbus/pull/154), [#155](https://github.com/asafgolombek/Nimbus/pull/155), [#156](https://github.com/asafgolombek/Nimbus/pull/156), [#157](https://github.com/asafgolombek/Nimbus/pull/157)

---

## 1 — Goal

Split the 1106-LOC `packages/gateway/src/ipc/connector-rpc-handlers.ts` into a directory of namespace-focused sibling files, with **zero behavioral change** and **zero churn at consumer call sites**. The file is one of 6 currently flagged in `deferred-backlog.md` as a D4 split candidate (>800 raw LOC). After this PR:

- The largest resulting file is `auth.ts` at ~530 LOC, well under the 800 D4 threshold.
- All 12 public handlers + the startup-time `resumePendingRemovals` keep their existing names + signatures.
- The 3 consumer files (`connector-rpc.ts`, `platform/assemble.ts`, `connector-rpc-handlers-setconfig.test.ts`) need at most a one-character path tweak (only if Bun's module resolution doesn't auto-resolve the directory).
- All audit gates (D4, D10, D11, lint, typecheck, tests) stay green.

This is the first of two D4 splits queued; `lazy-mesh.ts` (1408 LOC) is the next sub-project after this lands.

## 2 — Non-goals

- **No behavioral changes.** Every function moves verbatim — same logic, same imports (trimmed to per-file scope), same control flow. No "while I'm here" cleanup.
- **No second-level splits.** `auth.ts` will end up at ~530 LOC; further breaking it into per-connector or per-flow subdirectories is rejected for this scope. The per-connector flows are mechanically similar (mostly 20–40 LOC each, all ending in `authSuccess(...)`) and benefit from co-location. If `auth.ts` later exceeds 800 LOC organically, a follow-up D4 split can revisit.
- **No helper renaming or simplification.** Pure mechanical move.
- **No test file restructure.** `connector-rpc-handlers-setconfig.test.ts` keeps its current location and name; only its import path may need updating (one character) depending on Bun's directory-resolution behavior.
- **No new test files.** The existing tests cover the surface; the move is mechanical and exercised by the existing suite.
- **No D4 split of `lazy-mesh.ts`.** Separate spec / next sub-project.

## 3 — Architecture changes

### 3.1 Directory replaces file

Delete `packages/gateway/src/ipc/connector-rpc-handlers.ts`. Create `packages/gateway/src/ipc/connector-rpc-handlers/` containing:

| File | Responsibility | LOC est. |
|---|---|---|
| `context.ts` | Defines `ConnectorRpcHandlerContext` and `ConnectorRpcHit` types (both hoisted from old file). All 5 sibling files import from here. `ConnectorRpcHandlerContext` is re-exported by `index.ts` for the test file. | ~30 |
| `status.ts` | Read-only state introspection: `handleConnectorListStatus`, `handleConnectorStatus`, `handleConnectorHealthHistory`. | ~80 |
| `lifecycle.ts` | Per-connector state changes that don't mutate config: `handleConnectorPause`, `handleConnectorResume`, `handleConnectorSync`. **Owns** the shared internal helpers `resumeConnector`, `pauseConnector`, `emitConfigChanged` (also imported by `config.ts`). | ~110 |
| `config.ts` | Config edits + connector-add: `handleConnectorAddMcp`, `handleConnectorSetInterval`, `handleConnectorSetConfig`. Imports `resumeConnector` / `pauseConnector` / `emitConfigChanged` from `./lifecycle.ts`. | ~150 |
| `removal.ts` | Connector removal lifecycle: `handleConnectorRemove`, `resumePendingRemovals`, `snapshotGoogleOAuthIfLastFamilyMember`, `snapshotMicrosoftOAuthIfLastFamilyMember`, `unregisterConnectorFromSyncScheduler`, `removeConnectorIndexEntries`, `restoreGoogleAndMicrosoftOAuthBackups`. | ~200 |
| `auth.ts` | Auth dispatcher + 18 per-connector flows + OAuth helpers: `handleConnectorAuth`, `oauthScopesFromConnectorRequest`, `oauthRedirectPortFromRec`, `oauthClientConfigForProvider`, `authSuccess`, `connectorAuth{Github,Gitlab,Linear,Discord,Circleci,Aws,Azure,Gcp,Iac,Grafana,Sentry,Newrelic,Datadog,Kubernetes,Pagerduty,Jenkins,Bitbucket,OAuthPkce}`, `persistAwsAccessKeyPair`, `persistAwsProfileOnly`. | ~530 |
| `index.ts` | Pure re-export shim. Re-exports all 12 public handlers + `resumePendingRemovals` + the `ConnectorRpcHandlerContext` type from the 5 sibling files. | ~25 |

### 3.2 Handler-scoped types live in `context.ts`

Currently defined inline in `connector-rpc-handlers.ts`:

```ts
// Line 90
export type ConnectorRpcHit = { kind: "hit"; value: unknown };

// Lines 92-100
export type ConnectorRpcHandlerContext = {
  rec: Record<string, unknown> | undefined;
  vault: NimbusVault;
  localIndex: LocalIndex;
  openUrl: (url: string) => Promise<void>;
  syncScheduler: SyncScheduler | undefined;
  connectorMesh: LazyConnectorMesh | undefined;
  notify?: (method: string, params: Record<string, unknown>) => void;
};
```

Hoist both types verbatim into a dedicated `context.ts` file in the new directory. Every public handler returns `ConnectorRpcHit` and accepts `ConnectorRpcHandlerContext`, so all 5 sibling files import both via:

```ts
import type { ConnectorRpcHandlerContext, ConnectorRpcHit } from "./context.ts";
```

`index.ts` re-exports `ConnectorRpcHandlerContext` for the test file. `ConnectorRpcHit` has no external consumers (verified) — it stays internal to the directory and isn't re-exported.

(Alternative considered: hoist into `connector-rpc-shared.ts`. Rejected — both types are specific to the handlers' control surface, not the shared utilities, so a dedicated file is structurally cleaner.)

### 3.3 Shared lifecycle helpers location

`resumeConnector`, `pauseConnector`, `emitConfigChanged` are used by both `lifecycle.ts` (the public `handleConnectorPause` / `Resume` handlers) and `config.ts` (when `setConfig` flips an `enabled` bit, it calls these helpers internally). They live in `lifecycle.ts`; `config.ts` imports them via sibling import:

```ts
import { emitConfigChanged, pauseConnector, resumeConnector } from "./lifecycle.ts";
```

This is one-way (`config → lifecycle`); no cycle.

### 3.4 `index.ts` re-export shim

```ts
// packages/gateway/src/ipc/connector-rpc-handlers/index.ts

export type { ConnectorRpcHandlerContext } from "./context.ts";
export { handleConnectorAddMcp, handleConnectorSetConfig, handleConnectorSetInterval } from "./config.ts";
export { handleConnectorPause, handleConnectorResume, handleConnectorSync } from "./lifecycle.ts";
export { handleConnectorRemove, resumePendingRemovals } from "./removal.ts";
export { handleConnectorHealthHistory, handleConnectorListStatus, handleConnectorStatus } from "./status.ts";
export { handleConnectorAuth } from "./auth.ts";
```

(Order grouped by source file; alphabetical within each group. Final ordering may shift if Biome reformats.)

### 3.5 Consumer call-site impact

Three files currently import from `./connector-rpc-handlers.ts` (or its `../ipc/connector-rpc-handlers.ts` equivalent):

1. `packages/gateway/src/ipc/connector-rpc.ts:7-18` — imports 11 of the 12 public handlers.
2. `packages/gateway/src/platform/assemble.ts:33` — imports `resumePendingRemovals`.
3. `packages/gateway/src/ipc/connector-rpc-handlers-setconfig.test.ts:4,10` — imports `ConnectorRpcHandlerContext` (type) + `handleConnectorSetConfig` + helpers.

**Impact strategy:** verify Bun's module resolution behavior empirically during plan execution. Two cases:

- **Case A — Bun auto-resolves `./connector-rpc-handlers.ts` to `./connector-rpc-handlers/index.ts`:** Zero edits needed. `.ts` suffix in source-resident imports may need to drop to no-suffix (`./connector-rpc-handlers`) for the directory variant to resolve, in which case the 3 consumer files need a one-token edit each.
- **Case B — Bun does not auto-resolve directory imports:** The 3 consumer files update their import paths to `./connector-rpc-handlers/index.ts` (or the directory form Bun supports — to be confirmed at impl time).

Either case is a small, mechanical edit. The plan's verification step is `bun run typecheck` immediately after the move; any unresolved import surfaces as a TS error.

## 4 — Behavioral guarantees

The split is a pure code-rearrangement refactor. Specifically:

- **Function bodies unchanged.** Each function migrates verbatim from `connector-rpc-handlers.ts` to its target sibling file. No logic edits, no formatting reflows beyond what Biome auto-applies (import ordering / line length).
- **Function signatures unchanged.** All public handlers keep their exact `(ctx: ConnectorRpcHandlerContext) => ...` shape. `resumePendingRemovals` keeps its `(args)` shape.
- **Imports per-file are minimum-needed scope.** Each sibling file imports only what it uses. No "kitchen-sink" imports copied across.
- **Test file location unchanged.** Only its import path is touched (one character per import line, if needed at all).
- **Audit invariants unchanged.** `bun run audit:invariants` exits 0 before and after; D11's `VAULT_KEY_ALLOW_LIST` is unchanged; D10's spawn-rule untouched (no spawns in this file).

## 5 — Tests

No new tests are added. The existing test file (`connector-rpc-handlers-setconfig.test.ts`) covers `handleConnectorSetConfig`'s behavior and remains the authoritative test surface.

**Test verification matrix during plan execution:**

| Suite | Expected |
|---|---|
| `bun test packages/gateway/src/ipc/connector-rpc-handlers-setconfig.test.ts` | Pass count unchanged from main. |
| `bun test packages/gateway/` | Full gateway-suite pass count unchanged from main. |
| `bun run typecheck` | Clean across all packages. |
| `bun run lint` | Clean. |
| `bun run audit:invariants` | Exits 0; D11 = 0. |
| `bun run test:ci` | Gateway/script suites pass (modulo known UI vitest V8 coverage flake). |

## 6 — Acceptance criteria

- [ ] `packages/gateway/src/ipc/connector-rpc-handlers.ts` deleted.
- [ ] `packages/gateway/src/ipc/connector-rpc-handlers/` directory exists with 7 files (`context.ts`, `status.ts`, `lifecycle.ts`, `config.ts`, `removal.ts`, `auth.ts`, `index.ts`).
- [ ] Each sibling file's LOC is within ~10% of the estimates in § 3.1.
- [ ] `index.ts` re-exports all 12 public handlers + `resumePendingRemovals` + `ConnectorRpcHandlerContext` type.
- [ ] `connector-rpc.ts`, `platform/assemble.ts`, and `connector-rpc-handlers-setconfig.test.ts` either need no edits, OR each gets a one-token import-path edit (verified at impl time).
- [ ] All test gates in § 5 pass.
- [ ] No new D4 violations from any of the new files (none of them exceed 800 LOC).

## 7 — Rollout

Single atomic PR. Branch: `dev/asafgolombek/d4-rpc-handlers-split`. Title: `refactor(ipc): D4 — split connector-rpc-handlers into namespace files`. Single commit (or two, if the consumer-import-path edit ends up needed and the engineer prefers to keep the move and the path tweak as separate commits — both are acceptable).

## 8 — Out of scope, captured for future specs

- **Further `auth.ts` decomposition.** If `auth.ts` later exceeds the 800-LOC threshold organically (e.g., a new connector adds another flow), a follow-up D4 split can break it into `auth/dispatcher.ts`, `auth/direct.ts`, `auth/oauth-pkce.ts`. Out of scope here.
- **D4 split of `lazy-mesh.ts` (1408 LOC).** The next sub-project after this spec ships. Will follow the same brainstorm → spec → plan → execute pattern.
- **Cleanup of comment-only TODO's, unused parameters, etc.** Strict mechanical move; cosmetic improvements live in their own follow-up.

## 9 — Review dispositions (2026-05-02 Gemini CLI review)

Recorded for traceability. Source: [`2026-05-02-d4-rpc-handlers-split-review.md`](./2026-05-02-d4-rpc-handlers-split-review.md).

- **§ 3.1 — Move `ConnectorRpcHit` to `context.ts` → ACCEPT.** Applied to spec § 3.1 and § 3.2. `ConnectorRpcHit` is the return type for every public handler (verified at `connector-rpc-handlers.ts:90`); every sibling file will need it. Co-locating with `ConnectorRpcHandlerContext` in `context.ts` is the clean call. No external consumers (verified), so it stays internal to the directory and isn't re-exported by `index.ts`.
- **§ 3.2 — `VALID_DEPTHS` Location → NOTE (already implicitly covered).** Spec § 4 already states "imports trimmed to per-file scope"; the `VALID_DEPTHS` constant (used only in `handleConnectorSetConfig`) moves naturally with that function to `config.ts`. No spec edit.
- **§ 3.3 — Internal helpers location → NOTE (already covered).** Spec § 3.3 already designates `lifecycle.ts` as the owner of `resumeConnector` / `pauseConnector` / `emitConfigChanged`, with `config.ts` importing them via sibling import. No change.
- **§ 3.4 — Consumer edits consistency → NOTE (already covered).** Spec § 3.5 already addresses the 3 consumer files; the implementation plan will detect Bun's resolution behavior and apply consistent edits across all three if needed. No change.
- **§ 4 Q&A — Don't split `auth.ts` further → AGREE.** Spec § 2 (Non-goals) and § 8 (Out of scope) already document this disposition. No change.

## 10 — Provenance

- Phase 2 deferred-backlog: [`docs/structure-audit/deferred-backlog.md`](../../structure-audit/deferred-backlog.md) "D4 — large files" / `connector-rpc-handlers.ts:1103 churn 30 (p80+) Refactor candidate: split by namespace (status / config / oauth / removal) — own design spec".
- Current file: `packages/gateway/src/ipc/connector-rpc-handlers.ts` (1106 LOC after D11 widening across PRs #154, #156).
- Existing consumers: `packages/gateway/src/ipc/connector-rpc.ts`, `packages/gateway/src/platform/assemble.ts`, `packages/gateway/src/ipc/connector-rpc-handlers-setconfig.test.ts`.
- Existing IPC method names (12): `connector.addMcp`, `connector.listStatus`, `connector.pause`, `connector.resume`, `connector.setConfig`, `connector.setInterval`, `connector.status`, `connector.healthHistory`, `connector.remove`, `connector.sync`, `connector.auth`, `connector.startAuth` (deprecated alias of `connector.auth`).
