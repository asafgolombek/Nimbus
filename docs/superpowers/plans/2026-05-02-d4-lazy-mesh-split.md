# D4 Split — `lazy-mesh.ts` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 1428-LOC `packages/gateway/src/connectors/lazy-mesh.ts` with a `lazy-mesh/` directory of concern-focused sibling files. Mostly-mechanical move; the only non-verbatim changes are (a) `this.X` → `ctx.X` substitutions in extracted `ensureXxx` free functions, and (b) one extra `..` segment in `MCP_CONNECTORS_ROOT` to compensate for the new directory depth. Zero behavioral change.

**Architecture:** Single atomic PR. Create 10 new files inside `packages/gateway/src/connectors/lazy-mesh/` (`drain.ts`, `keys.ts`, `tool-map.ts`, `slot.ts`, `phase3-config.ts`, `connector-spawns.ts`, `user-mcp.ts`, `credential-orchestration.ts`, `mesh.ts`, `index.ts`); delete the original file; update 10 consumer import paths from `./lazy-mesh.ts` (or `../connectors/lazy-mesh.ts`) to `./lazy-mesh/index.ts` (or `../connectors/lazy-mesh/index.ts`). The `LazyConnectorMesh` class stays the state owner; per-connector spawn methods become free functions accepting a constructor-bound `MeshSpawnContext`.

**Tech Stack:** TypeScript 6.x strict / Bun v1.2 / `bun:test` / Biome lint / project-local `.worktrees/` for isolation.

**Spec:** [`docs/superpowers/specs/2026-05-02-d4-lazy-mesh-split-design.md`](../specs/2026-05-02-d4-lazy-mesh-split-design.md)

**Branch:** `dev/asafgolombek/d4-lazy-mesh-split` (from `main`).
**Worktree:** `.worktrees/d4-lazy-mesh-split`.
**Commit count:** 1 (atomic).

---

## Authoritative function-to-file map

The current file has **6 type/interface declarations + 30 functions / methods** (counting class methods). Line ranges below are pre-migration; verify with `grep -n "^export\|^class\|^function\|^async function\|^\s*\(public\|private\|async\) " packages/gateway/src/connectors/lazy-mesh.ts` if the line numbers feel off.

| Symbol | Line range | Goes to |
|---|---|---|
| `_LAZY_MESH_DIR` | 32 | `keys.ts` |
| `MCP_CONNECTORS_ROOT` | 33 | `keys.ts` (with **`..` count change**, see Task 4) |
| `mcpConnectorServerScript` | 35–37 | `keys.ts` |
| `LazyDrainTracker` (class) | 43–71 | `drain.ts` |
| `mergeToolMapsOrThrow` | 79–96 | `tool-map.ts` |
| `LazyMcpSlot` (type) | 98–103 | `slot.ts` |
| `LAZY_MESH` (const) | 105–122 | `keys.ts` |
| `USER_MESH_PREFIX` (const) | 124 | `keys.ts` |
| `userMcpMeshKey` | 126–128 | `keys.ts` |
| `LazyMeshToolMap` (type) | 130–133 | `tool-map.ts` |
| `listLazyMeshClientTools` | 135–140 | `tool-map.ts` |
| `MeshLogger` (interface) | 146–148 | `slot.ts` (per spec-review § 2.2 — co-located with `MeshSpawnContext`) |
| `LazyConnectorMesh` (class) — fields + ctor | 150–186 | `mesh.ts` |
| `LazyConnectorMesh.getToolsEpoch` | 188–190 | `mesh.ts` (kept) |
| `LazyConnectorMesh.bumpToolsEpoch` (private) | 192–194 | `mesh.ts` (kept) |
| `LazyConnectorMesh.lazySlot` (private) | 196–203 | `mesh.ts` (kept) |
| `LazyConnectorMesh.getLazyClient` (private) | 205–207 | `mesh.ts` (kept) |
| `LazyConnectorMesh.setLazyClient` (private) | 209–211 | `mesh.ts` (kept) |
| `LazyConnectorMesh.clearLazyIdle` (private) | 213–219 | `mesh.ts` (kept) |
| `LazyConnectorMesh.scheduleLazyDisconnect` (private) | 221–228 | `mesh.ts` (kept) |
| `LazyConnectorMesh.stopLazyClient` (private) | 230–258 | `mesh.ts` (kept) |
| `LazyConnectorMesh.stopUserMcpClient` (private) | 260–262 | `mesh.ts` (kept) |
| `LazyConnectorMesh.stopExtensionClient` (public) | 278–281 | `mesh.ts` (kept) |
| `LazyConnectorMesh.recordArgsJsonFailure` (private) | 290–303 | `user-mcp.ts` (lifted as free fn) |
| `LazyConnectorMesh.mcpServerKeyForUserConnector` (private) | 305–307 | `user-mcp.ts` (lifted) |
| `LazyConnectorMesh.ensureUserMcpClient` (private) | 309–345 | `user-mcp.ts` (lifted) |
| `LazyConnectorMesh.ensureUserMcpConnectorsRunning` (private) | 347–362 | `mesh.ts` (kept — needs `this.lazySlots.keys()`; calls extracted `ensureUserMcpClient` per row) |
| `LazyConnectorMesh.ensureUserMcpRunning` (public) | 365–372 | `mesh.ts` (kept as thin shell calling the user-mcp helpers) |
| `LazyConnectorMesh.phase3AddAwsMcp` (private) | 374–404 | `phase3-config.ts` (lifted, takes `vault`) |
| `LazyConnectorMesh.phase3AddAzureMcp` (private) | 406–424 | `phase3-config.ts` |
| `LazyConnectorMesh.phase3AddGcpMcp` (private) | 426–439 | `phase3-config.ts` |
| `LazyConnectorMesh.phase3AddIacMcp` (private) | 441–453 | `phase3-config.ts` |
| `LazyConnectorMesh.phase3AddGrafanaMcp` (private) | 455–468 | `phase3-config.ts` |
| `LazyConnectorMesh.phase3AddSentryMcp` (private) | 470–491 | `phase3-config.ts` |
| `LazyConnectorMesh.phase3AddNewrelicMcp` (private) | 493–505 | `phase3-config.ts` |
| `LazyConnectorMesh.phase3AddDatadogMcp` (private) | 507–528 | `phase3-config.ts` |
| `LazyConnectorMesh.buildPhase3Servers` (private) | 530–546 | `phase3-config.ts` |
| `LazyConnectorMesh.ensurePhase3BundleRunning` (public) | 551–571 | `mesh.ts` shell + `connector-spawns.ts` body |
| `LazyConnectorMesh.ensureGoogleDriveRunning` (public) | 578–628 | `mesh.ts` shell + `connector-spawns.ts` body |
| `LazyConnectorMesh.ensureMicrosoftBundleRunning` (public) | 634–672 | `mesh.ts` shell + `connector-spawns.ts` body |
| `LazyConnectorMesh.ensureGithubRunning` (public) | 678–709 | `mesh.ts` shell + `connector-spawns.ts` body |
| `LazyConnectorMesh.ensureGitlabRunning` (public) | 715–749 | `mesh.ts` shell + `connector-spawns.ts` body |
| `LazyConnectorMesh.ensureBitbucketRunning` (public) | 754–784 | `mesh.ts` shell + `connector-spawns.ts` body |
| `LazyConnectorMesh.ensureSlackRunning` (public) | 790–821 | `mesh.ts` shell + `connector-spawns.ts` body |
| `LazyConnectorMesh.ensureLinearRunning` (public) | 827–853 | `mesh.ts` shell + `connector-spawns.ts` body |
| `LazyConnectorMesh.ensureJiraRunning` (public) | 858–897 | `mesh.ts` shell + `connector-spawns.ts` body |
| `LazyConnectorMesh.ensureNotionRunning` (public) | 903–938 | `mesh.ts` shell + `connector-spawns.ts` body |
| `LazyConnectorMesh.ensureConfluenceRunning` (public) | 943–982 | `mesh.ts` shell + `connector-spawns.ts` body |
| `LazyConnectorMesh.ensureDiscordRunning` (public) | 987–1014 | `mesh.ts` shell + `connector-spawns.ts` body |
| `LazyConnectorMesh.ensureJenkinsRunning` (public) | 1019–1059 | `mesh.ts` shell + `connector-spawns.ts` body |
| `LazyConnectorMesh.ensureCircleciRunning` (public) | 1064–1090 | `mesh.ts` shell + `connector-spawns.ts` body |
| `LazyConnectorMesh.ensurePagerdutyRunning` (public) | 1095–1121 | `mesh.ts` shell + `connector-spawns.ts` body |
| `LazyConnectorMesh.ensureKubernetesRunning` (public) | 1126–1157 | `mesh.ts` shell + `connector-spawns.ts` body |
| `LazyConnectorMesh.ensureIfConnectorSecretSet` (private) | 1159–1168 | `credential-orchestration.ts` (lifted) |
| `LazyConnectorMesh.ensureIfProviderOAuthSet` (private) | 1170–1178 | `credential-orchestration.ts` |
| `LazyConnectorMesh.ensureIfGoogleOAuthPresent` (private) | 1180–1184 | `credential-orchestration.ts` |
| `LazyConnectorMesh.ensureBitbucketIfVaultCreds` (private) | 1186–1192 | `credential-orchestration.ts` |
| `LazyConnectorMesh.ensureJiraIfVaultCreds` (private) | 1194–1201 | `credential-orchestration.ts` |
| `LazyConnectorMesh.ensureConfluenceIfVaultCreds` (private) | 1203–1210 | `credential-orchestration.ts` |
| `LazyConnectorMesh.ensureDiscordIfOptIn` (private) | 1212–1218 | `credential-orchestration.ts` |
| `LazyConnectorMesh.ensureJenkinsIfVaultCreds` (private) | 1220–1234 | `credential-orchestration.ts` |
| `LazyConnectorMesh.ensureCircleciIfVaultCreds` (private) | 1236–1241 | `credential-orchestration.ts` |
| `LazyConnectorMesh.ensurePagerdutyIfVaultCreds` (private) | 1243–1248 | `credential-orchestration.ts` |
| `LazyConnectorMesh.ensureKubernetesIfVaultCreds` (private) | 1250–1255 | `credential-orchestration.ts` |
| `LazyConnectorMesh.ensureCredentialConnectorsRunning` (private) | 1258–1275 | `credential-orchestration.ts` |
| `LazyConnectorMesh.collectBuiltInToolMaps` (private) | 1278–1303 | `mesh.ts` (kept — needs `this.lazySlots` + `this.filesystem`) |
| `LazyConnectorMesh.collectUserMcpToolMap` (private) | 1306–1315 | `mesh.ts` (kept) |
| `LazyConnectorMesh.buildSlotForToolMap` (private) | 1318–1332 | `mesh.ts` (kept) |
| `LazyConnectorMesh.wrapMergedToolsWithRefcount` (private) | 1339–1359 | `mesh.ts` (kept) |
| `LazyConnectorMesh.listToolsForDispatcher` (public) | 1366–1378 | `mesh.ts` (kept; calls `ensureCredentialConnectorsRunning(this.spawnContext)` from credential-orchestration.ts + `this.ensureUserMcpConnectorsRunning()` private method on the class) |
| `LazyConnectorMesh.listTools` (public) | 1385–1403 | `mesh.ts` (kept) |
| `LazyConnectorMesh.disconnect` (public) | 1405–1414 | `mesh.ts` (kept) |
| `createLazyConnectorMesh` (factory) | 1417–1428 | `mesh.ts` (kept) |

---

## Per-file external import sets

Each new file needs a subset of the original's external imports. **All `../X` imports become `../../X` and all `./Y` imports become `../Y`** because the new files live one directory deeper.

To determine what each new file needs:
- **`drain.ts`** — zero external imports (standalone class).
- **`keys.ts`** — `dirname` from `node:path`, `fileURLToPath` from `node:url`, `join` from `node:path`. **No** application-level imports.
- **`tool-map.ts`** — `MCPClient` from `@mastra/mcp` (for type signature in `listLazyMeshClientTools`). No relative imports.
- **`slot.ts`** — `MCPClient` from `@mastra/mcp`, `NimbusVault` from `../../vault/nimbus-vault.ts`, `LazyDrainTracker` from `./drain.ts`. Plus `Database` from `bun:sqlite` for the optional `healthDb` field on `MeshSpawnContext`. **`MeshLogger` is defined inline here** (not imported) per spec-review § 2.2.
- **`phase3-config.ts`** — `NimbusVault` from `../../vault/nimbus-vault.ts`, `readConnectorSecret` from `../connector-vault.ts`, `extensionProcessEnv` from `../../extensions/spawn-env.ts`, `mcpConnectorServerScript` from `./keys.ts`, `ServerSpec` from `./slot.ts`.
- **`connector-spawns.ts`** — `randomUUID` from `node:crypto`, `MCPClient` from `@mastra/mcp`, all 4 access-token resolvers (`anyGoogleOAuthVaultPresent`, `GoogleConnectorOAuthServiceId`, `getValidGoogleAccessToken`, `resolveGoogleOAuthVaultKey` from `../../auth/google-access-token.ts`; `getValidMicrosoftAccessToken` from `../../auth/microsoft-access-token.ts`; `getValidNotionAccessToken` from `../../auth/notion-access-token.ts`; `readMicrosoftOAuthScopesForOutlookEnv` from `../../auth/oauth-vault-tokens.ts`; `getValidSlackAccessToken` from `../../auth/slack-access-token.ts`), `extensionProcessEnv` from `../../extensions/spawn-env.ts`, `stripTrailingSlashes` from `../../string/strip-trailing-slashes.ts`, `readConnectorSecret` from `../connector-vault.ts`, `LAZY_MESH` + `mcpConnectorServerScript` from `./keys.ts`, `MeshSpawnContext` + `ServerSpec` from `./slot.ts`, `buildPhase3Servers` from `./phase3-config.ts`.
- **`user-mcp.ts`** — `randomUUID` from `node:crypto`, `MCPClient` from `@mastra/mcp`, `extensionProcessEnv` from `../../extensions/spawn-env.ts`, `transitionHealth` from `../health.ts`, `UserMcpConnectorRow` from `../user-mcp-store.ts`, `USER_MESH_PREFIX` + `userMcpMeshKey` from `./keys.ts`, `MeshSpawnContext` from `./slot.ts`.
- **`credential-orchestration.ts`** — `ConnectorServiceId` from `../connector-catalog.ts`, `ConnectorSecretKeyOf` + `readConnectorSecret` + `SharedOAuthProvider` + `sharedOAuthKey` from `../connector-vault.ts`, `anyGoogleOAuthVaultPresent` from `../../auth/google-access-token.ts`, `MeshSpawnContext` from `./slot.ts`, plus the 16 `ensureXxxMcp` free functions from `./connector-spawns.ts`.
- **`mesh.ts`** — `MCPClient` from `@mastra/mcp`, `wrapToolOutput` from `../../engine/tool-output-envelope.ts`, `extensionProcessEnv` from `../../extensions/spawn-env.ts`, `PlatformPaths` from `../../platform/paths.ts`, `NimbusVault` from `../../vault/nimbus-vault.ts`, `UserMcpConnectorRow` from `../user-mcp-store.ts`, `LazyDrainTracker` from `./drain.ts`, `LAZY_MESH` + `USER_MESH_PREFIX` from `./keys.ts`, `LazyMeshToolMap` + `listLazyMeshClientTools` + `mergeToolMapsOrThrow` from `./tool-map.ts`, `LazyMcpSlot` + `MeshLogger` + `MeshSpawnContext` from `./slot.ts`, all 16 `ensureXxxMcp` free functions from `./connector-spawns.ts`, `ensureCredentialConnectorsRunning` from `./credential-orchestration.ts`, `ensureUserMcpClient` from `./user-mcp.ts` (note: only `ensureUserMcpClient` — `ensureUserMcpConnectorsRunning` stays as a private method on the class because it needs `this.lazySlots.keys()` access). Plus optional `Database` from `bun:sqlite`.
- **`index.ts`** — zero external imports; only re-exports from siblings.

The lists above are guidance, not exhaustive. The authoritative process: copy a function, see what symbol names appear in its body, find the matching import line in the original, copy that import too — adjusted for one extra `..`. Then typecheck.

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

Expected: at `82e4f03` (PR #160 merge) or later.

- [ ] **Step 2: Create the worktree**

```bash
git worktree add -b dev/asafgolombek/d4-lazy-mesh-split .worktrees/d4-lazy-mesh-split main
cd .worktrees/d4-lazy-mesh-split
bun install
```

Expected: `~2130 packages installed`.

- [ ] **Step 3: Verify the source file's pre-migration state**

```bash
wc -l packages/gateway/src/connectors/lazy-mesh.ts
grep -c "^export\|^\s*\(public\|private\|async\) " packages/gateway/src/connectors/lazy-mesh.ts
```

Expected: `1428` LOC. The `grep` count is informational — confirm non-zero.

- [ ] **Step 4: Verify the audit baseline**

```bash
bun run audit:invariants
```

Expected: exits 0; D10 = 0; D11 = 0.

- [ ] **Step 5: Run the existing test suite to capture baseline pass counts**

```bash
bun test packages/gateway/src/connectors/lazy-mesh.test.ts 2>&1 | tail -5
bun test packages/gateway/src/connectors/lazy-mesh-args-json.test.ts 2>&1 | tail -5
bun test packages/gateway/ 2>&1 | tail -5
```

Note the pass counts — they are the baseline that must be unchanged after the move.

### Task 2: Create the directory and `drain.ts`

**Files:**
- Create: `packages/gateway/src/connectors/lazy-mesh/drain.ts`

- [ ] **Step 1: Create the directory structure**

```bash
mkdir -p packages/gateway/src/connectors/lazy-mesh
```

- [ ] **Step 2: Write `drain.ts`**

Create the file with the body of `LazyDrainTracker` from `lazy-mesh.ts` lines 39–71, verbatim, with `export` preserved:

```ts
/**
 * S8-F7 — per-slot in-flight refcount with awaitable drain.
 * Used by LazyConnectorMesh to defer disconnect while tool calls are running.
 */
export class LazyDrainTracker {
  // [paste body verbatim from lazy-mesh.ts:43-71]
}
```

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck 2>&1 | tail -5
```

Expected: clean. The original file is untouched, so the workspace still compiles.

### Task 3: Create `tool-map.ts`

**Files:**
- Create: `packages/gateway/src/connectors/lazy-mesh/tool-map.ts`

- [ ] **Step 1: Write `tool-map.ts`**

```ts
import type { MCPClient } from "@mastra/mcp";

[paste mergeToolMapsOrThrow from lazy-mesh.ts:73-96 verbatim, including the JSDoc block]

[paste LazyMeshToolMap type from lazy-mesh.ts:130-133 verbatim — add `export` (currently unexported; will be imported by mesh.ts)]

[paste listLazyMeshClientTools from lazy-mesh.ts:135-140 verbatim — add `export` if not present]
```

The order doesn't matter; group by what the file currently has.

Both `LazyMeshToolMap` (originally `type LazyMeshToolMap = Record<...>`) and `listLazyMeshClientTools` (originally `async function listLazyMeshClientTools(...)`) are currently unexported. Add `export` to both when moving — `mesh.ts` will import them.

`MeshLogger` is **not** in this file (per spec-review § 2.2 disposition) — it's defined in `slot.ts` instead, co-located with its primary consumer `MeshSpawnContext`.

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck 2>&1 | tail -5
```

Expected: clean.

### Task 4: Create `keys.ts` — **load-bearing path adjustment**

**Files:**
- Create: `packages/gateway/src/connectors/lazy-mesh/keys.ts`

- [ ] **Step 1: Write `keys.ts`**

```ts
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const _LAZY_MESH_DIR = dirname(fileURLToPath(import.meta.url));

// NB: One additional ".." compared to the original lazy-mesh.ts because
// this file lives in connectors/lazy-mesh/ instead of connectors/.
// Resolves to packages/mcp-connectors. A regression here breaks every spawn.
export const MCP_CONNECTORS_ROOT = join(
  _LAZY_MESH_DIR,
  "..",
  "..",
  "..",
  "..",
  "mcp-connectors",
);

export function mcpConnectorServerScript(packageDir: string): string {
  return join(MCP_CONNECTORS_ROOT, packageDir, "src", "server.ts");
}

export const LAZY_MESH = {
  googleBundle: "mesh:google-bundle",
  microsoftBundle: "mesh:microsoft-bundle",
  github: "mesh:github",
  gitlab: "mesh:gitlab",
  bitbucket: "mesh:bitbucket",
  slack: "mesh:slack",
  linear: "mesh:linear",
  jira: "mesh:jira",
  notion: "mesh:notion",
  confluence: "mesh:confluence",
  discord: "mesh:discord",
  jenkins: "mesh:jenkins",
  circleci: "mesh:circleci",
  pagerduty: "mesh:pagerduty",
  kubernetes: "mesh:kubernetes",
  phase3Bundle: "mesh:phase3-bundle",
} as const;

export const USER_MESH_PREFIX = "mesh:user:";

export function userMcpMeshKey(serviceId: string): string {
  return `${USER_MESH_PREFIX}${serviceId}`;
}
```

The `LAZY_MESH` constant gets `export` (currently it's module-private but accessed only via `this`-scope; moving it requires it to be importable). `USER_MESH_PREFIX` and `userMcpMeshKey` similarly get `export`.

- [ ] **Step 2: Verify the path resolves correctly**

This is the load-bearing check. If you skip it, every spawn silently breaks at runtime.

```bash
bun -e 'import { MCP_CONNECTORS_ROOT } from "./packages/gateway/src/connectors/lazy-mesh/keys.ts"; import { existsSync } from "node:fs"; console.log("MCP_CONNECTORS_ROOT =", MCP_CONNECTORS_ROOT); console.log("exists?", existsSync(MCP_CONNECTORS_ROOT));'
```

Expected output:
```
MCP_CONNECTORS_ROOT = <repo-root>/packages/mcp-connectors
exists? true
```

If `exists? false`, the `..` count is wrong — fix and retry. The path must end in `packages/mcp-connectors`, **not** `packages/gateway/mcp-connectors`.

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck 2>&1 | tail -5
```

Expected: clean.

### Task 5: Create `slot.ts`

**Files:**
- Create: `packages/gateway/src/connectors/lazy-mesh/slot.ts`

- [ ] **Step 1: Write `slot.ts`**

```ts
import type { MCPClient } from "@mastra/mcp";

import type { NimbusVault } from "../../vault/nimbus-vault.ts";
import type { LazyDrainTracker } from "./drain.ts";

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
 * in `user-mcp.ts`.
 */
export interface MeshSpawnContext {
  readonly vault: NimbusVault;
  readonly logger?: MeshLogger | undefined;
  readonly healthDb?: import("bun:sqlite").Database | undefined;
  clearLazyIdle(key: string): void;
  getLazyClient(key: string): MCPClient | undefined;
  setLazyClient(key: string, client: MCPClient): void;
  bumpToolsEpoch(): void;
  scheduleLazyDisconnect(key: string): void;
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck 2>&1 | tail -5
```

Expected: clean.

### Task 6: Create `phase3-config.ts`

**Files:**
- Create: `packages/gateway/src/connectors/lazy-mesh/phase3-config.ts`

- [ ] **Step 1: Extract the 8 phase-3 helper bodies + buildPhase3Servers**

```bash
sed -n '374,546p' packages/gateway/src/connectors/lazy-mesh.ts > /tmp/phase3-bodies.ts
```

(Lines 374–546 cover all 8 `phase3AddXxxMcp` methods + `buildPhase3Servers`.)

- [ ] **Step 2: Write `phase3-config.ts`**

For each `phase3AddXxxMcp`, the body migrates verbatim with `this.vault` → `vault` and the parameter signature changing from `(servers: Record<...>)` to `(vault: NimbusVault, servers: Record<string, ServerSpec>)`. The `private async` keywords drop; replace with `export async function`. The inline `Record<...>` type becomes `Record<string, ServerSpec>` (using the hoisted `ServerSpec` from `slot.ts`).

```ts
import type { NimbusVault } from "../../vault/nimbus-vault.ts";
import { extensionProcessEnv } from "../../extensions/spawn-env.ts";
import { readConnectorSecret } from "../connector-vault.ts";
import { mcpConnectorServerScript } from "./keys.ts";
import type { ServerSpec } from "./slot.ts";

export async function phase3AddAwsMcp(
  vault: NimbusVault,
  servers: Record<string, ServerSpec>,
): Promise<void> {
  // [body verbatim from lazy-mesh.ts:375-403, this.vault → vault]
}

[same shape for phase3AddAzureMcp from lines 406-424]
[phase3AddGcpMcp from lines 426-439]
[phase3AddIacMcp from lines 441-453]
[phase3AddGrafanaMcp from lines 455-468]
[phase3AddSentryMcp from lines 470-491]
[phase3AddNewrelicMcp from lines 493-505]
[phase3AddDatadogMcp from lines 507-528]

export async function buildPhase3Servers(
  vault: NimbusVault,
): Promise<Record<string, ServerSpec>> {
  const servers: Record<string, ServerSpec> = {};
  await phase3AddAwsMcp(vault, servers);
  await phase3AddAzureMcp(vault, servers);
  await phase3AddGcpMcp(vault, servers);
  await phase3AddIacMcp(vault, servers);
  await phase3AddGrafanaMcp(vault, servers);
  await phase3AddSentryMcp(vault, servers);
  await phase3AddNewrelicMcp(vault, servers);
  await phase3AddDatadogMcp(vault, servers);
  return servers;
}
```

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck 2>&1 | tail -5
```

Expected: clean. If a missing import surfaces, add it from the original's lines 1–30 (with one extra `..`).

### Task 7: Create `connector-spawns.ts`

**Files:**
- Create: `packages/gateway/src/connectors/lazy-mesh/connector-spawns.ts`

- [ ] **Step 1: Extract the 16 ensure bodies**

```bash
sed -n '551,1157p' packages/gateway/src/connectors/lazy-mesh.ts > /tmp/connector-spawns-bodies.ts
```

(Lines 551–1157 cover all 16 `ensureXxxRunning` methods plus their JSDoc.)

- [ ] **Step 2: Write `connector-spawns.ts`**

For each ensure method:
- Drop the `async` / `private` / `public` modifiers; replace with `export async function`.
- Rename: `ensureXxxRunning` → `ensureXxxMcp` (e.g., `ensureGithubRunning` → `ensureGithubMcp`). Phase-3 method renames `ensurePhase3BundleRunning` → `ensurePhase3BundleMcp`.
- Substitute `this.vault` → `ctx.vault`.
- Substitute every `this.<slotMethod>(...)` → `ctx.<slotMethod>(...)` for the 5 slot methods (`clearLazyIdle`, `getLazyClient`, `setLazyClient`, `bumpToolsEpoch`, `scheduleLazyDisconnect`).
- Substitute `this.buildPhase3Servers()` → `buildPhase3Servers(ctx.vault)` in `ensurePhase3BundleMcp`.
- Add the parameter `(ctx: MeshSpawnContext)`.
- Keep all JSDoc comments verbatim.
- Keep all `try/catch`, all early-return shapes, all string literals, all server config object structures byte-for-byte identical.

```ts
import { randomUUID } from "node:crypto";

import { MCPClient } from "@mastra/mcp";

import {
  anyGoogleOAuthVaultPresent,
  type GoogleConnectorOAuthServiceId,
  getValidGoogleAccessToken,
  resolveGoogleOAuthVaultKey,
} from "../../auth/google-access-token.ts";
import { getValidMicrosoftAccessToken } from "../../auth/microsoft-access-token.ts";
import { getValidNotionAccessToken } from "../../auth/notion-access-token.ts";
import { readMicrosoftOAuthScopesForOutlookEnv } from "../../auth/oauth-vault-tokens.ts";
import { getValidSlackAccessToken } from "../../auth/slack-access-token.ts";
import { extensionProcessEnv } from "../../extensions/spawn-env.ts";
import { stripTrailingSlashes } from "../../string/strip-trailing-slashes.ts";
import { readConnectorSecret } from "../connector-vault.ts";
import { LAZY_MESH, mcpConnectorServerScript } from "./keys.ts";
import { buildPhase3Servers } from "./phase3-config.ts";
import type { MeshSpawnContext } from "./slot.ts";

[paste all 16 ensure functions in source-file order, with the substitutions above:
  ensurePhase3BundleMcp, ensureGoogleDriveMcp, ensureMicrosoftBundleMcp,
  ensureGithubMcp, ensureGitlabMcp, ensureBitbucketMcp, ensureSlackMcp,
  ensureLinearMcp, ensureJiraMcp, ensureNotionMcp, ensureConfluenceMcp,
  ensureDiscordMcp, ensureJenkinsMcp, ensureCircleciMcp, ensurePagerdutyMcp,
  ensureKubernetesMcp]
```

**Substitution checklist for each function:**
1. Function header: `private async ensureXxxRunning(): Promise<void>` → `export async function ensureXxxMcp(ctx: MeshSpawnContext): Promise<void>`
2. Body: `this.vault` → `ctx.vault` (occurs in `await readConnectorSecret(ctx.vault, ...)` etc.)
3. Body: `this.clearLazyIdle(slotKey)` → `ctx.clearLazyIdle(slotKey)`
4. Body: `this.getLazyClient(slotKey)` → `ctx.getLazyClient(slotKey)`
5. Body: `this.setLazyClient(slotKey, ...)` → `ctx.setLazyClient(slotKey, ...)`
6. Body: `this.bumpToolsEpoch()` → `ctx.bumpToolsEpoch()`
7. Body: `this.scheduleLazyDisconnect(slotKey)` → `ctx.scheduleLazyDisconnect(slotKey)`
8. Body in `ensurePhase3BundleMcp`: `await this.buildPhase3Servers()` → `await buildPhase3Servers(ctx.vault)`
9. Body in `ensureGoogleDriveMcp`: `await resolveGoogleOAuthVaultKey(this.vault, id)` → `await resolveGoogleOAuthVaultKey(ctx.vault, id)`; same for `getValidGoogleAccessToken`.
10. Body in `ensureMicrosoftBundleMcp`: `await getValidMicrosoftAccessToken(this.vault)` → `await getValidMicrosoftAccessToken(ctx.vault)`; same for `readMicrosoftOAuthScopesForOutlookEnv`.
11. Body in `ensureSlackMcp`: `await getValidSlackAccessToken(this.vault)` → `await getValidSlackAccessToken(ctx.vault)`.
12. Body in `ensureNotionMcp`: `await getValidNotionAccessToken(this.vault)` → `await getValidNotionAccessToken(ctx.vault)`.

Nothing else changes. No reordering of statements, no loop unrolling, no error-message edits.

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck 2>&1 | tail -5
```

Expected: clean. If a missing import surfaces, add it from the original's lines 1–30 (with one extra `..`).

- [ ] **Step 4: Spot-check 2–3 functions for byte-equivalence with the source**

```bash
diff <(sed -n '678,709p' packages/gateway/src/connectors/lazy-mesh.ts | sed 's/  this\./  ctx\./g; s/private async ensureGithubRunning/export async function ensureGithubMcp/; s/(): Promise/(ctx: MeshSpawnContext): Promise/') <(sed -n '/^export async function ensureGithubMcp/,/^}/p' packages/gateway/src/connectors/lazy-mesh/connector-spawns.ts)
```

(Diff helper for one of the simpler functions. The `sed` substitutions on the LHS approximate what your manual edits should have done. Use as a sanity check, not a strict gate — comment ordering and closing-brace placement may legitimately differ.)

### Task 8: Create `user-mcp.ts`

**Files:**
- Create: `packages/gateway/src/connectors/lazy-mesh/user-mcp.ts`

**Scope decision (resolved upfront):** `ensureUserMcpConnectorsRunning` from the original (lines 347–362) is **NOT** lifted to `user-mcp.ts`. It iterates `this.lazySlots.keys()` to find stale user-mcp slots, and `MeshSpawnContext` deliberately does not expose the slot map (would force a `forEachSlotKey` callback that adds plumbing without value). It stays as a private method on `LazyConnectorMesh` (kept in `mesh.ts`, see Task 11) that calls the extracted `ensureUserMcpClient(this.spawnContext, row)` per row.

Only 3 symbols extract to `user-mcp.ts`: `recordArgsJsonFailure`, `mcpServerKeyForUserConnector`, `ensureUserMcpClient`. The function-to-file map at the top of this plan reflects this; the spec's § 3.1 (which mentioned `ensureUserMcpConnectorsRunning` in the `user-mcp.ts` row) is technically aspirational — this plan is the authoritative resolution.

- [ ] **Step 1: Extract user-mcp bodies**

```bash
sed -n '290,345p' packages/gateway/src/connectors/lazy-mesh.ts > /tmp/user-mcp-bodies.ts
```

(Lines 290–345 cover `recordArgsJsonFailure`, `mcpServerKeyForUserConnector`, `ensureUserMcpClient` — the three symbols that move.)

- [ ] **Step 2: Write `user-mcp.ts`**

```ts
import { randomUUID } from "node:crypto";

import { MCPClient } from "@mastra/mcp";

import { extensionProcessEnv } from "../../extensions/spawn-env.ts";
import { transitionHealth } from "../health.ts";
import type { UserMcpConnectorRow } from "../user-mcp-store.ts";
import { userMcpMeshKey } from "./keys.ts";
import type { MeshSpawnContext } from "./slot.ts";

export function recordArgsJsonFailure(
  ctx: MeshSpawnContext,
  serviceId: string,
  reason: string,
): void {
  // [body from lazy-mesh.ts:290-303 with substitutions:
  //   this.logger → ctx.logger
  //   this.healthDb → ctx.healthDb
  // ]
}

// File-private — only used by ensureUserMcpClient below. No `export`.
function mcpServerKeyForUserConnector(serviceId: string): string {
  return serviceId.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
}

export async function ensureUserMcpClient(
  ctx: MeshSpawnContext,
  row: UserMcpConnectorRow,
): Promise<void> {
  // [body from lazy-mesh.ts:309-345 with substitutions:
  //   this.clearLazyIdle → ctx.clearLazyIdle
  //   this.getLazyClient → ctx.getLazyClient
  //   this.setLazyClient → ctx.setLazyClient
  //   this.bumpToolsEpoch → ctx.bumpToolsEpoch
  //   this.scheduleLazyDisconnect → ctx.scheduleLazyDisconnect
  //   this.recordArgsJsonFailure(row.service_id, ...) → recordArgsJsonFailure(ctx, row.service_id, ...)
  //   this.mcpServerKeyForUserConnector(row.service_id) → mcpServerKeyForUserConnector(row.service_id)
  // ]
}
```

`USER_MESH_PREFIX` from `keys.ts` is **not** imported here — it's only used by `ensureUserMcpConnectorsRunning`, which stays on the class.

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck 2>&1 | tail -5
```

Expected: clean.

### Task 9: Create `credential-orchestration.ts`

**Files:**
- Create: `packages/gateway/src/connectors/lazy-mesh/credential-orchestration.ts`

- [ ] **Step 1: Extract orchestration bodies**

```bash
sed -n '1159,1275p' packages/gateway/src/connectors/lazy-mesh.ts > /tmp/orch-bodies.ts
```

(Lines 1159–1275 cover `ensureIfConnectorSecretSet`, `ensureIfProviderOAuthSet`, `ensureIfGoogleOAuthPresent`, the 8 `ensureXxxIfVaultCreds` / `ensureXxxIfOptIn` wrappers, and `ensureCredentialConnectorsRunning`.)

- [ ] **Step 2: Write `credential-orchestration.ts`**

```ts
import { anyGoogleOAuthVaultPresent } from "../../auth/google-access-token.ts";
import type { ConnectorServiceId } from "../connector-catalog.ts";
import {
  type ConnectorSecretKeyOf,
  readConnectorSecret,
  type SharedOAuthProvider,
  sharedOAuthKey,
} from "../connector-vault.ts";
import {
  ensureBitbucketMcp,
  ensureCircleciMcp,
  ensureConfluenceMcp,
  ensureDiscordMcp,
  ensureGithubMcp,
  ensureGitlabMcp,
  ensureGoogleDriveMcp,
  ensureJenkinsMcp,
  ensureJiraMcp,
  ensureKubernetesMcp,
  ensureLinearMcp,
  ensureMicrosoftBundleMcp,
  ensureNotionMcp,
  ensurePagerdutyMcp,
  ensurePhase3BundleMcp,
  ensureSlackMcp,
} from "./connector-spawns.ts";
import type { MeshSpawnContext } from "./slot.ts";

// All 11 wrappers below are file-private (no `export`) — their sole
// caller is `ensureCredentialConnectorsRunning` in this same file.
// Adding `export` to anything not used externally pollutes the module
// surface for no benefit.

async function ensureIfConnectorSecretSet<S extends ConnectorServiceId>(
  ctx: MeshSpawnContext,
  serviceId: S,
  keyName: ConnectorSecretKeyOf<S>,
  run: () => Promise<void>,
): Promise<void> {
  // [body from lazy-mesh.ts:1159-1168, this.vault → ctx.vault]
}

async function ensureIfProviderOAuthSet(
  ctx: MeshSpawnContext,
  provider: SharedOAuthProvider,
  run: () => Promise<void>,
): Promise<void> {
  // [body from lazy-mesh.ts:1170-1178, this.vault → ctx.vault]
}

[paste the remaining 9 wrappers as file-private `async function ensureXxx(ctx: MeshSpawnContext)`:
  ensureIfGoogleOAuthPresent, ensureBitbucketIfVaultCreds,
  ensureJiraIfVaultCreds, ensureConfluenceIfVaultCreds,
  ensureDiscordIfOptIn, ensureJenkinsIfVaultCreds,
  ensureCircleciIfVaultCreds, ensurePagerdutyIfVaultCreds,
  ensureKubernetesIfVaultCreds.
 Substitutions:
  this.vault → ctx.vault
  this.ensureXxxRunning() → ensureXxxMcp(ctx)
 ]

// Public — called by mesh.ts's listToolsForDispatcher.
export async function ensureCredentialConnectorsRunning(
  ctx: MeshSpawnContext,
): Promise<void> {
  // [body from lazy-mesh.ts:1258-1275 with substitutions:
  //   this.ensureIfXxx(...) → ensureIfXxx(ctx, ...)
  //   this.ensureXxxRunning() → ensureXxxMcp(ctx) (in callback shapes)
  //   the lambda forms (() => this.ensureXxxRunning()) become (() => ensureXxxMcp(ctx))
  // ]
}
```

**Export surface:** `ensureCredentialConnectorsRunning` is the only `export` from this file. The 11 wrappers stay file-private — they have no consumers outside the orchestrator above them.

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck 2>&1 | tail -5
```

Expected: clean.

### Task 10: Create `user-mcp.ts` finalisation

**Files:** (already created in Task 8; re-verify in light of Task 8's Option-A note)

- [ ] **Step 1: Confirm `user-mcp.ts` exports only what's used externally**

Expected exports from `user-mcp.ts`:
- `recordArgsJsonFailure(ctx, serviceId, reason)` — used by `ensureUserMcpClient`.
- `ensureUserMcpClient(ctx, row)` — used by `mesh.ts`'s `ensureUserMcpRunning` shell + `ensureUserMcpConnectorsRunning`.

`mcpServerKeyForUserConnector` stays unexported — only used by `ensureUserMcpClient`.

`ensureUserMcpConnectorsRunning` does NOT live in `user-mcp.ts` (per Task 8 Option-A). It stays on the class.

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck 2>&1 | tail -5
```

Expected: clean.

### Task 11: Create `mesh.ts`

**Files:**
- Create: `packages/gateway/src/connectors/lazy-mesh/mesh.ts`

- [ ] **Step 1: Write `mesh.ts`**

This is the largest implementation file. It contains:
- The `LazyConnectorMesh` class definition
- The constructor (unchanged in shape; adds `this.spawnContext = { ... }` initialisation)
- The slot state-machine private methods (`lazySlot`, `getLazyClient`, `setLazyClient`, `clearLazyIdle`, `scheduleLazyDisconnect`, `stopLazyClient`, `stopUserMcpClient`, `bumpToolsEpoch`)
- The `getToolsEpoch`, `stopExtensionClient`, `disconnect` public methods (unchanged)
- 16 thin shell methods (`ensureXxxRunning() { return ensureXxxMcp(this.spawnContext); }`)
- `ensureUserMcpRunning(serviceId)` shell — finds the row in `listUserMcpConnectors()` and calls `ensureUserMcpClient(this.spawnContext, row)`
- `ensureUserMcpConnectorsRunning` (kept private — needs `this.lazySlots.keys()`)
- Tool-aggregation methods (`collectBuiltInToolMaps`, `collectUserMcpToolMap`, `buildSlotForToolMap`, `wrapMergedToolsWithRefcount`, `listToolsForDispatcher`, `listTools`)
- The `createLazyConnectorMesh` factory at the bottom

```ts
import { MCPClient } from "@mastra/mcp";

import { wrapToolOutput } from "../../engine/tool-output-envelope.ts";
import { extensionProcessEnv } from "../../extensions/spawn-env.ts";
import type { PlatformPaths } from "../../platform/paths.ts";
import type { NimbusVault } from "../../vault/nimbus-vault.ts";
import type { UserMcpConnectorRow } from "../user-mcp-store.ts";
import { LazyDrainTracker } from "./drain.ts";
import { LAZY_MESH, USER_MESH_PREFIX } from "./keys.ts";
import {
  type LazyMeshToolMap,
  listLazyMeshClientTools,
  mergeToolMapsOrThrow,
} from "./tool-map.ts";
import type { LazyMcpSlot, MeshLogger, MeshSpawnContext } from "./slot.ts";
import {
  ensureBitbucketMcp,
  ensureCircleciMcp,
  ensureConfluenceMcp,
  ensureDiscordMcp,
  ensureGithubMcp,
  ensureGitlabMcp,
  ensureGoogleDriveMcp,
  ensureJenkinsMcp,
  ensureJiraMcp,
  ensureKubernetesMcp,
  ensureLinearMcp,
  ensureMicrosoftBundleMcp,
  ensureNotionMcp,
  ensurePagerdutyMcp,
  ensurePhase3BundleMcp,
  ensureSlackMcp,
} from "./connector-spawns.ts";
import { ensureCredentialConnectorsRunning } from "./credential-orchestration.ts";
import { ensureUserMcpClient } from "./user-mcp.ts";

export class LazyConnectorMesh {
  private readonly filesystem: MCPClient;
  private readonly lazySlots = new Map<string, LazyMcpSlot>();
  private readonly listUserMcpConnectors: () => readonly UserMcpConnectorRow[];
  private readonly inactivityMs: number;
  private readonly healthDb: import("bun:sqlite").Database | undefined;
  private readonly logger: MeshLogger | undefined;
  private toolsEpoch = 0;
  private readonly spawnContext: MeshSpawnContext;

  constructor(
    paths: PlatformPaths,
    private readonly vault: NimbusVault,
    options?: {
      inactivityMs?: number;
      listUserMcpConnectors?: () => readonly UserMcpConnectorRow[];
      healthDb?: import("bun:sqlite").Database;
      logger?: MeshLogger;
    },
  ) {
    this.inactivityMs = options?.inactivityMs ?? 300_000;
    this.listUserMcpConnectors = options?.listUserMcpConnectors ?? (() => []);
    this.healthDb = options?.healthDb;
    this.logger = options?.logger;
    this.filesystem = new MCPClient({
      servers: {
        filesystem: {
          command: "bunx",
          args: ["@modelcontextprotocol/server-filesystem", paths.dataDir],
          env: extensionProcessEnv({}),
        },
      },
    });
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
  }

  // --- slot state-machine private methods (verbatim from original) ----

  [paste lazySlot, getLazyClient, setLazyClient, clearLazyIdle,
   scheduleLazyDisconnect, stopLazyClient, stopUserMcpClient,
   bumpToolsEpoch from lazy-mesh.ts:188-262 verbatim]

  // --- public introspection / lifecycle ---

  getToolsEpoch(): number {
    return this.toolsEpoch;
  }

  [paste stopExtensionClient from lazy-mesh.ts:278-281 verbatim]

  // --- per-connector ensure shells ---

  async ensureGoogleDriveRunning(): Promise<void> {
    return ensureGoogleDriveMcp(this.spawnContext);
  }

  async ensureMicrosoftBundleRunning(): Promise<void> {
    return ensureMicrosoftBundleMcp(this.spawnContext);
  }

  async ensureGithubRunning(): Promise<void> {
    return ensureGithubMcp(this.spawnContext);
  }

  async ensureGitlabRunning(): Promise<void> {
    return ensureGitlabMcp(this.spawnContext);
  }

  async ensureBitbucketRunning(): Promise<void> {
    return ensureBitbucketMcp(this.spawnContext);
  }

  async ensureSlackRunning(): Promise<void> {
    return ensureSlackMcp(this.spawnContext);
  }

  async ensureLinearRunning(): Promise<void> {
    return ensureLinearMcp(this.spawnContext);
  }

  async ensureJiraRunning(): Promise<void> {
    return ensureJiraMcp(this.spawnContext);
  }

  async ensureNotionRunning(): Promise<void> {
    return ensureNotionMcp(this.spawnContext);
  }

  async ensureConfluenceRunning(): Promise<void> {
    return ensureConfluenceMcp(this.spawnContext);
  }

  async ensureDiscordRunning(): Promise<void> {
    return ensureDiscordMcp(this.spawnContext);
  }

  async ensureJenkinsRunning(): Promise<void> {
    return ensureJenkinsMcp(this.spawnContext);
  }

  async ensureCircleciRunning(): Promise<void> {
    return ensureCircleciMcp(this.spawnContext);
  }

  async ensurePagerdutyRunning(): Promise<void> {
    return ensurePagerdutyMcp(this.spawnContext);
  }

  async ensureKubernetesRunning(): Promise<void> {
    return ensureKubernetesMcp(this.spawnContext);
  }

  async ensurePhase3BundleRunning(): Promise<void> {
    return ensurePhase3BundleMcp(this.spawnContext);
  }

  async ensureUserMcpRunning(serviceId: string): Promise<void> {
    const rows = this.listUserMcpConnectors();
    const row = rows.find((r) => r.service_id === serviceId);
    if (row === undefined) {
      return;
    }
    await ensureUserMcpClient(this.spawnContext, row);
  }

  // --- private user-mcp orchestration (kept on class for slot-map access) ---

  private async ensureUserMcpConnectorsRunning(): Promise<void> {
    const rows = this.listUserMcpConnectors();
    const active = new Set(rows.map((r) => r.service_id));
    for (const key of this.lazySlots.keys()) {
      if (!key.startsWith(USER_MESH_PREFIX)) {
        continue;
      }
      const id = key.slice(USER_MESH_PREFIX.length);
      if (!active.has(id)) {
        await this.stopUserMcpClient(id);
      }
    }
    for (const row of rows) {
      await ensureUserMcpClient(this.spawnContext, row);
    }
  }

  // --- tool aggregation (kept; needs raw slot access) ---

  [paste collectBuiltInToolMaps, collectUserMcpToolMap,
   buildSlotForToolMap, wrapMergedToolsWithRefcount from
   lazy-mesh.ts:1278-1359 verbatim]

  async listToolsForDispatcher(): Promise<
    Record<string, { execute?: (input: unknown, context?: unknown) => Promise<unknown> }>
  > {
    await ensureCredentialConnectorsRunning(this.spawnContext);
    await this.ensureUserMcpConnectorsRunning();

    const builtIns = await this.collectBuiltInToolMaps();
    const userMcpMerged = await this.collectUserMcpToolMap();
    const merged = mergeToolMapsOrThrow([...builtIns, { map: userMcpMerged, name: "user-mcp" }]);
    const slotForTool = await this.buildSlotForToolMap();
    this.wrapMergedToolsWithRefcount(merged, slotForTool);
    return merged;
  }

  [paste listTools from lazy-mesh.ts:1385-1403 verbatim]

  [paste disconnect from lazy-mesh.ts:1405-1414 verbatim]
}

export async function createLazyConnectorMesh(
  paths: PlatformPaths,
  vault: NimbusVault,
  options?: {
    inactivityMs?: number;
    listUserMcpConnectors?: () => readonly UserMcpConnectorRow[];
    healthDb?: import("bun:sqlite").Database;
    logger?: MeshLogger;
  },
): Promise<LazyConnectorMesh> {
  return new LazyConnectorMesh(paths, vault, options);
}
```

Note that `listToolsForDispatcher` was rewritten to call the free-function form of `ensureCredentialConnectorsRunning(ctx)` — this is the only call-site change in `mesh.ts` for that family. The `wrapMergedToolsWithRefcount` invocation passes `merged` mutably (the function mutates in place) — same as the original.

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck 2>&1 | tail -5
```

Expected: clean. The original file is still present, so the workspace still has a `LazyConnectorMesh` export from `lazy-mesh.ts` (unused) and a new one from `lazy-mesh/mesh.ts` (also unused at this point). Bun is fine with this; consumers haven't moved yet.

### Task 12: Create `index.ts`

**Files:**
- Create: `packages/gateway/src/connectors/lazy-mesh/index.ts`

- [ ] **Step 1: Write the re-export shim**

```ts
export { LazyDrainTracker } from "./drain.ts";
export { createLazyConnectorMesh, LazyConnectorMesh } from "./mesh.ts";
export type { MeshLogger } from "./slot.ts";
export { mergeToolMapsOrThrow } from "./tool-map.ts";
```

Order: alphabetical by source file (drain → mesh → tool-map). Symbols within each block: alphabetical, with `type` prefix kept adjacent to its symbol per Biome's default sort.

`LazyMeshToolMap`, `MeshSpawnContext`, `LazyMcpSlot`, `ServerSpec` are NOT re-exported — they are module-internal.

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck 2>&1 | tail -5
```

Expected: clean.

### Task 13: Delete the original file

**Files:**
- Delete: `packages/gateway/src/connectors/lazy-mesh.ts`

- [ ] **Step 1: Remove the original**

```bash
rm packages/gateway/src/connectors/lazy-mesh.ts
```

- [ ] **Step 2: Run typecheck — expect 10 broken imports**

```bash
bun run typecheck 2>&1 | tail -30
```

Expected: TS errors on the 10 consumer files enumerated in spec § 3.6:
1. `packages/gateway/src/connectors/lazy-mesh.test.ts`
2. `packages/gateway/src/connectors/lazy-mesh-args-json.test.ts`
3. `packages/gateway/src/connectors/registry.ts`
4. `packages/gateway/src/ipc/connector-rpc-handlers/context.ts`
5. `packages/gateway/src/ipc/connector-rpc.ts`
6. `packages/gateway/src/ipc/server.ts`
7. `packages/gateway/src/platform/assemble-sync-registrations.ts`
8. `packages/gateway/src/platform/assemble.ts`
9. `packages/gateway/src/platform/register-user-mcp-sync.ts`
10. `packages/gateway/src/platform/types.ts`

If the typecheck is clean (zero errors), Bun's directory resolution auto-resolved — skip Task 14 and go to Task 15.

### Task 14: Update consumer import paths

**Files:** modify 10 files (see Task 13 list).

For each file, change the path string. The set of imported symbols is unchanged.

- [ ] **Step 1: Sibling-folder consumers (relative `./lazy-mesh.ts`)**

```bash
# Three files use ./lazy-mesh.ts
sed -i 's|"./lazy-mesh.ts"|"./lazy-mesh/index.ts"|g' \
  packages/gateway/src/connectors/lazy-mesh.test.ts \
  packages/gateway/src/connectors/lazy-mesh-args-json.test.ts \
  packages/gateway/src/connectors/registry.ts
```

- [ ] **Step 2: Outer consumers (relative `../connectors/lazy-mesh.ts`)**

```bash
# Six files use ../connectors/lazy-mesh.ts
sed -i 's|"../connectors/lazy-mesh.ts"|"../connectors/lazy-mesh/index.ts"|g' \
  packages/gateway/src/ipc/connector-rpc.ts \
  packages/gateway/src/ipc/server.ts \
  packages/gateway/src/platform/assemble-sync-registrations.ts \
  packages/gateway/src/platform/assemble.ts \
  packages/gateway/src/platform/register-user-mcp-sync.ts \
  packages/gateway/src/platform/types.ts
```

- [ ] **Step 3: One-deeper consumer**

```bash
# context.ts under connector-rpc-handlers/ uses ../../connectors/lazy-mesh.ts
sed -i 's|"../../connectors/lazy-mesh.ts"|"../../connectors/lazy-mesh/index.ts"|g' \
  packages/gateway/src/ipc/connector-rpc-handlers/context.ts
```

- [ ] **Step 4: Verify — no remaining `./lazy-mesh.ts` references**

```bash
grep -rn 'from.*"./lazy-mesh\.ts"\|from.*"\.\./connectors/lazy-mesh\.ts"\|from.*"\.\./\.\./connectors/lazy-mesh\.ts"' packages/ --include="*.ts"
```

Expected: zero matches. If any remain, update them with the same sed pattern.

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck 2>&1 | tail -5
```

Expected: clean across all packages.

### Task 15: Verify all acceptance gates

**Files:** none (verification)

- [ ] **Step 1: Audit invariants**

```bash
bun run audit:invariants
```

Expected: exits 0, no D10 hits, no D11 hits.

- [ ] **Step 2: Lint**

```bash
bun run lint
```

Expected: clean. (If Biome reformats imports in any of the new files, accept the format.)

- [ ] **Step 3: Specific lazy-mesh tests**

```bash
bun test packages/gateway/src/connectors/lazy-mesh.test.ts
bun test packages/gateway/src/connectors/lazy-mesh-args-json.test.ts
```

Expected: pass count unchanged from baseline (Task 1 Step 5).

- [ ] **Step 4: Full gateway suite**

```bash
bun test packages/gateway/
```

Expected: pass count unchanged from baseline.

- [ ] **Step 5: New file LOC sanity check**

```bash
wc -l packages/gateway/src/connectors/lazy-mesh/*.ts
```

Expected: each file under 700 LOC; no file over 800 LOC. Largest is `connector-spawns.ts` at ~550 LOC.

- [ ] **Step 6: Path-resolution sanity check**

```bash
bun -e 'import { MCP_CONNECTORS_ROOT } from "./packages/gateway/src/connectors/lazy-mesh/keys.ts"; import { existsSync } from "node:fs"; if (!existsSync(MCP_CONNECTORS_ROOT)) { console.error("FAIL: " + MCP_CONNECTORS_ROOT + " does not exist"); process.exit(1); } console.log("OK: " + MCP_CONNECTORS_ROOT);'
```

Expected: prints `OK: <repo-root>/packages/mcp-connectors` and exits 0. If it fails, the `..` count in `keys.ts` is wrong — go back to Task 4 Step 2.

- [ ] **Step 7: CI parity (the user's enforced pre-push check per memory `feedback_preflight_before_pr.md`)**

```bash
bun run test:ci
```

Expected: gateway/script suites pass. UI vitest V8 coverage flake is acceptable (same as PRs #149–#160).

### Task 16: Commit + push + open PR

**Files:** none (git ops)

- [ ] **Step 1: Stage**

```bash
git add packages/gateway/src/connectors/lazy-mesh/ \
        packages/gateway/src/connectors/lazy-mesh.ts \
        packages/gateway/src/connectors/lazy-mesh.test.ts \
        packages/gateway/src/connectors/lazy-mesh-args-json.test.ts \
        packages/gateway/src/connectors/registry.ts \
        packages/gateway/src/ipc/connector-rpc.ts \
        packages/gateway/src/ipc/server.ts \
        packages/gateway/src/ipc/connector-rpc-handlers/context.ts \
        packages/gateway/src/platform/assemble-sync-registrations.ts \
        packages/gateway/src/platform/assemble.ts \
        packages/gateway/src/platform/register-user-mcp-sync.ts \
        packages/gateway/src/platform/types.ts
```

(`git add` of the deleted file `lazy-mesh.ts` records the deletion. `git status` should show 10 new files added, 1 file deleted, 10 files modified. Total: 21 entries in `git status`.)

- [ ] **Step 2: Verify staged set**

```bash
git status
```

Expected:
- new files: `packages/gateway/src/connectors/lazy-mesh/{drain,keys,tool-map,slot,phase3-config,connector-spawns,user-mcp,credential-orchestration,mesh,index}.ts` (10 files)
- deleted: `packages/gateway/src/connectors/lazy-mesh.ts`
- modified: 10 consumer files

If any other files appear (e.g., `junit-reports/junit-vitest.xml`), do not stage them.

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
refactor(connectors): D4 — split lazy-mesh.ts into namespace directory

Replaces the 1428-LOC packages/gateway/src/connectors/lazy-mesh.ts with
a directory of concern-focused sibling files:

- drain.ts                    — LazyDrainTracker class (verbatim)
- keys.ts                     — LAZY_MESH constants + path helpers
                                (MCP_CONNECTORS_ROOT path adjusted: extra
                                 ".." to compensate for new directory depth)
- tool-map.ts                 — LazyMeshToolMap, helpers
- slot.ts                     — LazyMcpSlot type + ServerSpec type +
                                MeshLogger interface +
                                MeshSpawnContext interface (internal)
- phase3-config.ts            — 8 phase3AddXxxMcp helpers + buildPhase3Servers
- connector-spawns.ts         — 16 ensureXxxMcp free fns taking MeshSpawnContext
- user-mcp.ts                 — recordArgsJsonFailure + ensureUserMcpClient
- credential-orchestration.ts — ensureCredentialConnectorsRunning + 11 wrappers
- mesh.ts                     — LazyConnectorMesh class (state owner) +
                                thin shells delegating to free fns +
                                tool-aggregation + factory
- index.ts                    — pure re-export shim preserving public surface

Mostly mechanical move; zero behavioral change. Per-connector spawn
methods become free functions that accept a constructor-bound
MeshSpawnContext interface, letting them live in sibling files without
exposing the slot state-machine on the public class API. The
LazyConnectorMesh class stays the state owner; its 16 ensureXxxRunning
methods become thin shells.

The largest resulting file is connector-spawns.ts at ~550 LOC, well
under the 800 D4 threshold.

Ten consumer files (lazy-mesh.test.ts, lazy-mesh-args-json.test.ts,
registry.ts, connector-rpc-handlers/context.ts, connector-rpc.ts,
server.ts, assemble-sync-registrations.ts, assemble.ts,
register-user-mcp-sync.ts, types.ts) update their import path from
"./lazy-mesh.ts" (or "../connectors/lazy-mesh.ts") to ".../lazy-mesh/index.ts".

Spec: docs/superpowers/specs/2026-05-02-d4-lazy-mesh-split-design.md
Plan: docs/superpowers/plans/2026-05-02-d4-lazy-mesh-split.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Push**

```bash
git push -u origin dev/asafgolombek/d4-lazy-mesh-split
```

- [ ] **Step 5: Open the PR**

```bash
gh pr create --base main --title "refactor(connectors): D4 — split lazy-mesh.ts into namespace directory" --body "$(cat <<'EOF'
## Summary
Replaces the 1428-LOC \`lazy-mesh.ts\` with a directory of concern-focused sibling files:

| File | Responsibility | LOC |
|---|---|---|
| \`drain.ts\` | LazyDrainTracker class | ~30 |
| \`keys.ts\` | LAZY_MESH + path helpers (with one extra \`..\` in MCP_CONNECTORS_ROOT) | ~50 |
| \`tool-map.ts\` | LazyMeshToolMap, helpers | ~45 |
| \`slot.ts\` | LazyMcpSlot + ServerSpec + MeshLogger + MeshSpawnContext (internal) | ~55 |
| \`phase3-config.ts\` | 8 phase-3 helpers + buildPhase3Servers | ~220 |
| \`connector-spawns.ts\` | 16 ensureXxxMcp free fns | ~550 |
| \`user-mcp.ts\` | recordArgsJsonFailure + ensureUserMcpClient | ~100 |
| \`credential-orchestration.ts\` | 11 wrappers + ensureCredentialConnectorsRunning | ~110 |
| \`mesh.ts\` | LazyConnectorMesh class + thin shells + factory | ~280 |
| \`index.ts\` | Re-export shim | ~25 |

Mostly-mechanical move; **zero behavioral change**. Per-connector spawn methods become free functions accepting a constructor-bound \`MeshSpawnContext\` interface, letting them live in sibling files without exposing the slot state-machine on the public class API. The class stays the state owner.

The largest file (connector-spawns.ts) is well under the 800 D4 threshold.

**Note:** \`MCP_CONNECTORS_ROOT\` in \`keys.ts\` gains one extra \`..\` segment to compensate for the new directory depth — verified at impl time to still resolve to \`packages/mcp-connectors\`. This is the only non-verbatim line in the move.

Ten consumer files update their import path to \`.../lazy-mesh/index.ts\`.

## Test plan
- [x] \`bun run audit:invariants\` exits 0; D10 = 0, D11 = 0.
- [x] \`bun test packages/gateway/src/connectors/lazy-mesh.test.ts\` — pass count unchanged.
- [x] \`bun test packages/gateway/src/connectors/lazy-mesh-args-json.test.ts\` — pass count unchanged.
- [x] \`bun test packages/gateway/\` — full gateway-suite pass count unchanged.
- [x] \`bun run typecheck\` clean.
- [x] \`bun run lint\` clean.
- [x] \`bun run test:ci\` clean (modulo known UI vitest V8 coverage flake).
- [x] \`MCP_CONNECTORS_ROOT\` resolves to \`packages/mcp-connectors\` (path-resolution sanity check).

## Spec / Plan
- Spec: [\`docs/superpowers/specs/2026-05-02-d4-lazy-mesh-split-design.md\`](https://github.com/asafgolombek/Nimbus/blob/main/docs/superpowers/specs/2026-05-02-d4-lazy-mesh-split-design.md)
- Plan: [\`docs/superpowers/plans/2026-05-02-d4-lazy-mesh-split.md\`](https://github.com/asafgolombek/Nimbus/blob/main/docs/superpowers/plans/2026-05-02-d4-lazy-mesh-split.md)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

- [ ] **Step 6: Wait for CI; request review; merge.**

After merge: D4 has one less violation (`lazy-mesh.ts` is gone). Four D4 candidates remain: `ipc/server.ts`, `cli/commands/connector.ts`, `index/local-index.ts`, `auth/pkce.ts`.

---

## Important constraints

- **Mostly mechanical move.** Function bodies migrate verbatim except for two well-defined substitutions: (a) `this.X` → `ctx.X` in extracted ensure functions, (b) one extra `..` in `MCP_CONNECTORS_ROOT`. No "while I'm here" cleanup.
- **Surrounding control flow / null-checks / try-catch placement / error messages stay byte-identical.**
- **No new test files. No test-body edits. Only test-import-path tweaks (Task 14 Step 1).**
- **No new helpers added beyond the `MeshSpawnContext` interface and `ServerSpec` type.** Specifically: NO generic `spawnIfConfigured(slotKey, idPrefix, configBuilder)` runner — captured as future follow-up in spec § 8, deliberately out of scope.
- **The 10 new files together must equal the original file's behavior.** A reviewer should be able to read each function body in the new files and verify it matches the original byte-for-byte modulo the two documented substitutions.
- **`MeshSpawnContext` and `ServerSpec` stay module-internal.** Not re-exported from `index.ts`. Adding either to the public API is a separate decision.

---

## Self-review notes

- **Spec coverage:** every spec section maps to tasks. § 1 (Goal) → all tasks. § 2 (Non-goals) → "Important constraints" block. § 3.1 (Directory replaces file) → Tasks 2–13. § 3.2 (Public surface) → Task 12. § 3.3 (MeshSpawnContext) → Task 5 + Task 11 Step 1's constructor block. § 3.4 (Per-connector shape) → Task 7. § 3.5 (Phase 3) → Task 6. § 3.6 (Consumer impact) → Task 14. § 4 (Behavioral guarantees) → "Important constraints" block. § 5 (Tests) → Task 15. § 6 (Acceptance criteria) → Task 15 + Task 16 verification.
- **Bun directory resolution:** Task 13 detects whether Bun auto-resolves; Task 14 runs only if it doesn't. Predecessor PR #160 confirmed Bun does NOT auto-resolve, so Task 14 IS expected to run.
- **`MCP_CONNECTORS_ROOT` path adjustment:** Task 4 Step 2 has an explicit runtime check (`existsSync(MCP_CONNECTORS_ROOT)`); Task 15 Step 6 is the post-move re-verification. A regression here silently breaks every spawn at runtime — both gates exist to catch it.
- **`ensureUserMcpConnectorsRunning` lives on the class, not in `user-mcp.ts`** — it iterates `this.lazySlots.keys()` directly, which `MeshSpawnContext` deliberately doesn't expose. Documented in Task 8 Option-A and Task 11.
- **Line-range drift:** the function-to-file map at the top of the plan uses pre-migration line numbers from `main` at commit `82e4f03`. If `main` shifts before this PR is opened, re-grep with `grep -n` and update the line ranges before Task 2 starts.
