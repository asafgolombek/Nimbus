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

Define the `AutostartManager` and `NotificationService` interfaces at minimum as stubs — implement only what is needed for Q1 (autostart can be minimal: enable/disable; notifications can be no-op stubs for now).

### 1.2 Implement `PlatformPaths` per platform

| Platform | `configDir` | `dataDir` | `socketPath` |
|---|---|---|---|
| win32 | `%APPDATA%\Nimbus` | `%LOCALAPPDATA%\Nimbus\data` | `\\.\pipe\nimbus-gateway` |
| darwin | `~/Library/Application Support/Nimbus` | same | `$TMPDIR/nimbus-gateway.sock` |
| linux | `$XDG_CONFIG_HOME/nimbus` or `~/.config/nimbus` | `$XDG_DATA_HOME/nimbus` | `$XDG_RUNTIME_DIR/nimbus-gateway.sock` |

### 1.3 Write PAL unit tests

`packages/gateway/src/platform/platform.test.ts` already exists as a stub. Add tests that:
- Verify `createPlatformServices()` returns the correct implementation for the current platform
- Verify `PlatformPaths` values are non-empty strings on each platform (run in CI matrix)

---

## Stage 2 — Secure Vault

**Files:** `packages/gateway/src/vault/index.ts`, `vault/win32.ts`, `vault/darwin.ts`, `vault/linux.ts`

### 2.1 Vault invariants (must be upheld in all implementations)

1. `get()` never throws on a missing key — returns `null`
2. No secret value appears in logs, error messages, or returned errors
3. `listKeys()` returns key names only — never values
4. Keys are namespaced `<service>.<type>` (validated by `isWellFormedVaultKey`)

### 2.2 Windows — DPAPI via `ffi-napi` or Bun FFI

Use Bun's native FFI to call `CryptProtectData` / `CryptUnprotectData` from `crypt32.dll`. Store encrypted blobs in `%APPDATA%\Nimbus\vault\<key>.bin`. The blob is DPAPI-encrypted with `CRYPTPROTECT_LOCAL_MACHINE=false` (user scope — fails on different accounts).

```typescript
// vault/win32.ts
import { dlopen, FFIType, suffix } from "bun:ffi";

// Call CryptProtectData(DATA_BLOB pDataIn, ...) -> BOOL
// Store encrypted blob to configDir/vault/<key>.enc
```

Key points:
- Create the vault directory on first use (`mkdir -p`)
- On `set`: encrypt → write to file
- On `get`: read file → decrypt → return string (or null if file missing)
- On `delete`: unlink file (no-op if missing)
- On `listKeys`: list files in vault dir, strip `.enc` suffix

### 2.3 macOS — Keychain Services via Bun FFI

Call `SecItemAdd`, `SecItemCopyMatching`, `SecItemDelete` from `Security.framework`. Service name: `"dev.nimbus"`, account = vault key.

### 2.4 Linux — libsecret via D-Bus

Use `@homebridge/dbus-native` or call `secret-tool` as a subprocess (simpler, no native binding needed for Q1). Schema: `org.gnome.keyring.NetworkPassword`, attribute `nimbus-key`.

Subprocess approach is acceptable for Q1; replace with direct D-Bus bindings if performance is needed.

### 2.5 Vault contract tests

`packages/gateway/src/vault/vault.test.ts` must achieve **≥90% coverage** (CI gate). Tests must cover:

- [ ] `set` + `get` round-trip returns original value
- [ ] `get` on missing key returns `null` (never throws)
- [ ] `delete` removes key; subsequent `get` returns `null`
- [ ] `delete` on missing key is a no-op (no throw)
- [ ] `listKeys()` never returns secret values
- [ ] `listKeys(prefix)` filters correctly
- [ ] Invalid key format: `isWellFormedVaultKey` rejects empty, too-long, bad-pattern keys
- [ ] Secret value does not appear in any thrown error message

---

## Stage 3 — IPC Server + Client

**Files:** `packages/gateway/src/ipc/index.ts`, `packages/cli/src/ipc-client/index.ts`

### 3.1 Protocol

JSON-RPC 2.0 over:
- **Windows:** Named Pipe `\\.\pipe\nimbus-gateway`
- **macOS/Linux:** Unix Domain Socket at `platformPaths.socketPath`

Message framing: newline-delimited JSON (one JSON object per line).

### 3.2 Gateway IPC Server

Implement `IPCServer` with these methods for Q1:

| Method | Direction | Purpose |
|---|---|---|
| `gateway.ping` | Client → Gateway | Health check; returns `{ version, uptime }` |
| `agent.invoke` | Client → Gateway | Submit NL query; streams responses |
| `consent.respond` | Client → Gateway | User's approve/reject decision for HITL |
| `consent.request` | Gateway → Client | Push consent request to client (reverse channel) |
| `vault.set` | Client → Gateway | Store a secret |
| `vault.get` | Client → Gateway | Retrieve a key (by name only — value returned encrypted in transit is fine for IPC) |
| `vault.delete` | Client → Gateway | Remove a key |
| `vault.listKeys` | Client → Gateway | List key names |

**Security:** The socket/pipe is created with permissions `0600` (user-only) on Unix. On Windows, the named pipe uses default ACL (current user only).

### 3.3 IPC Client (CLI)

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

### 3.4 Consent channel

The consent channel is a reverse-direction IPC notification. When the executor needs HITL:
1. Gateway sends `consent.request` notification to the connected client with a `requestId` + formatted prompt
2. Client displays the prompt (`@clack/prompts` confirm dialog)
3. Client sends `consent.respond` with `{ requestId, approved: boolean }`
4. Gateway executor unblocks and proceeds

The executor `await`s a `Promise` that resolves when `consent.respond` arrives with the matching `requestId`.

---

## Stage 4 — Local Index (SQLite)

**Files:** `packages/gateway/src/index/index.ts`, `packages/gateway/src/index/schema.ts`

### 4.1 Schema

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
  raw_meta    TEXT  -- JSON blob
);

CREATE INDEX IF NOT EXISTS idx_items_service       ON items(service);
CREATE INDEX IF NOT EXISTS idx_items_type          ON items(item_type);
CREATE INDEX IF NOT EXISTS idx_items_modified_at   ON items(modified_at);
CREATE INDEX IF NOT EXISTS idx_items_name          ON items(name);

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
export class LocalIndex {
  constructor(db: Database) {}
  upsert(item: NimbusItem): void {}
  delete(id: string): void {}
  search(query: { service?: string; itemType?: string; name?: string; limit?: number }): NimbusItem[] {}
  recordSync(connectorId: string, token: string): void {}
  getLastSyncToken(connectorId: string): string | null {}
}
```

Keep it simple for Q1 — no embeddings (that's Q3). Just fast exact/prefix text search via SQLite FTS5 or `LIKE`.

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

---

## Stage 6 — Engine: Intent Router + Task Planner

**Files:** `packages/gateway/src/engine/router.ts`, `packages/gateway/src/engine/planner.ts`, `packages/gateway/src/engine/agent.ts`

### 6.1 Intent Router

Uses a single cheap LLM call to classify the user's input into one of the `IntentClass` values defined in `architecture.md`. Returns `ClassifiedIntent`:

```typescript
interface ClassifiedIntent {
  intent: IntentClass;
  entities: Record<string, string>;
  requiresHITL: boolean;
  confidence: number; // 0–1; < 0.6 → ask one clarifying question
}
```

Model: `claude-haiku-4-5-20251001` for the classification call (fast, cheap).

### 6.2 Task Planner

Converts a `ClassifiedIntent` into an ordered `PlannedAction[]`. For Q1, this only needs to handle:
- `file_search` — call `filesystem.search`
- `file_organize` — call `filesystem.move` (HITL)
- `unknown` → return an empty plan + response asking for clarification

Full multi-service planning is Q2+.

### 6.3 Mastra Agent

Wire up `nimbusAgent` as specified in `architecture.md §Agent Definition`. Use `claude-sonnet-4-6` (latest available). Register the three Q1 tools:
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
| `nimbus start` | Launch the Gateway as a background process; print socket path |
| `nimbus stop` | Send shutdown signal to the Gateway |
| `nimbus status` | Ping the Gateway; print version, uptime, connector health |
| `nimbus ask <query>` | Submit a natural-language query; stream the response |
| `nimbus vault set <key> <value>` | Store a secret via the Gateway vault RPC |
| `nimbus vault get <key>` | Retrieve a key (confirm user understands it will be shown) |
| `nimbus vault delete <key>` | Remove a key |
| `nimbus vault list [prefix]` | List key names |

Each command lives in `packages/cli/src/commands/<name>.ts` and exports a `run(args: string[], client: IPCClient): Promise<void>` function.

Use `@clack/prompts` for:
- Consent gate prompts (`confirm`)
- Spinner during Gateway startup (`spinner`)
- Error formatting

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

## Stage 9 — Gateway Entry Point

**File:** `packages/gateway/src/index.ts`

Wire everything together:

```typescript
import { createPlatformServices } from "./platform/index.ts";
import { LocalIndex } from "./index/index.ts";
import { buildConnectorMesh } from "./connectors/registry.ts";
import { ToolExecutor } from "./engine/executor.ts";
import { IntentRouter } from "./engine/router.ts";
import { TaskPlanner } from "./engine/planner.ts";
import { Database } from "bun:sqlite";

async function main(): Promise<void> {
  const platform = await createPlatformServices();
  const db = new Database(path.join(platform.paths.dataDir, "nimbus.db"));
  const index = new LocalIndex(db);
  const connectors = await buildConnectorMesh(platform.paths);
  const executor = new ToolExecutor(platform.ipc.consentChannel, auditLog, connectors);
  const router = new IntentRouter();
  const planner = new TaskPlanner();
  await platform.ipc.listen();
}

main().catch(console.error);
```

---

## Test Coverage Gates (CI enforced)

| Package | File pattern | Threshold |
|---|---|---|
| Engine | `engine/**` | ≥85% |
| Vault | `vault/**` | ≥90% |

Run locally:
```bash
bun run test:coverage:engine
bun run test:coverage:vault
```

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
- [ ] `nimbus start` / `nimbus ask "list my files"` / `nimbus stop` works end-to-end on the dev machine
- [ ] Secrets never appear in `bun run test` output, logs, or IPC traces
- [ ] HITL gate fires for every action type in the whitelist — verified by unit test

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
