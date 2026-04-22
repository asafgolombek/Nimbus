# WS5 Sub-project B — Dashboard & HITL (Design)

> **Status:** Approved design · ready for implementation plan
> **Parent spec:** [`2026-04-19-ws5a-app-shell-foundation-design.md`](./2026-04-19-ws5a-app-shell-foundation-design.md)
> **Feature branch:** `dev/asafgolombek/phase_4_ws5` (umbrella). All WS5-B PRs target this branch; it merges to `main` once WS5 (A–D) is complete.
> **Non-negotiables reminder:** No `any` types (use `unknown`), Windows/macOS/Linux parity, AGPL-3.0 for `packages/ui`, HITL is structural, no `vault.*` / raw `db.*` writes from the frontend.

---

## 1. Overview & goals

Phase 4 Workstream 5 delivers the Tauri desktop application in four sub-projects. Sub-project A shipped the app shell, system tray, Quick Query popup, onboarding wizard, and IPC bridge with a 6-entry `ALLOWED_METHODS` allowlist. Sub-project B builds the first feature page (Dashboard) and the first security-critical interaction surface (HITL consent popup), plus the tray enhancements that these surfaces depend on.

### 1.1 Deliverables

B ships three user-visible deliverables:

1. **Dashboard** — hero-stacked layout with an index metric strip (items, embedding coverage, p95 query, index size), a connector health grid (per-service tile with state dot + last sync + tooltip for degradation reason), and a recent-activity audit feed (last ~25 entries).
2. **Nav chrome** — labelled sidebar (Dashboard · HITL · Marketplace · Watchers · Workflows · Settings) with a pending-HITL badge on the HITL entry; compact page-title + profile/health pill at the top of the page body.
3. **HITL popup** — dedicated frameless always-on-top window (modelled on Quick Query) spawned on `consent.request`; shows a structured `{ key: value }` preview of `details` + Approve / Reject buttons; closes on decision. The main-window `/hitl` route stays a one-line stub in B (full pending-list + history view lands later).

Tray enhancements (icon colour driven by aggregate health, HITL-pending badge, "Connectors ▸" submenu) ship alongside.

### 1.2 Non-goals (explicitly deferred)

- **Multi-action batch consent** (`agent.hitlBatch`). Current Gateway consent is single-action; the batch protocol is on the WS1 multi-agent roadmap and would double the HITL UI surface.
- **Monaco diff viewer / per-action-family custom renderers.** B renders every consent payload as a uniform structured preview. Richer renderers can land when real usage data shows which actions warrant them.
- **HITL history page.** `/hitl` stays a stub with a one-line "N pending · open popup" link.
- **Mobile breakpoints.** Carried forward from A-spec §7.
- **Gateway changes.** Every IPC method B consumes already exists server-side.

### 1.3 Success gates

- Quick Query, onboarding, offline banner, macOS accessory mode (all from A) keep working — existing WS5-A smoke passes unchanged.
- Dashboard renders against a live Gateway on all three OSes within 2 s of entering the route.
- A `consent.request` notification opens the popup within 1 s; Approve calls `consent.respond { requestId, approved: true }`; the Gateway proceeds and an audit row appears in the feed within 10 s.
- `packages/ui` coverage remains ≥ 80 % lines / ≥ 75 % branches.
- No `vault.*` or `db.*`-write method enters `ALLOWED_METHODS`.

---

## 2. Architecture & files

Additive over WS5-A. No files deleted except the single Dashboard stub replaced by the real page. Three-layer split matches A: TypeScript/React, Rust bridge/tray/popup, shared IPC contract.

### 2.1 TypeScript / React — `packages/ui/src/`

**New:**

- `components/chrome/Sidebar.tsx` — labelled sidebar; reads active route + pending-HITL badge count from store.
- `components/chrome/PageHeader.tsx` — page title + profile/health pill (right-aligned).
- `components/chrome/NavItem.tsx` — single nav entry (icon + label + optional badge).
- `components/dashboard/IndexMetricsStrip.tsx` — 4 metric tiles.
- `components/dashboard/ConnectorGrid.tsx` — grid of `ConnectorTile` cards + error + empty states.
- `components/dashboard/ConnectorTile.tsx` — single connector card (dot + name + last-sync + optional degradation reason + tooltip).
- `components/dashboard/AuditFeed.tsx` — scrollable list of recent audit rows.
- `components/dashboard/format.ts` — pure number/time/byte formatters (testable in isolation).
- `components/hitl/HitlPopupPage.tsx` — popup route body.
- `components/hitl/StructuredPreview.tsx` — renders `details` as labelled rows.
- `hooks/useIpcQuery.ts` — typed query hook with interval polling, visibility/connection pausing, in-flight dedupe, abortable cleanup.
- `hooks/useIpcSubscription.ts` — typed listener for Tauri events originating from Gateway notifications.
- `store/slices/dashboard.ts` — metrics + connectors + audit + highlight state.
- `store/slices/hitl.ts` — pending-request FIFO queue (mirror; source of truth is Rust).
- `pages/Dashboard.tsx` — composes the three dashboard components.
- `pages/HitlPopup.tsx` — standalone route for the popup window (`#/hitl-popup`).

**Modified:**

- `App.tsx` — add `/hitl-popup` route; remove `DashboardStub` import.
- `layouts/RootLayout.tsx` — compose `<Sidebar />` + main area + `<Outlet />` + existing offline banner.
- `pages/stubs/HitlStub.tsx` — rewrite to show `"N pending · Open popup"` (real list view lands with C/D).
- `store/slices/tray.ts` — extend aggregate computation to include health degradation state + `pendingHitl` count.
- `ipc/client.ts` — add typed wrappers for the four new methods.
- `ipc/types.ts` — `ConnectorStatus`, `IndexMetrics`, `AuditEntry`, `HitlRequest` types.

**Deleted:**

- `pages/stubs/DashboardStub.tsx` — replaced by `pages/Dashboard.tsx`.

### 2.2 Rust — `packages/ui/src-tauri/src/`

**New:**

- `hitl_popup.rs` — spawn/focus/close helpers for the popup window; mirrors `quick_query.rs`; 480×360, `always_on_top(true)`, `skip_taskbar(true)`, decorations off, non-resizable, centered on the active monitor (explicit `.center()` call so placement does not rely on Tauri defaults, which differ across backends).

**Modified:**

- `gateway_bridge.rs` — expand `ALLOWED_METHODS` (see §3); add a notification classifier that, after the existing `gateway://notification` re-emit, also emits typed events: `consent://request`, `connector://health-changed`, `consent://resolved`. Hold `pending_hitl: Mutex<Vec<HitlRequest>>` as the source of truth for active consent requests. Add `get_pending_hitl` + `open_hitl_popup` + `close_hitl_popup` + `set_connectors_menu` commands.
- `tray.rs` — state machine consumes `tray://state-changed` payloads (icon variant + badge); adds a "Connectors ▸" submenu populated by `set_connectors_menu`; clicking an item emits `tray://open-connector { name }`.
- `lib.rs` — register the new commands and a `consent://request` listener that invokes `open_hitl_popup`.
- `capabilities/default.json` — grant the `hitl-popup` window label the same scope as `quick-query`.

### 2.3 Tests

**New TS:**

- `test/components/chrome/Sidebar.test.tsx`
- `test/components/dashboard/ConnectorTile.test.tsx`
- `test/components/dashboard/IndexMetricsStrip.test.tsx`
- `test/components/dashboard/AuditFeed.test.tsx`
- `test/components/dashboard/format.test.ts`
- `test/components/hitl/StructuredPreview.test.tsx`
- `test/hooks/useIpcQuery.test.ts`
- `test/hooks/useIpcSubscription.test.ts`
- `test/store/hitl.test.ts`
- `test/store/dashboard.test.ts`
- `test/pages/Dashboard.test.tsx`
- `test/pages/HitlPopup.test.tsx`

**New Rust:**

- `src-tauri/src/hitl_popup.rs` — inline `#[cfg(test)] mod tests` for spawn/focus idempotency and close-when-absent no-op.

**Modified:**

- `src-tauri/src/gateway_bridge.rs` — expand allowlist tests and add notification-classifier tests.

### 2.4 Docs

**New:**

- `docs/manual-smoke-ws5b.md` — manual smoke checklist.

**Modified:**

- `CLAUDE.md`, `GEMINI.md` — add WS5-B file entries + update status line to `WS5-A ✅ · WS5-B ✅`.
- `docs/roadmap.md` — tick **Dashboard**, **HITL consent dialogs**, **System tray enhancements**; append a WS5-B acceptance section.

---

## 3. IPC contract additions

### 3.1 `ALLOWED_METHODS` — four additions

```rust
pub const ALLOWED_METHODS: &[&str] = &[
    // Sub-project A (unchanged)
    "diag.snapshot",
    "connector.list",
    "connector.startAuth",
    "engine.askStream",
    "db.getMeta",
    "db.setMeta",
    // Sub-project B additions
    "connector.listStatus",   // PR-B1 — Dashboard connector tiles + tray aggregate
    "index.metrics",          // PR-B1 — Dashboard metric strip
    "audit.list",             // PR-B1 — Dashboard audit feed
    "consent.respond",        // PR-B4 — HITL popup Approve / Reject
];
```

**Invariants (unchanged from A):**

- Any method not in `ALLOWED_METHODS` → `{ code: -32601, message: "ERR_METHOD_NOT_ALLOWED" }` before the bridge touches the socket.
- `vault.*` and raw `db.*` writes remain permanently excluded.
- `consent.respond` is a client → server **request**, not a notification. It already exists server-side at `packages/gateway/src/ipc/server.ts:872`.
- Receiving notifications (`consent.request`, `connector.healthChanged`) does not require an allowlist entry; it flows through the existing `subscribe_notifications` command.

### 3.2 Typed client wrappers — `packages/ui/src/ipc/client.ts`

```ts
class NimbusIpcClient {
  // existing from A …
  connectorListStatus(): Promise<ConnectorStatus[]>;
  indexMetrics(): Promise<IndexMetrics>;
  auditList(limit?: number): Promise<AuditEntry[]>;
  consentRespond(requestId: string, approved: boolean): Promise<void>;
}
```

### 3.3 New TypeScript types — `packages/ui/src/ipc/types.ts`

```ts
export type ConnectorHealth =
  | "healthy"
  | "degraded"
  | "rate_limited"
  | "error"
  | "unauthenticated"
  | "paused";

export interface ConnectorStatus {
  name: string;
  health: ConnectorHealth;
  lastSyncAt?: string;
  degradationReason?: string;
  itemCount?: number;
}

export interface IndexMetrics {
  itemsTotal: number;
  embeddingCoveragePct: number;
  queryP95Ms: number;
  indexSizeBytes: number;
}

export interface AuditEntry {
  id: number;
  ts: string;
  action: string;
  outcome: "approved" | "rejected" | "auto" | "info";
  subject?: string;
  hitlRejectReason?: string;
}

export interface HitlRequest {
  requestId: string;
  prompt: string;
  details?: Record<string, unknown>;
  receivedAtMs: number;
}
```

Fields only reflect data the UI reads in B. When the Gateway adds more detail, these types can grow additively.

### 3.4 Notification classifier — `gateway_bridge.rs`

The bridge already forwards every JSON-RPC notification as a single `gateway://notification` Tauri event. B adds classifier emits **in addition** (not instead):

```rust
match method {
    "consent.request" => {
        // push into pending_hitl (dedupe by requestId)
        app.emit("consent://request", params.clone())?;
    }
    "connector.healthChanged" => {
        app.emit("connector://health-changed", params.clone())?;
    }
    _ => {}
}
```

The generic event remains the single source of truth for test fixtures; specific events exist so Rust-side listeners (tray submenu, popup spawner) don't parse JSON-RPC envelopes.

On successful `consent.respond` response, the bridge emits `consent://resolved { requestId, approved }` so both windows can clear their local store entry in lockstep with Rust.

### 3.5 New Tauri commands — `gateway_bridge.rs` + `hitl_popup.rs`

```rust
#[tauri::command]
async fn get_pending_hitl() -> Vec<HitlRequest>;

#[tauri::command]
async fn open_hitl_popup(app: AppHandle) -> Result<(), BridgeError>;

#[tauri::command]
async fn close_hitl_popup(app: AppHandle) -> Result<(), BridgeError>;

#[tauri::command]
async fn set_connectors_menu(
    app: AppHandle,
    items: Vec<ConnectorMenuEntry>,
) -> Result<(), BridgeError>;
```

### 3.6 Gateway-side changes

**None.** Every method used by B exists and is tested today.

---

## 4. Component design

### 4.1 Chrome

**`RootLayout.tsx`** composes:

```
<GatewayOfflineBanner />
<div class="flex flex-1 min-h-0">
  <Sidebar />
  <main class="flex-1 overflow-auto"><Outlet /></main>
</div>
```

**`Sidebar.tsx`** — 150 px wide, hard-coded nav entries (Dashboard · HITL · Marketplace · Watchers · Workflows · Settings). Each entry uses `NavLink` from `react-router-dom` for auto `aria-current`. The HITL entry renders a right-aligned badge reading `useNimbusStore((s) => s.tray.pendingHitl)`; hidden at 0, `9+` above 9.

**`PageHeader.tsx`** — `<h1>` page title on the left, `<ProfileHealthPill />` on the right: `activeProfile · <dot><statusText>` where statusText is `"all healthy"`, `"N degraded"`, or `"N unavailable"`. Profile name comes from the existing `diag.snapshot` payload.

### 4.2 Dashboard page

```tsx
<PageHeader title="Dashboard" />
<main class="p-6 space-y-6">
  <IndexMetricsStrip />
  <ConnectorGrid />
  <AuditFeed />
</main>
```

**`IndexMetricsStrip.tsx`** — 4 tiles in one row (`grid grid-cols-4 gap-4`). Data from `useIpcQuery("index.metrics", 30_000)`. Each tile: big number + unit label. Loading → `<Skeleton />` variants shipped in A. Error → em-dash values with Retry.

**`ConnectorGrid.tsx`** — `useIpcQuery("connector.listStatus", 30_000)` plus `useIpcSubscription("connector://health-changed")` that patches the matching row in-place. Grid: `grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3`. Empty state: "No connectors configured. → Open Onboarding." (links to `/onboarding`).

**`ConnectorTile.tsx`** — 3-line card:

- Row 1: state dot + connector display name via `DISPLAY_NAMES` mapping. Covers every MCP connector key currently shipped — including the dev/collab services (`github` → `GitHub`, `gitlab` → `GitLab`, `slack` → `Slack`, `linear` → `Linear`, `jira` → `Jira`, …), the Microsoft/Google suites, and the Phase 2/3 infra/observability set (`aws` → `AWS`, `azure` → `Azure`, `gcp` → `GCP`, `iac` → `IaC`, `kubernetes` → `Kubernetes`, `pagerduty` → `PagerDuty`, `grafana` → `Grafana`, `sentry` → `Sentry`, `new-relic` → `New Relic`, `datadog` → `Datadog`). Unknown keys fall back to the raw name so new connectors degrade gracefully.
- Row 2: last sync relative time (`2 m ago`) or `not synced yet`.
- Row 3 (only on degradation): small amber/red text with degradation reason.

Radix `<Tooltip>` on hover shows the full degradation reason for long messages. State-dot colour mapping:

| Health | Dot colour |
|---|---|
| `healthy` | `--color-ok` |
| `degraded`, `rate_limited` | `--color-amber` |
| `error`, `unauthenticated` | `--color-error` |
| `paused` | `--color-fg-muted` |

**`AuditFeed.tsx`** — scrollable list, max-height 320 px. `useIpcQuery("audit.list", 10_000, { limit: 25 })`. One row per entry: timestamp (`10:42`) · action · subject · outcome pill. No click interaction in B.

### 4.3 HITL popup

**`pages/HitlPopup.tsx`** — standalone page rendered at `#/hitl-popup` inside the `hitl-popup` webview window. Reads the head of `useNimbusStore((s) => s.hitl.pending)`. If empty: renders "No pending requests" and invokes `close_hitl_popup` after 500 ms.

```tsx
<div class="p-5 space-y-4">
  <header>
    <h2>{request.prompt}</h2>
    <time>{timeAgo(request.receivedAtMs)}</time>
  </header>
  <StructuredPreview details={request.details} />
  <footer class="flex justify-end gap-2">
    <Button variant="ghost" onClick={reject}>Reject</Button>
    <Button onClick={approve} autoFocus={!isDestructive}>Approve</Button>
  </footer>
  {pending.length > 1 && <p class="muted">+{pending.length - 1} more pending</p>}
</div>
```

**`StructuredPreview.tsx`** — recursive, 2-level max:

- Scalar (`string | number | boolean`) → `<dt>{key}</dt><dd>{String(value)}</dd>`.
- String > 80 chars → truncate with "Show full" toggle (no Monaco).
- Array of scalars → comma-joined; array of objects → bulleted list of nested preview blocks (1 level nesting max).
- Object → nested `<dl>` (1 level only; beyond that, `JSON.stringify` fallback).
- `null` / `undefined` / missing → row hidden.
- **Never** renders raw HTML — all values go through `{String(v)}` for XSS safety.

**Destructive-action deny-list** — the Approve button loses `autoFocus` when `action` matches: `*.delete`, `*.destroy`, `*.cancel`, `*.stop`, `*.rollback`, `*.wipe`, `*.purge`, `*.format`, `*.terminate`, `*.drop`, `*.prune`, `pipeline.*`, `k8s.*`, `kubernetes.*`. Co-located as `DESTRUCTIVE_ACTION_PATTERNS` in `HitlPopupPage.tsx` and tested. Err toward over-inclusion — a missed keystroke on a destructive action is worse than one extra click on a benign one.

**Approve / Reject flow:**

1. User clicks Approve. Button disables, spinner shows.
2. `await client.consentRespond(requestId, true)`.
3. On success: `store.hitl.resolve(requestId, true)` (pops head of queue).
4. If queue empty → invoke `close_hitl_popup`. Else → UI re-renders for next request.
5. On error: inline error under buttons, Retry re-enables Approve/Reject; popup stays open.

### 4.4 Tray enhancements

**Badge:** `pendingHitl === 0` → no badge; `1..9` → numeric; `≥ 10` → `9+`.

**Icon aggregation** — extended in `store/slices/tray.ts`:

```
if (anyUnauthenticatedOrError) → red
else if (anyDegradedOrRateLimited) → amber
else if (allHealthy) → normal
```

Updates are debounced to 500 ms so a burst of `connector.healthChanged` events does not thrash the icon.

**"Connectors ▸" submenu:**

- Populated by `set_connectors_menu` after each `connector.listStatus` response.
- One menu item per connector: `●  <name> — <state>`.
- Click emits `tray://open-connector { name }` → `RootLayout` listens → navigates to `/` and sets `store.dashboard.highlightConnector = name`; `ConnectorTile` scrolls into view and flashes a ring for 1.5 s.

---

## 5. State & data flow

### 5.1 Store shape (additions only)

```ts
// store/slices/dashboard.ts
interface DashboardSlice {
  metrics: IndexMetrics | null;
  metricsError: string | null;
  connectors: ConnectorStatus[];
  audit: AuditEntry[];
  highlightConnector: string | null;
  setMetrics(m: IndexMetrics): void;
  setConnectors(c: ConnectorStatus[]): void;
  patchConnector(name: string, patch: Partial<ConnectorStatus>): void;
  setAudit(a: AuditEntry[]): void;
  setMetricsError(e: string | null): void;
  requestHighlight(name: string): void;
  clearHighlight(): void;
}

// store/slices/hitl.ts
interface HitlSlice {
  pending: HitlRequest[];                    // FIFO; head is the one shown
  enqueue(r: HitlRequest): void;             // dedupe by requestId
  resolve(requestId: string, approved: boolean): void;
}

// store/slices/tray.ts — extended (not new)
interface TraySlice {
  aggregateHealth: "normal" | "amber" | "red";
  pendingHitl: number;                       // mirrors hitl.pending.length
  connectorsMenu: ConnectorMenuEntry[];
}
```

### 5.2 Dashboard data flow

```
Dashboard mounts
  └─ useIpcQuery("index.metrics", 30s)        ──► store.dashboard.setMetrics
  └─ useIpcQuery("connector.listStatus", 30s) ─┬► store.dashboard.setConnectors
                                               └► invokes set_connectors_menu (Rust)
  └─ useIpcQuery("audit.list", 10s, {limit:25}) ► store.dashboard.setAudit
  └─ useIpcSubscription("connector://health-changed") ► store.dashboard.patchConnector
```

### 5.3 HITL popup data flow — cross-window store strategy

**Problem.** Each Tauri webview is its own JS realm — main window's Zustand store and popup window's store are independent.

**Decision (Option A).** Rust holds the source of truth (`pending_hitl: Mutex<Vec<HitlRequest>>` in `gateway_bridge.rs`). Both windows listen to `consent://request` and `consent://resolved`, and each mirrors into its local store. The popup page additionally calls `get_pending_hitl` on mount to recover if it was spawned fresh.

Flow:

```
Gateway emits consent.request
  └─ bridge classifier pushes to pending_hitl, emits consent://request
     ├─ lib.rs listener invokes open_hitl_popup
     ├─ main window RootLayout listener calls store.hitl.enqueue
     └─ popup window (if already open) listener calls store.hitl.enqueue

User clicks Approve in popup
  └─ client.consentRespond(requestId, true)
  └─ bridge sends JSON-RPC request over socket
  └─ on response: bridge removes from pending_hitl, emits consent://resolved
     ├─ main window store.hitl.resolve(id, true)
     └─ popup window store.hitl.resolve(id, true) → close_hitl_popup if queue empty
```

### 5.4 `useIpcQuery` contract

```ts
function useIpcQuery<T>(
  method: string,
  intervalMs: number,
  params?: object,
  opts?: { enabled?: boolean },
): { data: T | null; error: string | null; isLoading: boolean; refetch: () => void };
```

- Runs on mount, then every `intervalMs`.
- Pauses when `document.visibilityState === "hidden"`; resumes on visible with an immediate refetch.
- Pauses when `connection.state !== "connected"`; resumes on reconnect with an immediate refetch.
- Dedupes in-flight requests for identical `(method, params)` (key = `method + JSON.stringify(params)`).
- Abortable via `AbortController` on cleanup / dep change; if the bridge can't abort an in-flight call, the stale result is dropped.

### 5.5 Offline semantics (additive over A)

- Dashboard panels render last-known values from the store with a small amber "stale" chip.
- Connector tiles keep their last-known colour; tray icon holds its last-known state.
- `consent.request` cannot arrive while disconnected.
- On reconnect, `useIpcQuery` refetches immediately for all visible queries.

---

## 6. Error handling

### 6.1 IPC errors

| Source | Surface | Behavior |
|---|---|---|
| `ERR_METHOD_NOT_ALLOWED` | Dev-only red toast + `console.error` | Test enforces it cannot happen for B methods; it's a bug if raised |
| Gateway JSON-RPC error (`code`, `message`) | Inline in the affected panel | Never tears down the whole Dashboard |
| Bridge disconnected mid-call | Existing offline banner takes over; `useIpcQuery` pauses | Matches A |
| `consent.respond` fails | Popup stays open, red inline error, Retry re-enables buttons | Never silently drops a consent response |

### 6.2 Panel-level error UI

- `IndexMetricsStrip` — em-dash values + Retry button; preserves layout height.
- `ConnectorGrid` — keeps last-known tiles if any; one-line error row above the grid with Retry. **Known race (self-healing, accepted):** a `connector://health-changed` event arriving while the initial `connector.listStatus` fetch is in flight can be overwritten when the fetch resolves and calls `setConnectors`. A tile can show stale health for up to the 30 s poll interval until the next notification or refetch corrects it. Not patched because local IPC latency keeps the window small and a patch-replay queue is speculative complexity; revisit if we observe it in practice.
- `AuditFeed` — "Could not load recent activity. [Retry]".

### 6.3 HITL popup edge cases

1. **New request while popup open** — enqueue; header shows `+N more pending`; current request is not replaced.
2. **Popup closed without responding** — request stays pending in Rust; tray badge stays ≥ 1; clicking tray "Pending actions (N)" re-opens popup. Gateway stays blocked — **intentional**, no silent rejection.
3. **Gateway offline while popup open** — disable Approve/Reject, show "Gateway disconnected" banner inside popup body. Rust pending list retained.
4. **Gateway restart** — Gateway's in-memory consent state clears. `consent.respond` for an old id returns "Unknown or foreign consent request". Surface as "Request expired. Close." and clear the stale entry from Rust `pending_hitl`.
5. **App quits with popup open** — existing `rejectAllPending` fires Gateway-side on client disconnect; no UI action.
6. **Duplicate `requestId`** — dedupe check in Rust `pending_hitl` before push.

### 6.4 Tray edge cases

- `connector.listStatus` fails on first mount → tray stays last-known; aggregate only recomputes on success.
- `set_connectors_menu` called before tray init → Rust holds the last set and applies on init (existing pattern).

### 6.5 Visual-status rules

- **No infinite spinners.** Every loading state has a bounded skeleton that degrades to an error after `intervalMs + 2s` without response.
- **No destructive defaults.** See §4.3 destructive-action deny-list for Approve `autoFocus`.

### 6.6 Logging

- Bridge-side: no new logs.
- UI-side: silent in production; `console.warn` on IPC errors only in `import.meta.env.DEV`.
- **Never log `consent.request` details.** Only `{ requestId, action }`.

---

## 7. Testing strategy

### 7.1 Coverage gate

Existing: `packages/ui` ≥ 80 % lines / ≥ 75 % branches (`_test-suite.yml:ui-coverage`). WS5-B stays within this gate — no new threshold.

### 7.2 Test matrix

| Layer | Framework | What | Where |
|---|---|---|---|
| React components | Vitest + Testing Library + jsdom | Render + interaction, mocked IPC client | `packages/ui/test/components/**` |
| Hooks | Vitest + `renderHook` | `useIpcQuery` / `useIpcSubscription` behavior | `packages/ui/test/hooks/**` |
| Store slices | Vitest (unit) | Reducer-style tests on `dashboard`, `hitl`, extended `tray` | `packages/ui/test/store/**` |
| Pages (composition) | Vitest + Testing Library | Dashboard with all three panels; HitlPopup approve/reject | `packages/ui/test/pages/**` |
| Rust bridge | `#[cfg(test)] mod tests` | Allowlist + classifier + popup idempotency | `packages/ui/src-tauri/src/**` |

### 7.3 Critical test cases

**Bridge allowlist (regression guard):**

- `is_method_allowed("consent.respond") == true`
- `is_method_allowed("vault.get") == false`
- `is_method_allowed("db.setMeta") == true`
- `is_method_allowed("db.put") == false` (raw db writes blocked)

**`useIpcQuery`:**

- Emits initial call on mount; emits interval calls at `t + N · interval`.
- Skips call while `visibilityState === "hidden"`; fires one on return.
- Skips call while disconnected; fires one on reconnect.
- Concurrent mounts with identical `(method, params)` dedupe to a single in-flight call.
- Abort on unmount does not throw.

**`StructuredPreview`:**

- Scalar row for each primitive; hidden row for null/undefined.
- Truncation toggle for strings > 80 chars.
- Array of scalars → comma-joined; array of objects → nested preview list (1 level).
- Never renders raw HTML — fixture `{text: "<script>alert(1)</script>"}` asserts text content.

**`HitlPopup` flow:**

- 1 pending → Approve triggers `consentRespond(id, true)` → store resolves → `close_hitl_popup` invoked.
- Reject mocked error → popup stays open, error rendered, buttons re-enabled.
- Queue of 2 → header `+1 more pending`; after approve, second becomes head.
- Empty queue on mount → popup self-closes within 500 ms.
- Destructive action (`file.delete`, `kubernetes.pod.delete`, `pipeline.cancel`) → Approve does **not** `autoFocus`.

**`ConnectorTile`:**

- Colour mapping covers all six health values.
- Tooltip only renders when `degradationReason` is present.
- `connector://health-changed` patch leaves other tiles untouched.

**`Dashboard` page smoke:**

- All three panels render with mocked IPC returning canned payloads.
- Gateway-offline → banner appears, skeletons stay, last-known values preserved.

**Rust notification classifier:**

- `method: "consent.request"` → emits `consent://request` with params.
- Unknown method → only `gateway://notification` is emitted.

**Rust HITL popup:**

- `open_hitl_popup` called twice → one window, focus.
- `close_hitl_popup` when popup absent → `Ok(())`, no error.

### 7.4 Intentional non-goals for testing

- **No end-to-end test** from Gateway socket through popup render. Rust tests cover the bridge; TS tests cover store/UI with mocks. Full e2e belongs in a future lane.
- **No visual regression / screenshot diffing.** Layout is stable but not worth pinning to screenshots at this stage.

### 7.5 Manual smoke — `docs/manual-smoke-ws5b.md`

Per OS:

- Start Gateway → open main window → Dashboard tiles load within 2 s.
- Kill a connector via config → tray turns amber within 30 s; tile shows reason.
- Trigger a consent-gated action via `nimbus ask` → popup opens within 1 s.
- Approve via popup → `nimbus ask` completes; audit entry appears in feed within 10 s.
- Reject via popup → action aborts; audit entry shows `rejected`.
- Close popup (X) without responding → tray badge shows `1`; tray "Pending actions" re-opens popup.

### 7.6 CI

No new CI steps. Existing `ui-coverage` already runs on push + PR.

---

## 8. Acceptance criteria

All must pass on **Windows, macOS, and Linux** before B is considered done.

**Dashboard**

- [ ] Dashboard route renders metric strip, connector grid, and audit feed within 2 s of entering the route against a populated Gateway.
- [ ] Metric strip shows current values from `index.metrics`; refreshes every 30 s while visible.
- [ ] Connector tile colours follow the health → colour mapping in §4.2.
- [ ] Hovering a degraded tile shows `degradationReason` in a tooltip.
- [ ] Audit feed lists the latest 25 entries newest-first; refreshes every 10 s.
- [ ] Polling pauses when the tab is hidden and when Gateway is disconnected; resumes with an immediate refetch.

**Chrome**

- [ ] Sidebar lists all 6 top-level routes with correct active-state highlight.
- [ ] HITL sidebar entry shows a badge equal to `tray.pendingHitl`; hides at 0; shows `9+` above 9.
- [ ] Page header shows active profile + aggregated health pill; updates within 500 ms of a `connector.healthChanged` notification.

**Tray**

- [ ] Tray icon switches green → amber → red strictly following the aggregate-health rule; transitions debounced to ≤ 500 ms.
- [ ] Tray badge shows pending-HITL count; updates on enqueue and on resolve.
- [ ] Tray "Connectors ▸" submenu lists every connector with its state; click opens Dashboard and flashes the matching tile for 1.5 s.

**HITL popup**

- [ ] `consent.request` opens the popup within 1 s (frameless, 480×360, always-on-top, skip-taskbar).
- [ ] Popup shows `prompt` + `StructuredPreview(details)` + Approve/Reject.
- [ ] Approve calls `consent.respond { requestId, approved: true }`; Gateway proceeds; popup closes; audit row appears within 10 s.
- [ ] Reject calls `consent.respond { requestId, approved: false }`; action aborts; audit row shows `rejected`.
- [ ] Second `consent.request` while popup open → header shows `+1 more pending`; advance on resolve.
- [ ] Closing the popup without responding leaves the request pending; re-opening via tray shows the same request.
- [ ] Destructive action does **not** `autoFocus` Approve.
- [ ] `consent.respond` failure keeps the popup open with an inline error and Retry.

**IPC security**

- [ ] `ALLOWED_METHODS` contains exactly the 10 methods in §3.1 — test asserts positive and negative.
- [ ] Gateway-side code unchanged (diffstat confirms no `packages/gateway` changes across PRs B1–B4).
- [ ] `consent.request` details never appear in UI-side logs; only `{ requestId, action }` logged.

**Quality gates**

- [ ] `packages/ui` coverage ≥ 80 % lines / ≥ 75 % branches on the post-merge commit.
- [ ] `bun run typecheck`, `bun run lint`, `bun test`, `cd packages/ui && bunx vitest run` all pass in CI.
- [ ] Existing WS5-A smoke still passes — no regression in Quick Query, onboarding, offline banner, or macOS accessory mode.
- [ ] New WS5-B smoke passes on all three platforms.

**Docs**

- [ ] `CLAUDE.md` + `GEMINI.md` updated: WS5-B file entries added; status line reads `WS5-A ✅ · WS5-B ✅`.
- [ ] `docs/roadmap.md` — Dashboard, HITL consent dialogs, System tray enhancements rows ticked; "WS5 Sub-project B acceptance" section appended.

---

## 9. PR sequence

Four PRs target `dev/asafgolombek/phase_4_ws5`. Each is independently reviewable and mergeable.

| # | Branch (suggested) | Title | Approx. files |
|---|---|---|---|
| B1 | `dev/ws5b-chrome-ipc` | `feat(ui): WS5-B · nav chrome, useIpcQuery, allowlist +4` | ~15 |
| B2 | `dev/ws5b-dashboard` | `feat(ui): WS5-B · Dashboard page` | ~18 |
| B3 | `dev/ws5b-tray` | `feat(ui): WS5-B · tray health colour, badge, connectors submenu` | ~10 |
| B4 | `dev/ws5b-hitl-popup` | `feat(ui): WS5-B · HITL popup window + consent.respond wiring` | ~15 |

**Ordering:** B1 first; B2 depends on B1; B3 and B4 are parallelisable after B1. B4 carries the CLAUDE.md / GEMINI.md / roadmap.md updates that tick WS5-B as complete.

WS5 merges to `main` after B4 + any follow-up polish from C/D (separate designs).

---

## 10. References

- Sub-project A design: `docs/superpowers/specs/2026-04-19-ws5a-app-shell-foundation-design.md`
- Phase 4 working reference: skill `nimbus-phase-4`
- IPC conventions: skill `nimbus-ipc`
- Testing conventions: skill `nimbus-testing`
- Architecture: `docs/architecture.md`
- Roadmap: `docs/roadmap.md`
