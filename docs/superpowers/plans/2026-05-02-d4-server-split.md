# D4 Split — `ipc/server.ts` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 1239-LOC `packages/gateway/src/ipc/server.ts` with a `server/` directory of 9 concern-focused sibling files. Mostly-mechanical move; the only non-verbatim aspects are (a) `options.X` / `consentImpl` / `broadcastNotification` / `startedAtMs` → `ctx.X` substitutions in extracted dispatchers, and (b) `agentInvokeHandler` / `workflowRunHandler` closure reads → `ctx.getAgentInvokeHandler()` / `ctx.getWorkflowRunHandler()` getter calls (so the public setter API still affects future dispatch). Zero behavioral change.

**Architecture:** Single atomic PR. Create 9 new files inside `packages/gateway/src/ipc/server/` (`index.ts`, `rpc-error.ts`, `options.ts`, `context.ts`, `vault-dispatch.ts`, `socket-listeners.ts`, `inline-handlers.ts`, `dispatchers.ts`, `server.ts`); delete the original `server.ts`; update 4 consumer import paths from `./server.ts` to `./server/index.ts`. The `createIpcServer` factory stays the closure-state owner; per-namespace dispatchers and inline handlers become module-level functions accepting a constructor-bound `ServerCtx`.

**Tech Stack:** TypeScript 6.x strict / Bun v1.2 / `bun:test` / Biome lint / project-local `.worktrees/` for isolation.

**Spec:** [`docs/superpowers/specs/2026-05-02-d4-server-split-design.md`](../specs/2026-05-02-d4-server-split-design.md)

**Branch:** `dev/asafgolombek/d4-server-split` (from `main`).
**Worktree:** `.worktrees/d4-server-split`.
**Commit count:** 1 (atomic).

---

## Authoritative function-to-file map

The current file has **2 exported types/values + ~30 file-private symbols**. Line ranges below are pre-migration; verify with `grep -nE "^export|^function|^async function|^class|^interface|^type" packages/gateway/src/ipc/server.ts` if line numbers feel off (no other PR should have touched the file between this plan being written and this PR being executed).

| Symbol | Line range | Goes to |
|---|---|---|
| `RpcMethodError` (class) | 52–63 | `rpc-error.ts` |
| `assertWellFormedVaultKey` | 65–71 | `vault-dispatch.ts` |
| `removeStaleUnixSocketIfPresent` | 73–82 | `socket-listeners.ts` |
| `chmodListenSocketBestEffort` | 84–90 | `socket-listeners.ts` |
| `VaultDispatchHit` / `VaultDispatchMiss` / `VaultDispatchOutcome` (types) | 92–94 | `vault-dispatch.ts` |
| `dispatchVaultGated` (exported) | 96–123 | `vault-dispatch.ts` |
| `dispatchVaultIfPresent` | 125–166 | `vault-dispatch.ts` |
| `BunSessionData` (type) | 168 | `options.ts` |
| `CreateIpcServerOptions` (exported type) | 170–218 | `options.ts` |
| `requireNonEmptyRpcString` | 220–229 | `inline-handlers.ts` (file-private; only `buildWorkflowRunContext` uses it) |
| `assertDiagnosticsRpcAccess` | 231–256 | `dispatchers.ts` (file-private; only `tryDispatchDiagnosticsRpc` uses it) |
| `createIpcServer` factory — closure state, `broadcastNotification`, voiceService mic hook | 259–282 | `server.ts` |
| `createIpcServer.handleRpc` | 284–311 | `server.ts` |
| `sendAgentChunkIfStreaming` | 313–322 | `inline-handlers.ts` |
| `dispatchAgentInvoke` | 324–375 | `inline-handlers.ts` |
| 5 skip-symbol declarations (`connectorRpcSkipped`, `peopleRpcSkipped`, `sessionRpcSkipped`, `automationRpcSkipped`, `phase4RpcSkipped`) | 377–381 | `context.ts` |
| `tryDispatchLlmRpc` | 383–400 | `dispatchers.ts` |
| `tryDispatchVoiceRpc` | 402–416 | `dispatchers.ts` |
| `tryDispatchUpdaterRpc` | 418–430 | `dispatchers.ts` |
| `tryDispatchAuditRpc` | 432–442 | `dispatchers.ts` |
| `tryDispatchReindexRpc` | 444–477 | `dispatchers.ts` |
| `tryDispatchProfileRpc` | 479–495 | `dispatchers.ts` |
| `tryDispatchDataRpc` | 497–536 | `dispatchers.ts` |
| `requireLanIndex` / `requireLanPairingWindow` | 538–548 | `dispatchers.ts` (file-private; only `handleLanLocalRpc` uses them) |
| `extractPeerId` | 550–554 | `dispatchers.ts` (file-private; only `handleLanLocalRpc` uses it) |
| `handleLanLocalRpc` | 556–603 | `dispatchers.ts` |
| `tryDispatchLanRpc` | 605–610 | `dispatchers.ts` |
| `tryDispatchPhase4Rpc` (orchestrator) | 612–632 | `dispatchers.ts` |
| `tryDispatchSessionRpc` | 634–657 | `dispatchers.ts` |
| `parseOptionalString` | 659–666 | `inline-handlers.ts` (file-private; only `buildWorkflowRunContext` uses it) |
| `parseWorkflowRunParamsOverride` | 668–680 | `inline-handlers.ts` (file-private) |
| `buildWorkflowRunContext` | 682–710 | `inline-handlers.ts` |
| `dispatchWorkflowRunRpc` | 712–738 | `inline-handlers.ts` |
| `tryDispatchAutomationRpc` | 740–781 | `dispatchers.ts` (note: this dispatcher invokes `dispatchWorkflowRunRpc` from `inline-handlers.ts` for the `workflow.run` case — establishes the dispatchers→inline-handlers import edge) |
| `tryDispatchPeopleRpc` | 783–803 | `dispatchers.ts` |
| `tryDispatchConnectorRpc` | 805–850 | `dispatchers.ts` |
| `rpcGatewayPing` | 852–872 | `inline-handlers.ts` |
| `diagnosticsRpcSkipped` (skip symbol) | 874 | `context.ts` (move to the same place as the other 5) |
| `tryDispatchDiagnosticsRpc` | 876–913 | `dispatchers.ts` |
| `rpcIndexSearchRanked` | 915–949 | `inline-handlers.ts` |
| `rpcConsentRespond` | 951–957 | `inline-handlers.ts` |
| `rpcAuditList` | 959–969 | `inline-handlers.ts` |
| `rpcVaultOrMethodNotFound` | 971–997 | `vault-dispatch.ts` |
| `engine.askStream` body (inside `dispatchMethod` switch case) | 1053–1109 | `inline-handlers.ts` (extracted as `dispatchEngineAskStream(ctx, session, params, clientId)`) |
| `dispatchMethod` | 999–1114 | `server.ts` (thin: ~30 LOC after `engine.askStream` extraction) |
| `attachSession` | 1116–1125 | `server.ts` (factory owns `sessions` map) |
| `attachWin32Socket` | 1127–1146 | `socket-listeners.ts` |
| `startWin32NetServer` | 1148–1159 | `socket-listeners.ts` |
| `startBunUnixListener` | 1161–1184 | `socket-listeners.ts` |
| `IPCServer` returned object literal | 1186–1238 | `server.ts` |

---

## Per-file external import sets

Each new file needs a subset of the original's external imports. **All `../X` imports become `../../X` and all `./Y` imports become `../Y`** because the new files live one directory deeper (same as lazy-mesh PR #163).

To determine what each new file needs:

- **`rpc-error.ts`** — zero imports. Standalone class.
- **`options.ts`** — type-only imports: `ProfileManager` from `../../config/profiles.ts`; `LazyConnectorMesh` from `../../connectors/lazy-mesh/index.ts`; `LocalIndex` from `../../index/local-index.ts`; `LlmRegistry` from `../../llm/registry.ts`; `SessionMemoryStore` from `../../memory/session-memory-store.ts`; `SyncScheduler` from `../../sync/scheduler.ts`; `Updater` from `../../updater/updater.ts`; `NimbusVault` from `../../vault/nimbus-vault.ts`; `VoiceService` from `../../voice/service.ts`; `AgentInvokeHandler` from `../agent-invoke.ts`; `LanServer` from `../lan-server.ts`; `PairingWindow` from `../lan-pairing.ts`; `ClientSession` from `../session.ts`; `WorkflowRunHandler` from `../workflow-invoke.ts`. Plus `BunSessionData` is defined inline from `ClientSession`.
- **`context.ts`** — `ConsentCoordinatorImpl` from `../consent.ts`; `AgentInvokeHandler` from `../agent-invoke.ts`; `WorkflowRunHandler` from `../workflow-invoke.ts`; `CreateIpcServerOptions` from `./options.ts`. Plus the 6 skip-symbol exports.
- **`vault-dispatch.ts`** — `asRecord` from `../../connectors/unknown-record.ts`; `ToolExecutor`, `bindConsentChannel` from `../../engine/executor.ts`; `ConnectorDispatcher` (type) from `../../engine/types.ts`; `validateVaultKeyOrThrow` from `../../vault/key-format.ts`; `NimbusVault` (type) from `../../vault/nimbus-vault.ts`; `RpcMethodError` from `./rpc-error.ts`; `ServerCtx` from `./context.ts`.
- **`socket-listeners.ts`** — `EventEmitter` (type) from `node:events`; `chmodSync`, `existsSync`, `unlinkSync` from `node:fs`; `net` from `node:net`; `ClientSession`, `SessionWrite` (type) from `../session.ts`; `BunSessionData` (type) from `./options.ts`. **Plus** an `attachSession: (write: SessionWrite) => ClientSession` callback parameter (passed in by `server.ts`'s factory; not imported).
- **`inline-handlers.ts`** — `randomUUID` from `node:crypto`; `asRecord` from `../../connectors/unknown-record.ts`; `agentRequestContext`, `AgentRequestContext` from `../../engine/agent-request-context.ts`; `GatewayAgentUnavailableError` from `../../engine/gateway-agent-error.ts`; `Config` from `../../config.ts`; `driftHintsFromIndex` from `../../index/drift-hints.ts`; `IndexSearchQuery` (type) from `../../index/local-index.ts`; `AgentInvokeContext` (type) from `../agent-invoke.ts`; `WorkflowRunContext` (type) from `../workflow-invoke.ts`; `ClientSession` from `../session.ts`; `RpcMethodError` from `./rpc-error.ts`; `ServerCtx` from `./context.ts`.
- **`dispatchers.ts`** — `asRecord` from `../../connectors/unknown-record.ts`; `bindConsentChannel`, `ToolExecutor` from `../../engine/executor.ts`; `ConnectorDispatcher` (type) from `../../engine/types.ts`; `CURRENT_SCHEMA_VERSION` from `../../index/local-index.ts`; `AuditRpcError`, `dispatchAuditRpc` from `../audit-rpc.ts`; `AutomationRpcError`, `dispatchAutomationRpc` from `../automation-rpc.ts`; `ConnectorRpcError`, `dispatchConnectorRpc` from `../connector-rpc.ts`; `DataRpcError`, `dispatchDataRpc` from `../data-rpc.ts`; `DiagnosticsRpcError`, `dispatchDiagnosticsRpc` from `../diagnostics-rpc.ts`; `generatePairingCode` from `../lan-pairing.ts`; `dispatchLlmRpc`, `LlmRpcError` from `../llm-rpc.ts`; `dispatchPeopleRpc`, `PeopleRpcError` from `../people-rpc.ts`; `dispatchProfileRpc`, `ProfileRpcError` from `../profile-rpc.ts`; `dispatchReindexRpc`, `ReindexRpcError` from `../reindex-rpc.ts`; `dispatchSessionRpc`, `SessionRpcError` from `../session-rpc.ts`; `ClientSession` from `../session.ts`; `dispatchUpdaterRpc`, `UpdaterRpcError` from `../updater-rpc.ts`; `dispatchVoiceRpc`, `VoiceRpcError` from `../voice-rpc.ts`; `RpcMethodError` from `./rpc-error.ts`; `ServerCtx` + 6 skip-symbol values from `./context.ts`; `dispatchWorkflowRunRpc` from `./inline-handlers.ts` (for the `workflow.run` route inside `tryDispatchAutomationRpc`).
- **`server.ts`** — `randomUUID` from `node:crypto`; `platform` from `node:os`; `ClientSession`, `SessionWrite` (type) from `../session.ts`; `ConsentCoordinatorImpl` from `../consent.ts`; `errorResponse`, `isRequest`, `JsonRpcId`, `JsonRpcNotification`, `JsonRpcRequest` from `../jsonrpc.ts`; `AgentInvokeHandler` from `../agent-invoke.ts`; `WorkflowRunHandler` from `../workflow-invoke.ts`; `IPCServer` from `../types.ts`; `RpcMethodError` from `./rpc-error.ts`; `ServerCtx`, the 6 skip-symbol values from `./context.ts`; `BunSessionData`, `CreateIpcServerOptions` from `./options.ts`; `dispatchVaultGated`, `rpcVaultOrMethodNotFound` from `./vault-dispatch.ts`; the listener helpers from `./socket-listeners.ts`; the dispatchers used in `dispatchMethod` from `./dispatchers.ts`; the inline handlers (`rpcGatewayPing`, `rpcIndexSearchRanked`, `rpcConsentRespond`, `rpcAuditList`, `dispatchAgentInvoke`, `dispatchEngineAskStream`) from `./inline-handlers.ts`.
- **`index.ts`** — zero external imports; only re-exports from siblings.

The lists above are guidance, not exhaustive. The authoritative process: copy a function, see what symbol names appear in its body, find the matching import line in the original (lines 1–50), copy that import too — adjusted for one extra `..`. Then typecheck.

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

Expected: at `9ae63c8` (PR #163 merge) or later.

- [ ] **Step 2: Create the worktree**

```bash
git worktree add -b dev/asafgolombek/d4-server-split .worktrees/d4-server-split main
cd .worktrees/d4-server-split
bun install
```

Expected: `~2130 packages installed`.

- [ ] **Step 3: Verify the source file's pre-migration state**

```bash
wc -l packages/gateway/src/ipc/server.ts
```

Expected: `1239` LOC.

- [ ] **Step 4: Verify the audit baseline**

```bash
bun run audit:invariants
```

Expected: exits 0; D10 = 0; D11 = 0.

- [ ] **Step 5: Run the existing test suite to capture baseline pass counts**

```bash
bun test packages/gateway/src/ipc/ipc.test.ts 2>&1 | tail -5
bun test packages/gateway/src/ipc/engine-ask-stream.test.ts 2>&1 | tail -5
bun test packages/gateway/src/ipc/server-vault-gated.test.ts 2>&1 | tail -5
bun test packages/gateway/ 2>&1 | tail -5
```

Note the pass counts — they are the baseline that must be unchanged after the move.

### Task 2: Create the directory and `rpc-error.ts`

**Files:**
- Create: `packages/gateway/src/ipc/server/rpc-error.ts`

- [ ] **Step 1: Create the directory structure**

```bash
mkdir -p packages/gateway/src/ipc/server
```

- [ ] **Step 2: Write `rpc-error.ts`**

Paste the `RpcMethodError` class verbatim from `server.ts:52-63`, with `export` (already present in source — verify and preserve).

```ts
export class RpcMethodError extends Error {
  readonly rpcCode: number;
  readonly rpcData?: Record<string, unknown>;
  constructor(rpcCode: number, message: string, rpcData?: Record<string, unknown>) {
    super(message);
    this.rpcCode = rpcCode;
    this.name = "RpcMethodError";
    if (rpcData !== undefined) {
      this.rpcData = rpcData;
    }
  }
}
```

Note: the source has `class RpcMethodError extends Error` (not exported). Add `export` when moving.

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck 2>&1 | tail -5
```

Expected: clean. The original file is untouched, so the workspace still compiles.

### Task 3: Create `options.ts`

**Files:**
- Create: `packages/gateway/src/ipc/server/options.ts`

- [ ] **Step 1: Write `options.ts`**

Paste `BunSessionData` type from line 168 and the `CreateIpcServerOptions` type from lines 170-218 verbatim. The type imports at the top of the file (Profile/Lazy/Local/Llm/Memory/Sync/Updater/Vault/Voice/Lan/Session etc.) move with these types.

```ts
import type { ProfileManager } from "../../config/profiles.ts";
import type { LazyConnectorMesh } from "../../connectors/lazy-mesh/index.ts";
import type { LocalIndex } from "../../index/local-index.ts";
import type { LlmRegistry } from "../../llm/registry.ts";
import type { SessionMemoryStore } from "../../memory/session-memory-store.ts";
import type { SyncScheduler } from "../../sync/scheduler.ts";
import type { Updater } from "../../updater/updater.ts";
import type { NimbusVault } from "../../vault/nimbus-vault.ts";
import type { VoiceService } from "../../voice/service.ts";
import type { AgentInvokeHandler } from "../agent-invoke.ts";
import type { LanServer } from "../lan-server.ts";
import type { PairingWindow } from "../lan-pairing.ts";
import type { ClientSession } from "../session.ts";
import type { WorkflowRunHandler } from "../workflow-invoke.ts";

export type BunSessionData = { session: ClientSession };

export type CreateIpcServerOptions = {
  // [paste verbatim from server.ts:170-218]
};
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck 2>&1 | tail -5
```

Expected: clean.

### Task 4: Create `context.ts`

**Files:**
- Create: `packages/gateway/src/ipc/server/context.ts`

- [ ] **Step 1: Write `context.ts`**

```ts
import type { AgentInvokeHandler } from "../agent-invoke.ts";
import type { ConsentCoordinatorImpl } from "../consent.ts";
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

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck 2>&1 | tail -5
```

Expected: clean.

### Task 5: Create `vault-dispatch.ts`

**Files:**
- Create: `packages/gateway/src/ipc/server/vault-dispatch.ts`

- [ ] **Step 1: Extract vault bodies**

```bash
sed -n '65,71p;92,166p;971,997p' packages/gateway/src/ipc/server.ts > /tmp/vault-bodies.ts
```

(Lines 65-71: `assertWellFormedVaultKey`. Lines 92-166: vault outcome types + `dispatchVaultGated` + `dispatchVaultIfPresent`. Lines 971-997: `rpcVaultOrMethodNotFound`.)

- [ ] **Step 2: Write `vault-dispatch.ts`**

```ts
import { asRecord } from "../../connectors/unknown-record.ts";
import { type ConnectorDispatcher } from "../../engine/types.ts";
import { bindConsentChannel, ToolExecutor } from "../../engine/executor.ts";
import { validateVaultKeyOrThrow } from "../../vault/key-format.ts";
import type { NimbusVault } from "../../vault/nimbus-vault.ts";
import { RpcMethodError } from "./rpc-error.ts";
import type { ServerCtx } from "./context.ts";

function assertWellFormedVaultKey(key: string): void {
  // [body verbatim from server.ts:65-71]
}

type VaultDispatchHit = { readonly kind: "hit"; readonly value: unknown };
type VaultDispatchMiss = { readonly kind: "miss" };
type VaultDispatchOutcome = VaultDispatchHit | VaultDispatchMiss;

/**
 * S2-F8 — wrap `dispatchVaultIfPresent` with a HITL gate for writes
 * [paste verbatim JSDoc + body of dispatchVaultGated from server.ts:96-123]
 */
export async function dispatchVaultGated(
  vault: NimbusVault,
  toolExecutor: ToolExecutor | undefined,
  method: string,
  params: unknown,
): Promise<VaultDispatchOutcome> {
  // [body verbatim from server.ts:108-123]
}

async function dispatchVaultIfPresent(
  vault: NimbusVault,
  method: string,
  params: unknown,
): Promise<VaultDispatchOutcome> {
  // [body verbatim from server.ts:125-166]
}

/** Final fallback in dispatchMethod: try vault.* gated dispatch, else throw -32601. */
export async function rpcVaultOrMethodNotFound(
  ctx: ServerCtx,
  method: string,
  params: unknown,
  clientId: string,
): Promise<unknown> {
  // [body from server.ts:971-997 with substitutions:
  //   options.vault → ctx.options.vault
  //   options.localIndex → ctx.options.localIndex
  //   consentImpl → ctx.consentImpl
  // ]
}
```

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck 2>&1 | tail -5
```

Expected: clean.

### Task 6: Create `socket-listeners.ts`

**Files:**
- Create: `packages/gateway/src/ipc/server/socket-listeners.ts`

- [ ] **Step 1: Extract socket bodies**

```bash
sed -n '73,90p;1127,1184p' packages/gateway/src/ipc/server.ts > /tmp/socket-bodies.ts
```

(Lines 73-90: socket helpers. Lines 1127-1184: `attachWin32Socket`, `startWin32NetServer`, `startBunUnixListener`.)

- [ ] **Step 2: Write `socket-listeners.ts`**

The listener helpers need the factory's `attachSession` callback. Pass it as a parameter rather than importing from `server.ts` (would create a cycle). Each `start*Listener` returns a handle that `server.ts` can close on shutdown.

```ts
import type { EventEmitter } from "node:events";
import { chmodSync, existsSync, unlinkSync } from "node:fs";
import net from "node:net";

import { ClientSession, type SessionWrite } from "../session.ts";
import type { BunSessionData } from "./options.ts";

export function removeStaleUnixSocketIfPresent(listenPath: string): void {
  // [body verbatim from server.ts:73-82]
}

export function chmodListenSocketBestEffort(listenPath: string): void {
  // [body verbatim from server.ts:84-90]
}

export type AttachSessionFn = (write: SessionWrite) => ClientSession;

export type Win32ListenerHandle = {
  netServer: net.Server;
  winSockets: Set<net.Socket>;
};

function attachWin32Socket(
  attachSession: AttachSessionFn,
  winSockets: Set<net.Socket>,
  sock: net.Socket,
): void {
  // [body from server.ts:1127-1146 with substitution:
  //   attachSession via parameter (was closure-bound in source)
  //   winSockets.add / .delete via parameter
  // ]
}

export async function startWin32NetServer(
  listenPath: string,
  attachSession: AttachSessionFn,
): Promise<Win32ListenerHandle> {
  const winSockets = new Set<net.Socket>();
  const netServer = await new Promise<net.Server>((resolve, reject) => {
    const server = net.createServer((sock) => attachWin32Socket(attachSession, winSockets, sock));
    server.listen(listenPath, () => resolve(server));
    (server as unknown as EventEmitter).on("error", (err: Error) => reject(err));
  });
  return { netServer, winSockets };
}

export function startBunUnixListener(
  listenPath: string,
  attachSession: AttachSessionFn,
): ReturnType<typeof Bun.listen<BunSessionData>> {
  return Bun.listen<BunSessionData>({
    unix: listenPath,
    socket: {
      open(socket) {
        const session = attachSession((line) => {
          socket.write(line);
        });
        socket.data = { session };
      },
      data(socket, data: Uint8Array) {
        socket.data.session.push(data);
      },
      close(socket) {
        const s = socket.data.session;
        s.endInput();
        s.dispose();
      },
      error(socket) {
        socket.data.session?.dispose();
      },
    },
  });
}
```

The original `attachWin32Socket` (server.ts:1127-1146) read `winSockets` from the closure; here it takes `winSockets` as a parameter. Otherwise the body is verbatim.

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck 2>&1 | tail -5
```

Expected: clean.

### Task 7: Create `inline-handlers.ts`

**Files:**
- Create: `packages/gateway/src/ipc/server/inline-handlers.ts`

- [ ] **Step 1: Extract inline-handler bodies**

```bash
sed -n '220,229p;313,375p;659,738p;852,872p;915,969p;1053,1109p' packages/gateway/src/ipc/server.ts > /tmp/inline-bodies.ts
```

This grabs:
- 220-229: `requireNonEmptyRpcString`
- 313-322: `sendAgentChunkIfStreaming`
- 324-375: `dispatchAgentInvoke`
- 659-666: `parseOptionalString`
- 668-680: `parseWorkflowRunParamsOverride`
- 682-710: `buildWorkflowRunContext`
- 712-738: `dispatchWorkflowRunRpc`
- 852-872: `rpcGatewayPing`
- 915-949: `rpcIndexSearchRanked`
- 951-957: `rpcConsentRespond`
- 959-969: `rpcAuditList`
- 1053-1109: the `engine.askStream` switch case body (extract as `dispatchEngineAskStream`)

- [ ] **Step 2: Write `inline-handlers.ts`**

```ts
import { randomUUID } from "node:crypto";

import { Config } from "../../config.ts";
import { asRecord } from "../../connectors/unknown-record.ts";
import { agentRequestContext, type AgentRequestContext } from "../../engine/agent-request-context.ts";
import { GatewayAgentUnavailableError } from "../../engine/gateway-agent-error.ts";
import { driftHintsFromIndex } from "../../index/drift-hints.ts";
import type { IndexSearchQuery } from "../../index/local-index.ts";
import type { AgentInvokeContext } from "../agent-invoke.ts";
import type { ClientSession } from "../session.ts";
import type { WorkflowRunContext } from "../workflow-invoke.ts";
import type { ServerCtx } from "./context.ts";
import { RpcMethodError } from "./rpc-error.ts";

// File-private — only used by buildWorkflowRunContext below.
function requireNonEmptyRpcString(rec: Record<string, unknown> | undefined, key: string): string {
  // [body verbatim from server.ts:220-229]
}

// File-private — only used by buildWorkflowRunContext below.
function parseOptionalString(rec: Record<string, unknown> | undefined, key: string): string | undefined {
  // [body verbatim from server.ts:659-666]
}

function sendAgentChunkIfStreaming(session: ClientSession, stream: boolean, text: string): void {
  // [body verbatim from server.ts:313-322]
}

export async function dispatchAgentInvoke(
  ctx: ServerCtx,
  session: ClientSession,
  clientId: string,
  params: unknown,
): Promise<unknown> {
  // [body from server.ts:324-375 with substitutions:
  //   agentInvokeHandler → ctx.getAgentInvokeHandler()
  //   sendAgentChunkIfStreaming(...) — call directly (lives in this file)
  // ]
}

function parseWorkflowRunParamsOverride(
  rec: Record<string, unknown> | undefined,
): Readonly<Record<string, Record<string, unknown>>> | undefined {
  // [body verbatim from server.ts:668-680]
}

function buildWorkflowRunContext(
  clientId: string,
  session: ClientSession,
  params: unknown,
): { ctx: WorkflowRunContext; sessionId: string | undefined } {
  // [body verbatim from server.ts:682-710 — uses sendAgentChunkIfStreaming locally]
}

export async function dispatchWorkflowRunRpc(
  ctx: ServerCtx,
  clientId: string,
  session: ClientSession,
  params: unknown,
): Promise<unknown> {
  // [body from server.ts:712-738 with substitutions:
  //   options.localIndex → ctx.options.localIndex
  //   workflowRunHandler → ctx.getWorkflowRunHandler()
  // ]
}

export function rpcGatewayPing(ctx: ServerCtx, params: unknown): unknown {
  // [body from server.ts:852-872 with substitutions:
  //   options.X → ctx.options.X
  //   startedAtMs → ctx.startedAtMs
  // ]
}

export async function rpcIndexSearchRanked(ctx: ServerCtx, params: unknown): Promise<unknown> {
  // [body from server.ts:915-949 with substitutions:
  //   options.localIndex → ctx.options.localIndex
  // ]
}

export function rpcConsentRespond(ctx: ServerCtx, clientId: string, params: unknown): unknown {
  // [body from server.ts:951-957 with substitution:
  //   consentImpl → ctx.consentImpl
  // ]
}

export function rpcAuditList(ctx: ServerCtx, params: unknown): unknown {
  // [body from server.ts:959-969 with substitution:
  //   options.localIndex → ctx.options.localIndex
  // ]
}

export function dispatchEngineAskStream(
  ctx: ServerCtx,
  session: ClientSession,
  clientId: string,
  params: unknown,
): { streamId: string } {
  // [body from server.ts:1053-1109 (the switch-case body) with substitutions:
  //   agentInvokeHandler → ctx.getAgentInvokeHandler()
  // ]
}
```

**Substitution checklist for the extracted dispatchers/handlers:**

1. Function signature: prepend `ctx: ServerCtx` as first param. Most need `clientId` and/or `session` as additional params (all already exist as locals or closure vars in the source).
2. `options.X` → `ctx.options.X` (all option reads).
3. `consentImpl` → `ctx.consentImpl`.
4. `startedAtMs` → `ctx.startedAtMs`.
5. `agentInvokeHandler` (closure read) → `ctx.getAgentInvokeHandler()`.
6. `workflowRunHandler` (closure read) → `ctx.getWorkflowRunHandler()`.
7. **No body-logic edits** — same control flow, same string literals, same try/catch placement.

**Critical clarification on handler-getter call site (re plan-review § 2.2):**

The original code captures the handler **once** at the top of each handler-using function:

```ts
// server.ts:340 (dispatchAgentInvoke), :720 (dispatchWorkflowRunRpc), :1063 (engine.askStream switch case)
const handler = agentInvokeHandler;  // or workflowRunHandler
if (handler === undefined) { ... early return / throw ... }
// ... rest of the function — uses the captured `handler` local, including inside async IIFEs ...
```

This "capture once" semantic must be preserved exactly. When extracting:

```ts
// CORRECT — getter called once, captured in local:
const handler = ctx.getAgentInvokeHandler();
if (handler === undefined) { ... }
// ... async block uses captured `handler` ...

// WRONG — re-reading the getter inside an async block could see a different
// value if setAgentInvokeHandler fires between the top-level guard and the
// async resumption:
if (ctx.getAgentInvokeHandler() === undefined) { ... }
// ... async block calls ctx.getAgentInvokeHandler() again ...
```

The original behavior is "the handler is locked in for the duration of that specific call/stream". Replicate it by calling `ctx.getAgentInvokeHandler()` / `ctx.getWorkflowRunHandler()` exactly once at the same point in the function where the source captures the closure variable, and using the captured local thereafter. Verify by visual diff against the source after each extraction.

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck 2>&1 | tail -5
```

Expected: clean.

### Task 8: Create `dispatchers.ts`

**Files:**
- Create: `packages/gateway/src/ipc/server/dispatchers.ts`

This is the largest file (~580 LOC) and has the most extractions. Each `tryDispatchXxxRpc` follows the same substitution pattern from Task 7 plus the prepended `ctx: ServerCtx` parameter.

- [ ] **Step 1: Extract dispatcher bodies**

```bash
sed -n '231,256p;383,632p;634,657p;740,803p;805,850p;876,913p' packages/gateway/src/ipc/server.ts > /tmp/dispatchers-bodies.ts
```

This grabs:
- 231-256: `assertDiagnosticsRpcAccess` (file-private helper)
- 383-632: 7 phase-4 dispatchers + LAN local helpers + LAN dispatcher + phase4 orchestrator (long contiguous block)
- 634-657: `tryDispatchSessionRpc`
- 740-781: `tryDispatchAutomationRpc`
- 783-803: `tryDispatchPeopleRpc`
- 805-850: `tryDispatchConnectorRpc`
- 876-913: `tryDispatchDiagnosticsRpc`

- [ ] **Step 2: Write `dispatchers.ts`**

```ts
import { asRecord } from "../../connectors/unknown-record.ts";
import { bindConsentChannel, ToolExecutor } from "../../engine/executor.ts";
import type { ConnectorDispatcher } from "../../engine/types.ts";
import { CURRENT_SCHEMA_VERSION } from "../../index/local-index.ts";
import { AuditRpcError, dispatchAuditRpc } from "../audit-rpc.ts";
import { AutomationRpcError, dispatchAutomationRpc } from "../automation-rpc.ts";
import { ConnectorRpcError, dispatchConnectorRpc } from "../connector-rpc.ts";
import { DataRpcError, dispatchDataRpc } from "../data-rpc.ts";
import { DiagnosticsRpcError, dispatchDiagnosticsRpc } from "../diagnostics-rpc.ts";
import { generatePairingCode } from "../lan-pairing.ts";
import { dispatchLlmRpc, LlmRpcError } from "../llm-rpc.ts";
import { dispatchPeopleRpc, PeopleRpcError } from "../people-rpc.ts";
import { dispatchProfileRpc, ProfileRpcError } from "../profile-rpc.ts";
import { dispatchReindexRpc, ReindexRpcError } from "../reindex-rpc.ts";
import { dispatchSessionRpc, SessionRpcError } from "../session-rpc.ts";
import type { ClientSession } from "../session.ts";
import { dispatchUpdaterRpc, UpdaterRpcError } from "../updater-rpc.ts";
import { dispatchVoiceRpc, VoiceRpcError } from "../voice-rpc.ts";
import {
  automationRpcSkipped,
  connectorRpcSkipped,
  diagnosticsRpcSkipped,
  peopleRpcSkipped,
  phase4RpcSkipped,
  type ServerCtx,
  sessionRpcSkipped,
} from "./context.ts";
import { dispatchWorkflowRunRpc } from "./inline-handlers.ts";
import type { CreateIpcServerOptions } from "./options.ts";
import { RpcMethodError } from "./rpc-error.ts";

// File-private; only tryDispatchDiagnosticsRpc uses it.
function assertDiagnosticsRpcAccess(
  method: string,
  wantsConfig: boolean,
  wantsTelemetry: boolean,
  wantsDiagnostics: boolean,
  opts: Pick<CreateIpcServerOptions, "configDir" | "dataDir" | "localIndex">,
): void {
  // [body verbatim from server.ts:231-256]
}

[paste 14 dispatcher functions (each `export async function tryDispatchXxxRpc(ctx, ...)`):
  tryDispatchLlmRpc
  tryDispatchVoiceRpc
  tryDispatchUpdaterRpc
  tryDispatchAuditRpc
  tryDispatchReindexRpc
  tryDispatchProfileRpc
  tryDispatchDataRpc
  + LAN local helpers (file-private): requireLanIndex, requireLanPairingWindow, extractPeerId
  handleLanLocalRpc (file-private)
  tryDispatchLanRpc
  tryDispatchPhase4Rpc (orchestrator — calls all the above in order)
  tryDispatchSessionRpc
  tryDispatchAutomationRpc (calls dispatchWorkflowRunRpc from inline-handlers.ts for `workflow.run`)
  tryDispatchPeopleRpc
  tryDispatchConnectorRpc
  tryDispatchDiagnosticsRpc]
```

**Substitution checklist for each dispatcher:**

1. Signature: `private async tryDispatchXxxRpc(method, params, ...): Promise<unknown>` → `export async function tryDispatchXxxRpc(ctx: ServerCtx, method, params, ...): Promise<unknown>`. Some take `clientId`; those keep it as the last param after `params`.
2. `options.X` → `ctx.options.X`.
3. `broadcastNotification(...)` → `ctx.broadcastNotification(...)`.
4. `consentImpl` → `ctx.consentImpl`.
5. `phase4RpcSkipped` etc. — already imported from `./context.ts`.
6. `tryDispatchPhase4Rpc` calls `tryDispatchLlmRpc(ctx, method, params)` etc. — pass `ctx` to each delegate.
7. `tryDispatchAutomationRpc`'s `workflow.run` branch: `return dispatchWorkflowRunRpc(clientId, session, params);` → `return dispatchWorkflowRunRpc(ctx, clientId, session, params);`. Note: `tryDispatchAutomationRpc` already takes `clientId` and `session` from the source.

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck 2>&1 | tail -5
```

Expected: clean. If a missing import surfaces, add it from the original's lines 1-50 (with one extra `..`).

### Task 9: Create `server.ts` (the slimmed factory)

**Files:**
- Create: `packages/gateway/src/ipc/server/server.ts`

- [ ] **Step 1: Write `server.ts`**

```ts
import { randomUUID } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import type net from "node:net";
import { platform } from "node:os";

import type { AgentInvokeHandler } from "../agent-invoke.ts";
import { ConsentCoordinatorImpl } from "../consent.ts";
import {
  errorResponse,
  isRequest,
  type JsonRpcId,
  type JsonRpcNotification,
  type JsonRpcRequest,
} from "../jsonrpc.ts";
import { ClientSession, type SessionWrite } from "../session.ts";
import type { IPCServer } from "../types.ts";
import type { WorkflowRunHandler } from "../workflow-invoke.ts";
import {
  automationRpcSkipped,
  connectorRpcSkipped,
  diagnosticsRpcSkipped,
  peopleRpcSkipped,
  phase4RpcSkipped,
  type ServerCtx,
  sessionRpcSkipped,
} from "./context.ts";
import {
  tryDispatchAutomationRpc,
  tryDispatchConnectorRpc,
  tryDispatchDiagnosticsRpc,
  tryDispatchPeopleRpc,
  tryDispatchPhase4Rpc,
  tryDispatchSessionRpc,
} from "./dispatchers.ts";
import {
  dispatchAgentInvoke,
  dispatchEngineAskStream,
  rpcAuditList,
  rpcConsentRespond,
  rpcGatewayPing,
  rpcIndexSearchRanked,
} from "./inline-handlers.ts";
import type { BunSessionData, CreateIpcServerOptions } from "./options.ts";
import { RpcMethodError } from "./rpc-error.ts";
import {
  chmodListenSocketBestEffort,
  removeStaleUnixSocketIfPresent,
  startBunUnixListener,
  startWin32NetServer,
} from "./socket-listeners.ts";
import { dispatchVaultGated, rpcVaultOrMethodNotFound } from "./vault-dispatch.ts";

export function createIpcServer(options: CreateIpcServerOptions): IPCServer {
  const startedAtMs = options.startedAtMs ?? Date.now();
  let agentInvokeHandler: AgentInvokeHandler | undefined = options.agentInvoke;
  let workflowRunHandler: WorkflowRunHandler | undefined = options.workflowRun;
  const sessions = new Map<string, ClientSession>();
  const consentImpl = new ConsentCoordinatorImpl((clientId) => {
    const session = sessions.get(clientId);
    return session === undefined ? undefined : (n) => session.writeNotification(n);
  });

  let bunListener: ReturnType<typeof Bun.listen<BunSessionData>> | undefined;
  let netServer: net.Server | undefined;
  let winSockets: Set<net.Socket> = new Set();

  function broadcastNotification(method: string, params: Record<string, unknown>): void {
    for (const session of sessions.values()) {
      session.writeNotification({ jsonrpc: "2.0", method, params });
    }
  }

  if (options.voiceService !== undefined) {
    options.voiceService.onMicrophoneStateChange = (e) => {
      broadcastNotification("voice.microphoneActive", { active: e.active, source: e.source });
    };
  }

  // Constructor-bound facade exposing closure state to extracted dispatchers.
  // Same pattern as MeshSpawnContext in lazy-mesh PR #163.
  const ctx: ServerCtx = {
    options,
    consentImpl,
    startedAtMs,
    broadcastNotification,
    getAgentInvokeHandler: () => agentInvokeHandler,
    getWorkflowRunHandler: () => workflowRunHandler,
  };

  function attachSession(write: SessionWrite): ClientSession {
    const clientId = randomUUID();
    const session = new ClientSession(clientId, write, handleRpc, (cid) => {
      sessions.delete(cid);
      consentImpl.onClientDisconnect(cid);
    });
    sessions.set(clientId, session);
    options.onClientConnected?.(clientId);
    return session;
  }

  async function handleRpc(
    clientId: string,
    msg: JsonRpcRequest | JsonRpcNotification,
  ): Promise<void> {
    // [body verbatim from server.ts:284-311 — calls dispatchMethod]
  }

  async function dispatchMethod(
    clientId: string,
    session: ClientSession,
    req: JsonRpcRequest,
  ): Promise<unknown> {
    const { method } = req;
    const params = req.params;

    const sessionOutcome = await tryDispatchSessionRpc(ctx, method, params);
    if (sessionOutcome !== sessionRpcSkipped) return sessionOutcome;

    const automationOutcome = await tryDispatchAutomationRpc(ctx, clientId, session, method, params);
    if (automationOutcome !== automationRpcSkipped) return automationOutcome;

    const connectorOutcome = await tryDispatchConnectorRpc(ctx, method, params, clientId);
    if (connectorOutcome !== connectorRpcSkipped) return connectorOutcome;

    const diagnosticsHit = await tryDispatchDiagnosticsRpc(ctx, method, params);
    if (diagnosticsHit !== diagnosticsRpcSkipped) return diagnosticsHit;

    const peopleOutcome = tryDispatchPeopleRpc(ctx, method, params);
    if (peopleOutcome !== peopleRpcSkipped) return peopleOutcome;

    const phase4Outcome = await tryDispatchPhase4Rpc(ctx, method, params, clientId);
    if (phase4Outcome !== phase4RpcSkipped) return phase4Outcome;

    switch (method) {
      case "gateway.ping":
        return rpcGatewayPing(ctx, params);
      case "index.searchRanked":
        return await rpcIndexSearchRanked(ctx, params);
      case "agent.invoke":
        return await dispatchAgentInvoke(ctx, session, clientId, params);
      case "consent.respond":
        return rpcConsentRespond(ctx, clientId, params);
      case "audit.list":
        return rpcAuditList(ctx, params);
      case "engine.askStream":
        return dispatchEngineAskStream(ctx, session, clientId, params);
      default:
        return await rpcVaultOrMethodNotFound(ctx, method, params, clientId);
    }
  }

  return {
    listenPath: options.listenPath,
    consent: consentImpl,
    setAgentInvokeHandler(handler: AgentInvokeHandler | undefined): void {
      agentInvokeHandler = handler;
    },
    setWorkflowRunHandler(handler: WorkflowRunHandler | undefined): void {
      workflowRunHandler = handler;
    },
    async start(): Promise<void> {
      if (platform() === "win32") {
        const handle = await startWin32NetServer(options.listenPath, attachSession);
        netServer = handle.netServer;
        winSockets = handle.winSockets;
        return;
      }
      removeStaleUnixSocketIfPresent(options.listenPath);
      bunListener = startBunUnixListener(options.listenPath, attachSession);
      chmodListenSocketBestEffort(options.listenPath);
    },
    async stop(): Promise<void> {
      consentImpl.rejectAllPending("Gateway shutting down", "gateway shutting down");
      if (netServer !== undefined) {
        const s = netServer;
        netServer = undefined;
        for (const sock of winSockets) sock.destroy();
        winSockets.clear();
        await new Promise<void>((resolve) => {
          s.close(() => resolve());
        });
        return;
      }
      if (bunListener !== undefined) {
        const l = bunListener;
        bunListener = undefined;
        for (const sess of sessions.values()) sess.dispose();
        sessions.clear();
        l.stop(true);
        if (existsSync(options.listenPath)) {
          try {
            unlinkSync(options.listenPath);
          } catch {
            /* ignore */
          }
        }
      }
    },
  };
}
```

The body of `handleRpc` (server.ts:284-311) and `dispatchMethod` (server.ts:999-1114) move to this file. `dispatchMethod` is now ~30 LOC after extracting `engine.askStream`.

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck 2>&1 | tail -5
```

Expected: clean.

### Task 10: Create `index.ts`

**Files:**
- Create: `packages/gateway/src/ipc/server/index.ts`

- [ ] **Step 1: Write the re-export shim**

```ts
export type { CreateIpcServerOptions } from "./options.ts";
export { createIpcServer } from "./server.ts";
export { dispatchVaultGated } from "./vault-dispatch.ts";
```

Order: alphabetical-by-source-file (options → server → vault-dispatch). `ServerCtx`, `RpcMethodError`, the 6 skip symbols, the `ServerCtx`-typed dispatchers/handlers stay module-internal.

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck 2>&1 | tail -5
```

Expected: clean.

### Task 11: Delete the original `server.ts`

**Files:**
- Delete: `packages/gateway/src/ipc/server.ts`

- [ ] **Step 1: Remove the original**

```bash
rm packages/gateway/src/ipc/server.ts
```

- [ ] **Step 2: Run typecheck — expect 4 broken imports**

```bash
bun run typecheck 2>&1 | tail -10
```

Expected: TS errors on:
1. `packages/gateway/src/ipc/index.ts` (re-export from `./server.ts`)
2. `packages/gateway/src/ipc/engine-ask-stream.test.ts` (imports from `./server.ts`)
3. `packages/gateway/src/ipc/ipc.test.ts` (imports from `./server.ts`)
4. `packages/gateway/src/ipc/server-vault-gated.test.ts` (imports `dispatchVaultGated`)

If typecheck is clean (zero errors), Bun's directory resolution auto-resolved — skip Task 12 and go to Task 13.

### Task 12: Update consumer import paths

**Files:**
- Modify: `packages/gateway/src/ipc/index.ts`
- Modify: `packages/gateway/src/ipc/engine-ask-stream.test.ts`
- Modify: `packages/gateway/src/ipc/ipc.test.ts`
- Modify: `packages/gateway/src/ipc/server-vault-gated.test.ts`

For each file, change `./server.ts` → `./server/index.ts`. Imported symbols unchanged.

- [ ] **Step 1: Update all 4 files**

```bash
sed -i 's|"./server.ts"|"./server/index.ts"|g' \
  packages/gateway/src/ipc/index.ts \
  packages/gateway/src/ipc/engine-ask-stream.test.ts \
  packages/gateway/src/ipc/ipc.test.ts \
  packages/gateway/src/ipc/server-vault-gated.test.ts
```

- [ ] **Step 2: Verify — no remaining `./server.ts` references**

```bash
grep -rn 'from.*"\./server\.ts"' packages/gateway/src/ipc/ --include="*.ts"
```

Expected: zero matches.

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck 2>&1 | tail -5
```

Expected: clean across all packages.

### Task 13: Verify all acceptance gates

**Files:** none (verification)

- [ ] **Step 1: Audit invariants**

```bash
bun run audit:invariants
```

Expected: exits 0; D10 = 0; D11 = 0.

- [ ] **Step 2: Lint**

```bash
bun run lint
```

Expected: clean. (If Biome reformats imports in any of the new files, accept the format.)

- [ ] **Step 3: Targeted server tests**

```bash
bun test packages/gateway/src/ipc/ipc.test.ts
bun test packages/gateway/src/ipc/engine-ask-stream.test.ts
bun test packages/gateway/src/ipc/server-vault-gated.test.ts
```

Expected: pass count unchanged from baseline (Task 1 Step 5).

- [ ] **Step 4: Full gateway suite**

```bash
bun test packages/gateway/
```

Expected: pass count unchanged from baseline.

- [ ] **Step 5: New file LOC sanity check**

```bash
wc -l packages/gateway/src/ipc/server/*.ts
```

Expected: each file under ~700 LOC; no file over 800 LOC. Largest: `dispatchers.ts` at ~580 LOC.

- [ ] **Step 6: CI parity (the user's enforced pre-push check per memory `feedback_preflight_before_pr.md`)**

```bash
bun run test:ci
```

Expected: gateway/scripts/sdk/mcp suites pass. UI vitest V8 coverage flake is acceptable (same as PRs #149–#164).

### Task 14: Commit + push + open PR

**Files:** none (git ops)

- [ ] **Step 1: Stage**

```bash
git add packages/gateway/src/ipc/server/ \
        packages/gateway/src/ipc/server.ts \
        packages/gateway/src/ipc/index.ts \
        packages/gateway/src/ipc/engine-ask-stream.test.ts \
        packages/gateway/src/ipc/ipc.test.ts \
        packages/gateway/src/ipc/server-vault-gated.test.ts
```

(`git add` of the deleted `server.ts` records the deletion. `git status` should show 9 new files added, 1 file deleted, 4 files modified. Total: 14 entries.)

- [ ] **Step 2: Verify staged set**

```bash
git status
```

Expected:
- new files: `packages/gateway/src/ipc/server/{rpc-error,options,context,vault-dispatch,socket-listeners,inline-handlers,dispatchers,server,index}.ts`
- deleted: `packages/gateway/src/ipc/server.ts`
- modified: `packages/gateway/src/ipc/index.ts`, `engine-ask-stream.test.ts`, `ipc.test.ts`, `server-vault-gated.test.ts`

If any other files appear (e.g., `junit-reports/junit-vitest.xml`), do not stage them.

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
refactor(ipc): D4 — split server.ts into namespace directory

Replaces the 1239-LOC packages/gateway/src/ipc/server.ts with a
directory of concern-focused sibling files:

- index.ts            — re-export shim (3 public symbols)
- rpc-error.ts        — RpcMethodError class (universal error type)
- options.ts          — CreateIpcServerOptions type + BunSessionData
- context.ts          — ServerCtx interface + 6 skip-symbol exports
- vault-dispatch.ts   — vault gate + dispatchVaultGated (public) +
                        rpcVaultOrMethodNotFound
- socket-listeners.ts — Win32 + Bun unix listener wiring + helpers
- inline-handlers.ts  — direct method handlers (gateway.ping,
                        index.searchRanked, consent.respond,
                        audit.list, agent.invoke, engine.askStream,
                        workflow.run + helpers)
- dispatchers.ts      — all 14 tryDispatchXxxRpc free functions
                        taking ServerCtx (largest at ~580 LOC)
- server.ts           — createIpcServer factory + closure state +
                        thin dispatchMethod + IPCServer object

Mostly mechanical move; zero behavioral change. Per-namespace
dispatchers and inline handlers become free functions accepting a
constructor-bound ServerCtx. agentInvokeHandler / workflowRunHandler
are exposed as getters (ctx.getAgentInvokeHandler() etc.) so the
public setAgentInvokeHandler / setWorkflowRunHandler API still
affects future dispatched calls.

The largest resulting file is dispatchers.ts at ~580 LOC, well under
the 800 D4 threshold.

Four consumer files (ipc/index.ts, engine-ask-stream.test.ts,
ipc.test.ts, server-vault-gated.test.ts) update their import path
from "./server.ts" to "./server/index.ts".

Spec: docs/superpowers/specs/2026-05-02-d4-server-split-design.md
Plan: docs/superpowers/plans/2026-05-02-d4-server-split.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Push**

```bash
git push -u origin dev/asafgolombek/d4-server-split
```

- [ ] **Step 5: Open the PR**

```bash
gh pr create --base main --title "refactor(ipc): D4 — split server.ts into namespace directory" --body "$(cat <<'EOF'
## Summary
Replaces the 1239-LOC \`server.ts\` with a directory of concern-focused sibling files:

| File | Responsibility | LOC |
|---|---|---|
| \`index.ts\` | Re-export shim | ~10 |
| \`rpc-error.ts\` | RpcMethodError class | ~20 |
| \`options.ts\` | CreateIpcServerOptions type | ~70 |
| \`context.ts\` | ServerCtx interface + 6 skip symbols (internal) | ~50 |
| \`vault-dispatch.ts\` | Vault gate + dispatchVaultGated (public) | ~110 |
| \`socket-listeners.ts\` | Win32 + Bun listener wiring | ~120 |
| \`inline-handlers.ts\` | Direct method handlers + agent/workflow/askStream | ~360 |
| \`dispatchers.ts\` | 14 tryDispatchXxxRpc free functions | ~580 |
| \`server.ts\` | createIpcServer factory + thin dispatchMethod | ~280 |

Mostly-mechanical move; **zero behavioral change**. Per-namespace dispatchers and inline handlers become free functions accepting a constructor-bound \`ServerCtx\` (mirrors the lazy-mesh \`MeshSpawnContext\` pattern from PR #163).

\`agentInvokeHandler\` and \`workflowRunHandler\` are exposed as **getters** on \`ServerCtx\` (\`ctx.getAgentInvokeHandler()\` etc.) so the public \`setAgentInvokeHandler\` / \`setWorkflowRunHandler\` setters still affect future dispatched calls. This is the only non-mechanical aspect of the refactor; documented in spec § 3.5.

The largest file (dispatchers.ts) is well under the 800 D4 threshold.

## Test plan
- [x] \`bun run audit:invariants\` exits 0; D10 = 0, D11 = 0.
- [x] \`bun test packages/gateway/src/ipc/ipc.test.ts\` — pass count unchanged.
- [x] \`bun test packages/gateway/src/ipc/engine-ask-stream.test.ts\` — pass count unchanged.
- [x] \`bun test packages/gateway/src/ipc/server-vault-gated.test.ts\` — pass count unchanged.
- [x] \`bun test packages/gateway/\` — full gateway-suite pass count unchanged.
- [x] \`bun run typecheck\` clean.
- [x] \`bun run lint\` clean.
- [x] \`bun run test:ci\` clean (modulo known UI vitest V8 coverage flake).

## Spec / Plan
- Spec: \`docs/superpowers/specs/2026-05-02-d4-server-split-design.md\`
- Plan: \`docs/superpowers/plans/2026-05-02-d4-server-split.md\`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

- [ ] **Step 6: Wait for CI; request review; merge.**

After merge: D4 has one less violation (\`server.ts\` is gone). Three D4 candidates remain: \`cli/commands/connector.ts\` (1238 LOC), \`index/local-index.ts\` (987 LOC), \`auth/pkce.ts\` (886 LOC).

---

## Important constraints

- **Mostly mechanical move.** Function bodies migrate verbatim except for two well-defined substitutions: (a) `options.X` / closure-captured state → `ctx.X`, (b) `agentInvokeHandler` / `workflowRunHandler` reads → `ctx.getAgentInvokeHandler()` / `ctx.getWorkflowRunHandler()` (preserves setter reactivity).
- **Surrounding control flow / null-checks / try-catch placement / error messages stay byte-identical.**
- **No new test files. No test-body edits. Only test-import-path tweaks (Task 12).**
- **No new helpers added beyond `ServerCtx` interface + 6 skip-symbol exports + the listener-handle return type from `socket-listeners.ts`.** Specifically: NO `createIpcToolExecutor(ctx, clientId)` helper — captured as future follow-up in spec § 8, deliberately out of scope.
- **The 9 new files together must equal the original file's behavior.** A reviewer should be able to read each function body in the new files and verify it matches the original byte-for-byte modulo the documented substitutions.
- **`ServerCtx` and the 6 skip symbols stay module-internal.** Not re-exported from `index.ts`. Adding them to the public API is a separate decision.
- **Setter reactivity preservation.** `setAgentInvokeHandler(newHandler)` after `start()` must affect subsequent `agent.invoke` and `engine.askStream` calls. Verified by the existing `ipc.test.ts` and `engine-ask-stream.test.ts` assertions; if either fails, the getter pattern was wired incorrectly.

---

## Review dispositions (2026-05-02 Gemini CLI plan review)

Recorded for traceability. Source: [`2026-05-02-d4-server-split-feedback.md`](./2026-05-02-d4-server-split-feedback.md).

- **§ 2.1 — Explicit `export` for `RpcMethodError` → NOTE (already covered).** Plan Task 2 Step 2 already directs adding `export` (the source has it unexported). Per-file imports section already lists `RpcMethodError from "./rpc-error.ts"` in `vault-dispatch.ts`, `inline-handlers.ts`, `dispatchers.ts`, and `server.ts`. No change.
- **§ 2.2 — Reactivity of handler captures in `dispatchEngineAskStream` (and `dispatchAgentInvoke` / `dispatchWorkflowRunRpc`) → ACCEPT.** The substitution checklist's bare "agentInvokeHandler → ctx.getAgentInvokeHandler()" rule was ambiguous on call frequency. The original code captures the handler **once** at the top of each function and uses the captured local thereafter, including inside async IIFEs. Re-reading the getter inside an async block could see a different handler if the setter fires mid-stream — a subtle behavior regression. Task 7's substitution checklist now has a "Critical clarification on handler-getter call site" block making the "capture once" pattern explicit, with a worked CORRECT vs WRONG example.
- **§ 2.3 — Uniform `clientId` parameter on every dispatcher → DECLINE.** Same suggestion as spec-review § 2.3, already declined at spec level (spec § 8 / § 9). Plan inherits the decision: each dispatcher's signature reflects what it actually consumes; adding unused `clientId` to LLM/voice/etc. dispatchers introduces parameters that linters routinely flag.
- **§ 2.4 — `winSockets` initialization → NOTE (already correct).** Reviewer confirmed Task 9's `let winSockets = new Set()` + `winSockets = handle.winSockets` reassign + `stop()` iteration is correct. No change.

## Self-review notes

- **Spec coverage:** every spec section maps to tasks. § 1 (Goal) → all tasks. § 2 (Non-goals) → "Important constraints" block. § 3.1 (Directory replaces file) → Tasks 2–11. § 3.2 (Public surface) → Task 10. § 3.3 (ServerCtx) → Task 4 + Task 9 Step 1 ctx-construction block. § 3.4 (Free-function shape) → Tasks 7 + 8 substitution checklists. § 3.5 (Mutable handler accessors) → Task 9 Step 1 (the getter wiring). § 3.6 (Consumer impact) → Task 12. § 4 (Behavioral guarantees) → "Important constraints" block. § 5 (Tests) → Task 13. § 6 (Acceptance criteria) → Task 13 + Task 14 verification.
- **Bun directory resolution:** Task 11 detects whether Bun auto-resolves; Task 12 runs only if it doesn't. Predecessor PRs (#160, #163) confirmed Bun does NOT auto-resolve, so Task 12 IS expected to run.
- **Listener-handle pattern (Task 6):** The `start*Listener` helpers return small handle objects (`Win32ListenerHandle` for net.Server + winSockets, the raw `Bun.listen` return for the unix path) so `server.ts`'s `stop()` can close them without re-implementing the cleanup logic. This is the only structural deviation from "verbatim move" — the original held `bunListener` / `netServer` / `winSockets` as closure variables; here, `start*Listener` constructs them and returns them.
- **`tryDispatchAutomationRpc` cross-file edge:** This dispatcher is the only one in `dispatchers.ts` that calls into `inline-handlers.ts` (specifically `dispatchWorkflowRunRpc` for `workflow.run`). The import edge is documented in the per-file imports section.
- **Line-range drift:** the function-to-file map at the top of the plan uses pre-migration line numbers from `main` at commit `9ae63c8`. If `main` shifts before this PR is opened, re-grep with `grep -n` and update the line ranges before Task 2 starts.
- **Setter reactivity test:** No targeted unit test exercises the `setAgentInvokeHandler` setter directly. If `ipc.test.ts` doesn't cover the "set handler after start" code path, consider running an ad-hoc REPL check before pushing: construct the server with no handler, call `start()`, then `setAgentInvokeHandler(...)`, then drive an RPC and verify the handler fires. This is paranoid but cheap. Alternatively, the existing tests likely exercise this implicitly because the gateway boot sequence sets handlers after `start()`.
