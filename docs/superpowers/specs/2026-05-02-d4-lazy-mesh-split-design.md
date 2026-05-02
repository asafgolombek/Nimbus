# D4 Split — `lazy-mesh.ts` → namespace directory

**Date:** 2026-05-02
**Phase:** Phase 4 / B3 structure audit — Phase 2 follow-up (D4 deferred-backlog candidate)
**Source:** [`docs/structure-audit/deferred-backlog.md`](../../structure-audit/deferred-backlog.md) "D4 — large files (split candidates)" / `lazy-mesh.ts:1401` row.
**Predecessor specs:**
- [`2026-04-30-structure-audit-design.md`](./2026-04-30-structure-audit-design.md)
- [`2026-05-02-d4-rpc-handlers-split-design.md`](./2026-05-02-d4-rpc-handlers-split-design.md) (sibling — same pattern, different file)
**Predecessor PRs:** [#149](https://github.com/asafgolombek/Nimbus/pull/149), [#155](https://github.com/asafgolombek/Nimbus/pull/155), [#159](https://github.com/asafgolombek/Nimbus/pull/159), [#160](https://github.com/asafgolombek/Nimbus/pull/160)

---

## 1 — Goal

Split the 1428-LOC `packages/gateway/src/connectors/lazy-mesh.ts` into a directory of concern-focused sibling files, with **zero behavioral change** and **zero churn at consumer call sites**. The file is one of the 5 remaining D4 split candidates (>800 raw LOC) in `deferred-backlog.md`. After this PR:

- The largest resulting file is `connector-spawns.ts` at ~550 LOC, well under the 800 D4 threshold.
- The full public surface (`LazyConnectorMesh` class, `createLazyConnectorMesh` factory, `MeshLogger` interface, `LazyDrainTracker` class, `mergeToolMapsOrThrow` function) keeps its existing names + signatures.
- The 10 consumer files importing from `./lazy-mesh.ts` each get a one-token import-path edit to `./lazy-mesh/index.ts` (see § 3.6).
- All audit gates (D4, D10, D11, lint, typecheck, tests) stay green.

This is the second of six D4 splits in the deferred-backlog. The next candidates are `ipc/server.ts` (1239 LOC), `cli/commands/connector.ts` (1238 LOC), `index/local-index.ts` (987 LOC), and `auth/pkce.ts` (886 LOC).

## 2 — Non-goals

- **No behavioral changes.** Every function migrates verbatim — same logic, same imports (trimmed to per-file scope), same control flow. The only mechanical change to function bodies is `this.vault` → `ctx.vault` (or equivalent) for the `ensureXxx` family that moves to free functions; see § 3.4.
- **No restructuring of the slot state machine.** `LazyMcpSlot`, the per-slot map (`lazySlots: Map<string, LazyMcpSlot>`), the idle-timer + drain-tracker logic, and `bumpToolsEpoch` all stay on the `LazyConnectorMesh` class. Class is the state owner.
- **No collapsing of the 16 per-connector `ensureXxxRunning` methods into a single generic runner.** Each preserves its exact branch structure (e.g., the `try/catch` in `ensureSlackRunning` and `ensureNotionRunning`, the cred-shape variations across Jira/Confluence/Jenkins, the disabled-by-default opt-in for Discord). A generic runner would require subtle behavior unification we are not signing up for in this PR.
- **No new tests.** The two existing tests (`lazy-mesh.test.ts`, `lazy-mesh-args-json.test.ts`) cover the surface; the move is mechanical and exercised by the existing suite. Test imports follow the same one-token edit policy as production consumers (§ 3.6).
- **No D4 split of the 4 remaining large files.** Each gets its own design spec.

## 3 — Architecture changes

### 3.1 Directory replaces file

Delete `packages/gateway/src/connectors/lazy-mesh.ts`. Create `packages/gateway/src/connectors/lazy-mesh/` containing:

| File | Responsibility | LOC est. |
|---|---|---|
| `drain.ts` | `LazyDrainTracker` class — verbatim move. Standalone, no internal deps. | ~30 |
| `keys.ts` | Module-level constants and key helpers: `LAZY_MESH`, `USER_MESH_PREFIX`, `MCP_CONNECTORS_ROOT`, `_LAZY_MESH_DIR`, `mcpConnectorServerScript()`, `userMcpMeshKey()`. **Note:** `_LAZY_MESH_DIR` is now one directory deeper than the original `lazy-mesh.ts`, so `MCP_CONNECTORS_ROOT` must change `join(_LAZY_MESH_DIR, "..", "..", "..", "mcp-connectors")` → `join(_LAZY_MESH_DIR, "..", "..", "..", "..", "mcp-connectors")` (one extra `..`) so it still resolves to `packages/mcp-connectors`. This is the **only non-verbatim line** in the file move; the path-correctness check is a hard test gate (§ 4) — if it regresses, every Phase-3 / per-connector spawn loads the wrong server script. | ~35 |
| `tool-map.ts` | Tool-listing types and helpers: `LazyMeshToolMap` type, `listLazyMeshClientTools()`, `mergeToolMapsOrThrow()`. | ~45 |
| `slot.ts` | `LazyMcpSlot` type + `ServerSpec` type (the `{ command, args, env }` shape used by `phase3-config.ts` and `connector-spawns.ts` — hoisted here once instead of repeated inline) + `MeshLogger` interface (co-located with its primary consumer `MeshSpawnContext` per spec-review § 2.2) + `MeshSpawnContext` interface (§ 3.3). | ~55 |
| `phase3-config.ts` | All 8 `phase3AddXxxMcp` functions (AWS, Azure, GCP, IaC, Grafana, Sentry, NewRelic, Datadog) lifted to module-level functions taking `(vault, servers)`, plus `buildPhase3Servers(vault)`. Pure server-config builders — no slot state, no MCPClient instantiation. | ~220 |
| `connector-spawns.ts` | All 16 per-connector spawn ensure functions lifted to free functions taking `MeshSpawnContext`: `ensureGoogleDriveMcp`, `ensureMicrosoftBundleMcp`, `ensureGithubMcp`, `ensureGitlabMcp`, `ensureBitbucketMcp`, `ensureSlackMcp`, `ensureLinearMcp`, `ensureJiraMcp`, `ensureNotionMcp`, `ensureConfluenceMcp`, `ensureDiscordMcp`, `ensureJenkinsMcp`, `ensureCircleciMcp`, `ensurePagerdutyMcp`, `ensureKubernetesMcp`, `ensurePhase3BundleMcp`. | ~550 |
| `user-mcp.ts` | User-MCP-specific helpers: `mcpServerKeyForUserConnector()`, `recordArgsJsonFailure()`, `ensureUserMcpClient()`, `ensureUserMcpConnectorsRunning()`, all as free functions. They take the wider `MeshSpawnContext` (which carries `logger?` and `healthDb?` — see § 3.3) plus a `listUserMcpConnectors` reader callback. | ~110 |
| `credential-orchestration.ts` | Conditional ensure-helpers: `ensureCredentialConnectorsRunning()` (the orchestrator) plus the 11 `ensureIfXxx` wrappers (`ensureIfConnectorSecretSet`, `ensureIfProviderOAuthSet`, `ensureIfGoogleOAuthPresent`, `ensureBitbucketIfVaultCreds`, `ensureJiraIfVaultCreds`, `ensureConfluenceIfVaultCreds`, `ensureDiscordIfOptIn`, `ensureJenkinsIfVaultCreds`, `ensureCircleciIfVaultCreds`, `ensurePagerdutyIfVaultCreds`, `ensureKubernetesIfVaultCreds`). All free functions taking `MeshSpawnContext`. | ~110 |
| `mesh.ts` | `LazyConnectorMesh` class itself: state ownership (filesystem MCP, lazy-slot map, vault, paths, healthDb, logger, toolsEpoch), the slot state-machine private methods (`lazySlot`, `getLazyClient`, `setLazyClient`, `clearLazyIdle`, `scheduleLazyDisconnect`, `stopLazyClient`, `stopUserMcpClient`, `bumpToolsEpoch`), the public class methods (`stopExtensionClient`, `ensureUserMcpRunning`, all 14 `ensureXxxRunning` shells, `listToolsForDispatcher`, `listTools`, `disconnect`, `getToolsEpoch`), tool-aggregation helpers (`collectBuiltInToolMaps`, `collectUserMcpToolMap`, `buildSlotForToolMap`, `wrapMergedToolsWithRefcount`), plus `createLazyConnectorMesh()` factory. | ~280 |
| `index.ts` | Pure re-export shim. Re-exports `LazyConnectorMesh` (value + type), `createLazyConnectorMesh`, `MeshLogger`, `LazyDrainTracker`, `mergeToolMapsOrThrow` for the 11 existing consumers. | ~25 |

Total: ~1450 LOC across 10 files (slightly higher than the current 1428 due to interface boilerplate and a few `import` repetitions; well-distributed — no single file >550).

### 3.2 Public surface preservation

The `lazy-mesh/index.ts` shim re-exports everything currently imported across the codebase (verified 2026-05-02 with `grep -rn "from.*lazy-mesh" packages/`):

```ts
// packages/gateway/src/connectors/lazy-mesh/index.ts

export { createLazyConnectorMesh, LazyConnectorMesh } from "./mesh.ts";
export { LazyDrainTracker } from "./drain.ts";
export type { MeshLogger } from "./slot.ts";
export { mergeToolMapsOrThrow } from "./tool-map.ts";
```

(Order grouped by source file. Final ordering may shift if Biome reformats.)

`LazyMeshToolMap` is internal and not re-exported (verified: zero external consumers).

### 3.3 The `MeshSpawnContext` interface (key design decision)

The class cannot be split across files in TypeScript. To extract the per-connector spawn methods (the bulk of the file at ~700 LOC) without exposing the slot state-machine as part of the public class API, we introduce a typed internal interface:

```ts
// packages/gateway/src/connectors/lazy-mesh/slot.ts

export type LazyMcpSlot = {
  client: MCPClient | undefined;
  idleTimer: ReturnType<typeof setTimeout> | undefined;
  drain: LazyDrainTracker;
};

export type ServerSpec = {
  command: string;
  args: string[];
  env: Record<string, string>;
};

/** Minimal logger shape — accepts the pino `(bindings, msg)` form. */
export interface MeshLogger {
  warn(bindings: Record<string, unknown>, msg?: string): void;
}

/**
 * Internal collaborator interface — wraps the slot state-machine on
 * `LazyConnectorMesh` so per-connector spawn functions can live in sibling
 * files without `this.` access. Not exported from `index.ts`.
 *
 * `logger` and `healthDb` are optional and used only by `recordArgsJsonFailure`
 * in `user-mcp.ts`; carrying them on the context (rather than threading them
 * through every helper) mirrors how the class currently passes them around
 * implicitly via `this`.
 */
export interface MeshSpawnContext {
  readonly vault: NimbusVault;
  readonly logger?: MeshLogger;
  readonly healthDb?: import("bun:sqlite").Database;
  clearLazyIdle(key: string): void;
  getLazyClient(key: string): MCPClient | undefined;
  setLazyClient(key: string, client: MCPClient): void;
  bumpToolsEpoch(): void;
  scheduleLazyDisconnect(key: string): void;
}
```

**`LazyConnectorMesh` exposes itself as `MeshSpawnContext` via a single stable object built once in the constructor:**

```ts
// On the class in mesh.ts, in the constructor:
this.spawnContext = {
  vault: this.vault,
  logger: this.logger,
  healthDb: this.healthDb,
  clearLazyIdle: (k) => this.clearLazyIdle(k),
  getLazyClient: (k) => this.getLazyClient(k),
  setLazyClient: (k, c) => this.setLazyClient(k, c),
  bumpToolsEpoch: () => this.bumpToolsEpoch(),
  scheduleLazyDisconnect: (k) => this.scheduleLazyDisconnect(k),
};
```

Constructor-bound (rather than per-call getter) avoids per-call object allocation on the hot `listToolsForDispatcher` path and keeps the `MeshSpawnContext` identity stable for any downstream Map keys / equality checks (none exist today; future-proofing is cheap).

Free functions in `connector-spawns.ts`, `phase3-config.ts`, `credential-orchestration.ts`, and `user-mcp.ts` accept `MeshSpawnContext` (or the narrower subset they need). The interface mirrors the existing private method signatures verbatim — no behavior change. It is **not** re-exported from `index.ts`; it is module-internal.

### 3.4 Per-connector spawn function shape

Each `ensureXxxRunning` method on the class becomes a thin shell:

```ts
// On the class in mesh.ts:
async ensureGithubRunning(): Promise<void> {
  return ensureGithubMcp(this.spawnContext);
}
```

Where `ensureGithubMcp` is the free function in `connector-spawns.ts`:

```ts
// connector-spawns.ts
export async function ensureGithubMcp(ctx: MeshSpawnContext): Promise<void> {
  const slotKey = LAZY_MESH.github;
  ctx.clearLazyIdle(slotKey);
  if (ctx.getLazyClient(slotKey) !== undefined) {
    ctx.scheduleLazyDisconnect(slotKey);
    return;
  }
  const pat = await readConnectorSecret(ctx.vault, "github", "pat");
  if (pat === null || pat === "") {
    return;
  }
  ctx.setLazyClient(
    slotKey,
    new MCPClient({
      id: `nimbus-github-${randomUUID()}`,
      servers: {
        github: {
          command: "bun",
          args: [mcpConnectorServerScript("github")],
          env: extensionProcessEnv({ GITHUB_PAT: pat }),
        },
        github_actions: {
          command: "bun",
          args: [mcpConnectorServerScript("github-actions")],
          env: extensionProcessEnv({ GITHUB_PAT: pat }),
        },
      },
    }),
  );
  ctx.bumpToolsEpoch();
  ctx.scheduleLazyDisconnect(slotKey);
}
```

The body is verbatim from `lazy-mesh.ts:678-709` with only the `this.vault` → `ctx.vault` and `this.<helper>(...)` → `ctx.<helper>(...)` substitutions. All 16 per-connector functions follow this pattern.

(The naming `ensureXxxMcp` for the free function vs. `ensureXxxRunning` for the class shell is deliberate to keep them distinguishable in stack traces and grep results during the refactor.)

### 3.5 Phase 3 helpers stay pure

The 8 `phase3AddXxxMcp` methods already only depend on `this.vault` and the `servers` parameter. They lift cleanly to module-level functions taking `(vault: NimbusVault, servers: Record<...>)`:

```ts
// phase3-config.ts
export async function phase3AddAwsMcp(
  vault: NimbusVault,
  servers: Record<string, ServerSpec>,
): Promise<void> {
  // body verbatim from lazy-mesh.ts:374-404, this.vault → vault
}

export async function buildPhase3Servers(
  vault: NimbusVault,
): Promise<Record<string, ServerSpec>> {
  const servers: Record<string, ServerSpec> = {};
  await phase3AddAwsMcp(vault, servers);
  await phase3AddAzureMcp(vault, servers);
  // ...
  return servers;
}
```

`ServerSpec` is hoisted to `slot.ts` (§ 3.3) as a single named export consumed by `phase3-config.ts` and `connector-spawns.ts` — replaces ~17 inline repetitions of the `{ command: string; args: string[]; env: Record<string, string> }` shape in the source file.

`ensurePhase3BundleMcp` (in `connector-spawns.ts`) calls `buildPhase3Servers(ctx.vault)` to assemble the server map, then runs the standard slot-spawn sequence.

### 3.6 Consumer call-site impact

10 files currently import from `./lazy-mesh.ts` (or its `../connectors/lazy-mesh.ts` equivalent), verified 2026-05-02 via `grep -rln "from.*lazy-mesh" packages/`:

1. `packages/gateway/src/connectors/lazy-mesh.test.ts` — `LazyDrainTracker`, `mergeToolMapsOrThrow`
2. `packages/gateway/src/connectors/lazy-mesh-args-json.test.ts` — `LazyConnectorMesh`, `MeshLogger`
3. `packages/gateway/src/connectors/registry.ts` — `createLazyConnectorMesh`, `LazyConnectorMesh` (type) + re-export (2 import statements in this single file)
4. `packages/gateway/src/ipc/connector-rpc-handlers/context.ts` — `LazyConnectorMesh` (type)
5. `packages/gateway/src/ipc/connector-rpc.ts` — `LazyConnectorMesh` (type)
6. `packages/gateway/src/ipc/server.ts` — `LazyConnectorMesh` (type)
7. `packages/gateway/src/platform/assemble-sync-registrations.ts` — `LazyConnectorMesh` (type)
8. `packages/gateway/src/platform/assemble.ts` — `createLazyConnectorMesh`, `LazyConnectorMesh` (type)
9. `packages/gateway/src/platform/register-user-mcp-sync.ts` — `LazyConnectorMesh` (type)
10. `packages/gateway/src/platform/types.ts` — `LazyConnectorMesh` (type)

**Impact strategy:** Bun keeps the `.ts` suffix explicit in imports and does not auto-resolve `./lazy-mesh.ts` to `./lazy-mesh/index.ts`. The predecessor sibling split (connector-rpc-handlers, PR #160) confirmed this empirically — all 3 of its consumer files were updated to `./connector-rpc-handlers/index.ts`. We assume the same outcome here:

**All 10 consumer files get a one-token edit**, changing `./lazy-mesh.ts` → `./lazy-mesh/index.ts` (or the `../connectors/lazy-mesh.ts` equivalent → `../connectors/lazy-mesh/index.ts`). `bun run typecheck` after the move is the gate; if it surfaces any unresolved import, the consumer file is updated in the same commit.

## 4 — Behavioral guarantees

The split is a pure code-rearrangement refactor. Specifically:

- **Function bodies unchanged.** Every per-connector spawn body is verbatim from the current file, with only `this.vault` → `ctx.vault` and `this.<slotMethod>(key)` → `ctx.<slotMethod>(key)` substitutions. All `try/catch` blocks, all early-return shapes, all string literals are preserved.
- **Relative imports get one `..` deeper.** Every file in the new directory lives one level below the original `lazy-mesh.ts`, so `../X` imports become `../../X` (e.g., `../auth/google-access-token.ts` → `../../auth/google-access-token.ts`) and `./Y` imports become `../Y` (e.g., `./connector-vault.ts` → `../connector-vault.ts`). ~15 such imports in the source file. Mechanical, but the path-resolution variant of `MCP_CONNECTORS_ROOT` (§ 3.1) is the load-bearing one — get that wrong and every spawn fails.
- **Public class signatures unchanged.** All 16 `ensureXxxRunning()` methods, `ensureUserMcpRunning(serviceId)`, `stopExtensionClient(extensionId)`, `listTools()`, `listToolsForDispatcher()`, `disconnect()`, `getToolsEpoch()` keep their exact signatures. The constructor is unchanged. The factory `createLazyConnectorMesh` is unchanged.
- **Slot state ownership unchanged.** The class still owns `lazySlots: Map<string, LazyMcpSlot>`, the filesystem MCP client, the toolsEpoch counter, the healthDb, and the logger. The `MeshSpawnContext` interface is a thin facade — no state moves out.
- **Test files unchanged in location and name.** Only their import paths may need a one-token edit (§ 3.6). No new tests, no test logic changes.
- **Audit invariants unchanged.** `bun run audit:invariants` exits 0 before and after. D11's allow-list (6 entries) is unchanged. D10's spawn-rule is satisfied because every spawn site still runs through `extensionProcessEnv()` — those code locations move with the function bodies.

## 5 — Tests

No new tests are added. The existing two test files cover the public surface:

- `lazy-mesh.test.ts` — `mergeToolMapsOrThrow` collision + merge behavior; `LazyDrainTracker` bump/drop/awaitDrain semantics.
- `lazy-mesh-args-json.test.ts` — `LazyConnectorMesh.ensureUserMcpRunning` malformed-args_json health-transition path.

**Test verification matrix during plan execution:**

| Suite | Expected |
|---|---|
| `bun test packages/gateway/src/connectors/lazy-mesh.test.ts` | Pass count unchanged from main. |
| `bun test packages/gateway/src/connectors/lazy-mesh-args-json.test.ts` | Pass count unchanged from main. |
| `bun test packages/gateway/` | Full gateway-suite pass count unchanged from main. |
| `bun run typecheck` | Clean across all packages. |
| `bun run lint` | Clean. |
| `bun run audit:invariants` | Exits 0; D10 = 0, D11 = 0. |
| `bun run test:ci` | Full CI parity — all gateway / scripts / sdk / mcp suites pass (modulo known UI vitest V8 coverage flake). |

## 6 — Acceptance criteria

- [ ] `packages/gateway/src/connectors/lazy-mesh.ts` deleted.
- [ ] `packages/gateway/src/connectors/lazy-mesh/` directory exists with 10 files (`drain.ts`, `keys.ts`, `tool-map.ts`, `slot.ts`, `phase3-config.ts`, `connector-spawns.ts`, `user-mcp.ts`, `credential-orchestration.ts`, `mesh.ts`, `index.ts`).
- [ ] Each sibling file's LOC is within ~15% of the estimates in § 3.1.
- [ ] No file in the new directory exceeds 800 LOC (D4 threshold).
- [ ] `index.ts` re-exports `LazyConnectorMesh` (value + type), `createLazyConnectorMesh`, `MeshLogger`, `LazyDrainTracker`, `mergeToolMapsOrThrow`.
- [ ] Each of the 10 consumer files gets its `./lazy-mesh.ts` import updated to `./lazy-mesh/index.ts`.
- [ ] `MCP_CONNECTORS_ROOT` in `keys.ts` resolves to `packages/mcp-connectors` (verified by adding a one-line `console.log` during dev or by an `import.meta.resolve`-based assertion that gets removed before commit). Hard test gate — a regression here silently breaks every spawn.
- [ ] All test gates in § 5 pass.
- [ ] `MeshSpawnContext` and `ServerSpec` are module-internal — not present in `index.ts`'s export surface.

## 7 — Rollout

Single atomic PR. Branch: `dev/asafgolombek/d4-lazy-mesh-split`. Title: `refactor(connectors): D4 — split lazy-mesh.ts into namespace directory`. The PR may contain 1–3 commits depending on how the engineer organises the move (e.g., one commit for new files, one for `lazy-mesh.ts` deletion + consumer-edit, one for any Biome reflow). All commits land together in a single squash-merge or merge-commit.

Spec → review → plan → review → impl follows the predecessor sibling pattern (PR #159 spec/plan, PR #160 impl).

## 8 — Out of scope, captured for future specs

- **Further `connector-spawns.ts` decomposition.** If the file grows past 800 LOC organically (a 17th connector landing, or per-connector logic complexity bloating individual functions), a follow-up D4 split can break it into per-bundle subdirectories (`spawns/google.ts`, `spawns/microsoft.ts`, `spawns/dev.ts`, `spawns/comms.ts`, `spawns/devops.ts`). Out of scope here.
- **Generic `spawnIfConfigured` runner.** A unifying helper that takes `(slotKey, idPrefix, configBuilder)` and runs the slot prelude/postlude could collapse all 16 ensure functions into 3-line shells. We deliberately do not introduce this in the same PR — it has subtle behavior-equivalence risk (try/catch placement, early-exit ordering, opt-in flag handling for Discord/IaC) and would distract the reviewer from validating the mechanical split. Captured as a possible follow-up.
- **D4 splits of the 4 remaining large files.** `ipc/server.ts`, `cli/commands/connector.ts`, `index/local-index.ts`, `auth/pkce.ts` each get their own design spec.
- **Cleanup of comment-only TODO's, unused parameters, etc.** Strict mechanical move; cosmetic improvements live in their own follow-up.

## 9 — Review dispositions (2026-05-02 Gemini CLI review)

Recorded for traceability. Source: [`2026-05-02-d4-lazy-mesh-split-feedback.md`](./2026-05-02-d4-lazy-mesh-split-feedback.md).

- **§ 1.1 — `MCP_CONNECTORS_ROOT` `..`-count adjustment → ACCEPT (already in spec).** Spec § 3.1's `keys.ts` row already documents the path-count change from 3 to 4 and flags it as the only non-verbatim line. Plan Task 4 Step 2 has a runtime `existsSync` gate. No change.
- **§ 1.2 — Add `logger?` + `healthDb?` to `MeshSpawnContext` → ACCEPT (already in spec).** Spec § 3.3's interface block already carries both as optional readonly fields. No change.
- **§ 1.3 — Add `listUserMcpConnectors` to `MeshSpawnContext` → DECLINE.** The only consumer of `listUserMcpConnectors` is `ensureUserMcpConnectorsRunning`, which we kept on the class (Option A in plan Task 8) because it iterates `this.lazySlots.keys()` directly. Adding `listUserMcpConnectors` to the context would widen the interface surface for no caller benefit. The class still owns this callback and uses it through `this.listUserMcpConnectors`.
- **§ 2.1 — Hoist `ServerSpec` to `slot.ts` → ACCEPT (already in spec).** Spec § 3.3 + § 3.5 already place `ServerSpec` in `slot.ts` as a single named export. No change.
- **§ 2.2 — Move `MeshLogger` from `tool-map.ts` to `slot.ts` → ACCEPT.** Applied to spec § 3.1 (file table now lists `MeshLogger` under `slot.ts`, no longer under `tool-map.ts`), § 3.2 (re-export shim now sources `MeshLogger` from `./slot.ts`), and § 3.3 (interface block now defines `MeshLogger` directly above `MeshSpawnContext`). Co-locates the logger interface with its primary consumer; eliminates the `slot.ts → tool-map.ts` import edge; keeps `tool-map.ts` purely about tool maps.
- **§ 2.3 — `LazyMeshToolMap` exported from `tool-map.ts` → ACCEPT (in plan).** Plan Task 3 already directs adding `export` to `LazyMeshToolMap` when moving (the original is unexported). Spec § 3.2 already documents that it stays internal — i.e. exported from `tool-map.ts` for sibling consumption but not re-exported by `index.ts`. No spec change.
- **§ 2.4 — Auth/utility imports distribution → ACCEPT (in plan).** Plan's "Per-file external import sets" section enumerates each file's required imports explicitly. No change.

## 10 — Provenance

- Phase 2 deferred-backlog: [`docs/structure-audit/deferred-backlog.md`](../../structure-audit/deferred-backlog.md) "D4 — large files" / `lazy-mesh.ts:1401 churn 37 (p80+) Refactor candidate: split MCP-spawn-config from server-record state machine — by-concern preserves single export surface; own design spec`.
- Current file: `packages/gateway/src/connectors/lazy-mesh.ts` (1428 LOC after D11 widening across PRs #149, #155).
- Existing consumers: 10 files (enumerated in § 3.6).
- Sibling D4 split (predecessor pattern): [`2026-05-02-d4-rpc-handlers-split-design.md`](./2026-05-02-d4-rpc-handlers-split-design.md), PRs [#159](https://github.com/asafgolombek/Nimbus/pull/159) (spec) and [#160](https://github.com/asafgolombek/Nimbus/pull/160) (impl).
