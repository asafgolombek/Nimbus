# WS5 Sub-project A — App Shell Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a launchable Tauri 2.0 desktop shell for Nimbus with a working Rust↔Gateway IPC bridge, an `ALLOWED_METHODS` security allowlist, a system tray with global-hotkey quick-query popup, a first-run onboarding wizard, and scaffolding for Sub-projects B/C/D — all without feature pages (those ship in B/C/D).

**Architecture:** Three layers. Frontend (React 19 + Tailwind v4 + Radix + Zustand + React Router v7) calls Tauri `invoke` only. A Rust bridge (`gateway_bridge.rs`) is the sole path to the Gateway socket and enforces a compile-time `ALLOWED_METHODS` allowlist. The Gateway process is unchanged.

**Tech Stack:** Bun v1.2+, TypeScript 6.x strict, Tauri 2.0, Rust 2021, React 19, React Router v7, Zustand, Tailwind CSS v4, Radix UI primitives, Vitest + Testing Library, `tauri-plugin-global-shortcut`, `tauri-plugin-shell`, `tokio` (for async socket I/O), `interprocess` crate (named pipe / unix socket abstraction).

**Spec:** [`docs/superpowers/specs/2026-04-19-ws5a-app-shell-foundation-design.md`](../specs/2026-04-19-ws5a-app-shell-foundation-design.md) — approved design; refer to it for context that this plan abbreviates.

**Non-negotiables reminder (from `CLAUDE.md`):** No `any` types (use `unknown`), Windows/macOS/Linux parity, AGPL-3.0 for `packages/ui`, frequent commits.

---

## File structure

**New — TypeScript / React (`packages/ui/src/`):**

- `ipc/client.ts` — singleton `NimbusIpcClient`; typed JSON-RPC wrapper over Tauri `invoke`
- `ipc/types.ts` — `ConnectionState`, `DiagSnapshot`, `ConnectorSummary`, `JsonRpcNotification`, error classes
- `providers/GatewayConnectionProvider.tsx` — React context; connection state machine; first-run routing decision
- `components/GatewayOfflineBanner.tsx` — amber banner + Start Gateway button
- `components/Skeleton.tsx` — static placeholder primitive
- `store/index.ts` — `useNimbusStore` composing 4 slices
- `store/slices/connection.ts` — connection state, reconnect attempts
- `store/slices/tray.ts` — aggregate connector health, HITL badge count
- `store/slices/quickQuery.ts` — stream state, tokens, model metadata
- `store/slices/onboarding.ts` — selection set, per-service auth status, actions
- `layouts/RootLayout.tsx` — banner + `<Outlet />`
- `pages/Onboarding.tsx` — shared wizard frame (step pills + `<Outlet />`)
- `pages/onboarding/Welcome.tsx` — step 1
- `pages/onboarding/Connect.tsx` — step 2
- `pages/onboarding/Syncing.tsx` — step 3
- `pages/QuickQuery.tsx` — quick-query popup page
- `pages/stubs/DashboardStub.tsx`, `HitlStub.tsx`, `SettingsStub.tsx`, `MarketplaceStub.tsx`, `WatchersStub.tsx`, `WorkflowsStub.tsx` — one-line placeholder pages
- `index.css` — Tailwind v4 import + theme custom properties
- `App.tsx` — rewritten: composes provider + router
- `main.tsx` — rewritten: renders `<App />`
- `tailwind.config.ts` — base tokens (no mobile breakpoints)

**New — Rust (`packages/ui/src-tauri/src/`):**

- `gateway_bridge.rs` — two Tauri commands: `rpc_call`, `subscribe_notifications`; `ALLOWED_METHODS`; `shell_start_gateway` command; socket reconnect loop
- `tray.rs` — `TrayIconBuilder` setup, icon state machine, menu, hotkey
- `quick_query.rs` — quick-query `WebviewWindow` spawn/focus/close helpers
- `icons/tray-{normal,amber,red,template}.png` — tray icon assets

**New — tests:**

- `test/ipc/client.test.ts`
- `test/providers/GatewayConnectionProvider.test.tsx`
- `test/store/onboarding.test.ts`
- `test/pages/Onboarding.test.tsx`
- `test/pages/QuickQuery.test.tsx`
- `test/layouts/RootLayout.test.tsx`
- `test/components/GatewayOfflineBanner.test.tsx`
- `src-tauri/src/gateway_bridge.rs` — inline `#[cfg(test)] mod tests`

**New — docs:**

- `docs/manual-smoke-ws5a.md`

**Modified:**

- `packages/ui/package.json` — deps (react-router-dom, zustand, tailwindcss, @tailwindcss/vite, @radix-ui/*, tauri plugins)
- `packages/ui/vite.config.ts` — `@tailwindcss/vite` plugin
- `packages/ui/src-tauri/Cargo.toml` — deps (tauri-plugin-global-shortcut, tauri-plugin-shell, interprocess, tokio)
- `packages/ui/src-tauri/tauri.conf.json` — `LSUIElement`, plugin registration, shell allowlist
- `packages/ui/src-tauri/capabilities/default.json` — add frontend permission grants
- `packages/ui/src-tauri/src/lib.rs` — module wiring, activation policy, plugin init
- `.github/workflows/_test-suite.yml` — new `ui-coverage` step
- `CLAUDE.md` — add WS5-A file locations + status
- `GEMINI.md` — mirror CLAUDE.md
- `docs/roadmap.md` — WS5 Sub-project A row + acceptance
- `packages/ui/src/shell.vitest.tsx` — delete (obsolete placeholder)

---

## Task 1: Add frontend dependencies and Tailwind v4 wiring

**Files:**

- Modify: `packages/ui/package.json`
- Modify: `packages/ui/vite.config.ts`
- Create: `packages/ui/src/index.css`
- Create: `packages/ui/tailwind.config.ts`

- [ ] **Step 1: Add runtime dependencies to `package.json`**

Edit `packages/ui/package.json`. Merge these into the existing `dependencies` and `devDependencies`:

```json
{
  "dependencies": {
    "react": "^19.2.5",
    "react-dom": "^19.2.5",
    "react-router-dom": "^7.1.5",
    "zustand": "^5.0.2",
    "@radix-ui/react-dialog": "^1.1.4",
    "@radix-ui/react-slot": "^1.1.1",
    "@radix-ui/react-tooltip": "^1.1.6",
    "@tauri-apps/api": "^2.0.0",
    "@tauri-apps/plugin-shell": "^2.0.0",
    "@tauri-apps/plugin-global-shortcut": "^2.0.0"
  },
  "devDependencies": {
    "tailwindcss": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0"
  }
}
```

- [ ] **Step 2: Add `@tailwindcss/vite` to Vite config**

Edit `packages/ui/vite.config.ts`:

```typescript
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: ["es2021", "chrome105", "safari15"],
    minify: process.env.TAURI_DEBUG ? false : "esbuild",
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
```

- [ ] **Step 3: Create `index.css` with Tailwind import + theme tokens**

Create `packages/ui/src/index.css`:

```css
@import "tailwindcss";

@theme {
  --color-bg: #0f1115;
  --color-surface: #171a21;
  --color-border: #2a2f3a;
  --color-fg: #e4e7ee;
  --color-fg-muted: #8a93a6;
  --color-accent: #7890ff;
  --color-amber: #d4a657;
  --color-error: #e5484d;
  --color-ok: #52c41a;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
}

html, body, #root { height: 100%; }
body { margin: 0; background: var(--color-bg); color: var(--color-fg); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
```

- [ ] **Step 4: Create Tailwind config (empty plugin list — 16:9 only, no mobile breakpoints)**

Create `packages/ui/tailwind.config.ts`:

```typescript
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx,html}", "./index.html"],
  theme: { extend: {} },
  plugins: [],
};

export default config;
```

- [ ] **Step 5: Install dependencies**

Run (from repo root): `bun install`
Expected: Installs complete without errors.

- [ ] **Step 6: Verify typecheck passes on the existing placeholder app**

Run: `cd packages/ui && bunx tsc --noEmit`
Expected: PASS (no errors — nothing new to typecheck yet).

- [ ] **Step 7: Commit**

```bash
git add packages/ui/package.json packages/ui/vite.config.ts packages/ui/src/index.css packages/ui/tailwind.config.ts bun.lockb
git commit -m "feat(ui): add Tailwind v4, Radix, Zustand, React Router v7 deps"
```

---

## Task 2: Shared IPC types

**Files:**

- Create: `packages/ui/src/ipc/types.ts`

- [ ] **Step 1: Create `ipc/types.ts`**

Create `packages/ui/src/ipc/types.ts`:

```typescript
export type ConnectionState = "initializing" | "connecting" | "connected" | "disconnected";

export interface DiagSnapshot {
  readonly indexTotalItems: number;
  readonly connectorCount: number;
}

export type ConnectorHealth =
  | "healthy"
  | "degraded"
  | "error"
  | "rate_limited"
  | "unauthenticated"
  | "paused";

export interface ConnectorSummary {
  readonly name: string;
  readonly state: ConnectorHealth;
}

export interface JsonRpcNotification {
  readonly method: string;
  readonly params: unknown;
}

export interface JsonRpcErrorPayload {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export class MethodNotAllowedError extends Error {
  constructor(public readonly method: string) {
    super(`ERR_METHOD_NOT_ALLOWED: ${method}`);
    this.name = "MethodNotAllowedError";
  }
}

export class GatewayOfflineError extends Error {
  constructor(message = "Gateway is not connected") {
    super(message);
    this.name = "GatewayOfflineError";
  }
}

export class JsonRpcError extends Error {
  constructor(public readonly payload: JsonRpcErrorPayload) {
    super(payload.message);
    this.name = "JsonRpcError";
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd packages/ui && bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/ipc/types.ts
git commit -m "feat(ui): add shared IPC types for Sub-project A"
```

---

## Task 3: IPC client (TDD)

**Files:**

- Create: `packages/ui/src/ipc/client.ts`
- Test: `packages/ui/test/ipc/client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ui/test/ipc/client.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

type InvokeArgs = { method: string; params: unknown };
const invokeMock = vi.fn<(cmd: string, args?: InvokeArgs) => Promise<unknown>>();
const listenMock = vi.fn<(event: string, handler: (e: { payload: unknown }) => void) => Promise<() => void>>();

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

import { createIpcClient } from "../../src/ipc/client";
import {
  GatewayOfflineError,
  JsonRpcError,
  MethodNotAllowedError,
} from "../../src/ipc/types";

describe("NimbusIpcClient", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
    listenMock.mockResolvedValue(() => {});
  });

  it("serialises method + params and resolves with the Gateway result", async () => {
    invokeMock.mockResolvedValueOnce({ indexTotalItems: 0, connectorCount: 0 });
    const client = createIpcClient();

    const result = await client.call("diag.snapshot");

    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "diag.snapshot",
      params: null,
    });
    expect(result).toEqual({ indexTotalItems: 0, connectorCount: 0 });
  });

  it("throws MethodNotAllowedError when bridge rejects an unlisted method", async () => {
    invokeMock.mockRejectedValueOnce("ERR_METHOD_NOT_ALLOWED:vault.get");
    const client = createIpcClient();

    await expect(client.call("vault.get")).rejects.toBeInstanceOf(MethodNotAllowedError);
  });

  it("throws GatewayOfflineError when bridge reports disconnected", async () => {
    invokeMock.mockRejectedValueOnce("ERR_GATEWAY_OFFLINE");
    const client = createIpcClient();

    await expect(client.call("diag.snapshot")).rejects.toBeInstanceOf(GatewayOfflineError);
  });

  it("propagates JSON-RPC errors as JsonRpcError", async () => {
    invokeMock.mockRejectedValueOnce(
      JSON.stringify({ code: -32000, message: "boom" }),
    );
    const client = createIpcClient();

    await expect(client.call("diag.snapshot")).rejects.toBeInstanceOf(JsonRpcError);
  });

  it("dispatches notifications to subscribers", async () => {
    const client = createIpcClient();
    let registered: ((e: { payload: unknown }) => void) | undefined;
    listenMock.mockImplementationOnce(async (_event, handler) => {
      registered = handler;
      return () => {};
    });
    const handler = vi.fn();
    const unsubscribe = await client.subscribe(handler);

    registered?.({ payload: { method: "engine.streamToken", params: { text: "hi" } } });

    expect(handler).toHaveBeenCalledWith({
      method: "engine.streamToken",
      params: { text: "hi" },
    });
    unsubscribe();
  });
});
```

- [ ] **Step 2: Run test — expect failure**

Run: `cd packages/ui && bunx vitest run test/ipc/client.test.ts`
Expected: FAIL — `Cannot find module '../../src/ipc/client'` or similar.

- [ ] **Step 3: Implement `ipc/client.ts`**

Create `packages/ui/src/ipc/client.ts`:

```typescript
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  type ConnectionState,
  GatewayOfflineError,
  type JsonRpcErrorPayload,
  JsonRpcError,
  type JsonRpcNotification,
  MethodNotAllowedError,
} from "./types";

export interface NimbusIpcClient {
  call<TResult>(method: string, params?: unknown): Promise<TResult>;
  subscribe(handler: (n: JsonRpcNotification) => void): Promise<() => void>;
  onConnectionState(handler: (s: ConnectionState) => void): Promise<() => void>;
}

function parseError(err: unknown): Error {
  const msg = typeof err === "string" ? err : err instanceof Error ? err.message : JSON.stringify(err);
  if (msg.startsWith("ERR_METHOD_NOT_ALLOWED")) {
    const method = msg.split(":")[1] ?? "unknown";
    return new MethodNotAllowedError(method);
  }
  if (msg.startsWith("ERR_GATEWAY_OFFLINE")) return new GatewayOfflineError();
  try {
    const parsed = JSON.parse(msg) as JsonRpcErrorPayload;
    if (typeof parsed.code === "number" && typeof parsed.message === "string") {
      return new JsonRpcError(parsed);
    }
  } catch {
    /* not a JSON-RPC error payload */
  }
  return new Error(msg);
}

let singleton: NimbusIpcClient | null = null;

export function createIpcClient(): NimbusIpcClient {
  if (singleton) return singleton;

  const client: NimbusIpcClient = {
    async call<TResult>(method: string, params: unknown = null): Promise<TResult> {
      try {
        const result = await invoke<TResult>("rpc_call", { method, params });
        return result;
      } catch (err) {
        throw parseError(err);
      }
    },
    async subscribe(handler): Promise<() => void> {
      return listen<JsonRpcNotification>("gateway://notification", (evt) =>
        handler(evt.payload),
      );
    },
    async onConnectionState(handler): Promise<() => void> {
      return listen<ConnectionState>("gateway://connection-state", (evt) =>
        handler(evt.payload),
      );
    },
  };
  singleton = client;
  return client;
}

/** For tests only. Resets the singleton so each suite starts clean. */
export function __resetIpcClientForTests(): void {
  singleton = null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/ui && bunx vitest run test/ipc/client.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/ipc/client.ts packages/ui/test/ipc/client.test.ts
git commit -m "feat(ui): add typed IPC client with allowlist error handling"
```

---

## Task 4: Rust bridge — `rpc_call` with `ALLOWED_METHODS`

**Files:**

- Modify: `packages/ui/src-tauri/Cargo.toml`
- Create: `packages/ui/src-tauri/src/gateway_bridge.rs`
- Modify: `packages/ui/src-tauri/src/lib.rs`

- [ ] **Step 1: Add Rust dependencies**

Edit `packages/ui/src-tauri/Cargo.toml` — add to `[dependencies]`:

```toml
tauri-plugin-shell = "2"
tauri-plugin-global-shortcut = "2"
tokio = { version = "1", features = ["rt-multi-thread", "io-util", "net", "sync", "time", "macros"] }
interprocess = { version = "2", features = ["tokio"] }
thiserror = "1"
```

- [ ] **Step 2: Create `gateway_bridge.rs` with allowlist + rpc_call stub**

Create `packages/ui/src-tauri/src/gateway_bridge.rs`:

```rust
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

pub const ALLOWED_METHODS: &[&str] = &[
    "diag.snapshot",
    "connector.list",
    "connector.startAuth",
    "engine.askStream",
    "db.getMeta",
    "db.setMeta",
];

#[derive(Debug, Serialize, Deserialize)]
pub struct RpcError(pub String);

impl std::fmt::Display for RpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for RpcError {}

/// Bridge state — shared across Tauri commands.
/// Real socket wiring added in Task 5. For this task it only holds the allowlist check.
pub struct BridgeState;

impl BridgeState {
    pub fn new() -> Self {
        Self
    }
}

/// Returns true iff `method` is in ALLOWED_METHODS.
pub fn is_method_allowed(method: &str) -> bool {
    ALLOWED_METHODS.iter().any(|&m| m == method)
}

#[tauri::command]
pub async fn rpc_call(
    _state: State<'_, BridgeState>,
    method: String,
    _params: Value,
) -> Result<Value, String> {
    if !is_method_allowed(&method) {
        return Err(format!("ERR_METHOD_NOT_ALLOWED:{}", method));
    }
    // Real dispatch added in Task 5.
    Err("ERR_GATEWAY_OFFLINE".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlist_contains_expected_methods() {
        assert!(is_method_allowed("diag.snapshot"));
        assert!(is_method_allowed("connector.list"));
        assert!(is_method_allowed("connector.startAuth"));
        assert!(is_method_allowed("engine.askStream"));
        assert!(is_method_allowed("db.getMeta"));
        assert!(is_method_allowed("db.setMeta"));
    }

    #[test]
    fn allowlist_rejects_sensitive_methods() {
        assert!(!is_method_allowed("vault.get"));
        assert!(!is_method_allowed("vault.set"));
        assert!(!is_method_allowed("db.query"));
        assert!(!is_method_allowed("engine.ask"));
    }

    #[test]
    fn allowlist_rejects_empty_and_unknown() {
        assert!(!is_method_allowed(""));
        assert!(!is_method_allowed("unknown.method"));
    }
}
```

- [ ] **Step 3: Wire module into `lib.rs` and register command + state**

Replace the contents of `packages/ui/src-tauri/src/lib.rs`:

```rust
mod gateway_bridge;

use gateway_bridge::BridgeState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(BridgeState::new())
        .invoke_handler(tauri::generate_handler![gateway_bridge::rpc_call])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 4: Run Rust tests**

Run: `cd packages/ui/src-tauri && cargo test`
Expected: 3 tests PASS.

- [ ] **Step 5: Verify cargo build succeeds**

Run: `cd packages/ui/src-tauri && cargo build`
Expected: Builds without errors (downloads new deps on first run).

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src-tauri/Cargo.toml packages/ui/src-tauri/Cargo.lock packages/ui/src-tauri/src/gateway_bridge.rs packages/ui/src-tauri/src/lib.rs
git commit -m "feat(ui): add Rust bridge scaffold with ALLOWED_METHODS allowlist"
```

---

## Task 5: Rust bridge — Gateway socket client + connection state events

**Files:**

- Modify: `packages/ui/src-tauri/src/gateway_bridge.rs`
- Modify: `packages/ui/src-tauri/src/lib.rs`

Context: The Gateway listens on a platform-specific socket. On Windows it's a named pipe at `\\.\pipe\nimbus-gateway`; on macOS/Linux it's a Unix domain socket whose path depends on `NIMBUS_SOCKET` or defaults to `<data-dir>/nimbus.sock`. The bridge connects once, spawns a tokio task that reads newline-framed JSON-RPC messages, dispatches responses by `id`, and emits notifications + state events.

- [ ] **Step 1: Extend `BridgeState` with pending-request map + writer handle**

Replace the body of `packages/ui/src-tauri/src/gateway_bridge.rs` (keep existing `ALLOWED_METHODS` and test module intact — only extend the state and `rpc_call` implementation):

```rust
use interprocess::local_socket::{
    tokio::{prelude::*, Stream},
    GenericFilePath, GenericNamespaced, ToFsName, ToNsName,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{oneshot, Mutex};
use tokio::time::sleep;

pub const ALLOWED_METHODS: &[&str] = &[
    "diag.snapshot",
    "connector.list",
    "connector.startAuth",
    "engine.askStream",
    "db.getMeta",
    "db.setMeta",
];

pub fn is_method_allowed(method: &str) -> bool {
    ALLOWED_METHODS.iter().any(|&m| m == method)
}

type PendingMap = Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value, Value>>>>>;

pub struct BridgeState {
    writer: Arc<Mutex<Option<Box<dyn AsyncWriteExt + Send + Unpin>>>>,
    pending: PendingMap,
    next_id: Arc<Mutex<u64>>,
}

impl BridgeState {
    pub fn new() -> Self {
        Self {
            writer: Arc::new(Mutex::new(None)),
            pending: Arc::new(Mutex::new(HashMap::new())),
            next_id: Arc::new(Mutex::new(0)),
        }
    }
}

fn socket_name() -> std::io::Result<impl interprocess::local_socket::ToNsName<'static> + interprocess::local_socket::ToFsName<'static>> {
    // Platform-specific socket location.
    // Honour NIMBUS_SOCKET env var if set; otherwise use the platform default.
    if let Ok(path) = std::env::var("NIMBUS_SOCKET") {
        return Ok(path.to_fs_name::<GenericFilePath>().unwrap().into_owned());
    }
    #[cfg(target_os = "windows")]
    {
        Ok("nimbus-gateway".to_ns_name::<GenericNamespaced>().unwrap().into_owned())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
        let path = format!("{}/.local/share/nimbus/nimbus.sock", home);
        Ok(path.to_fs_name::<GenericFilePath>().unwrap().into_owned())
    }
}

pub async fn connect_and_run(app: AppHandle, state: BridgeState) {
    let mut attempt: u32 = 0;
    loop {
        let _ = app.emit("gateway://connection-state", "connecting");
        match Stream::connect(socket_name().expect("valid socket name")).await {
            Ok(stream) => {
                attempt = 0;
                let (read_half, write_half) = stream.split();
                {
                    let mut w = state.writer.lock().await;
                    *w = Some(Box::new(write_half));
                }
                let _ = app.emit("gateway://connection-state", "connected");
                let pending = state.pending.clone();
                let app_cloned = app.clone();
                let reader = BufReader::new(read_half);
                run_read_loop(reader, pending, app_cloned).await;
                let mut w = state.writer.lock().await;
                *w = None;
            }
            Err(_err) => {
                // fall through to retry
            }
        }
        let _ = app.emit("gateway://connection-state", "disconnected");
        let backoff_ms = match attempt { 0 => 200, 1 => 2_000, _ => 10_000 };
        attempt = attempt.saturating_add(1);
        sleep(Duration::from_millis(backoff_ms)).await;
    }
}

async fn run_read_loop<R>(reader: BufReader<R>, pending: PendingMap, app: AppHandle)
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut lines = reader.lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
        if let Some(id) = msg.get("id").and_then(|v| v.as_str()).map(String::from) {
            let mut map = pending.lock().await;
            if let Some(tx) = map.remove(&id) {
                let payload = if let Some(err) = msg.get("error") {
                    Err(err.clone())
                } else {
                    Ok(msg.get("result").cloned().unwrap_or(Value::Null))
                };
                let _ = tx.send(payload);
            }
        } else if msg.get("method").is_some() {
            // Notification — re-emit to frontend.
            let _ = app.emit("gateway://notification", msg);
        }
    }
    // Loop exited (EOF / socket closed / read error). Drain pending so any in-flight
    // rpc_call awaiters fail fast with ERR_GATEWAY_OFFLINE instead of hanging forever.
    let mut map = pending.lock().await;
    for (_id, tx) in map.drain() {
        let _ = tx.send(Err(Value::String("ERR_GATEWAY_OFFLINE".into())));
    }
}

#[tauri::command]
pub async fn rpc_call(
    state: State<'_, BridgeState>,
    method: String,
    params: Value,
) -> Result<Value, String> {
    if !is_method_allowed(&method) {
        return Err(format!("ERR_METHOD_NOT_ALLOWED:{}", method));
    }
    let writer_slot = state.writer.clone();
    let mut writer_guard = writer_slot.lock().await;
    let Some(writer) = writer_guard.as_mut() else {
        return Err("ERR_GATEWAY_OFFLINE".into());
    };
    let mut id_guard = state.next_id.lock().await;
    *id_guard = id_guard.wrapping_add(1);
    let id = format!("r{}", *id_guard);
    drop(id_guard);

    let frame = json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": if params.is_null() { Value::Null } else { params },
    });
    let mut line = frame.to_string();
    line.push('\n');
    writer.write_all(line.as_bytes()).await.map_err(|e| e.to_string())?;
    writer.flush().await.map_err(|e| e.to_string())?;
    drop(writer_guard);

    let (tx, rx) = oneshot::channel();
    state.pending.lock().await.insert(id, tx);
    match rx.await {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => Err("ERR_GATEWAY_OFFLINE".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlist_contains_expected_methods() {
        assert!(is_method_allowed("diag.snapshot"));
        assert!(is_method_allowed("connector.list"));
        assert!(is_method_allowed("connector.startAuth"));
        assert!(is_method_allowed("engine.askStream"));
        assert!(is_method_allowed("db.getMeta"));
        assert!(is_method_allowed("db.setMeta"));
    }

    #[test]
    fn allowlist_rejects_sensitive_methods() {
        assert!(!is_method_allowed("vault.get"));
        assert!(!is_method_allowed("vault.set"));
        assert!(!is_method_allowed("db.query"));
        assert!(!is_method_allowed("engine.ask"));
    }

    #[test]
    fn allowlist_rejects_empty_and_unknown() {
        assert!(!is_method_allowed(""));
        assert!(!is_method_allowed("unknown.method"));
    }
}
```

- [ ] **Step 2: Spawn connection loop from `lib.rs::setup`**

Edit `packages/ui/src-tauri/src/lib.rs`:

```rust
mod gateway_bridge;

use gateway_bridge::{connect_and_run, BridgeState};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(BridgeState::new())
        .invoke_handler(tauri::generate_handler![gateway_bridge::rpc_call])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            let handle = app.handle().clone();
            let state = handle.state::<BridgeState>();
            // Clone only the Arcs — BridgeState is cheap to construct with the same backing
            // storage semantics for the spawned task. We use a fresh BridgeState-shaped record
            // built from the same Arcs to avoid requiring BridgeState: Clone on the public API.
            let bridge_for_task = BridgeState {
                writer: state.writer.clone(),
                pending: state.pending.clone(),
                next_id: state.next_id.clone(),
            };
            tauri::async_runtime::spawn(async move {
                connect_and_run(handle, bridge_for_task).await;
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

Note: `BridgeState`'s fields are all `Arc<Mutex<...>>`, so constructing the task-side clone via field-level `.clone()` shares state correctly without requiring `BridgeState: Clone`.

Since the task-side struct needs to see the fields, make them `pub(crate)` in `gateway_bridge.rs`:

```rust
pub struct BridgeState {
    pub(crate) writer: Arc<Mutex<Option<Box<dyn AsyncWriteExt + Send + Unpin>>>>,
    pub(crate) pending: PendingMap,
    pub(crate) next_id: Arc<Mutex<u64>>,
}
```

- [ ] **Step 3: Run cargo tests**

Run: `cd packages/ui/src-tauri && cargo test`
Expected: 3 tests PASS.

- [ ] **Step 4: Run cargo build to catch wiring errors**

Run: `cd packages/ui/src-tauri && cargo build`
Expected: Builds without errors.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src-tauri/Cargo.toml packages/ui/src-tauri/Cargo.lock packages/ui/src-tauri/src/gateway_bridge.rs packages/ui/src-tauri/src/lib.rs
git commit -m "feat(ui): wire Rust bridge to Gateway socket with reconnect + notification forwarding"
```

---

## Task 6: Rust bridge — `shell_start_gateway` command

**Files:**

- Modify: `packages/ui/src-tauri/src/gateway_bridge.rs`
- Modify: `packages/ui/src-tauri/src/lib.rs`
- Modify: `packages/ui/src-tauri/capabilities/default.json`
- Modify: `packages/ui/src-tauri/tauri.conf.json`

**PATH note (deferred to Sub-project D / installer work):** `nimbus` must be on the `PATH` of the Tauri process. On macOS, GUI apps launched from Launchpad do **not** inherit a user shell `PATH`; on Linux, desktop-file launchers use a minimal environment. Sub-project A surfaces the resulting `command not found` error to the user via the existing `GatewayOfflineBanner` error display (implemented in Task 8) — good enough for a developer-audience release. Installer-level path wiring (configured-location fallback, PATH injection in `.desktop` / `Info.plist`) is scoped to Sub-project D and the WS4 installer polish. A dedicated item is added to the Sub-project D roadmap entry in Task 21.

- [ ] **Step 1: Add command implementation**

Append to `packages/ui/src-tauri/src/gateway_bridge.rs`:

```rust
use tauri_plugin_shell::ShellExt;

#[tauri::command]
pub async fn shell_start_gateway(app: AppHandle) -> Result<(), String> {
    app.shell()
        .command("nimbus")
        .args(["start"])
        .spawn()
        .map(|_child| ())
        .map_err(|e| format!("Failed to launch nimbus: {e} (is it on PATH?)"))
}
```

- [ ] **Step 2: Register command in `lib.rs`**

Update the `invoke_handler` in `packages/ui/src-tauri/src/lib.rs`:

```rust
.invoke_handler(tauri::generate_handler![
    gateway_bridge::rpc_call,
    gateway_bridge::shell_start_gateway,
])
```

- [ ] **Step 3: Scope shell permission to `nimbus` binary only**

Replace `packages/ui/src-tauri/capabilities/default.json` with:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capabilities for Nimbus Desktop",
  "windows": ["main", "quick-query"],
  "permissions": [
    "core:default",
    "shell:allow-spawn",
    {
      "identifier": "shell:allow-execute",
      "allow": [
        { "name": "nimbus", "cmd": "nimbus", "args": ["start"], "sidecar": false }
      ]
    },
    "global-shortcut:allow-register",
    "global-shortcut:allow-unregister"
  ]
}
```

- [ ] **Step 4: Register shell + global-shortcut plugins in `tauri.conf.json`**

The plugins are registered in `lib.rs` (Task 5 already added `tauri_plugin_shell`); no change needed in `tauri.conf.json` beyond what's there. Verify the file still parses.

- [ ] **Step 5: Cargo build**

Run: `cd packages/ui/src-tauri && cargo build`
Expected: Builds cleanly.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src-tauri/src/gateway_bridge.rs packages/ui/src-tauri/src/lib.rs packages/ui/src-tauri/capabilities/default.json
git commit -m "feat(ui): add shell_start_gateway command with scoped shell permission"
```

---

## Task 7: Zustand store with four slices

**Files:**

- Create: `packages/ui/src/store/index.ts`
- Create: `packages/ui/src/store/slices/connection.ts`
- Create: `packages/ui/src/store/slices/tray.ts`
- Create: `packages/ui/src/store/slices/quickQuery.ts`
- Create: `packages/ui/src/store/slices/onboarding.ts`
- Test: `packages/ui/test/store/onboarding.test.ts`

- [ ] **Step 1: Create `connection.ts` slice**

Create `packages/ui/src/store/slices/connection.ts`:

```typescript
import type { StateCreator } from "zustand";
import type { ConnectionState } from "../../ipc/types";

export interface ConnectionSlice {
  readonly connectionState: ConnectionState;
  readonly lastConnectedAt: number | null;
  readonly reconnectAttempts: number;
  setConnectionState: (s: ConnectionState) => void;
}

export const createConnectionSlice: StateCreator<ConnectionSlice, [], [], ConnectionSlice> = (set) => ({
  connectionState: "initializing",
  lastConnectedAt: null,
  reconnectAttempts: 0,
  setConnectionState: (s) =>
    set((state) => ({
      connectionState: s,
      lastConnectedAt: s === "connected" ? Date.now() : state.lastConnectedAt,
      reconnectAttempts:
        s === "connecting" ? state.reconnectAttempts + 1 : s === "connected" ? 0 : state.reconnectAttempts,
    })),
});
```

- [ ] **Step 2: Create `tray.ts` slice**

Create `packages/ui/src/store/slices/tray.ts`:

```typescript
import type { StateCreator } from "zustand";

export type TrayIconState = "normal" | "amber" | "red";

export interface TraySlice {
  readonly trayIcon: TrayIconState;
  readonly hitlBadgeCount: number;
  setTrayIcon: (icon: TrayIconState) => void;
  setHitlBadgeCount: (n: number) => void;
}

export const createTraySlice: StateCreator<TraySlice, [], [], TraySlice> = (set) => ({
  trayIcon: "normal",
  hitlBadgeCount: 0,
  setTrayIcon: (trayIcon) => set({ trayIcon }),
  setHitlBadgeCount: (hitlBadgeCount) => set({ hitlBadgeCount: Math.max(0, hitlBadgeCount) }),
});
```

- [ ] **Step 3: Create `quickQuery.ts` slice**

Create `packages/ui/src/store/slices/quickQuery.ts`:

```typescript
import type { StateCreator } from "zustand";

export interface QuickQuerySlice {
  readonly streamId: string | null;
  readonly tokens: readonly string[];
  readonly modelLabel: string | null;
  readonly doneAt: number | null;
  startStream: (streamId: string) => void;
  appendToken: (streamId: string, token: string) => void;
  markDone: (streamId: string, modelLabel: string) => void;
  reset: () => void;
}

export const createQuickQuerySlice: StateCreator<QuickQuerySlice, [], [], QuickQuerySlice> = (set) => ({
  streamId: null,
  tokens: [],
  modelLabel: null,
  doneAt: null,
  startStream: (streamId) => set({ streamId, tokens: [], modelLabel: null, doneAt: null }),
  appendToken: (streamId, token) =>
    set((state) => (state.streamId === streamId ? { tokens: [...state.tokens, token] } : {})),
  markDone: (streamId, modelLabel) =>
    set((state) => (state.streamId === streamId ? { modelLabel, doneAt: Date.now() } : {})),
  reset: () => set({ streamId: null, tokens: [], modelLabel: null, doneAt: null }),
});
```

- [ ] **Step 4: Create `onboarding.ts` slice**

Create `packages/ui/src/store/slices/onboarding.ts`:

```typescript
import type { StateCreator } from "zustand";

export type AuthStatus = "pending" | "authenticating" | "connected" | "cancelled" | "failed";

export interface OnboardingSlice {
  readonly selected: ReadonlySet<string>;
  readonly authStatus: Readonly<Record<string, AuthStatus>>;
  toggleSelected: (name: string) => void;
  setAuthStatus: (name: string, status: AuthStatus) => void;
  resetOnboarding: () => void;
}

export const createOnboardingSlice: StateCreator<OnboardingSlice, [], [], OnboardingSlice> = (set) => ({
  selected: new Set<string>(),
  authStatus: {},
  toggleSelected: (name) =>
    set((state) => {
      const next = new Set(state.selected);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return { selected: next };
    }),
  setAuthStatus: (name, status) =>
    set((state) => ({ authStatus: { ...state.authStatus, [name]: status } })),
  resetOnboarding: () => set({ selected: new Set<string>(), authStatus: {} }),
});
```

- [ ] **Step 5: Create combined store**

Create `packages/ui/src/store/index.ts`:

```typescript
import { create } from "zustand";
import { type ConnectionSlice, createConnectionSlice } from "./slices/connection";
import { type OnboardingSlice, createOnboardingSlice } from "./slices/onboarding";
import { type QuickQuerySlice, createQuickQuerySlice } from "./slices/quickQuery";
import { type TraySlice, createTraySlice } from "./slices/tray";

export type NimbusStore = ConnectionSlice & TraySlice & QuickQuerySlice & OnboardingSlice;

export const useNimbusStore = create<NimbusStore>()((...a) => ({
  ...createConnectionSlice(...a),
  ...createTraySlice(...a),
  ...createQuickQuerySlice(...a),
  ...createOnboardingSlice(...a),
}));
```

- [ ] **Step 6: Write onboarding slice test**

Create `packages/ui/test/store/onboarding.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { useNimbusStore } from "../../src/store";

describe("onboarding slice", () => {
  beforeEach(() => {
    useNimbusStore.getState().resetOnboarding();
  });

  it("toggles selection on/off", () => {
    useNimbusStore.getState().toggleSelected("github");
    expect(useNimbusStore.getState().selected.has("github")).toBe(true);
    useNimbusStore.getState().toggleSelected("github");
    expect(useNimbusStore.getState().selected.has("github")).toBe(false);
  });

  it("records per-service auth status", () => {
    useNimbusStore.getState().setAuthStatus("github", "authenticating");
    expect(useNimbusStore.getState().authStatus.github).toBe("authenticating");
    useNimbusStore.getState().setAuthStatus("github", "connected");
    expect(useNimbusStore.getState().authStatus.github).toBe("connected");
  });

  it("reset clears both selection and status", () => {
    useNimbusStore.getState().toggleSelected("github");
    useNimbusStore.getState().setAuthStatus("github", "connected");
    useNimbusStore.getState().resetOnboarding();
    expect(useNimbusStore.getState().selected.size).toBe(0);
    expect(useNimbusStore.getState().authStatus).toEqual({});
  });
});
```

- [ ] **Step 7: Run tests**

Run: `cd packages/ui && bunx vitest run test/store/onboarding.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/store packages/ui/test/store
git commit -m "feat(ui): add Zustand store with connection/tray/quickQuery/onboarding slices"
```

---

## Task 8: Skeleton primitive + GatewayOfflineBanner

**Files:**

- Create: `packages/ui/src/components/Skeleton.tsx`
- Create: `packages/ui/src/components/GatewayOfflineBanner.tsx`
- Test: `packages/ui/test/components/GatewayOfflineBanner.test.tsx`

- [ ] **Step 1: Write failing test for banner**

Create `packages/ui/test/components/GatewayOfflineBanner.test.tsx`:

```typescript
import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GatewayOfflineBanner } from "../../src/components/GatewayOfflineBanner";

const invokeMock = vi.fn<(cmd: string) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

describe("GatewayOfflineBanner", () => {
  beforeEach(() => invokeMock.mockReset());
  afterEach(() => invokeMock.mockReset());

  it("renders the offline message and a Start Gateway button", () => {
    render(<GatewayOfflineBanner />);
    expect(screen.getByText(/Gateway is not running/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /start gateway/i })).toBeTruthy();
  });

  it("invokes shell_start_gateway when the button is clicked", () => {
    invokeMock.mockResolvedValueOnce(null);
    render(<GatewayOfflineBanner />);
    fireEvent.click(screen.getByRole("button", { name: /start gateway/i }));
    expect(invokeMock).toHaveBeenCalledWith("shell_start_gateway");
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `cd packages/ui && bunx vitest run test/components/GatewayOfflineBanner.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement Skeleton**

Create `packages/ui/src/components/Skeleton.tsx`:

```typescript
import type { CSSProperties, PropsWithChildren } from "react";

export function Skeleton({
  width,
  height,
  children,
}: PropsWithChildren<{ width?: string; height?: string }>) {
  const style: CSSProperties = {
    width: width ?? "100%",
    height: height ?? "1rem",
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-md)",
    opacity: 0.5,
  };
  return <div aria-busy="true" style={style}>{children}</div>;
}
```

- [ ] **Step 4: Implement banner**

Create `packages/ui/src/components/GatewayOfflineBanner.tsx`:

```typescript
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";

export function GatewayOfflineBanner() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onStart = async () => {
    setPending(true);
    setError(null);
    try {
      await invoke("shell_start_gateway");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      role="alert"
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "10px 16px",
        background: "rgba(212, 166, 87, 0.15)",
        borderBottom: "1px solid var(--color-amber)",
        color: "var(--color-fg)",
      }}
    >
      <span>Gateway is not running.{error ? ` (${error})` : ""}</span>
      <button
        type="button"
        onClick={onStart}
        disabled={pending}
        style={{
          padding: "6px 14px",
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--color-amber)",
          background: "transparent",
          color: "var(--color-amber)",
          cursor: "pointer",
        }}
      >
        {pending ? "Starting…" : "Start Gateway"}
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Run tests**

Run: `cd packages/ui && bunx vitest run test/components/GatewayOfflineBanner.test.tsx`
Expected: 2 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components packages/ui/test/components
git commit -m "feat(ui): add Skeleton primitive and GatewayOfflineBanner"
```

---

## Task 9: RootLayout with banner gating + hotkey-failed toast

**Files:**

- Create: `packages/ui/src/layouts/RootLayout.tsx`
- Create: `packages/ui/src/components/HotkeyFailedBanner.tsx`
- Test: `packages/ui/test/layouts/RootLayout.test.tsx`
- Test: `packages/ui/test/components/HotkeyFailedBanner.test.tsx`

- [ ] **Step 1: Write failing test for RootLayout**

Create `packages/ui/test/layouts/RootLayout.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { RootLayout } from "../../src/layouts/RootLayout";
import { useNimbusStore } from "../../src/store";

describe("RootLayout", () => {
  beforeEach(() => {
    useNimbusStore.setState({ connectionState: "connected" });
  });

  const renderWith = () =>
    render(
      <MemoryRouter>
        <Routes>
          <Route element={<RootLayout />}>
            <Route index element={<div>child</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

  it("does not render the offline banner when connected", () => {
    renderWith();
    // `role="alert"` is used by BOTH banners — assert the offline-specific copy is absent
    expect(screen.queryByText(/Gateway is not running/i)).toBeNull();
    expect(screen.getByText("child")).toBeTruthy();
  });

  it("renders the offline banner when disconnected", () => {
    useNimbusStore.setState({ connectionState: "disconnected" });
    renderWith();
    expect(screen.getByText(/Gateway is not running/i)).toBeTruthy();
    expect(screen.getByText("child")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `cd packages/ui && bunx vitest run test/layouts/RootLayout.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement HotkeyFailedBanner**

Create `packages/ui/src/components/HotkeyFailedBanner.tsx`:

```typescript
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

export function HotkeyFailedBanner() {
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let stop: (() => void) | null = null;
    (async () => {
      stop = await listen<string>("tray://hotkey-failed", (evt) => {
        setError(typeof evt.payload === "string" ? evt.payload : "Unknown error");
      });
    })();
    return () => { stop?.(); };
  }, []);

  if (!error || dismissed) return null;
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "8px 16px",
        background: "rgba(212, 166, 87, 0.12)",
        borderBottom: "1px solid var(--color-amber)",
        color: "var(--color-fg)",
        fontSize: 12,
      }}
    >
      <span>
        Quick-query hotkey (<strong>Ctrl+Shift+N</strong>) could not be registered — it may be bound by another app. Details: {error}
      </span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        style={{
          padding: "4px 10px",
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--color-border)",
          background: "transparent",
          color: "var(--color-fg-muted)",
          cursor: "pointer",
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Write failing test for HotkeyFailedBanner**

Create `packages/ui/test/components/HotkeyFailedBanner.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (e: { payload: unknown }) => void;
const handlers: Handler[] = [];
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_event: string, h: Handler) => {
    handlers.push(h);
    return () => {};
  }),
}));

import { HotkeyFailedBanner } from "../../src/components/HotkeyFailedBanner";

describe("HotkeyFailedBanner", () => {
  beforeEach(() => { handlers.length = 0; });

  it("renders nothing until the tray emits hotkey-failed", () => {
    const { container } = render(<HotkeyFailedBanner />);
    expect(container.textContent).toBe("");
  });

  it("renders the conflict message when the event fires", async () => {
    render(<HotkeyFailedBanner />);
    await waitFor(() => expect(handlers.length).toBeGreaterThan(0));
    handlers[0]!({ payload: "already bound" });
    expect(await screen.findByText(/could not be registered/i)).toBeTruthy();
  });

  it("Dismiss hides the banner", async () => {
    render(<HotkeyFailedBanner />);
    await waitFor(() => expect(handlers.length).toBeGreaterThan(0));
    handlers[0]!({ payload: "already bound" });
    fireEvent.click(await screen.findByRole("button", { name: /dismiss/i }));
    expect(screen.queryByText(/could not be registered/i)).toBeNull();
  });
});
```

- [ ] **Step 5: Implement RootLayout**

Create `packages/ui/src/layouts/RootLayout.tsx`:

```typescript
import { Outlet } from "react-router-dom";
import { GatewayOfflineBanner } from "../components/GatewayOfflineBanner";
import { HotkeyFailedBanner } from "../components/HotkeyFailedBanner";
import { useNimbusStore } from "../store";

export function RootLayout() {
  const connectionState = useNimbusStore((s) => s.connectionState);
  const offline = connectionState === "disconnected";
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      {offline && <GatewayOfflineBanner />}
      <HotkeyFailedBanner />
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <Outlet />
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run both test suites**

Run: `cd packages/ui && bunx vitest run test/layouts/RootLayout.test.tsx test/components/HotkeyFailedBanner.test.tsx`
Expected: 5 tests PASS (2 RootLayout + 3 HotkeyFailedBanner).

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/layouts packages/ui/src/components/HotkeyFailedBanner.tsx packages/ui/test/layouts packages/ui/test/components/HotkeyFailedBanner.test.tsx
git commit -m "feat(ui): RootLayout with offline banner + hotkey-failed toast"
```

---

## Task 10: GatewayConnectionProvider

**Files:**

- Create: `packages/ui/src/providers/GatewayConnectionProvider.tsx`
- Test: `packages/ui/test/providers/GatewayConnectionProvider.test.tsx`

- [ ] **Step 1: Write failing test**

Create `packages/ui/test/providers/GatewayConnectionProvider.test.tsx`:

```typescript
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler<T> = (payload: T) => void;
const connectionHandlers: Handler<string>[] = [];
const notificationHandlers: Handler<{ method: string; params: unknown }>[] = [];
const callMock = vi.fn<(method: string, params?: unknown) => Promise<unknown>>();

vi.mock("../../src/ipc/client", async () => {
  return {
    createIpcClient: () => ({
      call: callMock,
      subscribe: async (h: Handler<{ method: string; params: unknown }>) => {
        notificationHandlers.push(h);
        return () => {};
      },
      onConnectionState: async (h: Handler<string>) => {
        connectionHandlers.push(h);
        return () => {};
      },
    }),
  };
});

import { GatewayConnectionProvider } from "../../src/providers/GatewayConnectionProvider";
import { useNimbusStore } from "../../src/store";

describe("GatewayConnectionProvider", () => {
  beforeEach(() => {
    connectionHandlers.length = 0;
    notificationHandlers.length = 0;
    callMock.mockReset();
    useNimbusStore.setState({ connectionState: "initializing" });
  });

  it("mirrors connection state into the store", async () => {
    render(
      <MemoryRouter>
        <GatewayConnectionProvider>
          <div>child</div>
        </GatewayConnectionProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(connectionHandlers.length).toBeGreaterThan(0));
    connectionHandlers[0]?.("connected");

    await waitFor(() => expect(useNimbusStore.getState().connectionState).toBe("connected"));
  });

  it("routes to /onboarding/welcome on first connected when no data and no meta", async () => {
    callMock.mockImplementation(async (method) => {
      if (method === "diag.snapshot") return { indexTotalItems: 0, connectorCount: 0 };
      if (method === "db.getMeta") return null;
      throw new Error(`unexpected method ${method}`);
    });

    const { container } = render(
      <MemoryRouter initialEntries={["/"]}>
        <GatewayConnectionProvider>
          <div data-testid="target">{String(window.location.pathname)}</div>
        </GatewayConnectionProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(connectionHandlers.length).toBeGreaterThan(0));
    connectionHandlers[0]?.("connected");

    await waitFor(() =>
      expect(container.querySelector("[data-nav-target]")?.getAttribute("data-nav-target")).toBe(
        "/onboarding/welcome",
      ),
    );
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `cd packages/ui && bunx vitest run test/providers/GatewayConnectionProvider.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the provider**

Create `packages/ui/src/providers/GatewayConnectionProvider.tsx`:

```typescript
import { type PropsWithChildren, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { createIpcClient } from "../ipc/client";
import type { ConnectionState, DiagSnapshot } from "../ipc/types";
import { useNimbusStore } from "../store";

export function GatewayConnectionProvider({ children }: PropsWithChildren) {
  const navigate = useNavigate();
  const setConnectionState = useNimbusStore((s) => s.setConnectionState);
  const firstConnectHandled = useRef(false);

  useEffect(() => {
    const client = createIpcClient();
    let stopState: (() => void) | null = null;
    let stopNotif: (() => void) | null = null;

    const runFirstConnect = async () => {
      if (firstConnectHandled.current) return;
      // Retry a transient failure (e.g. SQLite lock during migration finish) before giving up.
      // Only latch `firstConnectHandled` once the routing decision has actually been made.
      const MAX_ATTEMPTS = 5;
      const BACKOFF_MS = [200, 500, 1000, 2000, 4000];
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {
          const snap = await client.call<DiagSnapshot>("diag.snapshot");
          const meta = await client.call<string | null>("db.getMeta", { key: "onboarding_completed" });
          const fresh = meta == null && snap.connectorCount === 0 && snap.indexTotalItems === 0;
          firstConnectHandled.current = true;
          navigate(fresh ? "/onboarding/welcome" : "/", { replace: true });
          return;
        } catch {
          if (attempt === MAX_ATTEMPTS - 1) return; // give up silently; next `connected` event retries
          await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
        }
      }
    };

    const init = async () => {
      stopState = await client.onConnectionState((state: ConnectionState) => {
        setConnectionState(state);
        if (state === "connected") void runFirstConnect();
      });
      stopNotif = await client.subscribe(() => {
        // Sub-projects B/C/D consume notifications; A only needs the subscription wired.
      });
    };

    void init();
    return () => {
      stopState?.();
      stopNotif?.();
    };
  }, [navigate, setConnectionState]);

  return <>{children}</>;
}
```

- [ ] **Step 4: Update the second test to pair with useNavigate**

The second test in Step 1 asserts a navigation target via a `[data-nav-target]` attribute that the real app does not render. Replace Step 1's second test body with the following to use a `MemoryRouter` observer:

Edit `packages/ui/test/providers/GatewayConnectionProvider.test.tsx` — replace the second `it(...)` block:

```typescript
  it("routes to /onboarding/welcome on first connected when no data and no meta", async () => {
    callMock.mockImplementation(async (method) => {
      if (method === "diag.snapshot") return { indexTotalItems: 0, connectorCount: 0 };
      if (method === "db.getMeta") return null;
      throw new Error(`unexpected method ${method}`);
    });

    const seen: string[] = [];
    function PathSpy() {
      const { useLocation } = await import("react-router-dom");
      const loc = useLocation();
      seen.push(loc.pathname);
      return null;
    }

    // Dynamic import inline isn't supported in sync components; use a plain child instead:
    // We read the path via the MemoryRouter's history by asserting on the rendered tree.
    // Simpler: render a consumer that prints the current pathname.
    const { rerender } = render(
      <MemoryRouter initialEntries={["/"]}>
        <GatewayConnectionProvider>
          <Consumer onPath={(p) => seen.push(p)} />
        </GatewayConnectionProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(connectionHandlers.length).toBeGreaterThan(0));
    connectionHandlers[0]?.("connected");

    await waitFor(() => expect(seen[seen.length - 1]).toBe("/onboarding/welcome"));
    rerender(<div />);
  });
});
```

Now add the `Consumer` helper at the top of the test file, below the mocks:

```typescript
import { useLocation } from "react-router-dom";

function Consumer({ onPath }: { onPath: (p: string) => void }) {
  const loc = useLocation();
  onPath(loc.pathname);
  return null;
}
```

- [ ] **Step 5: Run tests**

Run: `cd packages/ui && bunx vitest run test/providers/GatewayConnectionProvider.test.tsx`
Expected: 2 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/providers packages/ui/test/providers
git commit -m "feat(ui): add GatewayConnectionProvider with first-run routing"
```

---

## Task 11: App.tsx + main.tsx + router + feature stubs

**Files:**

- Create: `packages/ui/src/App.tsx`
- Modify: `packages/ui/src/main.tsx`
- Create: `packages/ui/src/pages/stubs/DashboardStub.tsx`
- Create: `packages/ui/src/pages/stubs/HitlStub.tsx`
- Create: `packages/ui/src/pages/stubs/SettingsStub.tsx`
- Create: `packages/ui/src/pages/stubs/MarketplaceStub.tsx`
- Create: `packages/ui/src/pages/stubs/WatchersStub.tsx`
- Create: `packages/ui/src/pages/stubs/WorkflowsStub.tsx`
- Delete: `packages/ui/src/shell.vitest.tsx`

- [ ] **Step 1: Create stub pages (one file each)**

Create `packages/ui/src/pages/stubs/DashboardStub.tsx`:

```typescript
export function DashboardStub() {
  return <section style={{ padding: 24 }}>Dashboard — coming in Sub-project B</section>;
}
```

Repeat with identical pattern for the others, changing the name:

- `HitlStub.tsx` → `HITL — coming in Sub-project B`
- `SettingsStub.tsx` → `Settings — coming in Sub-project D`
- `MarketplaceStub.tsx` → `Marketplace — coming in Sub-project C`
- `WatchersStub.tsx` → `Watchers — coming in Sub-project C`
- `WorkflowsStub.tsx` → `Workflows — coming in Sub-project C`

- [ ] **Step 2: Create `App.tsx`**

Create `packages/ui/src/App.tsx`:

```typescript
import { Navigate, Route, RouterProvider, createBrowserRouter, createRoutesFromElements } from "react-router-dom";
import { GatewayConnectionProvider } from "./providers/GatewayConnectionProvider";
import { RootLayout } from "./layouts/RootLayout";
import { DashboardStub } from "./pages/stubs/DashboardStub";
import { HitlStub } from "./pages/stubs/HitlStub";
import { SettingsStub } from "./pages/stubs/SettingsStub";
import { MarketplaceStub } from "./pages/stubs/MarketplaceStub";
import { WatchersStub } from "./pages/stubs/WatchersStub";
import { WorkflowsStub } from "./pages/stubs/WorkflowsStub";
import { QuickQuery } from "./pages/QuickQuery";
import { Onboarding } from "./pages/Onboarding";
import { Welcome } from "./pages/onboarding/Welcome";
import { Connect } from "./pages/onboarding/Connect";
import { Syncing } from "./pages/onboarding/Syncing";

function Wrapper({ children }: { children: React.ReactNode }) {
  return <GatewayConnectionProvider>{children}</GatewayConnectionProvider>;
}

const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<Wrapper><RootLayout /></Wrapper>}>
      <Route index element={<DashboardStub />} />
      <Route path="onboarding" element={<Onboarding />}>
        <Route index element={<Navigate to="welcome" replace />} />
        <Route path="welcome" element={<Welcome />} />
        <Route path="connect" element={<Connect />} />
        <Route path="syncing" element={<Syncing />} />
      </Route>
      <Route path="quick" element={<QuickQuery />} />
      <Route path="hitl" element={<HitlStub />} />
      <Route path="settings" element={<SettingsStub />} />
      <Route path="marketplace" element={<MarketplaceStub />} />
      <Route path="watchers" element={<WatchersStub />} />
      <Route path="workflows" element={<WorkflowsStub />} />
    </Route>,
  ),
);

export function App() {
  return <RouterProvider router={router} />;
}
```

- [ ] **Step 3: Rewrite `main.tsx`**

Replace `packages/ui/src/main.tsx`:

```typescript
import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 4: Remove obsolete placeholder test**

Run: `rm packages/ui/src/shell.vitest.tsx`
(If missing, skip — the earlier `Bash find` showed it exists.)

- [ ] **Step 5: Verify full Vitest suite still passes**

Run: `cd packages/ui && bunx vitest run`
Expected: All existing tests still PASS (Onboarding/QuickQuery imports referenced by `App.tsx` will resolve after the next tasks create them — **but those pages are not yet created**, so typecheck will fail here).

To avoid a broken mid-task state, skip the full-suite run and proceed directly to the next tasks which create the missing files. Run `bunx vitest run test/store test/components test/layouts test/providers test/ipc` instead to verify completed modules.

Run: `cd packages/ui && bunx vitest run test/store test/components test/layouts test/providers test/ipc`
Expected: All PASS.

- [ ] **Step 6: Commit (WIP — router references not-yet-created pages)**

```bash
git add packages/ui/src/App.tsx packages/ui/src/main.tsx packages/ui/src/pages/stubs
git rm packages/ui/src/shell.vitest.tsx
git commit -m "feat(ui): add App shell with router + feature stubs (pages to follow)"
```

Typecheck will fail at this point because `App.tsx` imports `QuickQuery`, `Onboarding`, `Welcome`, `Connect`, `Syncing` which don't exist yet. Task 12 and 13 resolve this.

---

## Task 12: Onboarding wizard frame + Welcome step

**Files:**

- Create: `packages/ui/src/pages/Onboarding.tsx`
- Create: `packages/ui/src/pages/onboarding/Welcome.tsx`
- Test: `packages/ui/test/pages/OnboardingWelcome.test.tsx`

- [ ] **Step 1: Write failing test**

Create `packages/ui/test/pages/OnboardingWelcome.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const callMock = vi.fn<(method: string, params?: unknown) => Promise<unknown>>();
vi.mock("../../src/ipc/client", () => ({
  createIpcClient: () => ({
    call: callMock,
    subscribe: async () => () => {},
    onConnectionState: async () => () => {},
  }),
}));

import { Onboarding } from "../../src/pages/Onboarding";
import { Welcome } from "../../src/pages/onboarding/Welcome";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/onboarding" element={<Onboarding />}>
          <Route path="welcome" element={<Welcome />} />
        </Route>
        <Route path="/" element={<div>dashboard</div>} />
        <Route path="/onboarding/connect" element={<div>connect</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Onboarding → Welcome", () => {
  beforeEach(() => callMock.mockReset());

  it("renders the welcome copy and continue button", () => {
    renderAt("/onboarding/welcome");
    expect(screen.getByText(/Welcome to Nimbus/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /continue/i })).toBeTruthy();
  });

  it("Skip writes onboarding_completed meta and navigates home", async () => {
    callMock.mockResolvedValueOnce(null); // db.setMeta
    renderAt("/onboarding/welcome");
    fireEvent.click(screen.getByRole("button", { name: /skip/i }));
    await waitFor(() =>
      expect(callMock).toHaveBeenCalledWith(
        "db.setMeta",
        expect.objectContaining({ key: "onboarding_completed" }),
      ),
    );
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `cd packages/ui && bunx vitest run test/pages/OnboardingWelcome.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `Onboarding.tsx` wizard frame**

Create `packages/ui/src/pages/Onboarding.tsx`:

```typescript
import { Outlet, useLocation } from "react-router-dom";

const STEPS = [
  { path: "welcome", label: "Welcome" },
  { path: "connect", label: "Connect" },
  { path: "syncing", label: "Syncing" },
] as const;

export function Onboarding() {
  const { pathname } = useLocation();
  const currentIdx = STEPS.findIndex((s) => pathname.endsWith(s.path));
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "48px 24px" }}>
      <div style={{ width: "100%", maxWidth: 840, background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
        <div style={{ display: "flex", gap: 6, padding: "18px 24px 4px" }}>
          {STEPS.map((s, i) => {
            const state = i < currentIdx ? "done" : i === currentIdx ? "active" : "pending";
            const bg =
              state === "active" ? "rgba(120, 144, 255, 0.25)" : state === "done" ? "rgba(82, 196, 26, 0.2)" : "rgba(255, 255, 255, 0.05)";
            const color = state === "pending" ? "var(--color-fg-muted)" : "var(--color-fg)";
            return (
              <div key={s.path} style={{ padding: "6px 12px", borderRadius: 999, background: bg, color, fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>
                {i + 1} · {s.label}
              </div>
            );
          })}
        </div>
        <div style={{ padding: "28px 32px", minHeight: 280 }}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement Welcome step**

Create `packages/ui/src/pages/onboarding/Welcome.tsx`:

```typescript
import { useNavigate } from "react-router-dom";
import { createIpcClient } from "../../ipc/client";

export function Welcome() {
  const navigate = useNavigate();

  const onSkip = async () => {
    await createIpcClient().call("db.setMeta", {
      key: "onboarding_completed",
      value: new Date().toISOString(),
    });
    navigate("/", { replace: true });
  };

  return (
    <div>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1.5, color: "var(--color-fg-muted)", marginBottom: 6 }}>Step 1</div>
      <h2 style={{ marginTop: 0 }}>Welcome to Nimbus</h2>
      <p>Nimbus indexes your work — code, docs, chats, tickets — on <strong>your machine</strong>. Nothing leaves unless you explicitly allow it.</p>
      <ul style={{ lineHeight: 1.8, color: "var(--color-fg)" }}>
        <li>Local-first — your index lives on this computer</li>
        <li>Every action is logged and auditable</li>
        <li>You approve every write before it happens (HITL)</li>
      </ul>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 32 }}>
        <button type="button" onClick={onSkip} style={btn("ghost")}>Skip setup</button>
        <button type="button" onClick={() => navigate("/onboarding/connect")} style={btn("primary")}>Continue →</button>
      </div>
    </div>
  );
}

function btn(variant: "primary" | "ghost"): React.CSSProperties {
  const base: React.CSSProperties = { padding: "8px 20px", borderRadius: "var(--radius-md)", fontSize: 13, cursor: "pointer" };
  if (variant === "primary") return { ...base, background: "var(--color-accent)", color: "white", border: "1px solid var(--color-accent)" };
  return { ...base, background: "transparent", color: "var(--color-fg-muted)", border: "1px solid transparent" };
}
```

- [ ] **Step 5: Run tests**

Run: `cd packages/ui && bunx vitest run test/pages/OnboardingWelcome.test.tsx`
Expected: 2 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/pages/Onboarding.tsx packages/ui/src/pages/onboarding/Welcome.tsx packages/ui/test/pages/OnboardingWelcome.test.tsx
git commit -m "feat(ui): onboarding wizard frame + Welcome step"
```

---

## Task 13: Onboarding — Connect step

**Files:**

- Create: `packages/ui/src/pages/onboarding/Connect.tsx`
- Test: `packages/ui/test/pages/OnboardingConnect.test.tsx`

- [ ] **Step 1: Write failing test**

Create `packages/ui/test/pages/OnboardingConnect.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const callMock = vi.fn<(method: string, params?: unknown) => Promise<unknown>>();
vi.mock("../../src/ipc/client", () => ({
  createIpcClient: () => ({
    call: callMock,
    subscribe: async () => () => {},
    onConnectionState: async () => () => {},
  }),
}));

import { Connect } from "../../src/pages/onboarding/Connect";
import { useNimbusStore } from "../../src/store";

function renderAt() {
  return render(
    <MemoryRouter initialEntries={["/onboarding/connect"]}>
      <Routes>
        <Route path="/onboarding/connect" element={<Connect />} />
        <Route path="/onboarding/syncing" element={<div>syncing</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Onboarding → Connect", () => {
  beforeEach(() => {
    callMock.mockReset();
    useNimbusStore.getState().resetOnboarding();
  });

  it("renders the 6 connector cards", () => {
    renderAt();
    for (const name of ["Google Drive", "GitHub", "Slack", "Linear", "Notion", "Gmail"]) {
      expect(screen.getByText(name)).toBeTruthy();
    }
  });

  it("clicking a card toggles its selection in the store", () => {
    renderAt();
    fireEvent.click(screen.getByText("GitHub"));
    expect(useNimbusStore.getState().selected.has("GitHub")).toBe(true);
    fireEvent.click(screen.getByText("GitHub"));
    expect(useNimbusStore.getState().selected.has("GitHub")).toBe(false);
  });

  it("Authenticate dispatches connector.startAuth for each selected", async () => {
    callMock.mockImplementation(async (method) => {
      if (method === "connector.startAuth") return null;
      if (method === "connector.list") return [{ name: "GitHub", state: "healthy" }];
      throw new Error(`unexpected ${method}`);
    });
    renderAt();
    fireEvent.click(screen.getByText("GitHub"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /authenticate/i }));
    });
    await waitFor(() =>
      expect(callMock).toHaveBeenCalledWith("connector.startAuth", { service: "GitHub" }),
    );
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `cd packages/ui && bunx vitest run test/pages/OnboardingConnect.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement Connect step**

Create `packages/ui/src/pages/onboarding/Connect.tsx`:

```typescript
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { createIpcClient } from "../../ipc/client";
import type { ConnectorSummary } from "../../ipc/types";
import { useNimbusStore } from "../../store";

const CONNECTORS = ["Google Drive", "GitHub", "Slack", "Linear", "Notion", "Gmail"] as const;
const CONNECTOR_DESCRIPTIONS: Record<(typeof CONNECTORS)[number], string> = {
  "Google Drive": "Docs, Sheets, Slides",
  GitHub: "Repos, PRs, issues",
  Slack: "Channels, DMs",
  Linear: "Issues, projects",
  Notion: "Pages, databases",
  Gmail: "Mail + labels",
};

export function Connect() {
  const navigate = useNavigate();
  const selected = useNimbusStore((s) => s.selected);
  const authStatus = useNimbusStore((s) => s.authStatus);
  const toggleSelected = useNimbusStore((s) => s.toggleSelected);
  const setAuthStatus = useNimbusStore((s) => s.setAuthStatus);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const onAuth = async () => {
    const client = createIpcClient();
    const services = [...selected];
    for (const name of services) setAuthStatus(name, "authenticating");
    for (const name of services) {
      try {
        await client.call("connector.startAuth", { service: name });
      } catch {
        setAuthStatus(name, "failed");
      }
    }
    pollRef.current = setInterval(async () => {
      try {
        const list = await client.call<ConnectorSummary[]>("connector.list");
        let anyConnected = false;
        for (const name of services) {
          const summary = list.find((c) => c.name === name);
          if (summary && summary.state !== "unauthenticated") {
            setAuthStatus(name, "connected");
            anyConnected = true;
          }
        }
        if (anyConnected) {
          if (pollRef.current) clearInterval(pollRef.current);
          navigate("/onboarding/syncing");
        }
      } catch {
        // transient; keep polling
      }
    }, 2000);
  };

  const selectedCount = selected.size;

  return (
    <div>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1.5, color: "var(--color-fg-muted)", marginBottom: 6 }}>Step 2</div>
      <h2 style={{ marginTop: 0 }}>Connect your first service</h2>
      <p style={{ color: "var(--color-fg-muted)" }}>Pick one or more. You can add others from Settings.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 18 }}>
        {CONNECTORS.map((name) => {
          const isSelected = selected.has(name);
          const status = authStatus[name];
          return (
            <button
              type="button"
              key={name}
              onClick={() => toggleSelected(name)}
              style={{
                textAlign: "left",
                padding: 14,
                border: `1px solid ${isSelected ? "var(--color-accent)" : "var(--color-border)"}`,
                borderRadius: "var(--radius-md)",
                background: isSelected ? "rgba(120, 144, 255, 0.12)" : "transparent",
                color: "var(--color-fg)",
                cursor: "pointer",
              }}
            >
              <div style={{ fontSize: 13, marginBottom: 4 }}>{isSelected ? "✓ " : ""}{name}</div>
              <div style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>{CONNECTOR_DESCRIPTIONS[name]}</div>
              {status && (
                <div style={{ fontSize: 11, marginTop: 6, color: status === "connected" ? "var(--color-ok)" : status === "failed" || status === "cancelled" ? "var(--color-error)" : "var(--color-amber)" }}>
                  {status === "authenticating" ? "Authenticating…" : status === "connected" ? "Connected" : status === "failed" ? "Failed — retry" : status === "cancelled" ? "Cancelled — retry" : "Pending"}
                </div>
              )}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 32 }}>
        <button type="button" onClick={() => navigate("/onboarding/welcome")} style={{ padding: "8px 20px", borderRadius: "var(--radius-md)", background: "transparent", color: "var(--color-fg)", border: "1px solid var(--color-border)", cursor: "pointer" }}>← Back</button>
        <button type="button" onClick={onAuth} disabled={selectedCount === 0} style={{ padding: "8px 20px", borderRadius: "var(--radius-md)", background: selectedCount === 0 ? "var(--color-surface)" : "var(--color-accent)", color: selectedCount === 0 ? "var(--color-fg-muted)" : "white", border: "1px solid var(--color-accent)", cursor: selectedCount === 0 ? "not-allowed" : "pointer" }}>Authenticate ({selectedCount}) →</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/ui && bunx vitest run test/pages/OnboardingConnect.test.tsx`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/pages/onboarding/Connect.tsx packages/ui/test/pages/OnboardingConnect.test.tsx
git commit -m "feat(ui): onboarding Connect step with OAuth dispatch and polling"
```

---

## Task 14: Onboarding — Syncing step

**Files:**

- Create: `packages/ui/src/pages/onboarding/Syncing.tsx`
- Test: `packages/ui/test/pages/OnboardingSyncing.test.tsx`

- [ ] **Step 1: Write failing test**

Create `packages/ui/test/pages/OnboardingSyncing.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const callMock = vi.fn<(method: string, params?: unknown) => Promise<unknown>>();
vi.mock("../../src/ipc/client", () => ({
  createIpcClient: () => ({
    call: callMock,
    subscribe: async () => () => {},
    onConnectionState: async () => () => {},
  }),
}));

import { Syncing } from "../../src/pages/onboarding/Syncing";

function renderAt() {
  return render(
    <MemoryRouter initialEntries={["/onboarding/syncing"]}>
      <Routes>
        <Route path="/onboarding/syncing" element={<Syncing />} />
        <Route path="/" element={<div>dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Onboarding → Syncing", () => {
  beforeEach(() => callMock.mockReset());

  it("polls diag.snapshot and renders counters", async () => {
    callMock.mockImplementation(async (method) => {
      if (method === "diag.snapshot") return { indexTotalItems: 42, connectorCount: 1 };
      if (method === "db.setMeta") return null;
      throw new Error(`unexpected ${method}`);
    });
    renderAt();
    await waitFor(() => expect(screen.getByText(/42/)).toBeTruthy());
  });

  it("Open Dashboard writes onboarding_completed and navigates", async () => {
    callMock.mockImplementation(async (method) => {
      if (method === "diag.snapshot") return { indexTotalItems: 0, connectorCount: 0 };
      if (method === "db.setMeta") return null;
      throw new Error(`unexpected ${method}`);
    });
    renderAt();
    fireEvent.click(await screen.findByRole("button", { name: /open dashboard/i }));
    await waitFor(() =>
      expect(callMock).toHaveBeenCalledWith(
        "db.setMeta",
        expect.objectContaining({ key: "onboarding_completed" }),
      ),
    );
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `cd packages/ui && bunx vitest run test/pages/OnboardingSyncing.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement Syncing step**

Create `packages/ui/src/pages/onboarding/Syncing.tsx`:

```typescript
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createIpcClient } from "../../ipc/client";
import type { DiagSnapshot } from "../../ipc/types";

export function Syncing() {
  const navigate = useNavigate();
  const [snap, setSnap] = useState<DiagSnapshot | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number>(Date.now());
  const autoCompleted = useRef(false);

  useEffect(() => {
    const client = createIpcClient();
    const tick = async () => {
      try {
        const s = await client.call<DiagSnapshot>("diag.snapshot");
        setSnap(s);
        setLastUpdate(Date.now());
      } catch {
        /* leave counters stale until reconnect */
      }
    };
    void tick();
    const iv = setInterval(tick, 5000);

    const autoComplete = async () => {
      if (autoCompleted.current) return;
      autoCompleted.current = true;
      try {
        await client.call("db.setMeta", { key: "onboarding_completed", value: new Date().toISOString() });
      } catch { /* swallow */ }
    };

    const onVis = () => { if (document.visibilityState === "hidden") void autoComplete(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
      void autoComplete();
    };
  }, []);

  const onOpenDashboard = async () => {
    autoCompleted.current = true;
    await createIpcClient().call("db.setMeta", {
      key: "onboarding_completed",
      value: new Date().toISOString(),
    });
    navigate("/", { replace: true });
  };

  const ageSeconds = Math.floor((Date.now() - lastUpdate) / 1000);

  return (
    <div>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1.5, color: "var(--color-fg-muted)", marginBottom: 6 }}>Step 3</div>
      <h2 style={{ marginTop: 0 }}>You're set up</h2>
      <p style={{ color: "var(--color-fg-muted)" }}>Nimbus is indexing your data. You can close this window — it'll keep syncing in the background.</p>
      <div style={{ marginTop: 22, padding: "16px 20px", border: "1px solid var(--color-ok)", borderRadius: "var(--radius-md)", background: "rgba(82, 196, 26, 0.08)" }}>
        <div style={{ display: "flex", gap: 24, fontSize: 13 }}>
          <span><strong>{snap?.indexTotalItems ?? 0}</strong> items indexed</span>
          <span><strong>{snap?.connectorCount ?? 0}</strong> connectors syncing</span>
          <span>Updated <strong>{ageSeconds}s ago</strong></span>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 32 }}>
        <button type="button" onClick={onOpenDashboard} style={{ padding: "8px 20px", borderRadius: "var(--radius-md)", background: "var(--color-accent)", color: "white", border: "1px solid var(--color-accent)", cursor: "pointer" }}>Open Dashboard →</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/ui && bunx vitest run test/pages/OnboardingSyncing.test.tsx`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/pages/onboarding/Syncing.tsx packages/ui/test/pages/OnboardingSyncing.test.tsx
git commit -m "feat(ui): onboarding Syncing step with diag polling + auto-complete"
```

---

## Task 15: QuickQuery page

**Files:**

- Create: `packages/ui/src/pages/QuickQuery.tsx`
- Test: `packages/ui/test/pages/QuickQuery.test.tsx`

- [ ] **Step 1: Write failing test**

Create `packages/ui/test/pages/QuickQuery.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const callMock = vi.fn<(method: string, params?: unknown) => Promise<unknown>>();
type NotifHandler = (n: { method: string; params: unknown }) => void;
const notifHandlers: NotifHandler[] = [];

vi.mock("../../src/ipc/client", () => ({
  createIpcClient: () => ({
    call: callMock,
    subscribe: async (h: NotifHandler) => {
      notifHandlers.push(h);
      return () => {};
    },
    onConnectionState: async () => () => {},
  }),
}));

const closeMock = vi.fn();
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ close: closeMock }),
}));

import { QuickQuery } from "../../src/pages/QuickQuery";

describe("QuickQuery", () => {
  beforeEach(() => {
    callMock.mockReset();
    notifHandlers.length = 0;
    closeMock.mockReset();
    vi.useFakeTimers();
  });

  it("submits a prompt and renders streamed tokens", async () => {
    callMock.mockResolvedValueOnce({ streamId: "s1" });
    render(<MemoryRouter><QuickQuery /></MemoryRouter>);
    const input = screen.getByPlaceholderText(/ask nimbus/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "summarize my week" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(notifHandlers.length).toBeGreaterThan(0));
    act(() => notifHandlers[0]!({ method: "engine.streamToken", params: { streamId: "s1", text: "Hello" } }));
    act(() => notifHandlers[0]!({ method: "engine.streamToken", params: { streamId: "s1", text: ", world" } }));
    expect(screen.getByText(/Hello, world/)).toBeTruthy();
  });

  it("closes the window 2s after streamDone", async () => {
    callMock.mockResolvedValueOnce({ streamId: "s2" });
    render(<MemoryRouter><QuickQuery /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText(/ask nimbus/i), { target: { value: "hi" } });
    fireEvent.submit(screen.getByPlaceholderText(/ask nimbus/i).closest("form")!);

    await waitFor(() => expect(notifHandlers.length).toBeGreaterThan(0));
    act(() => notifHandlers[0]!({ method: "engine.streamDone", params: { streamId: "s2", model: "local · llama-3.1-8b" } }));
    act(() => { vi.advanceTimersByTime(2100); });
    await waitFor(() => expect(closeMock).toHaveBeenCalled());
  });

  it("closes immediately on Escape", () => {
    render(<MemoryRouter><QuickQuery /></MemoryRouter>);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(closeMock).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `cd packages/ui && bunx vitest run test/pages/QuickQuery.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement QuickQuery**

Create `packages/ui/src/pages/QuickQuery.tsx`:

```typescript
import { type FormEvent, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createIpcClient } from "../ipc/client";
import { useNimbusStore } from "../store";

interface StreamTokenParams { streamId: string; text: string; meta?: { modelUsed?: string; isLocal?: boolean } }
interface StreamDoneParams { streamId: string; model?: string; meta?: { modelUsed?: string; isLocal?: boolean } }

export function QuickQuery() {
  const [prompt, setPrompt] = useState("");
  const streamId = useNimbusStore((s) => s.streamId);
  const tokens = useNimbusStore((s) => s.tokens);
  const modelLabel = useNimbusStore((s) => s.modelLabel);
  const doneAt = useNimbusStore((s) => s.doneAt);
  const startStream = useNimbusStore((s) => s.startStream);
  const appendToken = useNimbusStore((s) => s.appendToken);
  const markDone = useNimbusStore((s) => s.markDone);

  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void getCurrentWindow().close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!doneAt) return;
    const t = setTimeout(() => { void getCurrentWindow().close(); }, 2000);
    return () => clearTimeout(t);
  }, [doneAt]);

  useEffect(() => () => { unsubRef.current?.(); }, []);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    const client = createIpcClient();
    const res = await client.call<{ streamId: string }>("engine.askStream", { input: prompt });
    startStream(res.streamId);
    unsubRef.current?.();
    unsubRef.current = await client.subscribe((n) => {
      if (n.method === "engine.streamToken") {
        const p = n.params as StreamTokenParams;
        if (p.streamId === res.streamId) appendToken(res.streamId, p.text);
      } else if (n.method === "engine.streamDone") {
        const p = n.params as StreamDoneParams;
        if (p.streamId === res.streamId) {
          const label = p.model ?? (p.meta?.isLocal ? `local · ${p.meta.modelUsed ?? "unknown"}` : p.meta?.modelUsed ?? "remote");
          markDone(res.streamId, label);
        }
      }
    });
  };

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--color-surface)" }}>
      <form onSubmit={onSubmit} style={{ borderBottom: "1px solid var(--color-border)" }}>
        <input
          autoFocus
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ask Nimbus…"
          style={{ width: "100%", padding: "16px 18px", background: "transparent", border: "none", outline: "none", color: "var(--color-fg)", fontSize: 15, boxSizing: "border-box" }}
        />
      </form>
      <div style={{ flex: 1, padding: "14px 18px", fontSize: 13, lineHeight: 1.55, color: "var(--color-fg)", opacity: 0.9 }}>
        {tokens.length > 0 ? tokens.join("") : <span style={{ opacity: 0.4 }}>Streaming response appears here…</span>}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 14px", fontSize: 11, borderTop: "1px solid var(--color-border)", opacity: 0.55, fontFamily: "monospace" }}>
        <span>⏎ submit · Esc close{streamId ? ` · ${streamId}` : ""}</span>
        <span>{modelLabel ?? "local"}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/ui && bunx vitest run test/pages/QuickQuery.test.tsx`
Expected: 3 tests PASS.

- [ ] **Step 5: Full Vitest sweep**

Run: `cd packages/ui && bunx vitest run`
Expected: All tests PASS; no type errors.

- [ ] **Step 6: Typecheck the whole UI package**

Run: `cd packages/ui && bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/pages/QuickQuery.tsx packages/ui/test/pages/QuickQuery.test.tsx
git commit -m "feat(ui): quick-query popup with streaming + Escape + 2s auto-close"
```

---

## Task 16: Rust — `tray.rs` icon + menu + state forwarder

**Files:**

- Create: `packages/ui/src-tauri/src/tray.rs`
- Create placeholder icons: `packages/ui/src-tauri/icons/tray-{normal,amber,red,template}.png`
- Modify: `packages/ui/src-tauri/src/lib.rs`
- Modify: `packages/ui/src-tauri/tauri.conf.json`

- [ ] **Step 1: Add placeholder icons**

Placeholder icons are required for `cargo build` to succeed. Copy the existing app icon to all four tray slots:

Run (repo root):

```bash
cp packages/ui/src-tauri/icons/32x32.png packages/ui/src-tauri/icons/tray-normal.png
cp packages/ui/src-tauri/icons/32x32.png packages/ui/src-tauri/icons/tray-amber.png
cp packages/ui/src-tauri/icons/32x32.png packages/ui/src-tauri/icons/tray-red.png
cp packages/ui/src-tauri/icons/32x32.png packages/ui/src-tauri/icons/tray-template.png
```

Final iconography is cosmetic polish — distinct variants will be produced in Sub-project D. For Sub-project A we verify the mechanism works.

- [ ] **Step 2: Create `tray.rs`**

Create `packages/ui/src-tauri/src/tray.rs`:

```rust
use serde::Deserialize;
use tauri::image::Image;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Listener, Manager};

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
enum TrayIconState {
    Normal,
    Amber,
    Red,
}

#[derive(Deserialize)]
struct TrayStateChange {
    icon: TrayIconState,
    #[serde(default)]
    badge: u32,
}

fn icon_bytes(state: TrayIconState) -> &'static [u8] {
    match state {
        TrayIconState::Normal => include_bytes!("../icons/tray-normal.png"),
        TrayIconState::Amber => include_bytes!("../icons/tray-amber.png"),
        TrayIconState::Red => include_bytes!("../icons/tray-red.png"),
    }
}

pub fn init_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItemBuilder::with_id("open-dashboard", "Open Dashboard").build(app)?;
    let quick = MenuItemBuilder::with_id("quick-query", "Quick Query\tCtrl+Shift+N").build(app)?;
    let settings = MenuItemBuilder::with_id("settings", "Settings").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&open, &quick, &settings, &quit])
        .build()?;

    #[cfg(target_os = "macos")]
    let icon_is_template = true;
    #[cfg(not(target_os = "macos"))]
    let icon_is_template = false;

    let tray = TrayIconBuilder::with_id("nimbus-tray")
        .icon(Image::from_bytes(if icon_is_template {
            include_bytes!("../icons/tray-template.png")
        } else {
            icon_bytes(TrayIconState::Normal)
        })?)
        .icon_as_template(icon_is_template)
        .menu(&menu)
        .on_menu_event(|app_handle, event| match event.id().as_ref() {
            "open-dashboard" => focus_main(app_handle),
            "quick-query" => { let _ = crate::quick_query::spawn_or_focus(app_handle); },
            "settings" => {
                focus_main(app_handle);
                let _ = app_handle.emit("tray://navigate", "/settings");
            }
            "quit" => app_handle.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|_icon, _event: TrayIconEvent| {})
        .build(app)?;

    // Forward `tray://state-changed` events into icon + tooltip updates.
    let tray_for_listener = tray.clone();
    app.listen("tray://state-changed", move |event| {
        let Ok(change) = serde_json::from_str::<TrayStateChange>(event.payload()) else { return };
        let bytes = icon_bytes(change.icon);
        let _ = tray_for_listener.set_icon(Some(Image::from_bytes(bytes).unwrap()));
        let tooltip = if change.badge > 0 {
            format!("Nimbus ({} pending)", change.badge)
        } else {
            "Nimbus".to_string()
        };
        let _ = tray_for_listener.set_tooltip(Some(tooltip));
    });

    Ok(())
}

fn focus_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}
```

- [ ] **Step 3: Enable `tray-icon` feature in `Cargo.toml`**

Edit `packages/ui/src-tauri/Cargo.toml`:

```toml
tauri = { version = "2.10.3", features = ["tray-icon", "image-png"] }
```

- [ ] **Step 4: Register the tray module in `lib.rs`**

Update `packages/ui/src-tauri/src/lib.rs` to add the module + init call:

```rust
mod gateway_bridge;
mod quick_query;
mod tray;

use gateway_bridge::{connect_and_run, BridgeState};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(BridgeState::new())
        .invoke_handler(tauri::generate_handler![
            gateway_bridge::rpc_call,
            gateway_bridge::shell_start_gateway,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            tray::init_tray(app.handle())?;
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let handle = app.handle().clone();
            let state = handle.state::<BridgeState>();
            let bridge_for_task = BridgeState {
                writer: state.writer.clone(),
                pending: state.pending.clone(),
                next_id: state.next_id.clone(),
            };
            tauri::async_runtime::spawn(async move {
                connect_and_run(handle, bridge_for_task).await;
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

`quick_query` is referenced but not yet created — Task 17 creates it. Move Step 5 after Task 17 if you want a strict green-build per-task. Otherwise accept a transient non-building state between Task 16 and Task 17.

- [ ] **Step 5: Build will fail until quick_query exists — proceed to Task 17**

Run: `cd packages/ui/src-tauri && cargo build` — expect FAIL with `unresolved module quick_query` — this is intentional. Task 17 resolves it.

- [ ] **Step 6: Commit (WIP, unbuildable state — normal mid-task for Rust mods)**

```bash
git add packages/ui/src-tauri/icons/tray-*.png packages/ui/src-tauri/src/tray.rs packages/ui/src-tauri/src/lib.rs packages/ui/src-tauri/Cargo.toml
git commit -m "feat(ui): add system tray module with icon state + menu (quick_query pending)"
```

---

## Task 17: Rust — quick-query window + global hotkey

**Files:**

- Create: `packages/ui/src-tauri/src/quick_query.rs`
- Modify: `packages/ui/src-tauri/src/lib.rs`
- Modify: `packages/ui/src-tauri/tauri.conf.json`

- [ ] **Step 1: Create `quick_query.rs`**

Create `packages/ui/src-tauri/src/quick_query.rs`:

```rust
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub fn spawn_or_focus(app: &AppHandle) -> tauri::Result<()> {
    if let Some(existing) = app.get_webview_window("quick-query") {
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }
    let window = WebviewWindowBuilder::new(app, "quick-query", WebviewUrl::App("index.html#/quick".into()))
        .inner_size(560.0, 220.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .center()
        .focused(true)
        .build()?;

    let handle_for_event = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Focused(false)) {
            let hnd = handle_for_event.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                if let Some(win) = hnd.get_webview_window("quick-query") {
                    let _ = win.close();
                }
            });
        }
    });
    Ok(())
}
```

- [ ] **Step 2: Wire global shortcut registration in `lib.rs::setup`**

Edit the `setup` closure in `packages/ui/src-tauri/src/lib.rs` to register the hotkey after `tray::init_tray`:

```rust
            tray::init_tray(app.handle())?;

            // Register Ctrl+Shift+N (Cmd+Shift+N on macOS) to spawn quick-query.
            use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
            let handle_for_shortcut = app.handle().clone();
            let modifier = if cfg!(target_os = "macos") {
                Modifiers::SUPER | Modifiers::SHIFT
            } else {
                Modifiers::CONTROL | Modifiers::SHIFT
            };
            let shortcut = Shortcut::new(Some(modifier), Code::KeyN);
            if let Err(err) = app
                .global_shortcut()
                .on_shortcut(shortcut, move |_app, _sh, event| {
                    if event.state == ShortcutState::Pressed {
                        let _ = crate::quick_query::spawn_or_focus(&handle_for_shortcut);
                    }
                })
            {
                log::warn!("quick-query hotkey registration failed: {err}");
                let _ = app.handle().emit("tray://hotkey-failed", err.to_string());
            }
```

Add the `Emitter` import at the top of the file if not already present (`use tauri::Emitter;`).

- [ ] **Step 3: Build**

Run: `cd packages/ui/src-tauri && cargo build`
Expected: Builds cleanly.

- [ ] **Step 4: Run cargo tests to confirm nothing regressed**

Run: `cd packages/ui/src-tauri && cargo test`
Expected: 3 tests PASS (allowlist tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src-tauri/src/quick_query.rs packages/ui/src-tauri/src/lib.rs
git commit -m "feat(ui): add quick-query window spawn + global hotkey registration"
```

---

## Task 18: macOS accessory mode + tauri.conf.json adjustments

**Files:**

- Modify: `packages/ui/src-tauri/tauri.conf.json`

- [ ] **Step 1: Update `tauri.conf.json`**

Replace `packages/ui/src-tauri/tauri.conf.json`:

```json
{
  "$schema": "../node_modules/@tauri-apps/cli/config.schema.json",
  "productName": "Nimbus",
  "version": "0.1.0",
  "identifier": "dev.nimbus.desktop",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:1420",
    "beforeDevCommand": "bunx vite",
    "beforeBuildCommand": "bunx vite build"
  },
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "Nimbus",
        "width": 1200,
        "height": 800,
        "minWidth": 1024,
        "minHeight": 640,
        "resizable": true,
        "fullscreen": false,
        "hiddenTitle": true,
        "titleBarStyle": "Transparent"
      }
    ],
    "security": {
      "csp": null
    },
    "macOSPrivateApi": false
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "macOS": {
      "dockIcon": false,
      "exceptionDomain": null,
      "frameworks": [],
      "license": "",
      "minimumSystemVersion": "13.0",
      "signingIdentity": null
    }
  }
}
```

Note: Tauri 2.x's macOS bundle schema does not yet accept `LSUIElement` inline; on macOS the Rust-side `set_activation_policy(ActivationPolicy::Accessory)` (already added in Task 16's `lib.rs`) is sufficient for the no-Dock behaviour. A post-bundle step in Sub-project D will add `LSUIElement` to the final `Info.plist` if required.

- [ ] **Step 2: Build**

Run: `cd packages/ui/src-tauri && cargo build`
Expected: Builds cleanly.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src-tauri/tauri.conf.json
git commit -m "chore(ui): main window sizing, transparent title bar, macOS accessory config"
```

---

## Task 19: UI coverage gate in CI

**Files:**

- Modify: `.github/workflows/_test-suite.yml`
- Modify: `packages/ui/package.json` (add `test:coverage` if missing)

- [ ] **Step 1: Add a `test:coverage` script**

The existing `package.json` has `"test:coverage": "bunx vitest run --coverage"` — confirm it's present. If not, add:

```json
"scripts": {
  "test:coverage": "bunx vitest run --coverage --coverage.thresholds.lines=80 --coverage.thresholds.branches=75"
}
```

If already present, update to include thresholds:

```json
"test:coverage": "bunx vitest run --coverage --coverage.thresholds.lines=80 --coverage.thresholds.branches=75"
```

- [ ] **Step 2: Inspect existing workflow file**

Run: `sed -n '1,80p' /c/gitrepo/Nimbus/.github/workflows/_test-suite.yml`
Expected: See existing coverage-gate jobs to match the pattern.

- [ ] **Step 3: Add a new job step for UI coverage**

Edit `.github/workflows/_test-suite.yml`. Under the existing coverage section, add:

```yaml
      - name: UI unit coverage (WS5 Sub-project A)
        working-directory: packages/ui
        run: bunx vitest run --coverage --coverage.thresholds.lines=80 --coverage.thresholds.branches=75
```

Place it adjacent to other `test:coverage:*` steps so it runs in the same job.

- [ ] **Step 4: Run locally to verify thresholds**

Run: `cd packages/ui && bunx vitest run --coverage`
Expected: Coverage report prints; ≥80 % lines / ≥75 % branches on `src/{ipc,providers,store,pages,components,layouts}/**`.

If below threshold, add targeted tests for the uncovered branches before proceeding. Common gaps: error paths in `ipc/client.ts`, `visibilitychange` effect in `Syncing.tsx`.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/_test-suite.yml packages/ui/package.json
git commit -m "ci(ui): enforce WS5-A coverage gate (80% lines / 75% branches)"
```

---

## Task 20: Manual smoke checklist document

**Files:**

- Create: `docs/manual-smoke-ws5a.md`

- [ ] **Step 1: Create the checklist**

Create `docs/manual-smoke-ws5a.md`:

```markdown
# WS5 Sub-project A — Manual Smoke Checklist

Run this on **each of Windows, macOS, and Linux** before signing off on Sub-project A.

## Prerequisites

- [ ] `nimbus` CLI installed and on `PATH` (`nimbus --version` succeeds)
- [ ] `bun install` succeeds from repo root
- [ ] `cd packages/ui && bunx vite build` succeeds
- [ ] `cd packages/ui/src-tauri && cargo build --release` succeeds

## App launch — Gateway running

1. Start the Gateway: `nimbus start`
2. Launch the UI: `cd packages/ui && bunx tauri dev`

- [ ] Main window appears with Nimbus title + transparent title bar
- [ ] Tray icon appears (system tray on Windows/Linux, menu bar on macOS)
- [ ] macOS only: no Dock icon appears; app is not in Cmd+Tab switcher
- [ ] macOS only: tray icon adapts to dark mode and light mode when system theme is switched

## App launch — Gateway NOT running

1. Stop the Gateway: `nimbus stop`
2. Launch the UI fresh

- [ ] Amber "Gateway is not running." banner appears within 2 s
- [ ] Click **Start Gateway**: banner dismisses, panels re-fetch within a few seconds
- [ ] `ps` shows the Gateway process running

## First-run onboarding

1. Reset meta before launch: in a fresh test profile, ensure `onboarding_completed` is absent
2. Launch with Gateway running and zero indexed items

- [ ] App routes to `/onboarding/welcome`
- [ ] Step 1 shows "Welcome to Nimbus" copy and Skip / Continue buttons
- [ ] Click Skip → `onboarding_completed` is written; app lands on Dashboard stub
- [ ] Reset meta again and relaunch
- [ ] Continue → Step 2: 6 connector cards appear
- [ ] Click a card → card highlights; click again → deselects
- [ ] Click Authenticate (1) → system browser opens OAuth flow for that service
- [ ] Complete OAuth → card shows "Connected"; app navigates to Step 3
- [ ] Step 3: "items indexed" counter polls and increments over time
- [ ] Click Open Dashboard → `onboarding_completed` written; Dashboard stub shown
- [ ] Close app mid-step-3 → next launch goes to Dashboard (auto-complete on unmount)

## Tray menu

- [ ] **Open Dashboard** focuses (or shows) the main window
- [ ] **Quick Query (Ctrl+Shift+N)** spawns the quick-query window
- [ ] **Settings** focuses main window (Settings stub visible in content)
- [ ] **Quit** closes the app completely

## Tray icon state

Simulate by running:

```bash
nimbus config set telemetry.endpoint http://invalid.example  # forces a connector into unhealthy
```

- [ ] Within 2 s tray icon transitions `normal` → `amber` (or `red` depending on state)
- [ ] When state returns to healthy, icon returns to `normal`

## Global hotkey — quick-query

- [ ] Press `Ctrl+Shift+N` (or `Cmd+Shift+N` on macOS): popup spawns in 560 × 220 window
- [ ] Popup is centered, has no decorations, has transparent background
- [ ] Input is autofocused
- [ ] Type a prompt + press Enter: tokens stream into the popup body
- [ ] ~2 s after stream finishes: popup auto-closes
- [ ] Reopen popup, press `Escape`: popup closes immediately
- [ ] Reopen popup, click outside: popup closes after ~150 ms

## Method allowlist (security)

Open DevTools in the main window (`Right-click → Inspect`), run in console:

```javascript
await window.__TAURI__.core.invoke("rpc_call", { method: "vault.get", params: { key: "foo" } })
```

- [ ] Rejects with `ERR_METHOD_NOT_ALLOWED:vault.get`
- [ ] No network/socket activity recorded (Gateway log confirms)

## Platform-specific

### Windows
- [ ] Tray icon appears with correct colour in both light and dark Windows 11 themes
- [ ] Hotkey registers without UAC prompt

### macOS
- [ ] No Dock icon; menu bar icon adapts to light/dark mode
- [ ] Quick-query popup appears as a Mission-Control-safe overlay
- [ ] App is not listed in Cmd+Tab application switcher

### Linux (GNOME / KDE)
- [ ] Tray icon appears via AppIndicator (may require `gnome-shell-extension-appindicator`)
- [ ] Hotkey works under both X11 and Wayland (may require XWayland)
- [ ] `notify-send` present: degraded-state log shows toast; missing: skipped silently
```

- [ ] **Step 2: Commit**

```bash
git add docs/manual-smoke-ws5a.md
git commit -m "docs(ws5a): add manual smoke checklist"
```

---

## Task 21: Docs — update CLAUDE.md, GEMINI.md, roadmap.md

**Files:**

- Modify: `CLAUDE.md`
- Modify: `GEMINI.md`
- Modify: `docs/roadmap.md`

- [ ] **Step 1: Add WS5-A entries to `CLAUDE.md` key file locations**

In the `Key File Locations` table, under the Phase 4 WS4 rows, add:

```markdown
| `packages/ui/src/ipc/client.ts` | Tauri frontend IPC client — `NimbusIpcClient`; typed wrapper over `rpc_call` |
| `packages/ui/src/ipc/types.ts` | Shared IPC types for UI — `ConnectionState`, `DiagSnapshot`, `MethodNotAllowedError` |
| `packages/ui/src/providers/GatewayConnectionProvider.tsx` | Connection state + first-run routing; wraps the whole app |
| `packages/ui/src/store/index.ts` | Zustand store — connection, tray, quickQuery, onboarding slices |
| `packages/ui/src/pages/Onboarding.tsx` | First-run wizard frame (Welcome → Connect → Syncing) |
| `packages/ui/src/pages/QuickQuery.tsx` | Quick-query popup page (streams via `engine.askStream`) |
| `packages/ui/src-tauri/src/gateway_bridge.rs` | Rust IPC bridge — `ALLOWED_METHODS` compile-time allowlist; only Tauri→Gateway path |
| `packages/ui/src-tauri/src/tray.rs` | System tray — icon state machine + menu (no dynamic submenus in A) |
| `packages/ui/src-tauri/src/quick_query.rs` | Quick-query `WebviewWindow` spawn/focus/close |
```

Update the Status line:

```markdown
**Status:** Phase 3.5 — Observability & DX ✅ Complete; **Phase 4** — Presence 🔵 Active (WS1/WS2/WS3/WS4 ✅; WS5-A in progress)
```

- [ ] **Step 2: Mirror the same changes in `GEMINI.md`**

Apply identical edits to `GEMINI.md` to keep the two files in sync (required per `CLAUDE.md` non-negotiable guidance).

- [ ] **Step 3: Update `docs/roadmap.md`**

Inspect the existing Phase 4 entries:

Run: `sed -n '1,60p' /c/gitrepo/Nimbus/docs/roadmap.md`

Find the Phase 4 section. Add a new row under WS4 completion:

```markdown
### Phase 4 Workstream 5 — Tauri Desktop UI (decomposed)

Workstream 5 is too large for a single spec. It's executed as four sub-projects:

| Sub-project | Scope | Status |
|---|---|---|
| **A — App Shell Foundation** | IPC bridge + `ALLOWED_METHODS`, system tray + quick-query, first-run onboarding, Tauri/React/Tailwind/Radix/Zustand scaffold | 🔵 In progress |
| **B — Dashboard & HITL** | Dashboard panels, HITL consent dialog, OS-level HITL notifications | ⬜ Blocked by A |
| **C — Automation Panels** | Marketplace, Watchers, Workflows pages | ⬜ Blocked by A |
| **D — Settings & Polish** | Settings panel, theming, keyboard shortcuts, a11y, WS5 acceptance closeout. **Deferred items from A:** (1) installer PATH wiring so `shell_start_gateway` works when the UI is launched from Launchpad / a `.desktop` file (not just from a shell); (2) customizable quick-query hotkey and auto-close delay; (3) final polished tray icon variants. | ⬜ Blocked by A; C recommended |

#### WS5 Sub-project A acceptance (must pass on Windows, macOS, Linux)
- [ ] Shipped `packages/ui` app launches with `bunx tauri dev`
- [ ] Tray icon appears and transitions state on connector health changes (within 2 s)
- [ ] Global hotkey spawns quick-query popup; streams tokens; auto-closes 2 s after `streamDone`
- [ ] First-run onboarding routes correctly and writes `onboarding_completed` on finish / skip / auto-complete
- [ ] Gateway-offline banner appears within 2 s of Gateway shutdown; dismisses on reconnect
- [ ] `rpc_call` with a method outside `ALLOWED_METHODS` rejects with `ERR_METHOD_NOT_ALLOWED` (Rust + frontend test)
- [ ] macOS: no Dock icon; tray icon adapts to light/dark mode
- [ ] Vitest coverage ≥ 80 % lines / 75 % branches on `packages/ui/src/{ipc,providers,store,pages,components,layouts}/**`
- [ ] Rust `cargo test` passes in `packages/ui/src-tauri/`
- [ ] `bun run typecheck` and `bun run lint` clean
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md GEMINI.md docs/roadmap.md
git commit -m "docs(ws5a): document WS5 sub-project decomposition + Sub-project A acceptance"
```

---

## Task 22: Final verification + end-to-end build

**Files:** none (verification only).

- [ ] **Step 1: Full UI typecheck**

Run: `cd packages/ui && bunx tsc --noEmit`
Expected: PASS — no errors.

- [ ] **Step 2: Full Vitest suite + coverage**

Run: `cd packages/ui && bunx vitest run --coverage`
Expected: All tests PASS; coverage meets thresholds.

- [ ] **Step 3: Rust tests**

Run: `cd packages/ui/src-tauri && cargo test`
Expected: 3 tests PASS.

- [ ] **Step 4: Rust fmt + clippy**

Run: `cd packages/ui/src-tauri && cargo fmt -- --check && cargo clippy -- -D warnings`
Expected: No formatting or clippy issues.

If clippy fires, fix the warning and commit. Do **not** suppress warnings.

- [ ] **Step 5: Frontend lint (Biome)**

Run: `cd packages/ui && bunx biome check src/ test/`
Expected: No violations.

- [ ] **Step 6: Full repo lint**

Run (repo root): `bun run lint`
Expected: PASS.

- [ ] **Step 7: Tauri dev launch (local smoke)**

Run (repo root, one terminal): `nimbus start`
Run (second terminal): `cd packages/ui && bunx tauri dev`

Verify the first few entries in `docs/manual-smoke-ws5a.md` work:
- App launches
- Tray icon appears
- Pressing `Ctrl+Shift+N` / `Cmd+Shift+N` spawns quick-query popup

- [ ] **Step 8: Commit any fmt/clippy fixes, then final merge-ready commit**

If any fixes were needed:

```bash
git add -A
git commit -m "chore(ws5a): final fmt/clippy/lint cleanup"
```

- [ ] **Step 9: Push the branch and open PR**

```bash
git push -u origin HEAD
gh pr create --title "feat(ui): WS5 Sub-project A — App Shell Foundation" --body "$(cat <<'EOF'
## Summary
- Establishes Tauri 2.0 desktop shell for Nimbus
- Adds Rust bridge with compile-time ALLOWED_METHODS allowlist
- System tray + global-hotkey quick-query popup
- First-run onboarding wizard (3 steps)
- React Router v7 + Zustand + Tailwind v4 + Radix scaffold
- Feature pages are stubs — Sub-projects B/C/D replace them

## Spec
docs/superpowers/specs/2026-04-19-ws5a-app-shell-foundation-design.md

## Plan
docs/superpowers/plans/2026-04-19-ws5a-app-shell-foundation.md

## Test plan
- [ ] Run manual smoke checklist: docs/manual-smoke-ws5a.md
- [ ] `bun run typecheck` passes
- [ ] `bun run lint` passes
- [ ] `cd packages/ui && bunx vitest run --coverage` ≥ 80% lines / 75% branches
- [ ] `cd packages/ui/src-tauri && cargo test` passes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Verify the PR opens without errors; confirm CI matrix triggers (Ubuntu pr-quality + full 3-platform on push to main after review).

---

## Self-review checklist (performed by plan author)

- **Spec §1 (context + outline):** covered by Task 21 (roadmap) and plan intro
- **Spec §2 (decisions):** enforced by plan structure (React Router v7 in Task 11, Zustand slices in Task 7, Tailwind in Task 1, single-main+child-window in Tasks 17–18)
- **Spec §3 (architecture):** implemented across Tasks 3–11
- **Spec §4.1.1 (ALLOWED_METHODS + rpc_call):** Task 4 + Task 5
- **Spec §4.1.1 (shell_start_gateway):** Task 6
- **Spec §4.1.2 (tray.rs):** Task 16
- **Spec §4.1.3 (quick_query.rs):** Task 17
- **Spec §4.2.1 (ipc/client.ts):** Task 3
- **Spec §4.2.2 (ipc/types.ts):** Task 2
- **Spec §4.2.3 (GatewayConnectionProvider):** Task 10
- **Spec §4.2.4 (GatewayOfflineBanner):** Task 8
- **Spec §4.2.5 (Skeleton):** Task 8
- **Spec §4.2.6 (Zustand store + slices):** Task 7
- **Spec §4.2.7 (routing + stubs):** Task 11
- **Spec §4.2.8 (Onboarding three steps + edge cases):** Tasks 12 + 13 + 14 (auto-complete on unmount covered in Task 14)
- **Spec §4.2.9 (QuickQuery):** Task 15
- **Spec §4.3 (Tailwind + Radix):** Task 1
- **Spec §5 (data flow):** matches implementation in Tasks 5, 10, 11, 13, 15
- **Spec §6 (error handling):** handled inline in implementation tasks; `parseError` in Task 3, bridge reconnect in Task 5
- **Spec §7.1–§7.2 (tests):** every UI file has matching test file; cargo tests in Task 4
- **Spec §7.3 (manual smoke):** Task 20
- **Spec §7.4 (coverage gate):** Task 19
- **Spec §8 (file manifest):** all files accounted for across Tasks 1–21; `Onboarding.tsx` wrapper + `Welcome/Connect/Syncing` match (Tasks 12–14)
- **Spec §9 (acceptance criteria):** every item maps to a task + verification step
- **Spec §10 (out of scope):** respected — no dashboard/HITL/marketplace/watchers/workflows/settings content shipped; theming deferred to D

**Type consistency check:**
- `createIpcClient()` signature identical across all usages (client.ts + every test)
- `useNimbusStore` slices composed additively — matches `NimbusStore` type
- `ConnectorSummary.state` uses the same string-literal union in types.ts, Connect.tsx, and tests
- Rust `BridgeState` fields referenced by name in both `gateway_bridge.rs` and the `lib.rs` task-side clone in Task 5

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-19-ws5a-app-shell-foundation.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
