# WS5 Sub-project A — App Shell Foundation (Design)

**Phase:** 4 — Presence
**Workstream:** 5 — Tauri Desktop UI
**Sub-project:** A (foundation)
**Status:** Design approved · ready for implementation plan
**Date:** 2026-04-19

---

## 1. Context

Phase 4 Workstream 5 delivers the Tauri desktop application. It is too large for a single spec (10 sub-sections covering an entire desktop UI), so it is decomposed into four sub-projects executed in order. This document specifies **Sub-project A — App Shell Foundation**, the first in that sequence. Sub-projects B, C, and D are specified separately and consume the shell built here.

Sub-project A ships a launchable Tauri app with a tray icon, an onboarding flow, a working IPC bridge, and a quick-query popup. It does **not** ship feature pages (Dashboard, HITL, Marketplace, Watchers, Workflows, Settings) — those routes exist as one-line stubs so the router works.

### 1.1 WS5 sub-project outline

The full decomposition, for reference by B/C/D:

| Sub-project | Scope | Blocked by |
|---|---|---|
| **A — App Shell Foundation** (this doc) | 5.1 IPC client + Rust bridge + `ALLOWED_METHODS`; 5.2 System tray + quick-query popup; 5.9 First-run onboarding; Tauri/React/Tailwind/Radix/Zustand scaffold; routing | — |
| **B — Dashboard & HITL** | 5.3 Dashboard panels; 5.4 HITL consent dialog; 5.10 OS-level HITL notifications (Gateway PAL work) | A |
| **C — Automation Panels** | 5.5 Extension Marketplace; 5.6 Watcher management UI; 5.7 Workflow pipeline editor | A |
| **D — Settings & Polish** | 5.8 Settings panel (10 sections); theming; keyboard shortcuts; accessibility pass; WS5 acceptance closeout | A (C recommended) |

**Hard boundaries:**

| Sub-project | Owns | Does NOT touch |
|---|---|---|
| A | `packages/ui/src/ipc/`, `src-tauri/src/gateway_bridge.rs`, shell, tray, routing, `Onboarding.tsx`, `QuickQuery.tsx` | Any feature page beyond placeholder stubs |
| B | `Dashboard.tsx`, `HitlDialog.tsx`, `platform/notifications.ts` | Marketplace / Watchers / Workflows / Settings |
| C | `Marketplace.tsx`, `Watchers.tsx`, `Workflows.tsx` | Settings, theming, HITL |
| D | `Settings.tsx`, theming tokens, shortcut table, a11y audit | New feature pages |

Each sub-project extends `ALLOWED_METHODS` and the Zustand store schema additively. Earlier sub-projects' entries must not be renamed or removed.

### 1.2 Goals

- Scaffolding ready for all follow-on WS5 work: routing, state, styling, Rust bridge, security allowlist.
- First-run experience that gets a user from zero to connected to indexed data.
- One non-trivial interaction surface proven (quick-query streaming via hotkey) so Sub-project B isn't the first consumer of the bridge.

### 1.3 Non-goals

- No feature pages (Dashboard, HITL dialog, Marketplace, Watchers, Workflows, Settings UI).
- No dynamic tray submenus, no customizable hotkey, no animated tray icon — deferred to B / D.
- No mobile/tablet breakpoints; target is 16:9 laptop/desktop from 1366×768 through 4K.

---

## 2. Architectural decisions

| Decision | Choice | Rationale |
|---|---|---|
| Tauri window strategy | **Single main window + on-demand child windows** | Quick-query is an isolated transient `WebviewWindow`; main window persists for Dashboard. Matches spec ("floating mini-window… closes on Escape or focus loss") and macOS menu-bar mode. |
| Routing | **React Router v7 (data router)** | Nested routes scale through Sub-projects B/C/D without migration; Settings in D will need sub-routes. |
| State management | **Single Zustand store with slices** | One source of truth, clear per-slice ownership, easy devtools. Each sub-project adds its slice. |
| Styling | **Tailwind CSS v4 + Radix UI primitives** | Matches `docs/phase-4-plan.md` §5.1. Tokens expressed as CSS custom properties for the Sub-project D theming panel. |
| Quick-query entry point | Both windows load the same `index.html`; child window navigates to `/quick` via URL hash on spawn | One Vite build, one router; bundle-size difference negligible for a local app. |
| Viewport target | 16:9 laptop/desktop (1366×768 min) through 4K (3840×2160) | Per user direction. Tauri logical-pixel DPI scaling handles 4K automatically. No mobile breakpoints. |

---

## 3. Architecture

Three layers. The Rust bridge is the only security boundary.

```
┌─────────────────────────────────────────────────────────────────┐
│ Frontend — React 19 (Webview, no raw socket)                    │
│                                                                  │
│   App.tsx ── React Router v7 ── <RootLayout> ── <Outlet>         │
│                                                                  │
│   GatewayConnectionProvider (context)                            │
│   useNimbusStore (Zustand slices)                                │
│   ipc/client.ts ── invoke('rpc_call') + 'gateway://' events      │
└─────────────────────────────────────────────────────────────────┘
                           │ Tauri invoke — only channel
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ Rust Bridge — packages/ui/src-tauri/ (security boundary)        │
│                                                                  │
│   gateway_bridge.rs   rpc_call / subscribe_notifications         │
│                       compile-time ALLOWED_METHODS               │
│   tray.rs             icon state machine + menu + hotkey         │
│   quick_query.rs      child WebviewWindow spawn/lifecycle        │
│   lib.rs              activation policy + plugin wiring          │
│                                                                  │
│   Socket client — named pipe (Win) / Unix socket (mac/Linux)     │
└─────────────────────────────────────────────────────────────────┘
                           │ JSON-RPC 2.0
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ Gateway — existing, unchanged                                   │
│   packages/gateway/src/ipc/server.ts                             │
└─────────────────────────────────────────────────────────────────┘
```

**Two webview windows share one bridge:**
1. **Main window** — persistent, 1200×800 default, loads `/` (route selects Onboarding or Dashboard stub).
2. **Quick-query window** — spawned on tray hotkey, 560×220 logical px, closes on `Escape` or focus loss (150 ms debounce), auto-closes 2 s after `streamDone`.

Both load `index.html` and use the same router. Both call `invoke('rpc_call', …)`; there is only one socket connection, owned by the bridge.

---

## 4. Component specification

### 4.1 Rust bridge

#### 4.1.1 `packages/ui/src-tauri/src/gateway_bridge.rs` (new)

Exposes exactly two Tauri commands:

```rust
#[tauri::command]
async fn rpc_call(method: String, params: serde_json::Value) -> Result<serde_json::Value, BridgeError>;

#[tauri::command]
async fn subscribe_notifications(window: tauri::Window) -> Result<(), BridgeError>;
```

**`ALLOWED_METHODS` allowlist** — compile-time `&'static [&'static str]`, expanded additively per sub-project. Sub-project A set:

```rust
pub const ALLOWED_METHODS: &[&str] = &[
    "diag.snapshot",          // onboarding + connection health probe
    "connector.list",         // onboarding + tray state derivation
    "connector.startAuth",    // onboarding OAuth launch
    "engine.askStream",       // quick-query streaming
    "db.getMeta",             // onboarding_completed check
    "db.setMeta",             // onboarding_completed write
];
```

Invariants:

- Any method not in `ALLOWED_METHODS` → reject with JSON-RPC error `{ code: -32601, message: "ERR_METHOD_NOT_ALLOWED" }` **before** touching the socket.
- `vault.*` and raw `db.*` writes (outside the two whitelisted meta keys) are permanently excluded.
- Adding a method requires editing `ALLOWED_METHODS` — reviewable in git diff.

**Socket connection:** one persistent connection owned by the bridge. Reconnect on `ECONNRESET` with exponential backoff (200 ms → 2 s → 10 s, capped). Emits `gateway://connection-state` Tauri events: `"connecting"` | `"connected"` | `"disconnected"`.

**Notification forwarding:** reads JSON-RPC notifications from the socket and re-emits them as Tauri events named `gateway://notification` with the full payload. The frontend subscribes once via `subscribe_notifications`.

**Shell scope:** registers a narrow `shell-execute` permission that allows invoking the `nimbus` binary only (no arbitrary shell). Used by the offline-banner "Start Gateway" action via an additional Tauri command defined in the bridge:

```rust
#[tauri::command]
async fn shell_start_gateway() -> Result<(), BridgeError>;
```

The command shells out to `nimbus start` via Tauri's scoped shell plugin. It does not wait for the Gateway to come up — the bridge's existing reconnect loop handles that. Any error (binary not found, non-zero exit) is surfaced as a toast.

#### 4.1.2 `packages/ui/src-tauri/src/tray.rs` (new)

Built with `tauri::tray::TrayIconBuilder` in Tauri 2.0.

**Icon assets** (under `packages/ui/src-tauri/icons/`):

- `tray-normal.png`, `tray-amber.png`, `tray-red.png` — full-colour 16/32/64 for Windows and Linux.
- `tray-template.png` — black/white template image for macOS so the menu-bar icon adapts to light/dark mode automatically.

**Icon state machine** — driven by notifications:

| State | Trigger |
|---|---|
| `normal` | all connectors `healthy` |
| `amber` | at least one connector `degraded` or `rate_limited` |
| `red` | at least one connector `error` or `unauthenticated` |
| badge `N` | `N` pending HITL actions (from `agent.hitlBatch` notification running count) |

The bridge subscribes to `connector.healthChanged` and `agent.hitlBatch` notifications, computes aggregate state, and emits a new Tauri event `tray://state-changed { icon, badge }`. The tray listener updates icon + badge.

**Menu structure** (Sub-project A — no dynamic submenu yet):

```
Nimbus  [icon]
──────────────
Open Dashboard
Quick Query     Ctrl+Shift+N
──────────────
Settings
──────────────
Quit
```

"Connectors ▸" submenu deferred to Sub-project B.

**Hotkey registration** via `tauri-plugin-global-shortcut`:

```rust
Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyN)  // Win/Linux
Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyN)    // macOS
```

Registration failure (OS-level conflict) logs a warning and emits `tray://hotkey-failed`. Does not block startup. The Sub-project D Settings panel will surface this via a toast.

**macOS menu-bar mode:**

- `lib.rs` — `app.set_activation_policy(ActivationPolicy::Accessory)` on `RunEvent::Ready`.
- `tauri.conf.json` — `LSUIElement = true` in `macOS.plist` inline config.
- Main window — `.hidden_title(true)` + `.title_bar_style(TitleBarStyle::Transparent)`.

Result: no Dock icon, no Cmd+Tab entry, app lives in menu bar only.

#### 4.1.3 `packages/ui/src-tauri/src/quick_query.rs` (new)

**Spawn** (idempotent — focus instead of recreating if open):

```rust
WebviewWindowBuilder::new(app, "quick-query", WebviewUrl::App("index.html#/quick".into()))
    .inner_size(560.0, 220.0)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .center()
    .focused(true)
    .build()?;
```

**Lifecycle:**

- If a `quick-query` window exists → `.set_focus()` rather than rebuilding.
- On `WindowEvent::Focused(false)` → `.close()` with a 150 ms debounce (tolerates DevTools focus churn).
- Frontend `Escape` keydown → `getCurrentWindow().close()`.
- Frontend auto-close: 2 s after `engine.streamDone` event.

### 4.2 Frontend — TypeScript / React

#### 4.2.1 `packages/ui/src/ipc/client.ts` (new)

```typescript
export interface NimbusIpcClient {
  call<TResult>(method: string, params?: unknown): Promise<TResult>;
  subscribe(handler: (notif: JsonRpcNotification) => void): () => void;
  onConnectionState(handler: (state: ConnectionState) => void): () => void;
}

export function createIpcClient(): NimbusIpcClient; // singleton
```

Wraps `@tauri-apps/api/core` `invoke` for `rpc_call` and `@tauri-apps/api/event` `listen` for `gateway://` events. Rejects with typed errors: `MethodNotAllowedError`, `GatewayOfflineError`, `JsonRpcError`. No `any` anywhere.

#### 4.2.2 `packages/ui/src/ipc/types.ts` (new)

Minimal typed surface for Sub-project A:

```typescript
export type ConnectionState = "connecting" | "connected" | "disconnected";
export interface DiagSnapshot { indexTotalItems: number; connectorCount: number; /* additive per sub-project */ }
export interface ConnectorSummary {
  name: string;
  state: "healthy" | "degraded" | "error" | "rate_limited" | "unauthenticated" | "paused";
}
export interface JsonRpcNotification { method: string; params: unknown; }
```

Sub-projects B/C/D extend this file additively.

#### 4.2.3 `packages/ui/src/providers/GatewayConnectionProvider.tsx` (new)

React context wrapping the entire app. State machine:

```
initializing → connecting → connected
                  ↓              ↓
              disconnected ← (any state)
```

**Responsibilities:**

1. On mount: register `client.onConnectionState(...)` and `client.subscribe(...)` handlers.
2. On first `connected`: call `diag.snapshot` + `db.getMeta("onboarding_completed")`. Route decision:
   - `connectorCount === 0 && indexTotalItems === 0 && onboardingCompleted == null` → `/onboarding/welcome`
   - otherwise → `/`
3. On `disconnected`: flip `useNimbusStore(s => s.connection.state)` → panels render skeleton; offline banner appears.
4. On reconnect: dismiss banner; panels re-fetch.

The 2-second detection target (spec requirement): the Rust bridge emits `disconnected` within 2 s of socket close; the provider updates store synchronously on receipt.

#### 4.2.4 `packages/ui/src/components/GatewayOfflineBanner.tsx` (new)

Amber dismissible bar at the top of the main window.

- Copy: `"Gateway is not running."`
- Action: `[Start Gateway]` button → `invoke("shell_start_gateway")` (Tauri command wrapping `shell.execute("nimbus start")` via the narrow permission scope).
- Auto-dismisses on reconnect.

#### 4.2.5 `packages/ui/src/components/Skeleton.tsx` (new)

Radix-styled static placeholder primitive. Never a spinner. Used by panels that depend on gateway data while `connection.state !== "connected"`.

#### 4.2.6 `packages/ui/src/store/index.ts` + slices (new)

Single `useNimbusStore` composed of Sub-project A slices:

```typescript
interface NimbusStore {
  connection: ConnectionSlice;  // state, lastConnectedAt, reconnectAttempts
  tray:       TraySlice;        // connectorHealth aggregate, hitlBadgeCount
  quickQuery: QuickQuerySlice;  // isOpen, currentStreamId, tokens[]
  onboarding: OnboardingSlice;  // selected, authStatus, actions
}
```

Each slice in its own file under `store/slices/`. Sub-projects B/C/D add slices additively.

```typescript
interface OnboardingSlice {
  selected: Set<string>;
  authStatus: Record<string, AuthStatus>;
  toggle(name: string): void;
  startAuth(name: string): Promise<void>;
  markComplete(): Promise<void>; // writes onboarding_completed meta
}
```

#### 4.2.7 Routing — `packages/ui/src/App.tsx` (rewritten) + `main.tsx` update

```typescript
const router = createBrowserRouter([
  {
    element: <GatewayConnectionProvider><RootLayout /></GatewayConnectionProvider>,
    children: [
      { path: "/", element: <DashboardStub /> },
      {
        path: "/onboarding",
        element: <Onboarding />,  // shared wizard frame (pills + footer) + <Outlet />
        children: [
          { index: true, element: <Navigate to="welcome" replace /> },
          { path: "welcome", element: <Welcome /> },
          { path: "connect", element: <Connect /> },
          { path: "syncing", element: <Syncing /> },
        ],
      },
      { path: "/quick",     element: <QuickQuery /> },
      { path: "/hitl",      element: <HitlStub /> },
      { path: "/settings",  element: <SettingsStub /> },
      { path: "/marketplace", element: <MarketplaceStub /> },
      { path: "/watchers",  element: <WatchersStub /> },
      { path: "/workflows", element: <WorkflowsStub /> },
    ],
  },
]);
```

`Onboarding.tsx` renders the persistent chrome (step pills, frame, title) and a `<Outlet />`. The three step components render only their step-specific body content, keeping the visual shell DRY.

`RootLayout.tsx` renders `<GatewayOfflineBanner />` + `<Outlet />`. No sidebar or header in A — those arrive with Sub-project B's Dashboard.

Stubs are ~3-line components rendering `"<PageName> — coming in Sub-project B/C/D"`. They exist so routes don't 404 while we build incrementally.

#### 4.2.8 `packages/ui/src/pages/Onboarding.tsx` (new)

Three-step wizard driven by sub-routes (`/onboarding/welcome`, `/onboarding/connect`, `/onboarding/syncing`).

**Step 1 — Welcome:**

- Static copy: "Nimbus indexes your work — code, docs, chats, tickets — on your machine. Nothing leaves unless you explicitly allow it."
- Three bullets: local-first index, auditable actions, HITL on every write.
- "Skip setup" → writes `onboarding_completed = new Date().toISOString()` via `db.setMeta`, navigates to `/`.
- "Continue →" → `/onboarding/connect`.

**Step 2 — Connect:**

- Hardcoded 6 cards: Google Drive, GitHub, Slack, Linear, Notion, Gmail. (Full list lives in Settings D.)
- Click toggles in `useNimbusStore(s => s.onboarding.selected)`.
- "Authenticate (N) →": iterates selected, calls `connector.startAuth({ service })` for each. Gateway handles OAuth in system browser. Frontend polls `connector.list` every 2 s.
- Per-card inline UI status (derived from `ConnectorSummary.state` + local dispatch state):
  - `unauthenticated` + no auth dispatched yet → `"Pending"`
  - auth dispatched, still `unauthenticated` → `"Authenticating…"` (spinner, but never a full-panel spinner)
  - state flips to `healthy` / `degraded` / `rate_limited` → `"Connected"`
  - state stays `unauthenticated` for >60 s after dispatch, or the user cancels in the OS browser → `"Cancelled — retry"`
  - unexpected IPC error → `"Failed — retry"`
- Advance to step 3 when at least one connector transitions out of `unauthenticated` (i.e. OAuth completed and the Gateway has accepted the token). If all transitions timeout or fail, show a generic error + retry.

**Step 3 — Syncing:**

- Polls `diag.snapshot` every 5 s.
- Renders live counters: items indexed, connectors syncing, last-update age.
- "Open Dashboard →": calls `db.setMeta("onboarding_completed", ISO)`, navigates to `/`.
- Cleanup effect on `visibilitychange` (hidden) and unmount writes `onboarding_completed` — auto-complete if the user closes the window mid-sync.

**Edge cases:**

| Case | Behavior |
|---|---|
| Window close mid-auth | Selected set persisted to session storage; next launch resumes at `/onboarding/connect` |
| Gateway dies | Offline banner + skeletons; resumes on reconnect |
| OAuth cancel in browser | Card shows `"Cancelled — retry"` |
| Deleted all connectors before launch | `onboarding_completed` exists → Dashboard empty state, not onboarding |

#### 4.2.9 `packages/ui/src/pages/QuickQuery.tsx` (new)

- Single `<input autoFocus>` bound to `useNimbusStore(s => s.quickQuery)`.
- `onSubmit`: call `engine.askStream({ prompt })` → `{ streamId }`. Subscribe to `engine.streamToken` notifications filtered by `streamId`, append tokens to `quickQuery.tokens[]`.
- Render streaming text below input. Footer shows model metadata from `engine.streamDone` (`local · <model>`).
- Auto-close 2 s after `engine.streamDone` or on `Escape`.
- Fully keyboard-operable; no pointer interaction required.

### 4.3 Styling

- **Tailwind CSS v4** via `@tailwindcss/vite` plugin.
- Single `src/index.css`: `@import "tailwindcss";` + CSS custom properties for theme tokens (color, spacing, radius). Sub-project D theming panel flips these.
- **Radix primitives**: `@radix-ui/react-dialog`, `@radix-ui/react-slot`, `@radix-ui/react-tooltip`. Additional primitives added per sub-project as needed.
- No Tailwind mobile/tablet breakpoints. Base = 16:9 laptop (`lg:` unused in A).

---

## 5. Data flow

### 5.1 App launch

```
Tauri starts
  → bridge connects to Gateway socket (backoff retry if needed)
  → emits gateway://connection-state "connecting" → "connected"
  → GatewayConnectionProvider receives "connected"
  → calls diag.snapshot + db.getMeta("onboarding_completed")
  → routes to /onboarding/welcome or /
  → tray registered; hotkey registered; main window shown
```

### 5.2 Quick-query

```
User presses Ctrl+Shift+N
  → tray.rs receives global shortcut event
  → quick_query::spawn_or_focus(app)
  → WebviewWindow loads index.html#/quick
  → QuickQuery.tsx mounts; input autofocused
  → user types prompt, hits Enter
  → client.call("engine.askStream", { prompt }) → { streamId }
  → client.subscribe filters engine.streamToken for streamId
  → tokens appended to store
  → engine.streamDone → store records model metadata, footer updates
  → 2 s timer → getCurrentWindow().close()
```

### 5.3 Gateway offline

```
Socket close (user kills Gateway)
  → bridge detects within 2 s
  → emits gateway://connection-state "disconnected"
  → GatewayConnectionProvider sets store.connection.state = "disconnected"
  → GatewayOfflineBanner renders
  → panels render <Skeleton />
User clicks [Start Gateway]
  → invoke("shell_start_gateway") → shell.execute("nimbus start")
  → Gateway socket comes up
  → bridge reconnects with backoff
  → emits "connected"
  → banner dismisses, panels re-fetch
```

### 5.4 Onboarding

```
First launch, no existing data
  → GatewayConnectionProvider routes to /onboarding/welcome
  → User clicks "Continue" → /onboarding/connect
  → User picks connectors, clicks "Authenticate (N)"
  → for each selected: client.call("connector.startAuth", { service })
  → Gateway opens system browser for OAuth
  → polling connector.list every 2s updates card statuses
  → at least one "healthy" → navigate /onboarding/syncing
  → poll diag.snapshot every 5s, update counters
  → "Open Dashboard" → db.setMeta("onboarding_completed", ISO) → /
```

---

## 6. Error handling

| Source | Error | Handling |
|---|---|---|
| IPC | Method not in `ALLOWED_METHODS` | `MethodNotAllowedError` — surface as dev-console warning; user-visible message only if invocation was user-triggered |
| IPC | Socket disconnected mid-call | `GatewayOfflineError` — offline banner; in-flight call rejected; caller falls back to skeleton state |
| IPC | JSON-RPC error response | `JsonRpcError` with `code` + `message` — surface inline on calling component |
| Tray | Hotkey registration conflict | Warning logged; `tray://hotkey-failed` emitted; startup continues |
| Tray | Icon asset missing | Fallback to Tauri default app icon; log error |
| Quick-query | Stream error notification | Replace stream text with error string; keep window open for user to retry |
| Onboarding | `connector.startAuth` fails | Card shows `"Failed — retry"`; keeps other connectors' flows unaffected |
| Onboarding | All connectors fail in step 2 | Generic error banner + retry button |
| Gateway offline | `[Start Gateway]` fails | Toast error: `"Couldn't launch Gateway. Check installation."` |

---

## 7. Testing strategy

All tests run via `cd packages/ui && bunx vitest run` (frontend) + `cargo test --manifest-path packages/ui/src-tauri/Cargo.toml` (Rust).

### 7.1 Frontend unit (Vitest + Testing Library)

| File | Covers |
|---|---|
| `test/ipc/client.test.ts` | `call()` serialisation; notification dispatch; typed error shapes; `ERR_METHOD_NOT_ALLOWED` surfacing |
| `test/providers/GatewayConnectionProvider.test.tsx` | `connecting → connected → disconnected → connected` transitions; offline banner within 2 s simulated; onboarding routing decision |
| `test/store/onboarding.test.ts` | Selection toggle; `startAuth` dispatch; `markComplete` meta write |
| `test/pages/Onboarding.test.tsx` | Render step 1 on zero state; advance through 3 steps; skip path; auto-complete on unmount |
| `test/pages/QuickQuery.test.tsx` | Submit → stream → auto-close 2 s after `streamDone`; Escape closes immediately |
| `test/layouts/RootLayout.test.tsx` | Banner renders only when disconnected |

### 7.2 Rust unit

| File | Covers |
|---|---|
| `src-tauri/src/gateway_bridge.rs` (`#[cfg(test)] mod tests`) | `rpc_call` with non-allowlisted method returns `ERR_METHOD_NOT_ALLOWED` **without** hitting the socket; allowlisted method forwards correctly against a mock socket |

### 7.3 Manual smoke (per platform)

Pre-`v0.1.0` manual checklist captured in `docs/manual-smoke-ws5a.md`:

- Tray icon appears; clicking menu items fires correct actions
- Tray icon state transitions (normal → amber → red) on synthetic connector state change
- Hotkey spawns quick-query popup; `Escape` closes; focus-loss closes
- macOS: no Dock icon, tray adapts to light/dark mode, window has transparent title bar
- Windows: tray icon visible; SmartScreen behavior unchanged
- Linux: tray icon visible under GNOME and KDE (AppIndicator)

### 7.4 Coverage gate

New step in `.github/workflows/_test-suite.yml`:

```yaml
- name: UI unit coverage (WS5 Sub-project A)
  run: cd packages/ui && bunx vitest run --coverage --coverage.thresholds.lines=80 --coverage.thresholds.branches=75
```

Covers `packages/ui/src/{ipc,providers,store,pages,components,layouts}/**`. Rust bridge covered separately by `cargo test`.

---

## 8. File manifest

**New — TypeScript/React:**

```
packages/ui/src/ipc/client.ts
packages/ui/src/ipc/types.ts
packages/ui/src/providers/GatewayConnectionProvider.tsx
packages/ui/src/components/GatewayOfflineBanner.tsx
packages/ui/src/components/Skeleton.tsx
packages/ui/src/store/index.ts
packages/ui/src/store/slices/connection.ts
packages/ui/src/store/slices/tray.ts
packages/ui/src/store/slices/quickQuery.ts
packages/ui/src/store/slices/onboarding.ts
packages/ui/src/layouts/RootLayout.tsx
packages/ui/src/pages/Onboarding.tsx            -- wraps the three step components
packages/ui/src/pages/onboarding/Welcome.tsx
packages/ui/src/pages/onboarding/Connect.tsx
packages/ui/src/pages/onboarding/Syncing.tsx
packages/ui/src/pages/QuickQuery.tsx
packages/ui/src/pages/stubs/DashboardStub.tsx
packages/ui/src/pages/stubs/HitlStub.tsx
packages/ui/src/pages/stubs/SettingsStub.tsx
packages/ui/src/pages/stubs/MarketplaceStub.tsx
packages/ui/src/pages/stubs/WatchersStub.tsx
packages/ui/src/pages/stubs/WorkflowsStub.tsx
packages/ui/src/index.css
packages/ui/tailwind.config.ts
```

**New — Rust:**

```
packages/ui/src-tauri/src/gateway_bridge.rs
packages/ui/src-tauri/src/tray.rs
packages/ui/src-tauri/src/quick_query.rs
packages/ui/src-tauri/icons/tray-normal.png
packages/ui/src-tauri/icons/tray-amber.png
packages/ui/src-tauri/icons/tray-red.png
packages/ui/src-tauri/icons/tray-template.png
```

**New — test files:** as listed in §7.1–§7.2.

**New — docs:**

```
docs/manual-smoke-ws5a.md
```

**Modified:**

```
packages/ui/src/main.tsx                    (router bootstrap)
packages/ui/src/App.tsx                     (provider + router composition)
packages/ui/src-tauri/src/lib.rs            (module wiring + activation policy)
packages/ui/src-tauri/tauri.conf.json       (LSUIElement, shell-execute scope, tray config)
packages/ui/src-tauri/Cargo.toml            (tauri-plugin-global-shortcut)
packages/ui/package.json                    (react-router-dom, zustand, tailwindcss v4, @radix-ui/*)
packages/ui/vite.config.ts                  (@tailwindcss/vite plugin)
.github/workflows/_test-suite.yml           (UI coverage gate)
CLAUDE.md                                   (key file locations; WS5-A status)
GEMINI.md                                   (mirror)
docs/roadmap.md                             (WS5 Sub-project A acceptance)
```

---

## 9. Acceptance criteria

Each must pass on **Windows, macOS, and Linux** before Sub-project A ships:

- [ ] `bun run build` in `packages/ui/` produces a running Tauri app
- [ ] Launching with no existing data routes to `/onboarding/welcome`; launching with `onboarding_completed` meta routes to `/` (Dashboard stub)
- [ ] Tray icon appears; menu items (`Open Dashboard`, `Quick Query`, `Settings`, `Quit`) fire the correct action
- [ ] Tray icon transitions `normal → amber → red` within 2 s of a synthetic `connector.healthChanged` notification
- [ ] `Ctrl+Shift+N` / `Cmd+Shift+N` spawns the quick-query popup; `Escape` closes it; focus loss closes it (150 ms debounce)
- [ ] Quick-query submits to `engine.askStream`, streams tokens visually, auto-closes 2 s after `engine.streamDone`
- [ ] `rpc_call` with a method not in `ALLOWED_METHODS` returns `ERR_METHOD_NOT_ALLOWED` — verified by a Rust unit test **and** a frontend integration test
- [ ] Gateway-offline banner appears within 2 s of killing the Gateway process; disappears on reconnect
- [ ] `[Start Gateway]` button invokes the scoped shell command and reconnects
- [ ] macOS: app does not appear in the Dock; tray icon adapts to light/dark mode; main window has a transparent title bar
- [ ] Onboarding step 2 triggers `connector.startAuth`; step 3 polls `diag.snapshot`; finish writes `onboarding_completed` to meta
- [ ] Skip on step 1 writes `onboarding_completed` + navigates to Dashboard stub
- [ ] Auto-complete on window close during onboarding writes `onboarding_completed`
- [ ] Vitest coverage ≥ 80 % lines / 75 % branches on `packages/ui/src/{ipc,providers,store,pages,components,layouts}/**`
- [ ] Rust `cargo test` under `src-tauri/` passes
- [ ] No `any` types; `bun run typecheck` clean; `bun run lint` clean

---

## 10. Out of scope (deferred to B / C / D)

- Dashboard panels, HITL consent dialog, OS-level notifications → **B**
- Marketplace, Watchers, Workflows panels → **C**
- Settings panel, theming, keyboard shortcut customization, accessibility audit, dynamic Connectors tray submenu → **D**
- Quick-query hotkey conflict toast UI → **D** (Settings)
- Animated tray icon transitions, tray popover — out of Phase 4 entirely
