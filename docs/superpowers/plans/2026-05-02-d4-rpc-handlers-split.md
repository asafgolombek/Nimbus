# D4 Split — `connector-rpc-handlers.ts` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 1106-LOC `packages/gateway/src/ipc/connector-rpc-handlers.ts` with a `connector-rpc-handlers/` directory of namespace-focused sibling files. Pure mechanical move; zero behavioral change.

**Architecture:** Single atomic PR. Create 7 new files inside `packages/gateway/src/ipc/connector-rpc-handlers/` (`context.ts`, `status.ts`, `lifecycle.ts`, `config.ts`, `removal.ts`, `auth.ts`, `index.ts`); delete the original file; update 3 consumer import paths from `./connector-rpc-handlers.ts` (file) to `./connector-rpc-handlers/index.ts` (directory entry point). All function bodies migrate verbatim; per-file imports trim to the minimum scope needed.

**Tech Stack:** TypeScript 6.x strict / Bun v1.2 / `bun:test` / Biome lint / project-local `.worktrees/` for isolation.

**Spec:** [`docs/superpowers/specs/2026-05-02-d4-rpc-handlers-split-design.md`](../specs/2026-05-02-d4-rpc-handlers-split-design.md)

**Branch:** `dev/asafgolombek/d4-rpc-handlers-split` (from `main`).
**Worktree:** `.worktrees/d4-rpc-handlers-split`.
**Commit count:** 1 (atomic).

---

## Authoritative function-to-file map

The current file has **2 types + 28 functions**. Line ranges below are pre-migration; verify with `grep -n "^export\|^function\|^async function" packages/gateway/src/ipc/connector-rpc-handlers.ts` if line numbers feel off (no other PR should have touched the file between this plan being written and this PR being executed).

| Symbol | Line range | Goes to |
|---|---|---|
| `oauthScopesFromConnectorRequest` | 60–75 | `auth.ts` |
| `oauthRedirectPortFromRec` | 77–88 | `auth.ts` |
| `ConnectorRpcHit` (type) | 90 | `context.ts` |
| `ConnectorRpcHandlerContext` (type) | 92–100 | `context.ts` |
| `handleConnectorAddMcp` | 102–141 | `config.ts` |
| `handleConnectorListStatus` | 142–158 | `status.ts` |
| `handleConnectorPause` | 159–170 | `lifecycle.ts` |
| `handleConnectorResume` | 171–182 | `lifecycle.ts` |
| `handleConnectorSetInterval` | 183–198 | `config.ts` |
| `emitConfigChanged` | 199–215 | `lifecycle.ts` |
| `resumeConnector` | 216–228 | `lifecycle.ts` |
| `pauseConnector` | 229–242 | `lifecycle.ts` |
| `handleConnectorSetConfig` | 243–293 | `config.ts` |
| `handleConnectorStatus` | 294–312 | `status.ts` |
| `handleConnectorHealthHistory` | 313–333 | `status.ts` |
| `snapshotGoogleOAuthIfLastFamilyMember` | 334–355 | `removal.ts` |
| `snapshotMicrosoftOAuthIfLastFamilyMember` | 356–370 | `removal.ts` |
| `unregisterConnectorFromSyncScheduler` | 371–383 | `removal.ts` |
| `removeConnectorIndexEntries` | 384–392 | `removal.ts` |
| `restoreGoogleAndMicrosoftOAuthBackups` | 393–407 | `removal.ts` |
| `handleConnectorRemove` | 408–451 | `removal.ts` |
| `resumePendingRemovals` | 452–476 | `removal.ts` |
| `handleConnectorSync` | 477–491 | `lifecycle.ts` |
| `authSuccess` | 492–502 | `auth.ts` |
| `connectorAuthGithub` | 503–521 | `auth.ts` |
| `connectorAuthGitlab` | 522–543 | `auth.ts` |
| `connectorAuthLinear` | 544–559 | `auth.ts` |
| `connectorAuthDiscord` | 560–586 | `auth.ts` |
| `connectorAuthCircleci` | 587–602 | `auth.ts` |
| `persistAwsAccessKeyPair` | 603–629 | `auth.ts` |
| `persistAwsProfileOnly` | 630–636 | `auth.ts` |
| `connectorAuthAws` | 637–667 | `auth.ts` |
| `connectorAuthAzure` | 668–692 | `auth.ts` |
| `connectorAuthGcp` | 693–718 | `auth.ts` |
| `connectorAuthIac` | 719–737 | `auth.ts` |
| `connectorAuthGrafana` | 738–768 | `auth.ts` |
| `connectorAuthSentry` | 769–798 | `auth.ts` |
| `connectorAuthNewrelic` | 799–824 | `auth.ts` |
| `connectorAuthDatadog` | 825–853 | `auth.ts` |
| `connectorAuthKubernetes` | 854–878 | `auth.ts` |
| `connectorAuthPagerduty` | 879–894 | `auth.ts` |
| `connectorAuthJenkins` | 895–928 | `auth.ts` |
| `connectorAuthBitbucket` | 929–950 | `auth.ts` |
| `oauthClientConfigForProvider` | 951–982 | `auth.ts` |
| `connectorAuthOAuthPkce` | 983–1095 | `auth.ts` |
| `handleConnectorAuth` | 1096–1106 | `auth.ts` |

---

## Per-file external import sets

Each new file needs a subset of the original's external imports. The implementer should copy each `import` statement from the original file's lines 1–58 only when the moved code actually uses it. After file creation, `bun run typecheck` verifies completeness — any missing import surfaces as a TS error.

To determine what each new file needs:
- **`context.ts`** uses 4 types: `NimbusVault`, `LocalIndex`, `SyncScheduler`, `LazyConnectorMesh`. Pure type imports.
- **`status.ts`** uses (from existing original imports): `requireRegisteredSchedulerServiceId`, `resolveConnectorListFilterServiceId`, `getConnectorHealthHistory`, `SyncStatus`, `parseServiceArg`, `ConnectorServiceId`, `normalizeConnectorServiceId`, `ConnectorRpcError`, plus internal `ConnectorRpcHandlerContext` + `ConnectorRpcHit` from `./context.ts`.
- **`lifecycle.ts`** uses: `parseServiceArg`, `requireRegisteredSchedulerServiceId`, `MIN_SYNC_INTERVAL_MS`, `defaultSyncIntervalMsForService`, `ConnectorServiceId`, `ConnectorRpcError`, plus internal context types.
- **`config.ts`** uses: same as `lifecycle.ts` plus `Config`, `parseUserMcpCommandLine`, `validateUserMcpArgsJson`, `normalizeUserMcpServiceId`, `insertUserMcpConnector`, `createUserMcpSyncable`, `defaultSyncIntervalMsForService`, `MIN_SYNC_INTERVAL_MS`. **Plus internal:** `emitConfigChanged`, `pauseConnector`, `resumeConnector` from `./lifecycle.ts`.
- **`removal.ts`** uses: `Database`, `ConnectorServiceId`, `GOOGLE_CONNECTOR_SERVICES`, `MICROSOFT_CONNECTOR_SERVICES`, `normalizeConnectorServiceId`, `oauthProfileForService`, `clearConnectorVaultSecretKeys`, `ALL_GOOGLE_OAUTH_VAULT_KEYS`, `clearOAuthVaultIfProviderUnused`, `sharedOAuthKey`, `writePerServiceOAuthKey`, `clearRemoveIntent`, `getPendingRemoveIntents`, `writeRemoveIntent`, `deleteUserMcpConnector`, `LazyConnectorMesh`, `LocalIndex`, `SyncScheduler`, `listRecentSyncTelemetry`, `parseServiceArg`, `requireRegisteredSchedulerServiceId`, `sumItemsSiblingServices`, `ConnectorRpcError`. **Plus** `defaultSyncIntervalMsForService` is NOT used here (only by config/lifecycle).
- **`auth.ts`** uses: all OAuth help-message constants (`GOOGLE_OAUTH_CLIENT_ID_HELP`, `MICROSOFT_OAUTH_CLIENT_ID_HELP`, `NOTION_OAUTH_CLIENT_ID_HELP`, `NOTION_OAUTH_CLIENT_SECRET_HELP`, `SLACK_OAUTH_CLIENT_ID_HELP`), `PKCEOptions`, `runPKCEFlow`, `Config`, `ConnectorServiceId`, `defaultSyncIntervalMsForService`, `oauthProfileForService`, `normalizeConnectorServiceId`, `deleteConnectorSecret`, `writeConnectorSecret`, `writePerServiceOAuthKey`, `LocalIndex`, `stripTrailingSlashes`, `MIN_SYNC_INTERVAL_MS`, `NimbusVault`, `parseAtlassianSiteCredentials`, `parseServiceArg`, `registerAtlassianApiConnectorAuth`, `requireRegisteredSchedulerServiceId`, `ConnectorRpcError`.
- **`index.ts`** has zero external imports — only re-exports from siblings.

The lists above are guidance, not exhaustive. The authoritative process: copy a function, see what symbol names appear in its body, find the matching import line in the original, copy that import too. Then typecheck.

---

## Tasks

### Task 1: Set up the PR worktree

**Files:** none (workspace setup)

- [ ] **Step 1: Sync main**

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
```

Expected: at `b3dd07e` or later.

- [ ] **Step 2: Create the worktree**

```bash
git worktree add -b dev/asafgolombek/d4-rpc-handlers-split .worktrees/d4-rpc-handlers-split main
cd .worktrees/d4-rpc-handlers-split
bun install
```

Expected: `~2130 packages installed`.

- [ ] **Step 3: Verify the source file's pre-migration state**

```bash
wc -l packages/gateway/src/ipc/connector-rpc-handlers.ts
grep -c "^export" packages/gateway/src/ipc/connector-rpc-handlers.ts
```

Expected: `1106` LOC, `13` `export` statements (12 public handlers + `ConnectorRpcHandlerContext` + `ConnectorRpcHit` + `resumePendingRemovals` − let the actual count guide you; the precise number is less important than confirming non-zero).

- [ ] **Step 4: Verify the audit baseline**

```bash
bun run audit:invariants
```

Expected: exits 0 with no D11 hits.

- [ ] **Step 5: Run the existing test suite to capture baseline pass counts**

```bash
bun test packages/gateway/src/ipc/connector-rpc-handlers-setconfig.test.ts 2>&1 | tail -5
bun test packages/gateway/ 2>&1 | tail -5
```

Note the pass counts — they are the baseline that must be unchanged after the move.

### Task 2: Create the directory and `context.ts`

**Files:**
- Create: `packages/gateway/src/ipc/connector-rpc-handlers/context.ts`

- [ ] **Step 1: Create the directory structure**

```bash
mkdir -p packages/gateway/src/ipc/connector-rpc-handlers
```

- [ ] **Step 2: Write `context.ts`**

Create the file with these exact contents:

```ts
import type { LazyConnectorMesh } from "../../connectors/lazy-mesh.ts";
import type { LocalIndex } from "../../index/local-index.ts";
import type { SyncScheduler } from "../../sync/scheduler.ts";
import type { NimbusVault } from "../../vault/nimbus-vault.ts";

export type ConnectorRpcHit = { kind: "hit"; value: unknown };

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

Note the import paths: from `connector-rpc-handlers/context.ts`, the `..` goes UP to `ipc/`, then UP again to `gateway/src/`, so the existing `../connectors/...` paths from the parent file become `../../connectors/...` etc.

- [ ] **Step 3: Typecheck the new file in isolation**

```bash
bun run typecheck 2>&1 | tail -5
```

Expected: clean (the new file is syntactically valid; the original file is unchanged so the rest of the workspace still typechecks).

### Task 3: Create `status.ts`

**Files:**
- Create: `packages/gateway/src/ipc/connector-rpc-handlers/status.ts`

- [ ] **Step 1: Read the original file to extract the 3 status handler bodies**

```bash
sed -n '142,158p;294,333p' packages/gateway/src/ipc/connector-rpc-handlers.ts > /tmp/status-bodies.ts
cat /tmp/status-bodies.ts
```

This dumps the 3 handler bodies to a scratch file. Use them as the source of truth for the function bodies you'll paste into `status.ts`.

- [ ] **Step 2: Write `status.ts`**

The file's contents should be (in order):

```ts
import { getConnectorHealthHistory } from "../../connectors/health.ts";
import {
  type ConnectorServiceId,
  normalizeConnectorServiceId,
} from "../../connectors/connector-catalog.ts";
import type { SyncStatus } from "../../sync/types.ts";
import {
  ConnectorRpcError,
  parseServiceArg,
  requireRegisteredSchedulerServiceId,
  resolveConnectorListFilterServiceId,
} from "../connector-rpc-shared.ts";
import type { ConnectorRpcHandlerContext, ConnectorRpcHit } from "./context.ts";

// ─── handleConnectorListStatus (was lines 142-158) ───────────────────────────
[paste body of handleConnectorListStatus from the original file, lines 142-158, verbatim]

// ─── handleConnectorStatus (was lines 294-312) ───────────────────────────────
[paste body of handleConnectorStatus from the original file, lines 294-312, verbatim]

// ─── handleConnectorHealthHistory (was lines 313-333) ────────────────────────
[paste body of handleConnectorHealthHistory from the original file, lines 313-333, verbatim]
```

(The header comments are optional — strip them if you prefer cleaner output. Function bodies go verbatim including their `export` keyword.)

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck 2>&1 | tail -5
```

Expected: clean. If TypeScript reports a missing import (e.g., a function used in one of the handlers that wasn't included), add the import line and re-typecheck. Verify each unfamiliar symbol against the original file's imports (lines 1–58).

### Task 4: Create `lifecycle.ts`

**Files:**
- Create: `packages/gateway/src/ipc/connector-rpc-handlers/lifecycle.ts`

- [ ] **Step 1: Extract the 6 lifecycle bodies**

```bash
sed -n '159,182p;199,242p;477,491p' packages/gateway/src/ipc/connector-rpc-handlers.ts > /tmp/lifecycle-bodies.ts
```

(Lines 159-182: pause + resume; 199-242: emitConfigChanged + resumeConnector + pauseConnector; 477-491: handleConnectorSync.)

- [ ] **Step 2: Write `lifecycle.ts`**

Order: shared helpers first (`emitConfigChanged`, `resumeConnector`, `pauseConnector`) so the public handlers below can reference them without forward-declaration concerns, then `handleConnectorPause`, `handleConnectorResume`, `handleConnectorSync`.

```ts
import {
  type ConnectorServiceId,
  defaultSyncIntervalMsForService,
} from "../../connectors/connector-catalog.ts";
import { MIN_SYNC_INTERVAL_MS } from "../../sync/constants.ts";
import {
  ConnectorRpcError,
  parseServiceArg,
  requireRegisteredSchedulerServiceId,
} from "../connector-rpc-shared.ts";
import type { ConnectorRpcHandlerContext, ConnectorRpcHit } from "./context.ts";

// ─── shared internal helpers (also imported by config.ts) ────────────────────

[paste emitConfigChanged from original lines 199-215]

[paste resumeConnector from original lines 216-228]

[paste pauseConnector from original lines 229-242]

// ─── public handlers ─────────────────────────────────────────────────────────

[paste handleConnectorPause from original lines 159-170]

[paste handleConnectorResume from original lines 171-182]

[paste handleConnectorSync from original lines 477-491]
```

The 3 helpers (`emitConfigChanged`, `resumeConnector`, `pauseConnector`) move WITHOUT the `export` keyword — they were originally non-exported. Add `export` to them now since `config.ts` will need to import them via `import { emitConfigChanged, pauseConnector, resumeConnector } from "./lifecycle.ts";`.

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck 2>&1 | tail -5
```

Expected: clean. Verify each helper now has `export`.

### Task 5: Create `config.ts`

**Files:**
- Create: `packages/gateway/src/ipc/connector-rpc-handlers/config.ts`

- [ ] **Step 1: Extract the 3 config handler bodies**

```bash
sed -n '102,141p;183,198p;243,293p' packages/gateway/src/ipc/connector-rpc-handlers.ts > /tmp/config-bodies.ts
```

(Lines 102-141: handleConnectorAddMcp; 183-198: handleConnectorSetInterval; 243-293: handleConnectorSetConfig.)

- [ ] **Step 2: Write `config.ts`**

```ts
import {
  type ConnectorServiceId,
  defaultSyncIntervalMsForService,
} from "../../connectors/connector-catalog.ts";
import {
  deleteUserMcpConnector,
  insertUserMcpConnector,
  normalizeUserMcpServiceId,
  parseUserMcpCommandLine,
  validateUserMcpArgsJson,
} from "../../connectors/user-mcp-store.ts";
import { createUserMcpSyncable } from "../../connectors/user-mcp-sync.ts";
import { Config } from "../../config.ts";
import { MIN_SYNC_INTERVAL_MS } from "../../sync/constants.ts";
import {
  ConnectorRpcError,
  parseServiceArg,
  requireRegisteredSchedulerServiceId,
} from "../connector-rpc-shared.ts";
import type { ConnectorRpcHandlerContext, ConnectorRpcHit } from "./context.ts";
import { emitConfigChanged, pauseConnector, resumeConnector } from "./lifecycle.ts";

[paste handleConnectorAddMcp from original lines 102-141]

[paste handleConnectorSetInterval from original lines 183-198]

[paste handleConnectorSetConfig from original lines 243-293]
```

If `handleConnectorAddMcp` references `deleteUserMcpConnector` or any other import not in the list above, add it. Cross-check with the source file lines 1–58.

The `VALID_DEPTHS` constant — currently a top-level const in the original file (find it with `grep -n "VALID_DEPTHS" packages/gateway/src/ipc/connector-rpc-handlers.ts`) — must move with `handleConnectorSetConfig` since it's only used there. Place it just above `handleConnectorSetConfig` in `config.ts`.

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck 2>&1 | tail -5
```

Expected: clean.

### Task 6: Create `removal.ts`

**Files:**
- Create: `packages/gateway/src/ipc/connector-rpc-handlers/removal.ts`

- [ ] **Step 1: Extract the 7 removal-related bodies**

```bash
sed -n '334,476p' packages/gateway/src/ipc/connector-rpc-handlers.ts > /tmp/removal-bodies.ts
```

(Lines 334-476 cover all 7 functions: snapshotGoogleOAuthIfLastFamilyMember, snapshotMicrosoftOAuthIfLastFamilyMember, unregisterConnectorFromSyncScheduler, removeConnectorIndexEntries, restoreGoogleAndMicrosoftOAuthBackups, handleConnectorRemove, resumePendingRemovals.)

- [ ] **Step 2: Write `removal.ts`**

```ts
import type { Database } from "bun:sqlite";
import {
  type ConnectorServiceId,
  GOOGLE_CONNECTOR_SERVICES,
  MICROSOFT_CONNECTOR_SERVICES,
  normalizeConnectorServiceId,
  oauthProfileForService,
} from "../../connectors/connector-catalog.ts";
import { clearConnectorVaultSecretKeys } from "../../connectors/connector-secrets-manifest.ts";
import {
  ALL_GOOGLE_OAUTH_VAULT_KEYS,
  clearOAuthVaultIfProviderUnused,
  sharedOAuthKey,
  writePerServiceOAuthKey,
} from "../../connectors/connector-vault.ts";
import type { LazyConnectorMesh } from "../../connectors/lazy-mesh.ts";
import {
  clearRemoveIntent,
  getPendingRemoveIntents,
  writeRemoveIntent,
} from "../../connectors/remove-intent.ts";
import { deleteUserMcpConnector } from "../../connectors/user-mcp-store.ts";
import type { LocalIndex } from "../../index/local-index.ts";
import type { SyncScheduler } from "../../sync/scheduler.ts";
import { listRecentSyncTelemetry } from "../../sync/scheduler-store.ts";
import {
  ConnectorRpcError,
  parseServiceArg,
  requireRegisteredSchedulerServiceId,
  sumItemsSiblingServices,
} from "../connector-rpc-shared.ts";
import type { ConnectorRpcHandlerContext, ConnectorRpcHit } from "./context.ts";

[paste all 7 functions from /tmp/removal-bodies.ts in their original order]
```

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck 2>&1 | tail -5
```

Expected: clean.

### Task 7: Create `auth.ts`

**Files:**
- Create: `packages/gateway/src/ipc/connector-rpc-handlers/auth.ts`

- [ ] **Step 1: Extract auth-related bodies**

```bash
sed -n '60,89p;492,1106p' packages/gateway/src/ipc/connector-rpc-handlers.ts > /tmp/auth-bodies.ts
```

(Lines 60-88: oauthScopesFromConnectorRequest + oauthRedirectPortFromRec; 492-1106: authSuccess + 18 connectorAuth* + persistAws* + oauthClientConfigForProvider + connectorAuthOAuthPkce + handleConnectorAuth.)

This is the largest file (~640 LOC including comments).

- [ ] **Step 2: Write `auth.ts`**

```ts
import {
  GOOGLE_OAUTH_CLIENT_ID_HELP,
  MICROSOFT_OAUTH_CLIENT_ID_HELP,
  NOTION_OAUTH_CLIENT_ID_HELP,
  NOTION_OAUTH_CLIENT_SECRET_HELP,
  SLACK_OAUTH_CLIENT_ID_HELP,
} from "../../auth/oauth-env-help-messages.ts";
import { type PKCEOptions, runPKCEFlow } from "../../auth/pkce.ts";
import { Config } from "../../config.ts";
import {
  type ConnectorServiceId,
  defaultSyncIntervalMsForService,
  normalizeConnectorServiceId,
  oauthProfileForService,
} from "../../connectors/connector-catalog.ts";
import {
  deleteConnectorSecret,
  writeConnectorSecret,
  writePerServiceOAuthKey,
} from "../../connectors/connector-vault.ts";
import type { LocalIndex } from "../../index/local-index.ts";
import { stripTrailingSlashes } from "../../string/strip-trailing-slashes.ts";
import { MIN_SYNC_INTERVAL_MS } from "../../sync/constants.ts";
import type { NimbusVault } from "../../vault/nimbus-vault.ts";
import {
  ConnectorRpcError,
  parseAtlassianSiteCredentials,
  parseServiceArg,
  registerAtlassianApiConnectorAuth,
  requireRegisteredSchedulerServiceId,
} from "../connector-rpc-shared.ts";
import type { ConnectorRpcHandlerContext, ConnectorRpcHit } from "./context.ts";

[paste the contents of /tmp/auth-bodies.ts in their original order:
  oauthScopesFromConnectorRequest, oauthRedirectPortFromRec,
  authSuccess, connectorAuthGithub, connectorAuthGitlab, connectorAuthLinear,
  connectorAuthDiscord, connectorAuthCircleci, persistAwsAccessKeyPair,
  persistAwsProfileOnly, connectorAuthAws, connectorAuthAzure,
  connectorAuthGcp, connectorAuthIac, connectorAuthGrafana, connectorAuthSentry,
  connectorAuthNewrelic, connectorAuthDatadog, connectorAuthKubernetes,
  connectorAuthPagerduty, connectorAuthJenkins, connectorAuthBitbucket,
  oauthClientConfigForProvider, connectorAuthOAuthPkce, handleConnectorAuth]
```

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck 2>&1 | tail -5
```

Expected: clean. If a missing import surfaces (likely 1–2 helpers not in the list above), add it from the original's top-of-file imports.

### Task 8: Create `index.ts`

**Files:**
- Create: `packages/gateway/src/ipc/connector-rpc-handlers/index.ts`

- [ ] **Step 1: Write the re-export shim**

```ts
export type { ConnectorRpcHandlerContext } from "./context.ts";
export {
  handleConnectorAddMcp,
  handleConnectorSetConfig,
  handleConnectorSetInterval,
} from "./config.ts";
export {
  handleConnectorPause,
  handleConnectorResume,
  handleConnectorSync,
} from "./lifecycle.ts";
export { handleConnectorRemove, resumePendingRemovals } from "./removal.ts";
export {
  handleConnectorHealthHistory,
  handleConnectorListStatus,
  handleConnectorStatus,
} from "./status.ts";
export { handleConnectorAuth } from "./auth.ts";
```

`ConnectorRpcHit` is intentionally not re-exported — it's an internal handler-return type with no consumers outside the new directory.

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck 2>&1 | tail -5
```

Expected: clean.

### Task 9: Delete the original file

**Files:**
- Delete: `packages/gateway/src/ipc/connector-rpc-handlers.ts`

- [ ] **Step 1: Remove the original**

```bash
rm packages/gateway/src/ipc/connector-rpc-handlers.ts
```

- [ ] **Step 2: Run typecheck — expect 3 broken imports**

```bash
bun run typecheck 2>&1 | tail -20
```

Expected: TS errors on:
- `packages/gateway/src/ipc/connector-rpc.ts` (imports from `./connector-rpc-handlers.ts`)
- `packages/gateway/src/platform/assemble.ts` (imports `resumePendingRemovals` from `../ipc/connector-rpc-handlers.ts`)
- `packages/gateway/src/ipc/connector-rpc-handlers-setconfig.test.ts` (2 imports from `./connector-rpc-handlers.ts`)

If the typecheck is clean (zero errors), Bun's directory resolution auto-resolved the imports — skip Task 10 and go directly to Task 11.

### Task 10: Update consumer import paths

**Files:**
- Modify: `packages/gateway/src/ipc/connector-rpc.ts`
- Modify: `packages/gateway/src/platform/assemble.ts`
- Modify: `packages/gateway/src/ipc/connector-rpc-handlers-setconfig.test.ts`

For each file, update the path string `./connector-rpc-handlers.ts` → `./connector-rpc-handlers/index.ts`. The list of imported symbols stays unchanged — only the path string changes.

- [ ] **Step 1: `connector-rpc.ts`**

Find:
```ts
} from "./connector-rpc-handlers.ts";
```

Replace with:
```ts
} from "./connector-rpc-handlers/index.ts";
```

- [ ] **Step 2: `platform/assemble.ts`**

Find:
```ts
import { resumePendingRemovals } from "../ipc/connector-rpc-handlers.ts";
```

Replace with:
```ts
import { resumePendingRemovals } from "../ipc/connector-rpc-handlers/index.ts";
```

- [ ] **Step 3: `connector-rpc-handlers-setconfig.test.ts`**

This file has TWO imports from the path. Find each:

```ts
import type { ConnectorRpcHandlerContext } from "./connector-rpc-handlers.ts";
```

Replace with:
```ts
import type { ConnectorRpcHandlerContext } from "./connector-rpc-handlers/index.ts";
```

And:
```ts
} from "./connector-rpc-handlers.ts";
```

Replace with:
```ts
} from "./connector-rpc-handlers/index.ts";
```

- [ ] **Step 4: Typecheck**

```bash
bun run typecheck 2>&1 | tail -5
```

Expected: clean across all packages.

### Task 11: Verify all acceptance gates

**Files:** none (verification)

- [ ] **Step 1: Audit invariants**

```bash
bun run audit:invariants
```

Expected: exits 0, no D11 hits.

- [ ] **Step 2: Lint**

```bash
bun run lint
```

Expected: clean. (If Biome reformats imports in any of the new files, accept the format.)

- [ ] **Step 3: setconfig regression test**

```bash
bun test packages/gateway/src/ipc/connector-rpc-handlers-setconfig.test.ts
```

Expected: pass count unchanged from baseline (Task 1 Step 5).

- [ ] **Step 4: Full gateway suite**

```bash
bun test packages/gateway/
```

Expected: pass count unchanged from baseline (Task 1 Step 5).

- [ ] **Step 5: New file LOC sanity check**

```bash
wc -l packages/gateway/src/ipc/connector-rpc-handlers/*.ts
```

Expected: each file under 700 LOC; total roughly equals the original 1106 LOC plus ~100 LOC overhead from per-file imports + the index re-export. No file over 800 LOC.

- [ ] **Step 6: CI parity (the user's enforced pre-push check per memory `feedback_preflight_before_pr.md`)**

```bash
bun run test:ci
```

Expected: gateway/script suites pass. UI vitest V8 coverage flake is acceptable (same as PRs #149–#157).

### Task 12: Commit + push + open PR

**Files:** none (git ops)

- [ ] **Step 1: Stage**

```bash
git add packages/gateway/src/ipc/connector-rpc-handlers/ \
        packages/gateway/src/ipc/connector-rpc-handlers.ts \
        packages/gateway/src/ipc/connector-rpc.ts \
        packages/gateway/src/platform/assemble.ts \
        packages/gateway/src/ipc/connector-rpc-handlers-setconfig.test.ts
```

(`git add` of the deleted file `connector-rpc-handlers.ts` records the deletion. `git status` should show 7 new files added, 1 file deleted, 3 files modified. Total: 11 entries in `git status`.)

- [ ] **Step 2: Verify staged set**

```bash
git status
```

Expected:
- new file: `packages/gateway/src/ipc/connector-rpc-handlers/auth.ts`
- new file: `packages/gateway/src/ipc/connector-rpc-handlers/config.ts`
- new file: `packages/gateway/src/ipc/connector-rpc-handlers/context.ts`
- new file: `packages/gateway/src/ipc/connector-rpc-handlers/index.ts`
- new file: `packages/gateway/src/ipc/connector-rpc-handlers/lifecycle.ts`
- new file: `packages/gateway/src/ipc/connector-rpc-handlers/removal.ts`
- new file: `packages/gateway/src/ipc/connector-rpc-handlers/status.ts`
- deleted: `packages/gateway/src/ipc/connector-rpc-handlers.ts`
- modified: `packages/gateway/src/ipc/connector-rpc.ts`
- modified: `packages/gateway/src/platform/assemble.ts`
- modified: `packages/gateway/src/ipc/connector-rpc-handlers-setconfig.test.ts`

If any other files appear (e.g., `junit-reports/junit-vitest.xml`), do not stage them.

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
refactor(ipc): D4 — split connector-rpc-handlers.ts into namespace directory

Replaces the 1106-LOC packages/gateway/src/ipc/connector-rpc-handlers.ts
with a directory of namespace-focused sibling files:

- context.ts    — ConnectorRpcHandlerContext + ConnectorRpcHit types
- status.ts     — listStatus / status / healthHistory
- lifecycle.ts  — pause / resume / sync + shared internal helpers
- config.ts     — addMcp / setInterval / setConfig (imports lifecycle helpers)
- removal.ts    — remove / resumePendingRemovals + 5 removal helpers
- auth.ts       — auth + 18 per-connector flows + OAuth helpers
- index.ts      — pure re-export shim preserving the original public surface

Pure mechanical move; zero behavioral change. Function bodies migrate
verbatim; per-file imports trim to minimum scope. Three consumer files
(connector-rpc.ts, platform/assemble.ts, connector-rpc-handlers-setconfig
.test.ts) update their import path string from
"./connector-rpc-handlers.ts" to "./connector-rpc-handlers/index.ts".

The largest resulting file is auth.ts at ~640 LOC, well under the 800 D4
threshold.

Spec: docs/superpowers/specs/2026-05-02-d4-rpc-handlers-split-design.md
Plan: docs/superpowers/plans/2026-05-02-d4-rpc-handlers-split.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Push**

```bash
git push -u origin dev/asafgolombek/d4-rpc-handlers-split
```

- [ ] **Step 5: Open the PR**

```bash
gh pr create --base main --title "refactor(ipc): D4 — split connector-rpc-handlers.ts into namespace directory" --body "$(cat <<'EOF'
## Summary
Replaces the 1106-LOC \`connector-rpc-handlers.ts\` with a directory of namespace-focused sibling files:

| File | Responsibility | LOC |
|---|---|---|
| \`context.ts\` | Handler-scoped types | ~30 |
| \`status.ts\` | Read-only state introspection | ~80 |
| \`lifecycle.ts\` | Pause / resume / sync + shared internal helpers | ~110 |
| \`config.ts\` | addMcp / setInterval / setConfig | ~150 |
| \`removal.ts\` | Remove + resumePendingRemovals + helpers | ~200 |
| \`auth.ts\` | Auth dispatcher + 18 per-connector flows | ~640 |
| \`index.ts\` | Re-export shim | ~25 |

Pure mechanical move; **zero behavioral change**. Function bodies migrate verbatim; per-file imports trim to minimum scope. Three consumer files update their import path string from \`./connector-rpc-handlers.ts\` (file) to \`./connector-rpc-handlers/index.ts\` (directory entry point).

The largest file (auth.ts) is well under the 800 D4 threshold.

## Test plan
- [x] \`bun run audit:invariants\` exits 0; D11 = 0.
- [x] \`bun test packages/gateway/src/ipc/connector-rpc-handlers-setconfig.test.ts\` — pass count unchanged.
- [x] \`bun test packages/gateway/\` — full gateway-suite pass count unchanged.
- [x] \`bun run typecheck\` clean.
- [x] \`bun run lint\` clean.
- [x] \`bun run test:ci\` clean (modulo known UI vitest V8 coverage flake).

## Spec / Plan
- Spec: [\`docs/superpowers/specs/2026-05-02-d4-rpc-handlers-split-design.md\`](https://github.com/asafgolombek/Nimbus/blob/main/docs/superpowers/specs/2026-05-02-d4-rpc-handlers-split-design.md)
- Plan: [\`docs/superpowers/plans/2026-05-02-d4-rpc-handlers-split.md\`](https://github.com/asafgolombek/Nimbus/blob/main/docs/superpowers/plans/2026-05-02-d4-rpc-handlers-split.md)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

- [ ] **Step 6: Wait for CI; request review; merge.**

After merge: D4 has one less violation (`connector-rpc-handlers.ts` is gone). The next sub-project is the D4 split of `lazy-mesh.ts` (1408 LOC).

---

## Important constraints

- **Pure mechanical move.** No function body changes. No "while I'm here" cleanup. The diff should show exactly: 1 file deleted, 7 files added, 3 files modified (path-string-only edits).
- **Surrounding control flow / null-checks / error messages stay byte-identical.**
- **No new test files. No test-body edits. Only test-import-path tweaks (Task 10 Step 3).**
- **No new helpers added.** Especially: NO `readSharedOAuth` / `writeSharedOAuth` wrappers (declined four times in prior reviews).
- **The 7 new files together must equal the original file's behavior.** A reviewer should be able to read each function body in the new files and verify it matches the original byte-for-byte (modulo the `export` keyword added to the 3 lifecycle helpers in Task 4).

---

## Self-review notes

- **Spec coverage:** every spec section maps to tasks. § 1 (Goal) → all tasks. § 2 (Non-goals) → enforced by "Important constraints" block. § 3.1 (Directory replaces file) → Tasks 2–9. § 3.2 (Context types in context.ts) → Task 2. § 3.3 (Shared helpers location) → Task 4 Step 2. § 3.4 (index.ts shim) → Task 8. § 3.5 (Consumer impact) → Task 10. § 4 (Behavioral guarantees) → "Important constraints" block. § 5 (Tests) → Task 11. § 6 (Acceptance criteria) → Task 11 + Task 12 verification.
- **Bun directory resolution:** Task 9 detects whether Bun auto-resolves; Task 10 runs only if it doesn't. The most likely outcome (per the explicit-`.ts`-suffix convention in the codebase) is that Task 10 IS needed.
- **`VALID_DEPTHS` constant:** Task 5 Step 2 explicitly calls out moving this constant to `config.ts`.
- **Line-range drift:** the function-to-file map at the top of the plan uses pre-migration line numbers from main at commit `b3dd07e`. If main shifts before this PR is opened, re-grep with `grep -n "^export\|^function\|^async function" packages/gateway/src/ipc/connector-rpc-handlers.ts` and update the line ranges before Task 2 starts.
