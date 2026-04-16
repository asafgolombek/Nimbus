# Nimbus Code Improvement Plan

> Scope: Performance, code duplication, security hardening, and SOLID alignment  
> Audience: Nimbus contributors  
> Last updated: 2026-04-16

### Completion log (in-repo)

2026-04-16 (initial) — **S3.1**, **S3.2**, **S3.5**, **S3.7**, **D2.2**, **D2.1** (foundation: `zod` + `ipc/params.ts`), **P1.1**, **P1.2**, **P1.3**, **P1.7**, **A5.1**.

2026-04-16 (follow-up) — **P1.4** (short TTL `WeakMap` cache for `COUNT(*)` on `item` in `run-ask.ts`), **P1.5** (`listConnectors` reads `sync_state`, static catalog fallback), **P1.6** (`context-ranker` linear merge after sort, no per-call `Map`), **D2.3** (unified `llmClassify` in `router.ts`), **D2.5** (`formatAuditPayload` in `audit/format-audit-payload.ts`, used by `executor`), **S3.3** (clipped tool strings in `agent.ts`), **S3.4** (`runReadOnlySelect` opens a dedicated readonly DB file — `diagnostics-rpc` passes `dataDir/nimbus.db`), **S3.6** (defensive `try/catch` around `onRpc` in `ClientSession.dispatchLines`), **OCP-lite** (`BUILTIN_INTENT_PLANNERS` table in `planner.ts`), **ISP** (`VaultReader` / `VaultWriter` / `VaultDeleter` / `VaultLister` on `NimbusVault` in `nimbus-vault.ts`), **A5.2** (`structuredClone` on returns from `loadNimbusEmbeddingFromPath`).

**Deferred (large refactors / optional follow-up):** **D2.1** full `zod` migration of every IPC handler in `server.ts`; **D2.4** lazy-mesh `Map` for bundled MCP client pairs; **SRP** split of `lazy-mesh.ts` / `scheduler.ts`; **DIP** `SchedulerStateRepository` injection; **P1.4** strict invalidation wired to sync telemetry (currently TTL-only).

---

## How to use this document

Each issue has a priority rating (**P0 critical → P3 nice-to-have**) and an estimated LOC delta. Issues are grouped by concern, then cross-referenced where they interact. Fix them in priority order within each section; many items in one section unblock cleanly independent work in another.

---

## 1. Performance

### P1.1 — N+1 query pattern in `SyncScheduler.tick()` · **P0**

**File:** `packages/gateway/src/sync/scheduler.ts` ~lines 370–387  
**Problem:** `tick()` calls `loadSchedulerState(db, id)` inside a `for` loop over every registered connector, issuing one `SELECT` per connector per tick.  
**Fix:** Batch-load all scheduler rows at the start of `tick()` and filter in memory.

```typescript
// Before — O(n) queries
for (const id of this.connectors.keys()) {
  const row = loadSchedulerState(this.db, id);
  …
}

// After — 1 query
const allRows = loadAllSchedulerStates(this.db);  // SELECT * FROM sync_state
const rowMap = new Map(allRows.map(r => [r.serviceId, r]));
for (const id of this.connectors.keys()) {
  const row = rowMap.get(id);
  …
}
```

**Impact:** ~80 % faster scheduling tick with 50+ connectors.

---

### P1.2 — Repeated `getConnectorHealth()` calls per connector per tick · **P0**

**File:** `packages/gateway/src/sync/scheduler.ts` ~lines 315, 339, 356, 375  
**Problem:** `connectorSkippedForHealth()` and `rowToStatus()` each call `getConnectorHealth()` independently, tripling the read load.  
**Fix:** Call `getAllConnectorHealth()` once at the top of `tick()` and pass the snapshot map down.

---

### P1.3 — Script path recalculated in 30+ functions · **P1**

**File:** `packages/gateway/src/connectors/lazy-mesh.ts` ~lines 21–159  
**Problem:** Every `*McpScriptPath()` helper recomputes `dirname(fileURLToPath(import.meta.url))` at call time. There are 30+ such functions.  
**Fix:** Compute the base path once at module level:

```typescript
const _HERE = dirname(fileURLToPath(import.meta.url));
const MCP_BASE = join(_HERE, "..", "..", "..", "mcp-connectors");

const CONNECTOR_SCRIPT_PATHS: Record<string, string> = {
  "google-drive": join(MCP_BASE, "google-drive", "src", "server.ts"),
  "github":        join(MCP_BASE, "github",       "src", "server.ts"),
  // …
};
```

**Impact:** Removes ~300 lines; adding a new connector becomes one map entry.

---

### P1.4 — `COUNT(*)` on FTS5 table in async hot path · **P1**

**File:** `packages/gateway/src/engine/run-ask.ts` ~lines 43–48  
**Problem:** `countIndexedItems()` runs a synchronous `SELECT COUNT(*) AS c FROM item` on the UI/RPC thread. On large indexes this blocks the event loop.  
**Fix:** Cache the count and invalidate it via the sync telemetry callback; or use `bun`'s `database.run()` off-thread.

---

### P1.5 — `listConnectors` tool returns a hardcoded service list · **P2**

**File:** `packages/gateway/src/engine/agent.ts` ~lines 197–234  
**Problem:** 32+ service names are hard-coded in memory. Adding a connector requires modifying this list.  
**Fix:** Query active connectors from `sync_state` at runtime; fall back to the static list only when the index is empty.

---

### P1.6 — `Map` rebuild per search in `contextRanker` · **P2**

**File:** `packages/gateway/src/engine/context-ranker.ts` ~lines 35–52  
**Problem:** A fresh `Map<string, SourceGroup>` is constructed and discarded on every call to `contextWindow()`.  
**Fix:** Pre-sort input array and use a plain array accumulator; avoid allocation inside tight result-processing loops.

---

### P1.7 — O(N²) queue check in `SyncScheduler.tick()` · **P2**

**File:** `packages/gateway/src/sync/scheduler.ts` ~line 384  
**Problem:** The `tick()` loop scans the entire `this.queue` array (`this.queue.some((j) => j.serviceId === id)`) for each of the $N$ connectors.  
**Fix:** Maintain a `Set<string>` of queued `serviceId`s alongside the queue array, allowing for an $O(1)$ membership check.

---

## 2. Code Duplication

### D2.1 — Input validation pattern repeated 30+ times · **P0**

**Files:** `packages/gateway/src/engine/agent.ts`, `packages/gateway/src/ipc/server.ts`, sync handlers  
**Problem:** Every RPC handler manually extracts and type-checks parameters:

```typescript
const q = inputData !== null && typeof inputData === "object" && !Array.isArray(inputData)
  ? (inputData as Record<string, unknown>) : {};
const name = typeof q["name"] === "string" ? q["name"] : undefined;
const limit = typeof q["limit"] === "number" && Number.isFinite(q["limit"]) ? … : 20;
```

**Fix:** Adopt `zod` for Gateway IPC parameter validation, ensuring alignment with the robust validation already present in `packages/mcp-connectors/shared/mcp-tool-kit.ts`.

```typescript
import { z } from "zod";
// packages/gateway/src/ipc/params.ts
export function parseParams<T>(raw: unknown, schema: z.ZodType<T>): T {
  return schema.parse(raw);
}
```

**Impact:** ~200 lines removed; consistent validation semantics everywhere.

---

### D2.2 — Connector credential deletion duplicated 13 times · **P0**

**File:** `packages/gateway/src/ipc/connector-rpc-handlers.ts` ~lines 59–147  
**Problem:** Each `case "github":`, `case "gitlab":`, … block follows the same pattern: delete vault keys, return key names. Logic is functionally identical; only the key names differ.  
**Fix:** Replace with a data-driven manifest:

```typescript
const CONNECTOR_SECRETS: Record<ConnectorServiceId, readonly string[]> = {
  github:    ["github.pat"],
  gitlab:    ["gitlab.pat", "gitlab.api_base"],
  linear:    ["linear.apiKey"],
  jira:      ["jira.apiToken", "jira.baseUrl", "jira.userEmail"],
  // …
};

async function clearConnectorSecrets(
  vault: NimbusVault,
  id: ConnectorServiceId,
): Promise<string[]> {
  const keys = CONNECTOR_SECRETS[id] ?? [];
  await Promise.all(keys.map(k => vault.delete(k)));
  return [...keys];
}
```

---

### D2.3 — Duplicate classification functions in `router.ts` · **P1**

**File:** `packages/gateway/src/engine/router.ts` ~lines 88–174  
**Problem:** `anthropicClassify()` and `openAiClassify()` differ only in endpoint URL, auth header, and response parsing.  
**Fix:** Extract a single `llmClassify(opts: ClassifyOptions)` function parameterized by provider config.

---

### D2.4 — 20+ parallel `*Client` / `*IdleTimer` field pairs · **P1**

**File:** `packages/gateway/src/connectors/lazy-mesh.ts` ~lines 192–229  
**Problem:**
```typescript
private googleBundleClient: MCPClient | undefined;
private googleIdleTimer:  ReturnType<typeof setTimeout> | undefined;
private microsoftBundleClient: MCPClient | undefined;
private microsoftIdleTimer:  ReturnType<typeof setTimeout> | undefined;
// … × 20
```

**Fix:** Replace with a typed map:
```typescript
interface LazyEntry {
  client:    MCPClient | undefined;
  idleTimer: ReturnType<typeof setTimeout> | undefined;
}
private readonly lazyClients = new Map<string, LazyEntry>();
```

Shared `getOrSpawn(key, spawnFn)` and `resetIdle(key)` methods complete the pattern. Removes ~250 lines.

---

### D2.5 — Audit payload formatting duplicated · **P2**

**Files:** `packages/gateway/src/engine/executor.ts`, `packages/gateway/src/ipc/server.ts`  
**Problem:** `JSON.stringify` + truncation logic for audit entries is repeated.  
**Fix:** Extract `formatAuditPayload(payload: unknown, maxBytes = 4096): string` into a shared utility.

---

## 3. Security

### S3.1 — Tool enumeration via error messages · **P0**

**File:** `packages/gateway/src/connectors/registry.ts` ~lines 139–142  
**Problem:** `"No MCP tool \"${toolId}\". Available: ${available}"` returns the full list of registered tools to any caller who supplies an unknown tool ID.  
**Fix:** Return a generic `"Tool not found"` to callers; log the available-tool list server-side at `warn` level only:

```typescript
throw new Error("Tool not found");
// log internally: logger.warn({ toolId, available: Object.keys(map) }, "Unknown MCP tool");
```

---

### S3.2 — Raw errors propagated to clients may contain secrets · **P0**

**File:** `packages/gateway/src/engine/run-conversational-agent.ts` ~lines 71–82  
**Problem:** The catch block checks for `"API key"` in the message but re-throws the original error if not matched. An error message containing `"API key: sk-..."` would be forwarded verbatim.  
**Fix:** Always sanitize before surfacing to the client:

```typescript
function sanitizeExternalError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  // Strip anything resembling a key: letters/digits sequences > 20 chars after "key", "token", "secret", "Bearer"
  return raw.replace(/(key|token|secret|Bearer)\s*[=:]\s*\S{8,}/gi, "[REDACTED]");
}
```

Log the unsanitized message server-side.

---

### S3.3 — Missing input length bounds on tool parameters · **P1**

**File:** `packages/gateway/src/engine/agent.ts` ~lines 54–66  
**Problem:** String parameters extracted from RPC calls are passed to the search engine with no length cap. A caller could send a multi-MB query string.  
**Fix:** Add max-length guards at extraction time:

```typescript
const MAX_QUERY_LEN = 2_000;
const name = typeof q["name"] === "string"
  ? q["name"].slice(0, MAX_QUERY_LEN)
  : undefined;
```

---

### S3.4 — `PRAGMA query_only` toggle is not atomic · **P1**

**File:** `packages/gateway/src/db/query-guard.ts` ~lines 39–47  
**Problem:** Setting `PRAGMA query_only = ON`, running a query, then setting `OFF` is a stateful toggle. If the connection is reused concurrently or `finally` is interrupted, it leaks in read-only state.  
**Fix:** Use a separate `SQLITE_OPEN_READONLY` connection (already done in `http-server.ts`). Apply the same pattern to `query-guard.ts` instead of toggling on a shared connection.

---

### S3.5 — Audit payload size unbounded · **P1**

**File:** `packages/gateway/src/engine/executor.ts` ~lines 143–148  
**Problem:** `JSON.stringify(actionPayload)` is stored directly. Large payloads (file contents, search results) can exhaust the audit table.  
**Fix:** Cap at 4 KB and store a `"[truncated]"` marker:

```typescript
const serialized = JSON.stringify(payload);
const stored = serialized.length > 4096
  ? serialized.slice(0, 4096) + "…[truncated]"
  : serialized;
```

---

### S3.6 — Error paths in IPC server may skip session cleanup · **P2**

**File:** `packages/gateway/src/ipc/server.ts` ~lines 306–333  
**Problem:** If `dispatchMethod()` throws synchronously, session resources may not be released.  
**Fix:** Wrap the dispatch loop in a `try/finally` that calls `session.dispose()`.

---

### S3.7 — Potential secret leak in consent prompt · **P0**

**File:** `packages/gateway/src/engine/executor.ts` ~lines 135–140  
**Problem:** `formatConsentPrompt` blindly `JSON.stringify`s the `action.payload`. If an automated workflow passes sensitive data (e.g., an API token or key) into a HITL-gated action as input, it will be printed in plaintext to the IPC channel and UI logs.  
**Fix:** Implement a redaction step that scrubs keys matching `/(token|key|secret|password)/i` before stringifying the payload for display.

---

## 4. SOLID Alignment

### SRP — `LazyConnectorMesh` has 5+ responsibilities · **P1**

**File:** `packages/gateway/src/connectors/lazy-mesh.ts`  
**Problem:** The class owns process spawning, script path resolution, idle lifecycle, tool cache management, and per-connector auth token fetching simultaneously.  
**Refactor plan:**

| New class | Responsibility |
|---|---|
| `ConnectorScriptPaths` | Static map of service → script path |
| `McpProcessLifecycle`  | Spawn, idle timer, shutdown per client |
| `ConnectorAuthProvider`| Fetch and cache auth tokens by service |
| `LazyClientRegistry`   | Wire the above three into the current public API |

The public interface of `LazyConnectorMesh` remains unchanged; internal classes are private to the `connectors/` module.

---

### SRP — `SyncScheduler` has 7+ responsibilities · **P1**

**File:** `packages/gateway/src/sync/scheduler.ts`  
**Problem:** Scheduling, health transitions, connectivity probing, force-sync promises, backoff, telemetry, and queue management are all in one class.  
**Refactor plan:**

| New class/module | Responsibility |
|---|---|
| `SyncQueue`             | Queue add/remove/pump, priority ordering |
| `ConnectivityMonitor`   | Online/offline probe and event emit |
| `SyncTelemetryRecorder` | Write telemetry rows |
| `ForceSyncCoordinator`  | Promise map for `forceSync()` callers |

`SyncScheduler` becomes an orchestrator that wires these together.

---

### OCP — Intent router requires modification for new intents · **P1**

**File:** `packages/gateway/src/engine/router.ts` ~lines 53–175  
**Problem:** Adding a new intent class requires touching `IntentClass`, `normalizeIntent()`, the classification prompt, and `planFromIntent()` — four places.  
**Fix:** Introduce a registration API:

```typescript
interface IntentPlugin {
  readonly id: string;
  normalize(raw: unknown): IntentClass | undefined;
  plan(intent: ClassifiedIntent, paths: PlanPaths): PlanResult;
}

const intentRegistry = new Map<string, IntentPlugin>();
export function registerIntent(plugin: IntentPlugin): void {
  intentRegistry.set(plugin.id, plugin);
}
```

Built-in intents register at module load; the classification prompt is built from the registry.

---

### ISP — `NimbusVault` exposes all methods to read-only callers · **P2**

**File:** `packages/gateway/src/vault/index.ts`  
**Problem:** Callers that only need `get()` are forced to depend on the full vault interface, including destructive `delete()`.  
**Fix:** Split into focused sub-interfaces:

```typescript
export interface VaultReader  { get(key: string): Promise<string | null>; }
export interface VaultWriter  { set(key: string, value: string): Promise<void>; }
export interface VaultDeleter { delete(key: string): Promise<void>; }
export interface VaultLister  { listKeys(prefix?: string): Promise<string[]>; }
export interface NimbusVault extends VaultReader, VaultWriter, VaultDeleter, VaultLister {}
```

Callers that only read (e.g., connector auth providers) accept `VaultReader` instead of `NimbusVault`.

---

### DIP — `SyncScheduler` depends directly on DB functions · **P1**

**File:** `packages/gateway/src/sync/scheduler.ts`  
**Problem:** The scheduler imports `loadSchedulerState`, `updateSchedulerState`, `getConnectorHealth` directly, creating tight coupling to the DB layer.  
**Fix:** Define a repository interface and inject it:

```typescript
interface SchedulerStateRepository {
  loadAll(): SchedulerStateRow[];
  save(row: SchedulerStateRow): void;
  getAllDue(now: number): SchedulerStateRow[];
}

class SqliteSchedulerStateRepository implements SchedulerStateRepository { … }

// Scheduler constructor:
constructor(
  private readonly repo: SchedulerStateRepository,
  …
) {}
```

This makes the scheduler fully unit-testable without a real SQLite database.

---

### DIP — `ConnectorRpcHandlers` depends on concrete vault key names · **P1**

**File:** `packages/gateway/src/ipc/connector-rpc-handlers.ts`  
**Problem:** Vault key strings like `"github.pat"` are hard-coded in the handler. A key rename breaks this silently.  
**Fix:** Move key constants into each connector's own module or into the `CONNECTOR_SECRETS` manifest introduced in D2.2. The handler imports the manifest, not raw strings.

---

## 5. Additional Hygiene

### A5.1 — `"__no_change__"` sentinel is fragile · **P2**

**File:** `packages/gateway/src/connectors/health.ts` ~line 254  
**Problem:** `to === ("__no_change__" as ConnectorHealthState)` uses a string cast against a typed union to smuggle a sentinel.  
**Fix:**
```typescript
type HealthTransition =
  | { kind: "change"; to: ConnectorHealthState }
  | { kind: "no_change" };
```

---

### A5.2 — Missing `structuredClone` before storing mutable config snapshots · **P2**

**File:** `packages/gateway/src/config/profiles.ts`  
**Problem:** Profile config objects are stored and returned by reference. Callers that mutate the returned object corrupt the cache.  
**Fix:** Return `structuredClone(config)` from any cache-read path.

---

## Implementation Sequence

Work top-to-bottom within each priority tier. Items in the same tier are independent and can be parallelised.

| Step | Item(s) | Reason first |
|---|---|---|
| 1 | S3.1, S3.2, S3.7 | Security — fix before any feature work |
| 2 | D2.2 + D2.1 | Prerequisite for clean IPC handler refactors |
| 3 | P1.1 + P1.2 | Highest runtime impact; safe DB-layer change |
| 4 | D2.4 + P1.3 | Enables SRP refactors; reduces diff noise |
| 5 | SRP (mesh + scheduler) | Unlocks DIP work |
| 6 | DIP (scheduler repo + handler manifest) | Enables full unit-test coverage without SQLite |
| 7 | S3.4, S3.5, S3.3 | Tighten security surface after structural changes |
| 8 | OCP (intent registry) | Architecture change; low risk once DIP done |
| 9 | ISP (VaultReader split) | Low risk; improves type safety across codebase |
| 10 | A5.1, A5.2, D2.5, P1.6, P1.7 | Clean up remaining hygiene items |

---

## Acceptance Criteria

An improvement PR is considered complete when:

1. All existing test suites pass (`bun test`).
2. Coverage gates are not regressed (see `CLAUDE.md` for thresholds).
3. `bun run typecheck` and `bun run lint` produce zero errors.
4. New unit tests cover any new repository interface or extracted utility function.
5. The relevant section of this document is updated to mark the item done.
