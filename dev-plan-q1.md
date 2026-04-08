# Nimbus Q1 2026 — Foundation Development Plan

**Period:** Q1 2026 (Active)  
**Theme:** Gateway, PAL, Vault, Filesystem Connector, HITL Gate, CLI, CI  
**Status:** Scaffold complete — implementation begins

---

## Current State

The monorepo is fully scaffolded: packages, CI matrix, biome config, and test infrastructure all exist. The files under `packages/gateway/src/` and `packages/cli/src/` are stubs with `// TODO Q1` markers. Nothing in the Engine, Vault, IPC, or Platform layer is implemented yet.

**What exists and is real:**
- `NimbusVault` interface (`vault/index.ts`)
- `PlatformServices` dispatch skeleton (`platform/index.ts`)
- `ExtensionManifest` and `NimbusItem` types (`sdk/src/types.ts`)
- CI/CD workflows (3-platform matrix on push, Ubuntu PR gate)
- Test file stubs (unit, integration, e2e)
- SDK server scaffold and testing utilities

**What is TODO Q1 (everything below):**
- `PlatformServices` interface fields (vault, ipc, paths, autostart, notifications)
- All three platform implementations (win32, darwin, linux)
- Vault implementations (DPAPI, Keychain, libsecret)
- IPC server and client (JSON-RPC 2.0)
- Local SQLite index schema
- Engine: Intent Router, Task Planner, HITL Consent Gate, Tool Executor
- Filesystem connector wiring
- CLI command router and commands

---

## Delivery Sequence

The order is strict: each layer depends on the one before it. Do not jump ahead.

```
1. PAL Interface + PlatformPaths
2. Secure Vault (platform implementations)
3. IPC Server + Client
4. Local Index (SQLite schema)
5. Engine — HITL Gate + Tool Executor
6. Engine — Intent Router + Task Planner
7. Filesystem MCP Connector
8. CLI commands
9. Coverage gates + CI green
```

---

## Stage 1 — Platform Abstraction Layer (PAL)

**Files:** `packages/gateway/src/platform/index.ts`, `win32.ts`, `darwin.ts`, `linux.ts`, `paths.ts`

### 1.1 Define `PlatformServices` and `PlatformPaths`

Fill in the TODO in `platform/index.ts`:

```typescript
export interface PlatformPaths {
  configDir: string;    // nimbus.toml location
  dataDir: string;      // SQLite DB, embeddings
  logDir: string;       // structured JSON logs
  socketPath: string;   // domain socket or named pipe path
  extensionsDir: string;
  tempDir: string;
}

export interface PlatformServices {
  vault: NimbusVault;
  ipc: IPCServer;
  paths: PlatformPaths;
  autostart: AutostartManager;
  notifications: NotificationService;
}
```

`AutostartManager` and `NotificationService` are stub interfaces for Q1 — implement enable/disable only; notifications are no-ops until Tauri (Q4).

### 1.2 Factory resilience

`createPlatformServices()` must fail fast and clearly. Wrap the platform-specific `create()` call:

```typescript
export async function createPlatformServices(): Promise<PlatformServices> {
  const p = platform();
  try {
    switch (p) {
      case "win32":  return (await import("./win32.ts")).create();
      case "darwin": return (await import("./darwin.ts")).create();
      case "linux":  return (await import("./linux.ts")).create();
      default:       throw new Error(`Unsupported platform: ${p}`);
    }
  } catch (err) {
    throw new PlatformInitError(
      `Failed to initialize platform services on ${p}. ` +
      `Ensure all OS dependencies are available. Cause: ${String(err)}`
    );
  }
}
```

Each platform `create()` performs a **dependency probe** before returning — e.g., the Linux vault probes for `secret-tool` via `which secret-tool`. If a probe fails, throw `PlatformInitError` with a human-readable install hint. The Gateway must not start in a degraded state.

### 1.3 Async initialization model

`createPlatformServices()` is the single async factory — all async setup (directory creation, socket binding, dependency probing) happens inside it before it resolves. Individual services do **not** have a separate `.init()` method. Callers receive a fully-ready `PlatformServices` object or an error.

### 1.4 Implement `PlatformPaths` per platform

| Platform | `configDir` | `dataDir` | `socketPath` |
|---|---|---|---|
| win32 | `%APPDATA%\Nimbus` | `%LOCALAPPDATA%\Nimbus\data` | `\\.\pipe\nimbus-gateway` |
| darwin | `~/Library/Application Support/Nimbus` | same | `$TMPDIR/nimbus-gateway.sock` |
| linux | `$XDG_CONFIG_HOME/nimbus` or `~/.config/nimbus` | `$XDG_DATA_HOME/nimbus` | `$XDG_RUNTIME_DIR/nimbus-gateway.sock` |

All directories are created on first use inside `create()` — never lazily.

### 1.5 Write PAL unit tests

`packages/gateway/src/platform/platform.test.ts` already exists as a stub. Add tests that:
- Verify `createPlatformServices()` returns the correct implementation for the current platform
- Verify `PlatformPaths` values are non-empty strings on each platform (run in CI matrix)
- Verify `PlatformInitError` is thrown (not a generic error) when a dependency is missing

---

## Stage 2 — Secure Vault

**Files:** `packages/gateway/src/vault/index.ts`, `vault/win32.ts`, `vault/darwin.ts`, `vault/linux.ts`

### 2.1 Vault invariants (must be upheld in all implementations)

1. `get()` never throws on a missing key — returns `null`
2. No secret value appears in logs, error messages, or returned errors
3. `listKeys()` returns key names only — never values
4. Keys are namespaced `<service>.<type>` (validated by `isWellFormedVaultKey`)

### 2.2 Encoding strategy (all platforms)

OS-native vaults return binary blobs. The `NimbusVault` interface uses `string`. The encoding contract is:

- **`set(key, value)`:** UTF-8 encode the string → pass bytes to OS API → store the returned encrypted blob as **Base64** on disk / in the keystore
- **`get(key)`:** retrieve raw blob → Base64-decode → pass to OS decrypt API → UTF-8 decode result → return string

This is internal to each implementation. Callers always see plain strings.

### 2.3 OS-level namespacing

All implementations must namespace keys at the OS level to avoid colliding with other applications:

| Platform | Namespace mechanism |
|---|---|
| Windows | Store blobs under `%APPDATA%\Nimbus\vault\` — directory itself is the namespace |
| macOS | Keychain service name = `"dev.nimbus"`, account = vault key |
| Linux | `secret-tool` attribute `nimbus-key=<key>` and label `"Nimbus: <key>"` |

### 2.4 Windows — DPAPI via Bun FFI

Use Bun's native FFI (`bun:ffi`) to call `CryptProtectData` / `CryptUnprotectData` from `crypt32.dll`. The blob is DPAPI-encrypted with `CRYPTPROTECT_LOCAL_MACHINE=false` (user scope — fails on other accounts and machines).

```typescript
// vault/win32.ts
import { dlopen, FFIType } from "bun:ffi";
// Call CryptProtectData(DATA_BLOB pDataIn, ...) -> BOOL
// Base64-encode the encrypted blob → write to configDir/vault/<key>.enc
```

- Vault directory is created by the factory (`createPlatformServices`), not lazily
- `get`: read `.enc` file → Base64-decode → DPAPI-decrypt → return UTF-8 string (or `null` if file missing)
- `delete`: unlink file; no-op if missing
- `listKeys`: list `*.enc` files in vault dir, strip suffix

### 2.5 macOS — Keychain Services via Bun FFI

Call `SecItemAdd`, `SecItemCopyMatching`, `SecItemDelete` from `Security.framework`. Service = `"dev.nimbus"`, account = vault key. Base64-encode blobs as the `kSecValueData` attribute.

### 2.6 Linux — `secret-tool` subprocess

Call `secret-tool store/lookup/clear` as a subprocess (no native binding needed for Q1). If `secret-tool` is not found during the dependency probe in `create()`, throw `PlatformInitError` with the message:

> `"secret-tool not found. Install libsecret-tools (Debian/Ubuntu) or libsecret (Fedora/Arch) to use Nimbus on Linux."`

**No fallback to file-based encryption.** A degraded vault would silently weaken the security model. Hard-fail is correct.

### 2.7 `MockVault` for CI

Add `packages/gateway/src/vault/mock.ts` — an in-memory `NimbusVault` implementation used only in tests. The contract tests in `vault.test.ts` run against `MockVault` on all platforms (fast, no OS dependency). Real vault integration tests (using actual DPAPI/Keychain/libsecret) run only on their matching platform in the CI matrix.

```typescript
// vault/mock.ts
export class MockVault implements NimbusVault {
  private store = new Map<string, string>();
  // ... implements NimbusVault fully in-memory
}
```

### 2.8 Vault contract tests

`packages/gateway/src/vault/vault.test.ts` must achieve **≥90% coverage** (CI gate). Tests run against `MockVault` on all platforms:

- [x] `set` + `get` round-trip returns original value
- [x] `get` on missing key returns `null` (never throws)
- [x] `delete` removes key; subsequent `get` returns `null`
- [x] `delete` on missing key is a no-op (no throw)
- [x] `listKeys()` never returns secret values
- [x] `listKeys(prefix)` filters correctly
- [x] Invalid key format: `isWellFormedVaultKey` rejects empty, too-long, bad-pattern keys
- [x] Secret value does not appear in any thrown error message
- [x] Real vault smoke test (1 set + get + delete round-trip) runs on the matching CI platform only

---

## Stage 3 — IPC Server + Client

**Files:** `packages/gateway/src/ipc/index.ts`, `packages/cli/src/ipc-client/index.ts`

### 3.1 Protocol

JSON-RPC 2.0 over:
- **Windows:** Named Pipe `\\.\pipe\nimbus-gateway`
- **macOS/Linux:** Unix Domain Socket at `platformPaths.socketPath`

**Message framing:** Newline-delimited JSON (one JSON object per line). Vault values are short credential strings, not large blobs, so there is no payload size risk that would justify length-prefixed headers in Q1. Add a 1MB per-message hard limit in the parser as a guard.

### 3.2 Gateway IPC Server

Implement `IPCServer` with these methods for Q1:

| Method | Direction | Purpose |
|---|---|---|
| `gateway.ping` | Client → Gateway | Health check; returns `{ version, uptime }` |
| `agent.invoke` | Client → Gateway | Submit NL query; streams responses |
| `consent.respond` | Client → Gateway | User's approve/reject decision for HITL |
| `consent.request` | Gateway → Client | Push consent request to client (reverse channel) |
| `vault.set` | Client → Gateway | Store a secret |
| `vault.get` | Client → Gateway | Retrieve key value |
| `vault.delete` | Client → Gateway | Remove a key |
| `vault.listKeys` | Client → Gateway | List key names |
| `audit.list` | Client → Gateway | Query recent audit log entries |

**Security:** The socket/pipe is created with permissions `0600` (user-only) on Unix. On Windows, the named pipe uses default ACL (current user only).

### 3.3 Multi-client concurrency

The IPC server assigns each connection a `clientId` at connect time. When `agent.invoke` is called, the Gateway records the `clientId` of the initiating client on the active request context. `consent.request` notifications are sent **only to the initiating client** — never broadcast to all connected clients. This prevents a second terminal from seeing (or hijacking) a consent prompt belonging to a different session.

### 3.4 IPC Client (CLI)

Implement `IPCClient` in `packages/cli/src/ipc-client/index.ts`:

```typescript
export class IPCClient {
  constructor(socketPath: string) {}
  async connect(): Promise<void> {}
  async call<T>(method: string, params?: unknown): Promise<T> {}
  onNotification(method: string, handler: (params: unknown) => void): void {}
  async disconnect(): Promise<void> {}
}
```

### 3.5 Consent channel + zombie prevention

The consent channel is a reverse-direction IPC notification. When the executor needs HITL:
1. Gateway sends `consent.request` notification to the initiating client with a `requestId` + formatted prompt
2. Client displays the prompt (`@clack/prompts` confirm dialog)
3. Client sends `consent.respond` with `{ requestId, approved: boolean }`
4. Gateway executor unblocks and proceeds

The executor `await`s a `Promise` that resolves when `consent.respond` arrives.

**Zombie prevention:** The `ToolExecutor` subscribes to IPC disconnect events. If the initiating client disconnects while consent is pending, the pending `Promise` is **immediately rejected** (treated as user rejection), the audit log records `"rejected"` with reason `"client disconnected"`, and the Gateway does not hang. There is no auto-approve timer — the architecture.md invariant ("synchronous block, no timeout") applies only to the happy path.

---

## Stage 4 — Local Index (SQLite)

**Files:** `packages/gateway/src/index/index.ts`, `packages/gateway/src/index/schema.ts`

### 4.1 Schema

Use **FTS5** from day one for the `name` field. `LIKE` is too slow on large item sets and FTS5 is built into `bun:sqlite` at no extra cost.

```sql
-- Core items table
CREATE TABLE IF NOT EXISTS items (
  id          TEXT PRIMARY KEY,
  service     TEXT NOT NULL,
  item_type   TEXT NOT NULL,
  name        TEXT NOT NULL,
  mime_type   TEXT,
  size_bytes  INTEGER,
  created_at  INTEGER,
  modified_at INTEGER,
  url         TEXT,
  parent_id   TEXT,
  raw_meta    TEXT  -- JSON blob; enforced max 65536 bytes in LocalIndex.upsert()
);

-- FTS5 virtual table for name-based full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  name,
  content=items,
  content_rowid=rowid
);

-- Keep FTS5 in sync via triggers
CREATE TRIGGER IF NOT EXISTS items_fts_insert AFTER INSERT ON items BEGIN
  INSERT INTO items_fts(rowid, name) VALUES (new.rowid, new.name);
END;
CREATE TRIGGER IF NOT EXISTS items_fts_delete AFTER DELETE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, name) VALUES ('delete', old.rowid, old.name);
END;
CREATE TRIGGER IF NOT EXISTS items_fts_update AFTER UPDATE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, name) VALUES ('delete', old.rowid, old.name);
  INSERT INTO items_fts(rowid, name) VALUES (new.rowid, new.name);
END;

CREATE INDEX IF NOT EXISTS idx_items_service       ON items(service);
CREATE INDEX IF NOT EXISTS idx_items_type          ON items(item_type);
CREATE INDEX IF NOT EXISTS idx_items_modified_at   ON items(modified_at);

-- Sync state per connector
CREATE TABLE IF NOT EXISTS sync_state (
  connector_id    TEXT PRIMARY KEY,
  last_sync_at    INTEGER,
  next_sync_token TEXT
);

-- Audit log
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  action_type TEXT NOT NULL,
  hitl_status TEXT NOT NULL CHECK(hitl_status IN ('approved','rejected','not_required')),
  action_json TEXT NOT NULL,
  timestamp   INTEGER NOT NULL
);
```

### 4.2 `LocalIndex` class

```typescript
const RAW_META_MAX_BYTES = 65_536; // 64 KB per item — enforced in upsert()

export class LocalIndex {
  constructor(db: Database) {}
  upsert(item: NimbusItem): void {
    // Validate raw_meta size before write
    const meta = JSON.stringify(item.rawMeta ?? {});
    if (Buffer.byteLength(meta) > RAW_META_MAX_BYTES) {
      throw new Error(`raw_meta for item "${item.id}" exceeds 64 KB limit`);
    }
    // ... upsert into items table
  }
  delete(id: string): void {}
  search(query: { service?: string; itemType?: string; name?: string; limit?: number }): NimbusItem[] {}
  recordSync(connectorId: string, token: string): void {}
  getLastSyncToken(connectorId: string): string | null {}
  listAudit(limit: number): AuditEntry[] {} // for nimbus audit command
}
```

Name search uses `items_fts` (FTS5 `MATCH`) when `name` is provided; other filters apply as SQL predicates on `items`. No embeddings in Q1 (that's Q3).

---

## Stage 5 — Engine: HITL Gate + Tool Executor

**Files:** `packages/gateway/src/engine/executor.ts`

This is the most security-critical file. Implement it exactly as specified in `architecture.md`:

### 5.1 `HITL_REQUIRED` frozen set

Copy the exact set from `architecture.md §HITL Consent Gate`. It is `Object.freeze(new Set([...]))` — a module-level constant. It must not be modifiable at runtime.

### 5.2 `ToolExecutor.execute()`

```typescript
export class ToolExecutor {
  constructor(
    private readonly consentChannel: ConsentChannel,
    private readonly auditLog: AuditLog,
    private readonly connectorMesh: MCPClient,
  ) {}

  async execute(action: PlannedAction): Promise<ActionResult> {
    const requiresHITL = HITL_REQUIRED.has(action.type);

    let hitlStatus: "approved" | "rejected" | "not_required";

    if (requiresHITL) {
      const approved = await this.consentChannel.requestApproval(
        formatConsentPrompt(action)
      );
      hitlStatus = approved ? "approved" : "rejected";
    } else {
      hitlStatus = "not_required";
    }

    // ALWAYS write audit record BEFORE any action is taken
    await this.auditLog.record({ action, hitlStatus, timestamp: Date.now() });

    if (hitlStatus === "rejected") {
      return { status: "rejected", reason: "User declined consent gate." };
    }

    return this.dispatchToConnector(action);
  }
}
```

### 5.3 HITL unit tests

`packages/gateway/src/engine/engine.test.ts` must achieve **≥85% coverage** (CI gate):

- [ ] Every action type in `HITL_REQUIRED` triggers the consent channel
- [ ] Action types NOT in `HITL_REQUIRED` do NOT call the consent channel
- [ ] `rejected` response → connector is NOT called; audit record shows `"rejected"`
- [ ] `approved` response → connector IS called; audit record shows `"approved"`
- [ ] `not_required` → connector is called without asking; audit shows `"not_required"`
- [ ] Audit record is written BEFORE the connector call (verify ordering with a spy)
- [ ] `HITL_REQUIRED` set cannot be mutated at runtime (attempt `HITL_REQUIRED.add(...)` → throws or is ignored)
- [ ] If IPC client disconnects mid-consent, pending action is rejected and audit records `"rejected"` with `reason: "client disconnected"`

---

## Stage 6 — Engine: Intent Router + Task Planner

**Files:** `packages/gateway/src/engine/router.ts`, `packages/gateway/src/engine/planner.ts`, `packages/gateway/src/engine/agent.ts`

### 6.1 Model configuration

Never hardcode model IDs. Use a `config.ts` with env-var overrides:

```typescript
// packages/gateway/src/config.ts
export const Config = {
  agentModel:      process.env.NIMBUS_AGENT_MODEL      ?? "claude-sonnet-4-6",
  classifierModel: process.env.NIMBUS_CLASSIFIER_MODEL ?? "claude-haiku-4-5-20251001",
};
```

This lets model IDs be bumped without code changes and lets CI override them if needed.

### 6.2 Intent Router

Uses a single cheap LLM call (`Config.classifierModel`) to classify the user's input. Returns `ClassifiedIntent`:

```typescript
interface ClassifiedIntent {
  intent: IntentClass;
  entities: Record<string, string>;
  requiresHITL: boolean;
  confidence: number; // 0–1; < 0.6 → ask one clarifying question
}
```

**Offline / LLM failure handling:** The Intent Router is only invoked by `nimbus ask`. Structured CLI commands (`vault`, `status`, `start`, `stop`, `audit`) go directly through IPC without touching the LLM. If the `ask` router call fails (network error, API error), the Gateway returns a `GatewayError` to the CLI:

> `"Agent unavailable — check your network connection and API key."`

No regex fallback. The structured commands are what users need when offline; natural-language queries are inherently online.

### 6.3 Task Planner

Converts a `ClassifiedIntent` into an ordered `PlannedAction[]`. For Q1, this only needs to handle:
- `file_search` — call `filesystem.search`
- `file_organize` — call `filesystem.move` (HITL)
- `unknown` → return an empty plan + response asking for clarification

Full multi-service planning is Q2+.

### 6.4 Mastra Agent

Wire up `nimbusAgent` as specified in `architecture.md §Agent Definition`. Use `Config.agentModel`. Register the three Q1 tools:
- `searchLocalIndex`
- `listConnectors`
- `getAuditLog`

---

## Stage 7 — Filesystem MCP Connector

**Files:** `packages/gateway/src/connectors/registry.ts`

For Q1, the only connector wired in is the filesystem connector:

```typescript
import { MCPClient } from "@mastra/mcp";

export async function buildConnectorMesh(paths: PlatformPaths): Promise<MCPClient> {
  return new MCPClient({
    servers: {
      filesystem: {
        command: "bunx",
        args: ["@modelcontextprotocol/server-filesystem", paths.dataDir],
      },
    },
  });
}
```

This is intentionally minimal. All cloud connectors are Q2.

---

## Stage 8 — CLI Commands

**Files:** `packages/cli/src/index.ts`, `packages/cli/src/commands/`

### Commands to implement in Q1

| Command | Description |
|---|---|
| `nimbus start` | Daemonize the Gateway; print socket path |
| `nimbus stop` | Send shutdown signal to the Gateway |
| `nimbus status` | Ping the Gateway; print version, uptime, connector health |
| `nimbus ask <query>` | Submit a natural-language query; stream the response |
| `nimbus vault set <key> <value>` | Store a secret via the Gateway vault RPC |
| `nimbus vault get <key>` | Retrieve a key (confirm user understands it will be shown) |
| `nimbus vault delete <key>` | Remove a key |
| `nimbus vault list [prefix]` | List key names |
| `nimbus audit [--limit N]` | Print recent audit log entries (HITL decisions) |

Each command lives in `packages/cli/src/commands/<name>.ts` and exports a `run(args: string[], client: IPCClient): Promise<void>` function.

Use `@clack/prompts` for:
- Consent gate prompts (`confirm`)
- Spinner during Gateway startup (`spinner`)
- Error formatting

### Daemonization (`nimbus start`)

Use `Bun.spawn` with `detached: true` to launch the Gateway process and then detach:

```typescript
const logFile = Bun.file(path.join(platformPaths.logDir, "gateway.log"));
const proc = Bun.spawn(["bun", "run", gatewayEntryPoint], {
  detached: true,
  stdio: ["ignore", logFile, logFile],
});
proc.unref(); // allow CLI process to exit

// Write PID file for nimbus stop
await Bun.write(
  path.join(platformPaths.dataDir, "gateway.pid"),
  String(proc.pid)
);
```

`nimbus stop` reads `gateway.pid`, sends `SIGTERM`, and removes the PID file.

### `nimbus audit` command

Calls `audit.list` IPC method (see Stage 3). Displays a table of recent HITL decisions:

```
Timestamp            Action Type       Status        Reason
-------------------  ----------------  ------------  --------------------------
2026-04-07 14:23:01  file.delete       rejected      User declined consent gate.
2026-04-07 14:22:55  filesystem.search not_required  —
```

This is essential during development to verify the HITL gate is firing correctly.

### HITL consent prompt (CLI)

When the Gateway sends a `consent.request` notification:

```
┌─────────────────────────────────────┐
│  Action requires your approval      │
│                                     │
│  Type:    file.delete               │
│  Target:  /Users/asaf/docs/old.pdf  │
│  Source:  filesystem connector      │
│                                     │
│  Approve? (y/N)                     │
└─────────────────────────────────────┘
```

---

## Stage 9 — Gateway Entry Point + Graceful Shutdown

**File:** `packages/gateway/src/index.ts`

Wire everything together and register shutdown handlers:

```typescript
import { createPlatformServices } from "./platform/index.ts";
import { LocalIndex } from "./index/index.ts";
import { buildConnectorMesh } from "./connectors/registry.ts";
import { ToolExecutor } from "./engine/executor.ts";
import { IntentRouter } from "./engine/router.ts";
import { TaskPlanner } from "./engine/planner.ts";
import { Database } from "bun:sqlite";

async function main(): Promise<void> {
  const platform = await createPlatformServices(); // throws PlatformInitError if deps missing
  const db = new Database(path.join(platform.paths.dataDir, "nimbus.db"));
  const index = new LocalIndex(db);
  const connectors = await buildConnectorMesh(platform.paths);
  const executor = new ToolExecutor(platform.ipc.consentChannel, index, connectors);
  const router = new IntentRouter();
  const planner = new TaskPlanner();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[gateway] ${signal} received — shutting down`);
    await platform.ipc.close();   // stop accepting new connections
    connectors.disconnect();      // terminate MCP child processes
    db.close();                   // flush SQLite WAL
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));

  await platform.ipc.listen();
}

main().catch((err: unknown) => {
  console.error("[gateway] fatal:", err);
  process.exit(1);
});
```

**Shutdown contract:**
1. IPC server stops accepting new connections immediately
2. In-flight requests complete (or time out after 5 seconds)
3. Any pending consent requests are rejected with `"Gateway shutting down"`
4. MCP connector subprocesses receive SIGTERM
5. SQLite database is closed cleanly (WAL checkpoint)
6. Process exits 0

---

## Test Coverage Gates (CI enforced)

| Package | File pattern | Threshold |
|---|---|---|
| Engine | `engine/**` | ≥85% |
| Vault | `vault/**` | ≥90% |

Coverage is measured with `bun test --coverage` per package. Run from the package root or via the workspace scripts:

```bash
# From repo root
bun run test:coverage:engine   # runs inside packages/gateway
bun run test:coverage:vault    # runs inside packages/gateway
```

Coverage thresholds are enforced by passing `--coverage-threshold` in the script. Vault contract tests use `MockVault` on every OS; OS-specific smoke tests in `vault.test.ts` run only when `process.platform` matches (`win32` / `darwin` / `linux`). On Linux CI, tests that use `secret-tool` run under `dbus-run-session` so the Secret Service is available.

---

## Definition of Done (Q1)

- [ ] `bun run typecheck` passes with zero errors on all three platforms
- [ ] `bun run lint` passes (Biome — no warnings)
- [ ] `bun test` passes — all unit tests green
- [ ] `bun run test:coverage:engine` ≥85%
- [ ] `bun run test:coverage:vault` ≥90%
- [ ] `bun run test:integration` passes (real SQLite, real Bun subprocess)
- [ ] `bun run test:e2e:cli` passes (real Gateway subprocess + mock filesystem MCP)
- [ ] CI matrix green on Ubuntu, macOS, Windows
- [ ] `nimbus start` / `nimbus ask "list my files"` / `nimbus stop` works end-to-end on dev machine
- [ ] `nimbus audit` shows HITL decisions from the session
- [ ] Secrets never appear in `bun run test` output, logs, or IPC traces
- [ ] HITL gate fires for every action type in the whitelist — verified by unit test
- [ ] Gateway shuts down cleanly on `SIGTERM`/`SIGINT` with no socket hang or DB corruption
- [ ] `PlatformInitError` is thrown (not a crash) when a vault OS dependency is missing
- [ ] Multi-client IPC: consent prompt goes only to the initiating client

---

## What is Explicitly Out of Scope (Q1)

| Feature | Quarter |
|---|---|
| Google Drive / Gmail / OneDrive / Outlook connectors | Q2 |
| OAuth PKCE flow | Q2 |
| Delta sync / sync scheduling | Q2 |
| Semantic embeddings / sqlite-vec / hybrid search | Q3 |
| Extension Registry | Q3 |
| Ambient monitoring / watchers | Q3 |
| Tauri 2.0 desktop UI | Q4 |
| Extension marketplace | Q4 |
| DevOps connectors (GitHub, Jenkins, AWS, etc.) | Q2 |

Do not implement any of these in Q1 code.

---

## Implementation Order (recommended sprint breakdown)

### Week 1–2: Foundation
- Stage 1 (PAL + PlatformPaths) — all three platforms
- Stage 2 (Vault) — start with win32 (dev machine); darwin + linux in parallel or next
- Stage 4 (Local Index schema) — small, unblocks everything

### Week 3–4: IPC + Gateway skeleton
- Stage 3 (IPC Server + Client)
- Stage 9 (Gateway entry point — minimal wire-up)
- Verify `nimbus start` launches the process and `nimbus stop` kills it

### Week 5–6: Engine core
- Stage 5 (HITL Gate + Tool Executor) — with full tests first (TDD)
- Stage 6 (Intent Router + Task Planner) — minimal for `file_search` and `file_organize`

### Week 7–8: CLI + E2E
- Stage 7 (Filesystem connector wiring)
- Stage 8 (CLI commands)
- Integration and E2E tests
- Coverage gates
- CI matrix green

---

*This plan covers only Q1 2026 Foundation scope. See `architecture.md` for the full system design and `mission.md` for the project principles behind every decision.*
