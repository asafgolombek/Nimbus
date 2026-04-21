# WS5-C UI — Plan 4: Audit panel + Updates panel

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `PanelComingSoon` placeholders at `/settings/audit` and `/settings/updates` with fully wired panels. Audit gets a `react-window` virtualized list (Gateway returns up to 1,000 rows), filter chips (service / outcome / date range derived client-side), a "Verify chain" toast wired to `audit.verify`, and an "Export…" button that opens the native save dialog with `.json` (default) and `.csv` format filters — CSV is flattened client-side from `audit.export` to a fixed 6-column whitelist (`timestamp`, `service`, `actor`, `action`, `outcome`, `rowHash`). Updates gets a state-machine-driven panel (`idle` → `checking` → `available` → `downloading` → `verifying` → `applying` → `restarting` → `reconnecting` → `success` / `rolled_back` / `failed`), a full-window "Restarting Nimbus…" overlay triggered by the `updater.restarting` notification (not by raw socket disconnect, to avoid the 1–2 s gap), a 2-minute reconnect timeout, a `diag.getVersion` post-reconnect check, and a Rollback button surfaced when the previous install failed.

**Architecture:** Additive only — no files deleted, no signatures removed. **No new methods** added to the Rust `ALLOWED_METHODS` allowlist — every method consumed (`audit.list`, `audit.getSummary`, `audit.verify`, `audit.export`, `updater.getStatus`, `updater.checkNow`, `updater.applyUpdate`, `updater.rollback`, `diag.getVersion`) is already at line-positions inside the Plan-3 allowlist of 38. **One new Tauri plugin (`tauri-plugin-fs` v2)** with a single capability (`fs:allow-write-text-file`) is added so the Audit panel can write user-chosen `.json` / `.csv` files after the dialog returns a path. **One new Rust module (`src-tauri/src/updater.rs`)** owns the restart-window watcher: it listens for `gateway://connection-state` transitions during the `applying` state and emits two narrow window-scoped events (`updater://restart-started`, `updater://restart-complete`) consumed by an always-mounted `UpdaterRestartChrome` (see below) — these are *not* added to `GLOBAL_BROADCAST_METHODS` (which stays at 1) and they are *not* in `ALLOWED_METHODS` (which stays at 38) because they are emit-only Tauri events, not invokable RPC methods. **Nine** new typed wrappers join `packages/ui/src/ipc/client.ts`. Two new transient store slices (`audit`, `updater`) are added; the persisted-key whitelist in `partialize.ts` stays at exactly 5 (`connectorsList`, `installedModels`, `activePullId`, `active`, `profiles`) — neither slice persists any field. Notifications (`updater.updateAvailable`, `updater.downloadProgress`, `updater.restarting`, `updater.rolledBack`, `updater.verifyFailed`) flow through the existing `gateway://notification` window-scoped channel — **no** new dedicated topic classifier entries.

**Two corrections from Plan 4 review feedback** (folded into the phases below):

1. **Pre-existing `AuditEntry` wire-shape mismatch fix (Phase 1.5).** The `AuditEntry` interface in `packages/ui/src/ipc/types.ts` was authored before the Gateway's `audit.list` shape was settled: it declares `{ id, ts, action, outcome: "approved" | "rejected" | "auto" | "info", subject?, hitlRejectReason? }` while the Gateway returns `{ id, actionType, hitlStatus: "approved" | "rejected" | "not_required", actionJson, timestamp }`. The Dashboard's `AuditFeed.tsx` (WS5-B) reads the wrong field names and silently renders blank rows in production — the existing test passes only because the mock data matches the wrong-shape interface, not the wire. Plan 4 corrects the type to mirror the Gateway exactly, updates `AuditFeed.tsx` to map fields correctly, and updates `AuditFeed.test.tsx` to use real wire-shape mocks. This is a one-task patch in its own commit (`fix(ui): align AuditEntry with Gateway wire shape; fix AuditFeed mapping`) — small, surgical, and pre-condition for the new Audit panel that consumes the same `audit.list` endpoint.

2. **Restart overlay must outlive panel navigation (Phase 6 restructure).** The first draft mounted `RestartOverlay` and the 2-min reconnect-timer effect inside `UpdatesPanel.tsx`. If the user clicked away from `/settings/updates` mid-apply, the overlay would unmount, the timer would die, and `updater://restart-complete` would land on no listener — the success / `diag.getVersion` check would never fire. The corrected plan extracts both the overlay and *all* updater-related listeners (notification subscription, restart-started / restart-complete handlers, 2-min timer) into a new always-mounted `UpdaterRestartChrome` component rendered inside `RootLayout.tsx` next to the existing offline banner. `UpdatesPanel` is slimmed: it owns user-driven actions (Check now / Apply / Rollback), `updater.getStatus` fetch on mount, and panel-local visualisation (notes card, download progress bar, success/failure inline message). The slice is the single source of truth that bridges the always-mounted machinery and the panel-local UI.

**Tech Stack:** Tauri 2 · React 18 · TypeScript 6 strict · Zustand v5 · React Router v6 · Tailwind CSS v4 · `react-window` (already installed via Plan 1) · `@tauri-apps/plugin-dialog` (already installed) · `@tauri-apps/plugin-fs` (added in Phase 3) · Vitest + `@testing-library/react` · `cargo test` for Rust.

**Parent spec:** [`docs/superpowers/specs/2026-04-19-ws5c-settings-design.md`](../specs/2026-04-19-ws5c-settings-design.md) — §2.1 (Audit + Updates panel pages, `react-window` use, CSV column whitelist), §2.2 (`updater.rs` Rust module + window-scoped events), §3.1–3.2 (every method already in the allowlist), §4.3 (updater apply state machine), §5.2 (panel-specific failure modes including 2-minute reconnect timeout), §6.1 (Vitest requirements: `audit-panel.test.tsx`, `updater-state-machine.test.ts`, `updates-panel.test.tsx`), §7 commits 8–9.

**Depends on:** Plan 3 (`feat(ui-bridge): allowlist llm.getStatus` through `feat(ui): Model panel …` plus the `fix(ui)` cleanup and the `feat(docs)` plans commit) merged to `dev/asafgolombek/ws5c-ui`. All Plan-3 commits and the docs-update commit reflecting Plan-3 completion are expected on `HEAD` at the start of this plan.

**Branching strategy:** Continue on the existing feature branch `dev/asafgolombek/ws5c-ui`. Commits from this plan append to the seven Plan-3 commits + cleanup + plans-docs commit. **No PR opens yet** — Plan 5 (Data panel) still adds work to this branch. The single WS5-C UI PR opens after Plan 5 lands.

**Test convention:** UI tests live under `packages/ui/test/` mirroring the `src/` layout. The mock module at `packages/ui/src/ipc/__mocks__/client.ts` exports module-scope `vi.fn()` instances so `createIpcClient()` always resolves to the same mocks across a test. Pattern reference: `packages/ui/test/pages/settings/ProfilesPanel.test.tsx` and `packages/ui/test/components/settings/model/PullDialog.test.tsx`.

---

## Pre-flight (do once before Task 1)

- [ ] **Step A — Confirm branch + baseline green**

```bash
git checkout dev/asafgolombek/ws5c-ui
git status                        # expect clean
git log --oneline -12             # expect Plan 3's commits + cleanup + plans-docs commit on top of Plan 2
bun install
bun run typecheck
bun test --bail
cd packages/ui && bunx vitest run && cd ../..
cd packages/ui/src-tauri && cargo test && cd ../../..
```

Expected: every command exits 0. If anything is red on the Plan 3 tip, stop and fix before continuing.

- [ ] **Step B — Skim the patterns this plan mirrors**

Open each of these once; every task below assumes you have them in your head:

- `packages/ui/src/pages/settings/TelemetryPanel.tsx` — canonical fetch-once-and-render pattern: `useEffect(() => void refresh(), [refresh])`, `PanelHeader`, `PanelError`, `StaleChip`, offline-driven `writeDisabled`. The Audit panel and the Updates panel follow this shape.
- `packages/ui/src/pages/settings/ConnectorsPanel.tsx` — canonical multi-source panel: `useIpcQuery` polling at 30 s + `useIpcSubscription` on `gateway://notification` filtered by `method`. The Audit panel uses the same dual-source pattern.
- `packages/ui/test/pages/settings/ProfilesPanel.test.tsx` — canonical panel test scaffold: `vi.mock("../../../src/ipc/client")` + module-scope mock imports + `useNimbusStore.setState({...} as never)` to force connection / offline state. Both new panel tests use this exact scaffold.
- `packages/ui/src/components/settings/model/PullDialog.test.tsx` — canonical timer-driven test pattern: `vi.useFakeTimers()` + `vi.advanceTimersByTime(...)`. The updater 2-minute reconnect-timeout test uses this exact pattern.
- `packages/ui/src/hooks/useIpcQuery.ts` — typed polling hook (pauses on `visibilityState === "hidden"` and when `connectionState !== "connected"`). The Audit panel uses this at a 60 s cadence for new audit entries.
- `packages/ui/src/hooks/useIpcSubscription.ts` — typed Tauri event listener. Used by both panels: Audit listens to `gateway://notification` for new audit-row events; Updates listens to both `gateway://notification` (for `updater.*` notifications) and the new `updater://restart-*` window events emitted by the Rust module.
- `packages/ui/src/ipc/client.ts` — `call()` plus typed wrappers; this plan adds nine more typed wrappers alongside them.
- `packages/ui/src/ipc/__mocks__/client.ts` — module-scope `vi.fn()` mocks; extend with one mock per new wrapper.
- `packages/ui/src-tauri/src/gateway_bridge.rs:497–549` — `classify_notification` dispatcher. **No edits required for this plan** — the updater notifications flow through the generic `gateway://notification` channel (line 246) and are filtered by method in the Updates panel.
- `packages/ui/src-tauri/src/hitl_popup.rs` — canonical pattern for a small Rust module that owns one concern (window lifecycle + 1 `#[cfg(test)] mod tests`). The new `updater.rs` follows the same shape (event subscription + emit + 1 `#[cfg(test)] mod tests`).
- `packages/gateway/src/ipc/audit-rpc.ts` — confirms wire shapes: `audit.verify` accepts `{ full?: boolean }` and returns either `{ ok: true, lastVerifiedId: number, totalChecked: number }` or `{ ok: false, brokenAtId: number, expectedHash: string, actualHash: string }`; `audit.export` returns `Array<{ id, actionType, hitlStatus, actionJson, timestamp, rowHash, prevHash }>` capped at 10,000; `audit.getSummary` returns `{ byOutcome: Record<string, number>, byService: Record<string, number>, total: number }`.
- `packages/gateway/src/ipc/updater-rpc.ts` — confirms wire shapes: `updater.getStatus` returns `{ state, currentVersion, configUrl, lastCheckAt?, lastError? }`; `updater.checkNow` returns `{ currentVersion, latestVersion, updateAvailable, notes? }`; `updater.applyUpdate` returns `{ jobId: string }` (it does not block on completion — it streams `updater.downloadProgress` / `updater.restarting` / `updater.rolledBack` / `updater.verifyFailed` notifications); `updater.rollback` returns `{ ok: true }`.
- `packages/gateway/src/updater/updater.ts:5–13` — confirms the five notification names emitted by the Gateway updater: `updater.updateAvailable`, `updater.downloadProgress`, `updater.restarting`, `updater.rolledBack`, `updater.verifyFailed`. Notification payloads: `updateAvailable { version, notes? }`; `downloadProgress { receivedBytes, totalBytes? }`; `restarting { fromVersion, toVersion }`; `rolledBack { reason: "download_failed" | "hash_mismatch" | "signature_invalid" | "installer_failed" }`; `verifyFailed { reason: "hash_mismatch" | "signature_invalid" }`.

---

## Phase 1 — Shared IPC contract: types + wrappers + mocks

Plan 4 adds **nine** typed wrappers to `NimbusIpcClient`:

| Wrapper | Gateway method | Used by |
|---|---|---|
| `auditGetSummary()` | `audit.getSummary` | Audit panel filter chips |
| `auditVerify(full?)` | `audit.verify` | Audit panel "Verify chain" button |
| `auditExport()` | `audit.export` | Audit panel "Export…" button |
| `updaterGetStatus()` | `updater.getStatus` | Updates panel initial fetch |
| `updaterCheckNow()` | `updater.checkNow` | Updates panel "Check now" button |
| `updaterApplyUpdate()` | `updater.applyUpdate` | Updates panel "Apply" button |
| `updaterRollback()` | `updater.rollback` | Updates panel "Rollback" button |
| `diagGetVersion()` | `diag.getVersion` | Updates panel post-reconnect verification |

Note: `auditList` already exists from WS5-B (line 140 of `client.ts`) — we do **not** re-wrap it.

Each wrapper just forwards `{ ...args }` (or `{}` for no-arg reads) as JSON-RPC params and returns the raw result, with a lightweight runtime shape guard on every method whose response is a non-primitive object. No extra `parseError` redaction needed — Plan 2 already redacts the five forbidden credential keys.

### Task 1: Extend `packages/ui/src/ipc/types.ts`

**Files:**
- Modify: `packages/ui/src/ipc/types.ts`

- [ ] **Step 1: Append the new types**

At the bottom of `packages/ui/src/ipc/types.ts` (after the `LlmPullTerminalPayload` export at the current end of file — the last addition from Plan 3), append:

```ts
// ---- WS5-C Plan 4 additions (Audit + Updates panels) ----

/** `audit.getSummary` response — counts by outcome and by first-segment service. */
export interface AuditSummary {
  readonly byOutcome: Readonly<Record<string, number>>;
  readonly byService: Readonly<Record<string, number>>;
  readonly total: number;
}

/** `audit.verify` success result. */
export interface AuditVerifyOk {
  readonly ok: true;
  readonly lastVerifiedId: number;
  readonly totalChecked: number;
}

/** `audit.verify` failure result — chain broken at `brokenAtId`. */
export interface AuditVerifyBroken {
  readonly ok: false;
  readonly brokenAtId: number;
  readonly expectedHash: string;
  readonly actualHash: string;
}

export type AuditVerifyResult = AuditVerifyOk | AuditVerifyBroken;

/**
 * One row from `audit.export` — includes the BLAKE3 row hash and prev hash.
 * Distinct from `AuditEntry` (the lighter `audit.list` shape), which omits hashes
 * and remaps fields for the Dashboard's audit feed.
 */
export interface AuditExportRow {
  readonly id: number;
  readonly actionType: string;
  readonly hitlStatus: "approved" | "rejected" | "not_required";
  readonly actionJson: string;
  readonly timestamp: number;
  readonly rowHash: string;
  readonly prevHash: string;
}

/** `updater.getStatus` response — mirrors `UpdaterStatus` in `packages/gateway/src/updater/types.ts`. */
export type UpdaterStateName =
  | "idle"
  | "checking"
  | "downloading"
  | "verifying"
  | "applying"
  | "rolled_back"
  | "failed";

export interface UpdaterStatus {
  readonly state: UpdaterStateName;
  readonly currentVersion: string;
  readonly configUrl: string;
  readonly lastCheckAt?: string;
  readonly lastError?: string;
}

/** `updater.checkNow` response. */
export interface UpdaterCheckResult {
  readonly currentVersion: string;
  readonly latestVersion: string;
  readonly updateAvailable: boolean;
  readonly notes?: string;
}

/** `updater.applyUpdate` response — `jobId` is opaque, used only for log correlation. */
export interface UpdaterApplyStarted {
  readonly jobId: string;
}

/** `updater.rollback` response. */
export interface UpdaterRollbackResult {
  readonly ok: true;
}

/** `updater.updateAvailable` notification payload. */
export interface UpdaterUpdateAvailablePayload {
  readonly version: string;
  readonly notes?: string;
}

/** `updater.downloadProgress` notification payload. */
export interface UpdaterDownloadProgressPayload {
  readonly receivedBytes: number;
  readonly totalBytes?: number;
}

/** `updater.restarting` notification payload — fires *before* the Gateway socket closes. */
export interface UpdaterRestartingPayload {
  readonly fromVersion: string;
  readonly toVersion: string;
}

/** `updater.rolledBack` notification payload. */
export interface UpdaterRolledBackPayload {
  readonly reason: "download_failed" | "hash_mismatch" | "signature_invalid" | "installer_failed";
}

/** `updater.verifyFailed` notification payload. */
export interface UpdaterVerifyFailedPayload {
  readonly reason: "hash_mismatch" | "signature_invalid";
}

/** `diag.getVersion` response. */
export interface DiagVersionResult {
  readonly version: string;
}
```

- [ ] **Step 2: Verify**

```bash
cd packages/ui && bunx tsc --noEmit && cd ../..
```

Expected: exit 0 with no errors.

### Task 2: Add the nine wrappers to `packages/ui/src/ipc/client.ts`

**Files:**
- Modify: `packages/ui/src/ipc/client.ts`

- [ ] **Step 1: Import the new types**

Update the top-of-file `import` block to add the new type names. Replace:

```ts
import {
  type AuditEntry,
  type ConnectionState,
  type ConnectorConfigPatch,
  type ConnectorStatus,
  GatewayOfflineError,
  type IndexMetrics,
  JsonRpcError,
  type JsonRpcErrorPayload,
  type JsonRpcNotification,
  type LlmAvailabilityResult,
  type LlmListModelsResult,
  type LlmPullStartedResult,
  type LlmTaskType,
  MethodNotAllowedError,
  type ProfileListResult,
  type RouterStatusResult,
  type TelemetryStatus,
} from "./types";
```

with:

```ts
import {
  type AuditEntry,
  type AuditExportRow,
  type AuditSummary,
  type AuditVerifyResult,
  type ConnectionState,
  type ConnectorConfigPatch,
  type ConnectorStatus,
  type DiagVersionResult,
  GatewayOfflineError,
  type IndexMetrics,
  JsonRpcError,
  type JsonRpcErrorPayload,
  type JsonRpcNotification,
  type LlmAvailabilityResult,
  type LlmListModelsResult,
  type LlmPullStartedResult,
  type LlmTaskType,
  MethodNotAllowedError,
  type ProfileListResult,
  type RouterStatusResult,
  type TelemetryStatus,
  type UpdaterApplyStarted,
  type UpdaterCheckResult,
  type UpdaterRollbackResult,
  type UpdaterStatus,
} from "./types";
```

- [ ] **Step 2: Extend the `NimbusIpcClient` interface**

In `packages/ui/src/ipc/client.ts`, immediately after the `llmSetDefault(...)` declaration (the last entry in the interface today), add:

```ts
  /** WS5-C Plan 4 additions — Audit + Updates panels. */
  auditGetSummary(): Promise<AuditSummary>;
  auditVerify(full?: boolean): Promise<AuditVerifyResult>;
  auditExport(): Promise<ReadonlyArray<AuditExportRow>>;
  updaterGetStatus(): Promise<UpdaterStatus>;
  updaterCheckNow(): Promise<UpdaterCheckResult>;
  updaterApplyUpdate(): Promise<UpdaterApplyStarted>;
  updaterRollback(): Promise<UpdaterRollbackResult>;
  diagGetVersion(): Promise<DiagVersionResult>;
```

- [ ] **Step 3: Implement the wrappers in `createIpcClient`**

Inside the object literal returned by `createIpcClient`, immediately after the `llmSetDefault(taskType, provider, modelName) { ... }` method (the last implementation today), add:

```ts
    async auditGetSummary(): Promise<AuditSummary> {
      const res = await this.call<unknown>("audit.getSummary", {});
      if (typeof res !== "object" || res === null)
        throw new Error("audit.getSummary: expected object");
      return res as AuditSummary;
    },
    async auditVerify(full = false): Promise<AuditVerifyResult> {
      const res = await this.call<unknown>("audit.verify", { full });
      if (typeof res !== "object" || res === null)
        throw new Error("audit.verify: expected object");
      return res as AuditVerifyResult;
    },
    async auditExport(): Promise<ReadonlyArray<AuditExportRow>> {
      const res = await this.call<unknown>("audit.export", {});
      if (!Array.isArray(res)) throw new Error("audit.export: expected array");
      return res as ReadonlyArray<AuditExportRow>;
    },
    async updaterGetStatus(): Promise<UpdaterStatus> {
      const res = await this.call<unknown>("updater.getStatus", {});
      if (typeof res !== "object" || res === null)
        throw new Error("updater.getStatus: expected object");
      return res as UpdaterStatus;
    },
    async updaterCheckNow(): Promise<UpdaterCheckResult> {
      const res = await this.call<unknown>("updater.checkNow", {});
      if (typeof res !== "object" || res === null)
        throw new Error("updater.checkNow: expected object");
      return res as UpdaterCheckResult;
    },
    async updaterApplyUpdate(): Promise<UpdaterApplyStarted> {
      const res = await this.call<unknown>("updater.applyUpdate", {});
      if (typeof res !== "object" || res === null)
        throw new Error("updater.applyUpdate: expected object");
      return res as UpdaterApplyStarted;
    },
    async updaterRollback(): Promise<UpdaterRollbackResult> {
      return await this.call<UpdaterRollbackResult>("updater.rollback", {});
    },
    async diagGetVersion(): Promise<DiagVersionResult> {
      const res = await this.call<unknown>("diag.getVersion", {});
      if (typeof res !== "object" || res === null)
        throw new Error("diag.getVersion: expected object");
      return res as DiagVersionResult;
    },
```

- [ ] **Step 4: Verify**

```bash
cd packages/ui && bunx tsc --noEmit && cd ../..
```

Expected: exit 0.

### Task 3: Extend the mock client at `packages/ui/src/ipc/__mocks__/client.ts`

**Files:**
- Modify: `packages/ui/src/ipc/__mocks__/client.ts`

- [ ] **Step 1: Add eight `vi.fn()` mocks**

After the existing `// WS5-C Plan 3 additions` block (last mock is `llmSetDefaultMock`), append:

```ts
// WS5-C Plan 4 additions
export const auditGetSummaryMock = vi.fn<() => Promise<unknown>>();
export const auditVerifyMock = vi.fn<(full?: boolean) => Promise<unknown>>();
export const auditExportMock = vi.fn<() => Promise<unknown>>();
export const updaterGetStatusMock = vi.fn<() => Promise<unknown>>();
export const updaterCheckNowMock = vi.fn<() => Promise<unknown>>();
export const updaterApplyUpdateMock = vi.fn<() => Promise<unknown>>();
export const updaterRollbackMock = vi.fn<() => Promise<unknown>>();
export const diagGetVersionMock = vi.fn<() => Promise<unknown>>();
```

- [ ] **Step 2: Wire them into the `createIpcClient` factory**

Inside the existing `createIpcClient` factory's return object, after `llmSetDefault: llmSetDefaultMock,`, append:

```ts
  auditGetSummary: auditGetSummaryMock,
  auditVerify: auditVerifyMock,
  auditExport: auditExportMock,
  updaterGetStatus: updaterGetStatusMock,
  updaterCheckNow: updaterCheckNowMock,
  updaterApplyUpdate: updaterApplyUpdateMock,
  updaterRollback: updaterRollbackMock,
  diagGetVersion: diagGetVersionMock,
```

- [ ] **Step 3: Verify**

```bash
cd packages/ui && bunx tsc --noEmit && cd ../..
```

Expected: exit 0.

### Task 4: Add a Vitest spec for all nine wrappers

**Files:**
- Create: `packages/ui/test/ipc/client-ws5c-plan4.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetIpcClientForTests, createIpcClient } from "../../src/ipc/client";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  __resetIpcClientForTests();
  invokeMock.mockReset();
});

afterEach(() => {
  __resetIpcClientForTests();
});

describe("WS5-C Plan 4 IPC wrappers", () => {
  it("auditGetSummary forwards to audit.getSummary and returns the object verbatim", async () => {
    invokeMock.mockResolvedValueOnce({ byOutcome: { approved: 3 }, byService: { github: 2 }, total: 3 });
    const result = await createIpcClient().auditGetSummary();
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", { method: "audit.getSummary", params: {} });
    expect(result).toEqual({ byOutcome: { approved: 3 }, byService: { github: 2 }, total: 3 });
  });

  it("auditGetSummary throws if Gateway returns non-object", async () => {
    invokeMock.mockResolvedValueOnce("oops");
    await expect(createIpcClient().auditGetSummary()).rejects.toThrow(/expected object/);
  });

  it("auditVerify defaults `full` to false and forwards", async () => {
    invokeMock.mockResolvedValueOnce({ ok: true, lastVerifiedId: 42, totalChecked: 42 });
    const result = await createIpcClient().auditVerify();
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", { method: "audit.verify", params: { full: false } });
    expect(result).toEqual({ ok: true, lastVerifiedId: 42, totalChecked: 42 });
  });

  it("auditVerify(true) forwards `full: true`", async () => {
    invokeMock.mockResolvedValueOnce({ ok: false, brokenAtId: 7, expectedHash: "a", actualHash: "b" });
    await createIpcClient().auditVerify(true);
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", { method: "audit.verify", params: { full: true } });
  });

  it("auditExport returns the array verbatim", async () => {
    const rows = [
      { id: 1, actionType: "github.sync", hitlStatus: "not_required", actionJson: "{}", timestamp: 1, rowHash: "x", prevHash: "0" },
    ];
    invokeMock.mockResolvedValueOnce(rows);
    const result = await createIpcClient().auditExport();
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", { method: "audit.export", params: {} });
    expect(result).toEqual(rows);
  });

  it("auditExport throws if Gateway returns non-array", async () => {
    invokeMock.mockResolvedValueOnce({ rows: [] });
    await expect(createIpcClient().auditExport()).rejects.toThrow(/expected array/);
  });

  it("updaterGetStatus returns the object verbatim", async () => {
    const status = { state: "idle", currentVersion: "0.1.0", configUrl: "https://x" };
    invokeMock.mockResolvedValueOnce(status);
    const result = await createIpcClient().updaterGetStatus();
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", { method: "updater.getStatus", params: {} });
    expect(result).toEqual(status);
  });

  it("updaterCheckNow returns the object verbatim", async () => {
    const check = { currentVersion: "0.1.0", latestVersion: "0.2.0", updateAvailable: true, notes: "hello" };
    invokeMock.mockResolvedValueOnce(check);
    const result = await createIpcClient().updaterCheckNow();
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", { method: "updater.checkNow", params: {} });
    expect(result).toEqual(check);
  });

  it("updaterApplyUpdate returns the jobId object", async () => {
    invokeMock.mockResolvedValueOnce({ jobId: "abc123" });
    const result = await createIpcClient().updaterApplyUpdate();
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", { method: "updater.applyUpdate", params: {} });
    expect(result).toEqual({ jobId: "abc123" });
  });

  it("updaterRollback returns { ok: true }", async () => {
    invokeMock.mockResolvedValueOnce({ ok: true });
    const result = await createIpcClient().updaterRollback();
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", { method: "updater.rollback", params: {} });
    expect(result).toEqual({ ok: true });
  });

  it("diagGetVersion returns the object verbatim", async () => {
    invokeMock.mockResolvedValueOnce({ version: "0.1.0" });
    const result = await createIpcClient().diagGetVersion();
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", { method: "diag.getVersion", params: {} });
    expect(result).toEqual({ version: "0.1.0" });
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

```bash
cd packages/ui && bunx vitest run test/ipc/client-ws5c-plan4.test.ts && cd ../..
```

Expected: 11 tests passed.

- [ ] **Step 3: Commit Phase 1**

```bash
git add packages/ui/src/ipc/types.ts packages/ui/src/ipc/client.ts \
        packages/ui/src/ipc/__mocks__/client.ts \
        packages/ui/test/ipc/client-ws5c-plan4.test.ts
git commit -m "feat(ui-ipc): audit + updater + diag wrappers for Audit/Updates panels"
```

---

## Phase 1.5 — Pre-existing `AuditEntry` wire-shape correction

The `AuditEntry` interface in `packages/ui/src/ipc/types.ts` ships the wrong field names. `AuditFeed.tsx` on the Dashboard renders blank rows in production because it reads `e.ts` / `e.action` / `e.outcome` / `e.subject` — none of which exist on the wire. The existing `AuditFeed.test.tsx` passes because the mock data matches the wrong-shape interface. Fix the interface to mirror the Gateway, update the consumer, and update the test to use real wire-shape mocks.

This is a single bundled task — type, source, and test all change together — committed in its own surgical patch so the diff is reviewable.

### Task 5: Fix `AuditEntry` shape and `AuditFeed` mapping

**Files:**
- Modify: `packages/ui/src/ipc/types.ts`
- Modify: `packages/ui/src/components/dashboard/AuditFeed.tsx`
- Modify: `packages/ui/test/components/dashboard/AuditFeed.test.tsx`

- [ ] **Step 1: Replace the broken `AuditEntry` interface**

In `packages/ui/src/ipc/types.ts`, the existing block (lines 76–83 today) reads:

```ts
export interface AuditEntry {
  id: number;
  ts: string;
  action: string;
  outcome: "approved" | "rejected" | "auto" | "info";
  subject?: string;
  hitlRejectReason?: string;
}
```

Replace it with the Gateway wire shape (matches `LocalIndex.listAudit` in `packages/gateway/src/index/local-index.ts:920`):

```ts
/**
 * Wire shape of `audit.list` — mirrors the Gateway's `AuditEntry` exported from
 * `packages/gateway/src/index/local-index.ts`. Distinct from `AuditExportRow` (the
 * `audit.export` shape with `rowHash` + `prevHash`), which is added in this plan.
 *
 * Field names match the underlying SQLite columns: `actionType`, `hitlStatus`,
 * `actionJson`, `timestamp` (ms epoch). Display logic (e.g., splitting
 * `actionType` into service + action, or extracting `actor` from `actionJson`)
 * lives in the consumer, not the wire shape.
 */
export interface AuditEntry {
  readonly id: number;
  readonly actionType: string;
  readonly hitlStatus: "approved" | "rejected" | "not_required";
  readonly actionJson: string;
  /** Milliseconds since the Unix epoch. */
  readonly timestamp: number;
}
```

- [ ] **Step 2: Update `AuditFeed.tsx` to read the correct fields**

Replace the entire contents of `packages/ui/src/components/dashboard/AuditFeed.tsx` with:

```tsx
import type { ReactNode } from "react";
import { useIpcQuery } from "../../hooks/useIpcQuery";
import type { AuditEntry } from "../../ipc/types";

function formatTime(ms: number): string {
  const d = new Date(ms);
  return Number.isNaN(d.getTime())
    ? "--:--"
    : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

function outcomeColour(o: AuditEntry["hitlStatus"]): string {
  switch (o) {
    case "approved":
      return "text-[var(--color-ok)]";
    case "rejected":
      return "text-[var(--color-error)]";
    case "not_required":
      return "text-[var(--color-accent)]";
    default:
      return "text-[var(--color-fg-muted)]";
  }
}

/** Best-effort `subject` extraction from `actionJson`; never throws. */
function extractSubject(actionJson: string): string | undefined {
  if (actionJson === "" || actionJson === "{}") return undefined;
  try {
    const parsed = JSON.parse(actionJson) as unknown;
    if (parsed !== null && typeof parsed === "object" && "subject" in parsed) {
      const subject = (parsed as { subject: unknown }).subject;
      if (typeof subject === "string" && subject !== "") return subject;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

export function AuditFeed(): ReactNode {
  const { data } = useIpcQuery<AuditEntry[]>("audit.list", 10_000, { limit: 25 });
  const entries = data ?? [];
  if (entries.length === 0) {
    return (
      <section aria-label="Recent activity" className="text-[var(--color-fg-muted)] text-sm">
        No recent activity.
      </section>
    );
  }
  return (
    <section
      aria-label="Recent activity"
      className="max-h-80 overflow-auto border border-[var(--color-border)] rounded-md"
    >
      <ul className="divide-y divide-[var(--color-border)]">
        {entries.map((e) => {
          const subject = extractSubject(e.actionJson);
          return (
            <li key={e.id} className="px-3 py-2 flex items-center gap-3 text-xs">
              <time className="text-[var(--color-fg-muted)] w-12 font-mono">
                {formatTime(e.timestamp)}
              </time>
              <span className="text-[var(--color-fg)]">{e.actionType}</span>
              {subject !== undefined && (
                <span className="text-[var(--color-fg-muted)] truncate">{subject}</span>
              )}
              <span className={`ml-auto ${outcomeColour(e.hitlStatus)}`}>{e.hitlStatus}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

- [ ] **Step 3: Update `AuditFeed.test.tsx` to use real wire-shape mocks**

Replace the entire contents of `packages/ui/test/components/dashboard/AuditFeed.test.tsx` with:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuditFeed } from "../../../src/components/dashboard/AuditFeed";

const hookState = { data: null as unknown, error: null as string | null, isLoading: false };
vi.mock("../../../src/hooks/useIpcQuery", () => ({ useIpcQuery: () => hookState }));

describe("AuditFeed", () => {
  it("renders recent entries using the Gateway wire shape", () => {
    hookState.data = [
      {
        id: 1,
        actionType: "file.create",
        hitlStatus: "approved",
        actionJson: JSON.stringify({ subject: "doc.md" }),
        timestamp: Date.now(),
      },
      {
        id: 2,
        actionType: "email.draft.send",
        hitlStatus: "rejected",
        actionJson: JSON.stringify({ subject: "to:a@b" }),
        timestamp: Date.now(),
      },
      {
        id: 3,
        actionType: "startup",
        hitlStatus: "not_required",
        actionJson: "{}",
        timestamp: Date.now(),
      },
    ];
    render(<AuditFeed />);
    expect(screen.getByText("file.create")).toBeInTheDocument();
    expect(screen.getByText("email.draft.send")).toBeInTheDocument();
    expect(screen.getByText("startup")).toBeInTheDocument();
    expect(screen.getByText("approved")).toBeInTheDocument();
    expect(screen.getByText("rejected")).toBeInTheDocument();
    expect(screen.getByText("not_required")).toBeInTheDocument();
    expect(screen.getByText("doc.md")).toBeInTheDocument();
  });

  it("shows empty state when no entries", () => {
    hookState.data = [];
    render(<AuditFeed />);
    expect(screen.getByText(/No recent activity/i)).toBeInTheDocument();
  });

  it("handles malformed actionJson gracefully (no subject rendered)", () => {
    hookState.data = [
      {
        id: 1,
        actionType: "weird.entry",
        hitlStatus: "approved",
        actionJson: "not json",
        timestamp: Date.now(),
      },
    ];
    render(<AuditFeed />);
    expect(screen.getByText("weird.entry")).toBeInTheDocument();
    expect(screen.getByText("approved")).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run the affected tests**

```bash
cd packages/ui && bunx vitest run test/components/dashboard/AuditFeed.test.tsx && cd ../..
```

Expected: 3 tests passed.

- [ ] **Step 5: Commit Phase 1.5**

```bash
git add packages/ui/src/ipc/types.ts \
        packages/ui/src/components/dashboard/AuditFeed.tsx \
        packages/ui/test/components/dashboard/AuditFeed.test.tsx
git commit -m "fix(ui): align AuditEntry with Gateway wire shape; fix AuditFeed mapping"
```

---

## Phase 2 — Audit slice (transient, filter state + summary cache)

The Audit panel keeps its filter state and the latest `auditGetSummary()` snapshot in a dedicated transient slice. **Nothing is persisted** — `partialize.ts` is unchanged.

### Task 6: Create `packages/ui/src/store/slices/audit.ts`

**Files:**
- Create: `packages/ui/src/store/slices/audit.ts`

- [ ] **Step 1: Write the slice**

```ts
import type { StateCreator } from "zustand";
import type { AuditSummary } from "../../ipc/types";

/** Outcome filter values match the Gateway `hitl_status` column verbatim, plus "all". */
export type AuditOutcomeFilter = "all" | "approved" | "rejected" | "not_required";

export interface AuditFilter {
  /** First-segment service name (e.g., "github" derived from "github.sync"); empty string = no service filter. */
  readonly service: string;
  readonly outcome: AuditOutcomeFilter;
  /** Inclusive lower bound, ms epoch. `null` = no lower bound. */
  readonly sinceMs: number | null;
  /** Inclusive upper bound, ms epoch. `null` = no upper bound. */
  readonly untilMs: number | null;
}

export interface AuditSlice {
  readonly auditFilter: AuditFilter;
  /** Latest snapshot of `audit.getSummary` — `null` until first fetch completes. Transient. */
  readonly auditSummary: AuditSummary | null;
  /** Transient — `true` while `audit.verify` or `audit.export` is in flight. */
  readonly auditActionInFlight: boolean;
  setAuditFilter: (next: Partial<AuditFilter>) => void;
  resetAuditFilter: () => void;
  setAuditSummary: (snapshot: AuditSummary | null) => void;
  setAuditActionInFlight: (inFlight: boolean) => void;
}

const DEFAULT_FILTER: AuditFilter = {
  service: "",
  outcome: "all",
  sinceMs: null,
  untilMs: null,
};

export const createAuditSlice: StateCreator<AuditSlice, [], [], AuditSlice> = (set) => ({
  auditFilter: DEFAULT_FILTER,
  auditSummary: null,
  auditActionInFlight: false,
  setAuditFilter: (next) =>
    set((s) => ({ auditFilter: { ...s.auditFilter, ...next } })),
  resetAuditFilter: () => set({ auditFilter: DEFAULT_FILTER }),
  setAuditSummary: (snapshot) => set({ auditSummary: snapshot }),
  setAuditActionInFlight: (inFlight) => set({ auditActionInFlight: inFlight }),
});
```

- [ ] **Step 2: Wire the slice into the root store**

In `packages/ui/src/store/index.ts`:

Add an alphabetically-placed import. `audit` sorts before `connection`, so it becomes the very first slice import. The exact line block should read:

```ts
import { type AuditSlice, createAuditSlice } from "./slices/audit";
import { type ConnectionSlice, createConnectionSlice } from "./slices/connection";
import { type ConnectorsSlice, createConnectorsSlice } from "./slices/connectors";
import { createDashboardSlice, type DashboardSlice } from "./slices/dashboard";
```

Extend the `NimbusStore` type by appending `& AuditSlice`:

```ts
export type NimbusStore = ConnectionSlice &
  TraySlice &
  QuickQuerySlice &
  OnboardingSlice &
  DashboardSlice &
  HitlSlice &
  SettingsSlice &
  ProfileSlice &
  TelemetrySlice &
  ConnectorsSlice &
  ModelSlice &
  AuditSlice;
```

In the `create<NimbusStore>()(persist((...a) => ({ ... }), ...))` block, add `...createAuditSlice(...a),` immediately after `...createModelSlice(...a),`:

```ts
      ...createModelSlice(...a),
      ...createAuditSlice(...a),
```

- [ ] **Step 3: Verify**

```bash
cd packages/ui && bunx tsc --noEmit && cd ../..
```

Expected: exit 0.

### Task 7: Add Vitest spec for the audit slice

**Files:**
- Create: `packages/ui/test/store/slices/audit.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, expect, it } from "vitest";
import { create } from "zustand";
import { type AuditSlice, createAuditSlice } from "../../../src/store/slices/audit";

function makeStore() {
  return create<AuditSlice>()((...a) => ({ ...createAuditSlice(...a) }));
}

describe("audit slice", () => {
  it("seeds with the default filter and null summary", () => {
    const store = makeStore();
    const s = store.getState();
    expect(s.auditFilter).toEqual({ service: "", outcome: "all", sinceMs: null, untilMs: null });
    expect(s.auditSummary).toBeNull();
    expect(s.auditActionInFlight).toBe(false);
  });

  it("setAuditFilter merges patches without dropping unspecified fields", () => {
    const store = makeStore();
    store.getState().setAuditFilter({ service: "github" });
    expect(store.getState().auditFilter.service).toBe("github");
    expect(store.getState().auditFilter.outcome).toBe("all");
    store.getState().setAuditFilter({ outcome: "rejected" });
    expect(store.getState().auditFilter.service).toBe("github");
    expect(store.getState().auditFilter.outcome).toBe("rejected");
  });

  it("resetAuditFilter restores defaults", () => {
    const store = makeStore();
    store.getState().setAuditFilter({ service: "github", outcome: "approved", sinceMs: 1, untilMs: 2 });
    store.getState().resetAuditFilter();
    expect(store.getState().auditFilter).toEqual({ service: "", outcome: "all", sinceMs: null, untilMs: null });
  });

  it("setAuditSummary swaps the snapshot reference", () => {
    const store = makeStore();
    const snap = { byOutcome: { approved: 3 }, byService: { github: 2 }, total: 3 };
    store.getState().setAuditSummary(snap);
    expect(store.getState().auditSummary).toBe(snap);
  });

  it("setAuditActionInFlight toggles the boolean", () => {
    const store = makeStore();
    store.getState().setAuditActionInFlight(true);
    expect(store.getState().auditActionInFlight).toBe(true);
    store.getState().setAuditActionInFlight(false);
    expect(store.getState().auditActionInFlight).toBe(false);
  });
});
```

- [ ] **Step 2: Run test**

```bash
cd packages/ui && bunx vitest run test/store/slices/audit.test.ts && cd ../..
```

Expected: 5 tests passed.

- [ ] **Step 3: Commit Phase 2**

```bash
git add packages/ui/src/store/slices/audit.ts packages/ui/src/store/index.ts \
        packages/ui/test/store/slices/audit.test.ts
git commit -m "feat(ui-store): add audit slice (filter state + summary cache, transient)"
```

---

## Phase 3 — Audit panel

The Audit panel renders a virtualized list of audit rows, three filter chips (service / outcome / date range), a "Verify chain" button that surfaces a toast, and an "Export…" button that opens the native save dialog with `.json` / `.csv` format filters and writes the file via `tauri-plugin-fs`.

### Task 8: Add `tauri-plugin-fs` dependency + capability

**Files:**
- Modify: `packages/ui/package.json`
- Modify: `packages/ui/src-tauri/Cargo.toml`
- Modify: `packages/ui/src-tauri/capabilities/default.json`
- Modify: `packages/ui/src-tauri/src/lib.rs`

- [ ] **Step 1: Add the JS plugin**

```bash
cd packages/ui && bun add @tauri-apps/plugin-fs@^2 && cd ../..
```

This adds `"@tauri-apps/plugin-fs": "^2"` to `packages/ui/package.json` `dependencies`. Verify by reading the diff:

```bash
git diff packages/ui/package.json
```

Expected: only the `@tauri-apps/plugin-fs` line is added; no other dep changes.

- [ ] **Step 2: Add the Rust crate**

In `packages/ui/src-tauri/Cargo.toml`, the `[dependencies]` table contains `tauri-plugin-dialog = "2"` (line 28). Immediately after that line, add:

```toml
tauri-plugin-fs = "2"
```

- [ ] **Step 3: Register the plugin in `lib.rs`**

In `packages/ui/src-tauri/src/lib.rs`, the `tauri::Builder::default()` chain registers plugins on lines 12–15. Insert `tauri_plugin_fs::init()` between `tauri_plugin_dialog::init()` and `tauri_plugin_clipboard_manager::init()` (alphabetical-ish order, matching the existing convention):

```rust
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
```

- [ ] **Step 4: Grant the narrow `fs:allow-write-text-file` capability**

In `packages/ui/src-tauri/capabilities/default.json`, the `"permissions"` array currently ends with `"dialog:allow-save"` and `"dialog:allow-open"`. Append `"fs:allow-write-text-file"` to the array:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capabilities for Nimbus Desktop",
  "windows": ["main", "quick-query", "hitl-popup"],
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
    "global-shortcut:allow-unregister",
    "clipboard-manager:allow-write-text",
    "clipboard-manager:allow-clear",
    "dialog:allow-save",
    "dialog:allow-open",
    "fs:allow-write-text-file"
  ]
}
```

`fs:allow-write-text-file` grants exactly one operation (write a UTF-8 text file at a path); read, append, and binary-write surfaces remain forbidden. This is the minimum necessary for `.json` / `.csv` export.

- [ ] **Step 5: Verify the build still compiles**

```bash
cd packages/ui/src-tauri && cargo build && cd ../../..
```

Expected: exit 0. (First build will pull `tauri-plugin-fs` from crates.io; subsequent builds are cached.)

### Task 9: Build the audit-row helpers (`packages/ui/src/pages/settings/audit/audit-row-utils.ts`)

These are the pure helpers the panel and the CSV exporter both share. Putting them in their own file keeps the panel test surface bounded and lets the CSV-flattening logic be unit-tested independently.

**Files:**
- Create: `packages/ui/src/pages/settings/audit/audit-row-utils.ts`

- [ ] **Step 1: Write the helpers**

```ts
import type { AuditExportRow } from "../../../ipc/types";

export interface AuditDisplayRow {
  readonly id: number;
  /** ISO timestamp string from the wire `timestamp` ms epoch. */
  readonly tsIso: string;
  /** First segment of `actionType` (e.g., "github.sync" → "github"). Falls back to the full string. */
  readonly service: string;
  /** Remainder of `actionType` after the first dot (e.g., "github.sync" → "sync"). Falls back to the full string. */
  readonly action: string;
  /** Mirrors the wire `hitlStatus`. */
  readonly outcome: "approved" | "rejected" | "not_required";
  /** Parsed `actor` field from `actionJson`, or empty string when absent / parse fails. */
  readonly actor: string;
  /** Echoes the wire `rowHash` (omit for `audit.list` rows that don't carry it). */
  readonly rowHash: string;
}

/** Splits `actionType` into `{ service, action }` using the first `.`. */
export function splitActionType(actionType: string): { service: string; action: string } {
  const dot = actionType.indexOf(".");
  if (dot === -1) return { service: actionType, action: actionType };
  return { service: actionType.slice(0, dot), action: actionType.slice(dot + 1) };
}

/** Best-effort actor extraction from a JSON-encoded action payload. Never throws. */
export function extractActor(actionJson: string): string {
  if (actionJson === "" || actionJson === "{}") return "";
  try {
    const parsed = JSON.parse(actionJson) as unknown;
    if (parsed !== null && typeof parsed === "object" && "actor" in parsed) {
      const actor = (parsed as { actor: unknown }).actor;
      if (typeof actor === "string") return actor;
    }
  } catch {
    /* ignore */
  }
  return "";
}

/** Materialises a wire `audit.export` row into the display shape. */
export function toDisplayRow(row: AuditExportRow): AuditDisplayRow {
  const { service, action } = splitActionType(row.actionType);
  return {
    id: row.id,
    tsIso: new Date(row.timestamp).toISOString(),
    service,
    action,
    outcome: row.hitlStatus,
    actor: extractActor(row.actionJson),
    rowHash: row.rowHash,
  };
}

/** RFC 4180 — quote a field if it contains `,`, `"`, or any newline; double interior `"`. */
export function csvEscape(field: string): string {
  if (field === "") return "";
  const needsQuote = /[",\r\n]/.test(field);
  const escaped = field.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}

/**
 * Flattens `audit.export` rows into a CSV string with the fixed 6-column whitelist
 * `timestamp,service,actor,action,outcome,rowHash` — matching the spec §2.1 contract.
 * Nested payload blobs in `actionJson` are dropped on purpose (preserved in the JSON
 * export path). The header row is always emitted, even for an empty result set.
 */
export function rowsToCsv(rows: ReadonlyArray<AuditExportRow>): string {
  const header = "timestamp,service,actor,action,outcome,rowHash";
  const lines = rows.map((r) => {
    const d = toDisplayRow(r);
    return [d.tsIso, d.service, d.actor, d.action, d.outcome, d.rowHash]
      .map(csvEscape)
      .join(",");
  });
  return [header, ...lines].join("\n");
}
```

- [ ] **Step 2: Add a Vitest spec**

Create `packages/ui/test/pages/settings/audit/audit-row-utils.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  csvEscape,
  extractActor,
  rowsToCsv,
  splitActionType,
  toDisplayRow,
} from "../../../../src/pages/settings/audit/audit-row-utils";

const baseRow = {
  id: 1,
  actionType: "github.sync",
  hitlStatus: "approved" as const,
  actionJson: '{"actor":"alice"}',
  timestamp: 1745126400000, // 2025-04-20T08:00:00.000Z
  rowHash: "abc",
  prevHash: "0",
};

describe("splitActionType", () => {
  it("splits on the first dot", () => {
    expect(splitActionType("github.sync")).toEqual({ service: "github", action: "sync" });
  });

  it("returns the full string for both halves when there is no dot", () => {
    expect(splitActionType("startup")).toEqual({ service: "startup", action: "startup" });
  });

  it("preserves dotted suffixes", () => {
    expect(splitActionType("data.export.completed")).toEqual({
      service: "data",
      action: "export.completed",
    });
  });
});

describe("extractActor", () => {
  it("returns an empty string for empty/{} payloads", () => {
    expect(extractActor("")).toBe("");
    expect(extractActor("{}")).toBe("");
  });

  it("returns the `actor` field when present and a string", () => {
    expect(extractActor('{"actor":"alice"}')).toBe("alice");
  });

  it("returns an empty string when JSON parse fails", () => {
    expect(extractActor("not json")).toBe("");
  });

  it("returns an empty string when actor is non-string", () => {
    expect(extractActor('{"actor":42}')).toBe("");
  });
});

describe("toDisplayRow", () => {
  it("materialises every field including ISO timestamp", () => {
    const d = toDisplayRow(baseRow);
    expect(d).toEqual({
      id: 1,
      tsIso: "2025-04-20T04:00:00.000Z", // depends on TZ; equality computed below
      service: "github",
      action: "sync",
      outcome: "approved",
      actor: "alice",
      rowHash: "abc",
    });
    // Replace the TZ-sensitive expected value with a compute:
    expect(d.tsIso).toBe(new Date(baseRow.timestamp).toISOString());
  });
});

describe("csvEscape", () => {
  it("returns empty for empty", () => {
    expect(csvEscape("")).toBe("");
  });

  it("does not quote plain text", () => {
    expect(csvEscape("hello")).toBe("hello");
  });

  it("quotes when comma present", () => {
    expect(csvEscape("a,b")).toBe('"a,b"');
  });

  it("quotes and doubles interior quote", () => {
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  });

  it("quotes on CR/LF", () => {
    expect(csvEscape("a\nb")).toBe('"a\nb"');
  });
});

describe("rowsToCsv", () => {
  it("emits header even for empty input", () => {
    expect(rowsToCsv([])).toBe("timestamp,service,actor,action,outcome,rowHash");
  });

  it("emits header + one row for one input", () => {
    const csv = rowsToCsv([baseRow]);
    const [header, line] = csv.split("\n");
    expect(header).toBe("timestamp,service,actor,action,outcome,rowHash");
    expect(line).toBe(`${new Date(baseRow.timestamp).toISOString()},github,alice,sync,approved,abc`);
  });

  it("escapes commas inside fields", () => {
    const csv = rowsToCsv([{ ...baseRow, actionJson: '{"actor":"a,b"}' }]);
    const [, line] = csv.split("\n");
    expect(line.split(",").length).toBeGreaterThan(6); // because of the embedded comma being quoted
    expect(line).toContain('"a,b"');
  });
});
```

- [ ] **Step 3: Run test**

```bash
cd packages/ui && bunx vitest run test/pages/settings/audit/audit-row-utils.test.ts && cd ../..
```

Expected: 16 tests passed.

### Task 10: Build the `AuditFilterChips` component

A small, self-contained component for the three filter inputs. Lives in its own file so the panel test stays focused.

**Files:**
- Create: `packages/ui/src/components/settings/audit/AuditFilterChips.tsx`

- [ ] **Step 1: Write the component**

```tsx
import type { ReactNode } from "react";
import type { AuditFilter, AuditOutcomeFilter } from "../../../store/slices/audit";

interface Props {
  readonly filter: AuditFilter;
  /** All distinct service names harvested from the current row set, sorted ascending. */
  readonly availableServices: ReadonlyArray<string>;
  readonly onChange: (patch: Partial<AuditFilter>) => void;
  readonly onReset: () => void;
  readonly disabled?: boolean;
}

/** Convert "" or undefined to `null` for the date inputs; ISO 8601 date string → ms epoch otherwise. */
function dateInputToMs(value: string): number | null {
  if (value === "") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function msToDateInput(ms: number | null): string {
  if (ms === null) return "";
  // <input type="date"> wants YYYY-MM-DD in local time.
  const d = new Date(ms);
  const yyyy = d.getFullYear().toString().padStart(4, "0");
  const mm = (d.getMonth() + 1).toString().padStart(2, "0");
  const dd = d.getDate().toString().padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

const OUTCOMES: ReadonlyArray<AuditOutcomeFilter> = ["all", "approved", "rejected", "not_required"];

export function AuditFilterChips({
  filter,
  availableServices,
  onChange,
  onReset,
  disabled,
}: Props): ReactNode {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      <label className="text-xs flex items-center gap-1">
        <span>Service</span>
        <select
          aria-label="Service filter"
          value={filter.service}
          disabled={disabled}
          onChange={(e) => onChange({ service: e.target.value })}
          className="border border-[var(--color-border)] bg-[var(--color-bg)] rounded px-1 py-0.5"
        >
          <option value="">all</option>
          {availableServices.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      <label className="text-xs flex items-center gap-1">
        <span>Outcome</span>
        <select
          aria-label="Outcome filter"
          value={filter.outcome}
          disabled={disabled}
          onChange={(e) => onChange({ outcome: e.target.value as AuditOutcomeFilter })}
          className="border border-[var(--color-border)] bg-[var(--color-bg)] rounded px-1 py-0.5"
        >
          {OUTCOMES.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>

      <label className="text-xs flex items-center gap-1">
        <span>Since</span>
        <input
          type="date"
          aria-label="Since (date filter)"
          value={msToDateInput(filter.sinceMs)}
          disabled={disabled}
          onChange={(e) => onChange({ sinceMs: dateInputToMs(e.target.value) })}
          className="border border-[var(--color-border)] bg-[var(--color-bg)] rounded px-1 py-0.5"
        />
      </label>

      <label className="text-xs flex items-center gap-1">
        <span>Until</span>
        <input
          type="date"
          aria-label="Until (date filter)"
          value={msToDateInput(filter.untilMs)}
          disabled={disabled}
          onChange={(e) => onChange({ untilMs: dateInputToMs(e.target.value) })}
          className="border border-[var(--color-border)] bg-[var(--color-bg)] rounded px-1 py-0.5"
        />
      </label>

      <button
        type="button"
        onClick={onReset}
        disabled={disabled}
        className="text-xs underline text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
      >
        Reset
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

```bash
cd packages/ui && bunx tsc --noEmit && cd ../..
```

Expected: exit 0. (No dedicated component test — the chip behaviour is exercised inside the panel test in Task 11.)

### Task 11: Build the `AuditPanel` page

**Files:**
- Create: `packages/ui/src/pages/settings/AuditPanel.tsx`
- Modify: `packages/ui/src/App.tsx`

- [ ] **Step 1: Write the panel**

```tsx
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FixedSizeList, type ListChildComponentProps } from "react-window";
import { PanelError } from "../../components/settings/PanelError";
import { PanelHeader } from "../../components/settings/PanelHeader";
import { StaleChip } from "../../components/settings/StaleChip";
import { AuditFilterChips } from "../../components/settings/audit/AuditFilterChips";
import { useIpcQuery } from "../../hooks/useIpcQuery";
import { useIpcSubscription } from "../../hooks/useIpcSubscription";
import { createIpcClient } from "../../ipc/client";
import type {
  AuditExportRow,
  AuditVerifyResult,
  JsonRpcNotification,
} from "../../ipc/types";
import {
  rowsToCsv,
  splitActionType,
  toDisplayRow,
} from "./audit/audit-row-utils";
import { useNimbusStore } from "../../store";

const ROW_HEIGHT = 32;
const LIST_HEIGHT = 480;
const POLL_MS = 60_000;
const MAX_ROWS = 1_000;

interface ToastState {
  readonly kind: "success" | "error" | "info";
  readonly text: string;
}

function VerifyToast({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  const colorClass =
    toast.kind === "success"
      ? "bg-green-700"
      : toast.kind === "error"
        ? "bg-red-700"
        : "bg-blue-700";
  return (
    <div
      role="status"
      aria-live="polite"
      className={`mt-3 rounded px-3 py-2 text-sm text-white flex items-start justify-between ${colorClass}`}
    >
      <span data-testid="audit-toast-text">{toast.text}</span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="ml-2 underline"
      >
        ×
      </button>
    </div>
  );
}

export function AuditPanel() {
  const connectionState = useNimbusStore((s) => s.connectionState);
  const filter = useNimbusStore((s) => s.auditFilter);
  const summary = useNimbusStore((s) => s.auditSummary);
  const inFlight = useNimbusStore((s) => s.auditActionInFlight);
  const setFilter = useNimbusStore((s) => s.setAuditFilter);
  const resetFilter = useNimbusStore((s) => s.resetAuditFilter);
  const setSummary = useNimbusStore((s) => s.setAuditSummary);
  const setInFlight = useNimbusStore((s) => s.setAuditActionInFlight);
  const offline = connectionState === "disconnected";
  const writeDisabled = offline || inFlight;

  const [toast, setToast] = useState<ToastState | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // 60 s polling for the row list — gives near-real-time visibility without thrashing.
  const { data: rawRows, error: listError, refetch: refetchList } = useIpcQuery<
    Array<{
      id: number;
      actionType: string;
      hitlStatus: "approved" | "rejected" | "not_required";
      actionJson: string;
      timestamp: number;
    }>
  >("audit.list", POLL_MS, { limit: MAX_ROWS });

  // Summary refresh whenever the row count changes (cheap server-side aggregation).
  const refreshSummary = useCallback(async () => {
    try {
      const next = await createIpcClient().auditGetSummary();
      setSummary(next);
    } catch {
      // Summary failure is non-fatal — keep the prior snapshot, just don't update it.
    }
  }, [setSummary]);

  useEffect(() => {
    void refreshSummary();
  }, [refreshSummary, rawRows?.length]);

  // New audit rows arriving via the gateway notification channel → refetch list immediately.
  // Filter on the message method so we don't re-fetch on unrelated traffic.
  const onNotification = useCallback(
    (n: JsonRpcNotification) => {
      if (n.method === "audit.entryAppended" || n.method === "data.delete.completed") {
        refetchList();
      }
    },
    [refetchList],
  );
  useIpcSubscription<JsonRpcNotification>("gateway://notification", onNotification);

  const displayRows = useMemo(() => {
    if (rawRows === null) return [];
    return rawRows.map((r) => {
      const { service, action } = splitActionType(r.actionType);
      return {
        id: r.id,
        tsIso: new Date(r.timestamp).toISOString(),
        service,
        action,
        outcome: r.hitlStatus,
        rowHash: "", // not present in `audit.list`; populated only in the export pipeline
        actor: "",
      };
    });
  }, [rawRows]);

  const filteredRows = useMemo(() => {
    return displayRows.filter((row) => {
      if (filter.service !== "" && row.service !== filter.service) return false;
      if (filter.outcome !== "all" && row.outcome !== filter.outcome) return false;
      const ms = Date.parse(row.tsIso);
      if (filter.sinceMs !== null && ms < filter.sinceMs) return false;
      if (filter.untilMs !== null && ms > filter.untilMs + 86_399_000) return false; // inclusive end-of-day
      return true;
    });
  }, [displayRows, filter]);

  const availableServices = useMemo(() => {
    const set = new Set<string>();
    for (const r of displayRows) set.add(r.service);
    return Array.from(set).sort();
  }, [displayRows]);

  const onVerify = useCallback(async () => {
    setInFlight(true);
    setToast({ kind: "info", text: "Verifying audit chain…" });
    try {
      const result: AuditVerifyResult = await createIpcClient().auditVerify(true);
      if (result.ok) {
        setToast({
          kind: "success",
          text: `Chain verified — ${result.totalChecked} rows through id ${result.lastVerifiedId}.`,
        });
      } else {
        setToast({
          kind: "error",
          text: `Chain BROKEN at id ${result.brokenAtId}: expected ${result.expectedHash.slice(0, 12)}…, got ${result.actualHash.slice(0, 12)}…`,
        });
      }
    } catch (e) {
      setToast({ kind: "error", text: `Verify failed: ${(e as Error).message}` });
    } finally {
      setInFlight(false);
    }
  }, [setInFlight]);

  const onExport = useCallback(async () => {
    setInFlight(true);
    setExportError(null);
    try {
      const path = await save({
        title: "Export audit log",
        defaultPath: `audit-${Date.now()}.json`,
        filters: [
          { name: "JSON", extensions: ["json"] },
          { name: "CSV", extensions: ["csv"] },
        ],
      });
      if (path === null) return; // user cancelled
      const rows: ReadonlyArray<AuditExportRow> = await createIpcClient().auditExport();
      const isCsv = path.toLowerCase().endsWith(".csv");
      const contents = isCsv
        ? rowsToCsv(rows)
        : JSON.stringify(rows.map(toDisplayRow), null, 2);
      await writeTextFile(path, contents);
      setToast({ kind: "success", text: `Exported ${rows.length} rows to ${path}` });
    } catch (e) {
      setExportError((e as Error).message);
    } finally {
      setInFlight(false);
    }
  }, [setInFlight]);

  const Row = useCallback(
    ({ index, style }: ListChildComponentProps) => {
      const row = filteredRows[index];
      if (!row) return null;
      return (
        <div
          style={style}
          className="grid grid-cols-[180px_120px_1fr_100px] items-center px-3 text-xs border-b border-[var(--color-border)]"
          data-testid="audit-row"
        >
          <span className="font-mono text-[var(--color-text-muted)]">{row.tsIso}</span>
          <span className="font-medium">{row.service}</span>
          <span>{row.action}</span>
          <span
            className={
              row.outcome === "rejected"
                ? "text-red-500 font-medium"
                : row.outcome === "approved"
                  ? "text-green-600 font-medium"
                  : "text-[var(--color-text-muted)]"
            }
          >
            {row.outcome}
          </span>
        </div>
      );
    },
    [filteredRows],
  );

  return (
    <section className="p-6 space-y-3">
      <PanelHeader
        title="Audit"
        description="Tamper-evident BLAKE3-chained audit log. Up to 1,000 most recent rows shown; verify or export the full chain below."
        livePill={offline ? <StaleChip /> : undefined}
      />

      {summary !== null && (
        <div className="text-xs text-[var(--color-text-muted)]">
          Total rows: {summary.total} · approved: {summary.byOutcome.approved ?? 0} · rejected: {summary.byOutcome.rejected ?? 0} · auto: {summary.byOutcome.not_required ?? 0}
        </div>
      )}

      <AuditFilterChips
        filter={filter}
        availableServices={availableServices}
        onChange={setFilter}
        onReset={resetFilter}
        disabled={offline}
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void onVerify()}
          disabled={writeDisabled}
          className="px-3 py-1.5 text-sm rounded bg-[var(--color-accent)] text-white disabled:opacity-50"
        >
          Verify chain
        </button>
        <button
          type="button"
          onClick={() => void onExport()}
          disabled={writeDisabled}
          className="px-3 py-1.5 text-sm rounded border border-[var(--color-border)] disabled:opacity-50"
        >
          Export…
        </button>
        <span className="text-xs text-[var(--color-text-muted)]">
          {filteredRows.length} of {displayRows.length} rows
        </span>
      </div>

      {listError !== null && (
        <PanelError message={`Failed to load audit log: ${listError}`} onRetry={() => refetchList()} />
      )}
      {exportError !== null && (
        <PanelError message={`Export failed: ${exportError}`} onRetry={() => setExportError(null)} />
      )}
      {toast !== null && <VerifyToast toast={toast} onDismiss={() => setToast(null)} />}

      <div className="border border-[var(--color-border)] rounded">
        <div className="grid grid-cols-[180px_120px_1fr_100px] px-3 py-1.5 text-xs font-semibold border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)]">
          <span>Timestamp</span>
          <span>Service</span>
          <span>Action</span>
          <span>Outcome</span>
        </div>
        <FixedSizeList
          height={LIST_HEIGHT}
          itemCount={filteredRows.length}
          itemSize={ROW_HEIGHT}
          width="100%"
        >
          {Row}
        </FixedSizeList>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Wire the route in `App.tsx`**

In `packages/ui/src/App.tsx`:

Add the import next to the other settings-panel imports (alphabetical):

```ts
import { AuditPanel } from "./pages/settings/AuditPanel";
```

Replace the existing route line:

```tsx
<Route path="audit" element={<PanelComingSoon title="Audit" />} />
```

with:

```tsx
<Route path="audit" element={<AuditPanel />} />
```

- [ ] **Step 3: Verify the panel compiles**

```bash
cd packages/ui && bunx tsc --noEmit && cd ../..
```

Expected: exit 0.

### Task 12: Add Vitest spec for the audit panel

**Files:**
- Create: `packages/ui/test/pages/settings/AuditPanel.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/ipc/client");
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  writeTextFile: vi.fn(),
}));

import {
  auditExportMock,
  auditGetSummaryMock,
  auditVerifyMock,
  callMock,
} from "../../../src/ipc/__mocks__/client";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { AuditPanel } from "../../../src/pages/settings/AuditPanel";
import { useNimbusStore } from "../../../src/store";

const saveMock = vi.mocked(save);
const writeTextFileMock = vi.mocked(writeTextFile);

const SAMPLE_ROWS = [
  { id: 3, actionType: "github.sync", hitlStatus: "approved" as const, actionJson: "{}", timestamp: 1745126400000 },
  { id: 2, actionType: "data.delete", hitlStatus: "rejected" as const, actionJson: "{}", timestamp: 1745122800000 },
  { id: 1, actionType: "startup", hitlStatus: "not_required" as const, actionJson: "{}", timestamp: 1745119200000 },
];

beforeEach(() => {
  callMock.mockReset();
  auditGetSummaryMock.mockReset();
  auditVerifyMock.mockReset();
  auditExportMock.mockReset();
  saveMock.mockReset();
  writeTextFileMock.mockReset();
  useNimbusStore.setState({
    connectionState: "connected",
    auditFilter: { service: "", outcome: "all", sinceMs: null, untilMs: null },
    auditSummary: null,
    auditActionInFlight: false,
  } as never);
  callMock.mockImplementation(async (method: string) => {
    if (method === "audit.list") return SAMPLE_ROWS;
    return [];
  });
  auditGetSummaryMock.mockResolvedValue({
    byOutcome: { approved: 1, rejected: 1, not_required: 1 },
    byService: { github: 1, data: 1, startup: 1 },
    total: 3,
  });
});

afterEach(() => {
  useNimbusStore.setState({
    auditFilter: { service: "", outcome: "all", sinceMs: null, untilMs: null },
    auditSummary: null,
    auditActionInFlight: false,
  } as never);
});

describe("AuditPanel", () => {
  it("renders summary and one row per fetched entry", async () => {
    render(<AuditPanel />);
    await waitFor(() => expect(screen.getAllByTestId("audit-row").length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByText(/Total rows: 3/)).toBeTruthy());
    expect(screen.getByText("3 of 3 rows")).toBeTruthy();
  });

  it("filters by service via the chip", async () => {
    render(<AuditPanel />);
    await waitFor(() => expect(screen.getAllByTestId("audit-row").length).toBe(3));
    const select = screen.getByLabelText("Service filter") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "github" } });
    await waitFor(() => expect(screen.getAllByTestId("audit-row").length).toBe(1));
    expect(screen.getByText("1 of 3 rows")).toBeTruthy();
  });

  it("Verify chain success surfaces a green toast", async () => {
    auditVerifyMock.mockResolvedValueOnce({ ok: true, lastVerifiedId: 3, totalChecked: 3 });
    render(<AuditPanel />);
    await waitFor(() => expect(screen.getAllByTestId("audit-row").length).toBe(3));
    fireEvent.click(screen.getByRole("button", { name: "Verify chain" }));
    await waitFor(() =>
      expect(screen.getByTestId("audit-toast-text").textContent).toMatch(/Chain verified/),
    );
  });

  it("Verify chain broken surfaces a red toast with the broken id", async () => {
    auditVerifyMock.mockResolvedValueOnce({
      ok: false,
      brokenAtId: 7,
      expectedHash: "expected_hash_value",
      actualHash: "actual_hash_value",
    });
    render(<AuditPanel />);
    await waitFor(() => expect(screen.getAllByTestId("audit-row").length).toBe(3));
    fireEvent.click(screen.getByRole("button", { name: "Verify chain" }));
    await waitFor(() =>
      expect(screen.getByTestId("audit-toast-text").textContent).toMatch(/BROKEN at id 7/),
    );
  });

  it("Export with .json path writes flattened display rows as JSON", async () => {
    saveMock.mockResolvedValueOnce("/tmp/audit-test.json");
    auditExportMock.mockResolvedValueOnce([
      { id: 3, actionType: "github.sync", hitlStatus: "approved", actionJson: '{"actor":"alice"}', timestamp: 1, rowHash: "abc", prevHash: "0" },
    ]);
    writeTextFileMock.mockResolvedValueOnce(undefined);
    render(<AuditPanel />);
    await waitFor(() => expect(screen.getAllByTestId("audit-row").length).toBe(3));
    fireEvent.click(screen.getByRole("button", { name: "Export…" }));
    await waitFor(() => expect(writeTextFileMock).toHaveBeenCalled());
    const [path, contents] = writeTextFileMock.mock.calls[0]!;
    expect(path).toBe("/tmp/audit-test.json");
    const parsed = JSON.parse(contents as string) as Array<{ service: string; actor: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.service).toBe("github");
    expect(parsed[0]?.actor).toBe("alice");
  });

  it("Export with .csv path writes the 6-column CSV", async () => {
    saveMock.mockResolvedValueOnce("/tmp/audit-test.csv");
    auditExportMock.mockResolvedValueOnce([
      { id: 3, actionType: "github.sync", hitlStatus: "approved", actionJson: '{"actor":"alice"}', timestamp: 1, rowHash: "abc", prevHash: "0" },
    ]);
    writeTextFileMock.mockResolvedValueOnce(undefined);
    render(<AuditPanel />);
    await waitFor(() => expect(screen.getAllByTestId("audit-row").length).toBe(3));
    fireEvent.click(screen.getByRole("button", { name: "Export…" }));
    await waitFor(() => expect(writeTextFileMock).toHaveBeenCalled());
    const [, contents] = writeTextFileMock.mock.calls[0]!;
    const [header, line] = (contents as string).split("\n");
    expect(header).toBe("timestamp,service,actor,action,outcome,rowHash");
    expect(line).toContain("github");
    expect(line).toContain("alice");
    expect(line).toContain("abc");
  });

  it("Export cancelled (save returns null) writes nothing", async () => {
    saveMock.mockResolvedValueOnce(null);
    render(<AuditPanel />);
    await waitFor(() => expect(screen.getAllByTestId("audit-row").length).toBe(3));
    fireEvent.click(screen.getByRole("button", { name: "Export…" }));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(writeTextFileMock).not.toHaveBeenCalled();
    expect(auditExportMock).not.toHaveBeenCalled();
  });

  it("disconnected state disables write buttons", async () => {
    useNimbusStore.setState({ connectionState: "disconnected" } as never);
    render(<AuditPanel />);
    expect((screen.getByRole("button", { name: "Verify chain" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Export…" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run test**

```bash
cd packages/ui && bunx vitest run test/pages/settings/AuditPanel.test.tsx && cd ../..
```

Expected: 8 tests passed.

### Task 13: Commit Phase 3 (Audit panel + plugin-fs dependency)

- [ ] **Step 1: Commit**

```bash
git add packages/ui/package.json \
        packages/ui/src-tauri/Cargo.toml packages/ui/src-tauri/Cargo.lock \
        packages/ui/src-tauri/capabilities/default.json \
        packages/ui/src-tauri/src/lib.rs \
        packages/ui/src/pages/settings/audit/audit-row-utils.ts \
        packages/ui/src/components/settings/audit/AuditFilterChips.tsx \
        packages/ui/src/pages/settings/AuditPanel.tsx \
        packages/ui/src/App.tsx \
        packages/ui/test/pages/settings/audit/audit-row-utils.test.ts \
        packages/ui/test/pages/settings/AuditPanel.test.tsx
git commit -m "feat(ui): Audit panel with virtualized list, filter chips, verify, export (.json/.csv)"
```

(Include `Cargo.lock` if `cargo build` regenerated it during Task 7 step 5.)

---

## Phase 4 — Updater slice (transient state machine)

The updater state is a small finite state machine driven by IPC responses and notification arrivals. It lives in its own transient slice; nothing is persisted (in-flight installs that survive a UI reload are uncommon and the panel always re-fetches `updater.getStatus` on mount).

### Task 14: Create `packages/ui/src/store/slices/updater.ts`

**Files:**
- Create: `packages/ui/src/store/slices/updater.ts`

- [ ] **Step 1: Write the slice**

```ts
import type { StateCreator } from "zustand";
import type {
  UpdaterCheckResult,
  UpdaterDownloadProgressPayload,
  UpdaterRestartingPayload,
  UpdaterRolledBackPayload,
  UpdaterStatus,
  UpdaterVerifyFailedPayload,
} from "../../ipc/types";

/**
 * Local UI-side state machine. A superset of the Gateway's `UpdaterStateName`
 * because the UI layers two extra states on top:
 *
 *   - `available` — `checkNow` returned `updateAvailable: true`; user has not clicked Apply yet.
 *   - `restarting` — `updater.restarting` notification fired; overlay is visible; socket may or may not have closed.
 *   - `reconnecting` — socket has dropped during apply; waiting for reconnect + version check.
 *   - `success` — post-reconnect `diag.getVersion` matched `toVersion`.
 *
 * The Gateway-level states (`idle`, `checking`, `downloading`, `verifying`, `applying`, `rolled_back`, `failed`)
 * are included verbatim so we can mirror `updater.getStatus` directly.
 */
export type UpdaterUiState =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "verifying"
  | "applying"
  | "restarting"
  | "reconnecting"
  | "success"
  | "rolled_back"
  | "failed";

export interface UpdaterSlice {
  /** Mirrors `updater.getStatus`; null until first fetch resolves. Transient. */
  readonly updaterStatus: UpdaterStatus | null;
  /** UI-side state — drives panel render and overlay visibility. Transient. */
  readonly updaterUiState: UpdaterUiState;
  /** Latest `checkNow` result; null until the user has run a check. Transient. */
  readonly updaterCheck: UpdaterCheckResult | null;
  /** Latest `updater.downloadProgress` payload. Transient. */
  readonly updaterDownload: UpdaterDownloadProgressPayload | null;
  /** Set when `updater.restarting` fires — drives overlay copy. Transient. */
  readonly updaterRestarting: UpdaterRestartingPayload | null;
  /** Set when `updater.rolledBack` or `updater.verifyFailed` fires. Transient. */
  readonly updaterFailure:
    | UpdaterRolledBackPayload
    | UpdaterVerifyFailedPayload
    | { reason: "reconnect_timeout" }
    | null;
  setUpdaterStatus: (status: UpdaterStatus | null) => void;
  setUpdaterUiState: (state: UpdaterUiState) => void;
  setUpdaterCheck: (check: UpdaterCheckResult | null) => void;
  setUpdaterDownload: (progress: UpdaterDownloadProgressPayload | null) => void;
  setUpdaterRestarting: (payload: UpdaterRestartingPayload | null) => void;
  setUpdaterFailure: (
    failure:
      | UpdaterRolledBackPayload
      | UpdaterVerifyFailedPayload
      | { reason: "reconnect_timeout" }
      | null,
  ) => void;
  resetUpdaterTransients: () => void;
}

export const createUpdaterSlice: StateCreator<UpdaterSlice, [], [], UpdaterSlice> = (set) => ({
  updaterStatus: null,
  updaterUiState: "idle",
  updaterCheck: null,
  updaterDownload: null,
  updaterRestarting: null,
  updaterFailure: null,
  setUpdaterStatus: (status) => set({ updaterStatus: status }),
  setUpdaterUiState: (state) => set({ updaterUiState: state }),
  setUpdaterCheck: (check) => set({ updaterCheck: check }),
  setUpdaterDownload: (progress) => set({ updaterDownload: progress }),
  setUpdaterRestarting: (payload) => set({ updaterRestarting: payload }),
  setUpdaterFailure: (failure) => set({ updaterFailure: failure }),
  resetUpdaterTransients: () =>
    set({
      updaterUiState: "idle",
      updaterCheck: null,
      updaterDownload: null,
      updaterRestarting: null,
      updaterFailure: null,
    }),
});
```

- [ ] **Step 2: Wire into the root store**

In `packages/ui/src/store/index.ts`:

Add the import alphabetically (after `createTraySlice`):

```ts
import { createTelemetrySlice, type TelemetrySlice } from "./slices/telemetry";
import { createTraySlice, type TraySlice } from "./slices/tray";
import { createUpdaterSlice, type UpdaterSlice } from "./slices/updater";
```

Append `& UpdaterSlice` to the `NimbusStore` type:

```ts
export type NimbusStore = ConnectionSlice &
  TraySlice &
  QuickQuerySlice &
  OnboardingSlice &
  DashboardSlice &
  HitlSlice &
  SettingsSlice &
  ProfileSlice &
  TelemetrySlice &
  ConnectorsSlice &
  ModelSlice &
  AuditSlice &
  UpdaterSlice;
```

In the `create<NimbusStore>` block, after `...createAuditSlice(...a),` add `...createUpdaterSlice(...a),`:

```ts
      ...createAuditSlice(...a),
      ...createUpdaterSlice(...a),
```

- [ ] **Step 3: Verify**

```bash
cd packages/ui && bunx tsc --noEmit && cd ../..
```

Expected: exit 0.

### Task 15: Add Vitest spec for the updater slice

**Files:**
- Create: `packages/ui/test/store/slices/updater.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, expect, it } from "vitest";
import { create } from "zustand";
import {
  type UpdaterSlice,
  createUpdaterSlice,
} from "../../../src/store/slices/updater";

function makeStore() {
  return create<UpdaterSlice>()((...a) => ({ ...createUpdaterSlice(...a) }));
}

describe("updater slice", () => {
  it("seeds idle with all transient fields null", () => {
    const s = makeStore().getState();
    expect(s.updaterUiState).toBe("idle");
    expect(s.updaterStatus).toBeNull();
    expect(s.updaterCheck).toBeNull();
    expect(s.updaterDownload).toBeNull();
    expect(s.updaterRestarting).toBeNull();
    expect(s.updaterFailure).toBeNull();
  });

  it("setters write each field independently", () => {
    const store = makeStore();
    store.getState().setUpdaterStatus({ state: "idle", currentVersion: "0.1.0", configUrl: "u" });
    store.getState().setUpdaterUiState("checking");
    store.getState().setUpdaterCheck({ currentVersion: "0.1.0", latestVersion: "0.2.0", updateAvailable: true });
    store.getState().setUpdaterDownload({ receivedBytes: 100, totalBytes: 200 });
    store.getState().setUpdaterRestarting({ fromVersion: "0.1.0", toVersion: "0.2.0" });
    store.getState().setUpdaterFailure({ reason: "hash_mismatch" });
    const s = store.getState();
    expect(s.updaterStatus?.state).toBe("idle");
    expect(s.updaterUiState).toBe("checking");
    expect(s.updaterCheck?.updateAvailable).toBe(true);
    expect(s.updaterDownload?.receivedBytes).toBe(100);
    expect(s.updaterRestarting?.toVersion).toBe("0.2.0");
    expect(s.updaterFailure).toEqual({ reason: "hash_mismatch" });
  });

  it("resetUpdaterTransients zeroes everything except updaterStatus", () => {
    const store = makeStore();
    store.getState().setUpdaterStatus({ state: "idle", currentVersion: "0.1.0", configUrl: "u" });
    store.getState().setUpdaterUiState("applying");
    store.getState().setUpdaterDownload({ receivedBytes: 1 });
    store.getState().resetUpdaterTransients();
    const s = store.getState();
    expect(s.updaterStatus).not.toBeNull(); // preserved
    expect(s.updaterUiState).toBe("idle");
    expect(s.updaterDownload).toBeNull();
    expect(s.updaterFailure).toBeNull();
  });
});
```

- [ ] **Step 2: Run test**

```bash
cd packages/ui && bunx vitest run test/store/slices/updater.test.ts && cd ../..
```

Expected: 3 tests passed.

- [ ] **Step 3: Commit Phase 4**

```bash
git add packages/ui/src/store/slices/updater.ts packages/ui/src/store/index.ts \
        packages/ui/test/store/slices/updater.test.ts
git commit -m "feat(ui-store): add updater slice (state machine, manifest cache, transient)"
```

---

## Phase 5 — Rust updater module: restart-window watcher

The Updates panel needs to know when the gateway socket disconnects *while an apply is in flight* (so the overlay can transition from "Restarting Nimbus…" to "Reconnecting…") and when the socket comes back (so the panel can call `diag.getVersion`). The cross-window machinery for this is in Rust.

`updater.rs` is small and focused: it owns one watcher lifecycle. The frontend tells it (via a `#[tauri::command]`) "an apply just started" → it begins listening to `gateway://connection-state` transitions and emits three narrow events to the current window. The 2-minute timeout is implemented in the JS panel using `setTimeout`, not Rust — keeping Rust state minimal.

### Task 16: Create `packages/ui/src-tauri/src/updater.rs`

**Files:**
- Create: `packages/ui/src-tauri/src/updater.rs`
- Modify: `packages/ui/src-tauri/src/lib.rs`

- [ ] **Step 1: Write the module**

```rust
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Listener, Manager, State};

/// Tracks whether an apply is in flight. While `true`, the bridge will translate
/// `gateway://connection-state` transitions into narrow `updater://restart-*` events.
///
/// State is process-global because every window that started an apply must observe
/// the same restart lifecycle — the apply itself targets the OS process, not the window.
pub struct ApplyTracker {
    pub apply_in_flight: Arc<AtomicBool>,
}

impl ApplyTracker {
    pub fn new() -> Self {
        Self {
            apply_in_flight: Arc::new(AtomicBool::new(false)),
        }
    }
}

/// Frontend calls this just before invoking `updater.applyUpdate` so the bridge
/// can correlate subsequent disconnect/reconnect events with the apply intent.
#[tauri::command]
pub async fn updater_apply_started(
    app: AppHandle,
    tracker: State<'_, ApplyTracker>,
) -> Result<(), String> {
    tracker.apply_in_flight.store(true, Ordering::SeqCst);
    let _ = app.emit("updater://restart-started", ());
    Ok(())
}

/// Frontend calls this on success (after `diag.getVersion` matches) or after timeout
/// (after the 2-minute reconnect deadline fires) so the bridge stops translating
/// disconnects into restart events.
#[tauri::command]
pub async fn updater_apply_finished(tracker: State<'_, ApplyTracker>) -> Result<(), String> {
    tracker.apply_in_flight.store(false, Ordering::SeqCst);
    Ok(())
}

/// Subscribes to `gateway://connection-state` transitions and emits
/// `updater://restart-complete` when the socket reconnects mid-apply.
/// Called once at app startup.
pub fn install_listener(app: &AppHandle) {
    let app_for_handler = app.clone();
    app.listen("gateway://connection-state", move |evt| {
        let payload = evt.payload();
        // Tauri payloads are JSON-encoded; for a string emit it'll arrive as `"connected"`.
        let stripped = payload.trim_matches('"');
        if stripped != "connected" {
            return;
        }
        let tracker = match app_for_handler.try_state::<ApplyTracker>() {
            Some(t) => t,
            None => return,
        };
        // Only emit if an apply was in flight when the socket came back.
        if tracker.apply_in_flight.swap(false, Ordering::SeqCst) {
            let _ = app_for_handler.emit("updater://restart-complete", ());
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracker_is_initially_idle() {
        let t = ApplyTracker::new();
        assert!(!t.apply_in_flight.load(Ordering::SeqCst));
    }

    #[test]
    fn tracker_swap_returns_prior_then_clears() {
        let t = ApplyTracker::new();
        t.apply_in_flight.store(true, Ordering::SeqCst);
        let prior = t.apply_in_flight.swap(false, Ordering::SeqCst);
        assert!(prior);
        assert!(!t.apply_in_flight.load(Ordering::SeqCst));
    }

    #[test]
    fn tracker_swap_when_idle_returns_false() {
        let t = ApplyTracker::new();
        let prior = t.apply_in_flight.swap(false, Ordering::SeqCst);
        assert!(!prior);
    }
}
```

- [ ] **Step 2: Register the module + commands + state in `lib.rs`**

In `packages/ui/src-tauri/src/lib.rs`:

After `mod tray;` add `mod updater;`:

```rust
mod gateway_bridge;
mod hitl_popup;
mod quick_query;
mod tray;
mod updater;
```

Add the import for `ApplyTracker`:

```rust
use gateway_bridge::{connect_and_run, BridgeState, HitlInbox};
use tauri::Manager;
use updater::ApplyTracker;
```

In `tauri::Builder::default()` chain, add `.manage(ApplyTracker::new())` immediately after `.manage(HitlInbox::new())`:

```rust
        .manage(BridgeState::new())
        .manage(HitlInbox::new())
        .manage(ApplyTracker::new())
```

In the same `invoke_handler!` macro, register the two new commands inline with the existing ones:

```rust
        .invoke_handler(tauri::generate_handler![
            gateway_bridge::rpc_call,
            gateway_bridge::shell_start_gateway,
            gateway_bridge::get_pending_hitl,
            gateway_bridge::hitl_resolved,
            tray::set_connectors_menu,
            hitl_popup::open_hitl_popup,
            hitl_popup::close_hitl_popup,
            updater::updater_apply_started,
            updater::updater_apply_finished,
        ])
```

In the `.setup` closure, after `tray::init_tray(app.handle())?;`, install the listener:

```rust
            tray::init_tray(app.handle())?;
            updater::install_listener(app.handle());
```

- [ ] **Step 3: Verify**

```bash
cd packages/ui/src-tauri && cargo test && cd ../../..
```

Expected: exit 0; the existing 22 Rust tests + 3 new updater tests pass (25 total).

### Task 17: Commit Phase 5

- [ ] **Step 1: Commit**

```bash
git add packages/ui/src-tauri/src/updater.rs packages/ui/src-tauri/src/lib.rs
git commit -m "feat(ui-bridge): updater.rs Rust event listener for restart lifecycle"
```

---

## Phase 6 — Updates panel + RootLayout-mounted restart machinery

The user-driven Updates panel and the always-on restart-window machinery are split into two locations: the panel owns user actions (Check now / Apply / Rollback) + visible status; the always-mounted `UpdaterRestartChrome` (rendered inside `RootLayout`) owns the notification subscription, the `updater://restart-*` listeners, the 2-min reconnect timer, and the post-reconnect `diag.getVersion` check. This split prevents the navigation-loses-monitoring bug: if the user clicks away from `/settings/updates` mid-apply, the chrome keeps watching and the overlay stays visible.

### Task 18: Build the `RestartOverlay` component

A simple absolute-positioned full-window overlay; copy is driven by the slice state. Pure presentational — no effects, no listeners.

**Files:**
- Create: `packages/ui/src/components/settings/updater/RestartOverlay.tsx`

- [ ] **Step 1: Write the component**

```tsx
import type { ReactNode } from "react";
import type { UpdaterRestartingPayload } from "../../../ipc/types";
import type { UpdaterUiState } from "../../../store/slices/updater";

interface Props {
  readonly state: UpdaterUiState;
  readonly restarting: UpdaterRestartingPayload | null;
  readonly elapsedSec: number;
}

export function RestartOverlay({ state, restarting, elapsedSec }: Props): ReactNode | null {
  if (state !== "restarting" && state !== "reconnecting") return null;

  const heading =
    state === "restarting" ? "Restarting Nimbus…" : "Reconnecting to Gateway…";
  const subline =
    restarting !== null
      ? `Updating from ${restarting.fromVersion} → ${restarting.toVersion}.`
      : "Apply in progress.";
  const hint =
    state === "reconnecting"
      ? `Up to 2 minutes — elapsed ${elapsedSec}s.`
      : "Up to 30 seconds.";

  return (
    <div
      role="alert"
      data-testid="restart-overlay"
      className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center text-white px-6 text-center"
    >
      <h2 className="text-xl font-semibold">{heading}</h2>
      <p className="mt-2 text-sm">{subline}</p>
      <p className="mt-1 text-xs text-white/70">{hint}</p>
      <div className="mt-6 h-1 w-48 bg-white/20 rounded overflow-hidden">
        <div className="h-full w-1/3 bg-white animate-pulse" />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

```bash
cd packages/ui && bunx tsc --noEmit && cd ../..
```

Expected: exit 0.

### Task 19: Build `UpdaterRestartChrome` (always-mounted) and wire into `RootLayout`

`UpdaterRestartChrome` lives at the app-shell level so its listeners and the 2-minute reconnect timer keep firing even if the user navigates away from `/settings/updates` mid-apply. It owns:

1. The `gateway://notification` subscription filtered by `method.startsWith("updater.")`.
2. The `updater://restart-started` listener (transitions `restarting` → `reconnecting`).
3. The `updater://restart-complete` listener (calls `diag.getVersion`, sets success or rolls back).
4. The 2-minute reconnect timer (transitions `reconnecting` → `failed` with `reconnect_timeout`).
5. Rendering the `<RestartOverlay />` driven by the slice.

It renders no chrome of its own when `updaterUiState` is outside the `restarting` / `reconnecting` set; in those states it overlays the entire window.

**Files:**
- Create: `packages/ui/src/components/updater/UpdaterRestartChrome.tsx`
- Modify: `packages/ui/src/layouts/RootLayout.tsx`

- [ ] **Step 1: Write `UpdaterRestartChrome.tsx`**

```tsx
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { RestartOverlay } from "../settings/updater/RestartOverlay";
import { useIpcSubscription } from "../../hooks/useIpcSubscription";
import { createIpcClient } from "../../ipc/client";
import type {
  JsonRpcNotification,
  UpdaterDownloadProgressPayload,
  UpdaterRestartingPayload,
  UpdaterRolledBackPayload,
  UpdaterVerifyFailedPayload,
} from "../../ipc/types";
import { useNimbusStore } from "../../store";

const RECONNECT_TIMEOUT_MS = 2 * 60 * 1_000;

/**
 * Always-mounted (rendered inside `RootLayout`). Owns every cross-cutting effect for
 * the updater restart window so navigating away from `/settings/updates` mid-apply
 * does not strand the success-detection logic or hide the overlay.
 *
 * Source of truth is the `updater` slice. `UpdatesPanel` reads the same slice for
 * its panel-local UI but performs no listener/timer work — that all lives here.
 */
export function UpdaterRestartChrome() {
  const uiState = useNimbusStore((s) => s.updaterUiState);
  const restarting = useNimbusStore((s) => s.updaterRestarting);
  const setUiState = useNimbusStore((s) => s.setUpdaterUiState);
  const setCheck = useNimbusStore((s) => s.setUpdaterCheck);
  const setDownload = useNimbusStore((s) => s.setUpdaterDownload);
  const setRestarting = useNimbusStore((s) => s.setUpdaterRestarting);
  const setFailure = useNimbusStore((s) => s.setUpdaterFailure);
  const setStatus = useNimbusStore((s) => s.setUpdaterStatus);

  const reconnectStartRef = useRef<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  // Drive the elapsed counter while in `reconnecting`, fail at the 2-min mark.
  useEffect(() => {
    if (uiState !== "reconnecting") {
      reconnectStartRef.current = null;
      setElapsedSec(0);
      return;
    }
    reconnectStartRef.current = Date.now();
    setElapsedSec(0);
    const id = setInterval(() => {
      const start = reconnectStartRef.current;
      if (start === null) return;
      const elapsed = Math.floor((Date.now() - start) / 1_000);
      setElapsedSec(elapsed);
      if (Date.now() - start >= RECONNECT_TIMEOUT_MS) {
        clearInterval(id);
        setFailure({ reason: "reconnect_timeout" });
        setUiState("failed");
        void invoke("updater_apply_finished").catch(() => undefined);
      }
    }, 1_000);
    return () => clearInterval(id);
  }, [uiState, setFailure, setUiState]);

  // Translate gateway updater notifications into slice updates.
  // Read `updaterUiState` via getState() to avoid making the dep list
  // re-register the listener every state transition.
  const onNotification = useCallback(
    (n: JsonRpcNotification) => {
      switch (n.method) {
        case "updater.updateAvailable":
          void createIpcClient()
            .updaterCheckNow()
            .then((c) => {
              setCheck(c);
              setUiState("available");
            })
            .catch(() => undefined);
          return;
        case "updater.downloadProgress":
          setDownload(n.params as UpdaterDownloadProgressPayload);
          if (useNimbusStore.getState().updaterUiState !== "downloading") {
            setUiState("downloading");
          }
          return;
        case "updater.restarting":
          setRestarting(n.params as UpdaterRestartingPayload);
          setUiState("restarting");
          return;
        case "updater.rolledBack":
          setFailure(n.params as UpdaterRolledBackPayload);
          setUiState("rolled_back");
          void invoke("updater_apply_finished").catch(() => undefined);
          return;
        case "updater.verifyFailed":
          setFailure(n.params as UpdaterVerifyFailedPayload);
          setUiState("failed");
          void invoke("updater_apply_finished").catch(() => undefined);
          return;
        default:
          return;
      }
    },
    [setCheck, setDownload, setRestarting, setFailure, setUiState],
  );
  useIpcSubscription<JsonRpcNotification>("gateway://notification", onNotification);

  const onRestartStarted = useCallback(() => {
    setUiState("reconnecting");
  }, [setUiState]);
  useIpcSubscription<unknown>("updater://restart-started", onRestartStarted);

  const onRestartComplete = useCallback(() => {
    void (async () => {
      try {
        const version = await createIpcClient().diagGetVersion();
        const latest = useNimbusStore.getState().updaterRestarting;
        const expected = latest?.toVersion ?? null;
        if (expected !== null && version.version === expected) {
          setUiState("success");
          // Refresh status so the panel reflects the new currentVersion.
          try {
            const next = await createIpcClient().updaterGetStatus();
            setStatus(next);
          } catch {
            /* non-fatal */
          }
        } else {
          setFailure({ reason: "installer_failed" });
          setUiState("rolled_back");
        }
      } catch {
        setFailure({ reason: "installer_failed" });
        setUiState("failed");
      } finally {
        void invoke("updater_apply_finished").catch(() => undefined);
      }
    })();
  }, [setFailure, setStatus, setUiState]);
  useIpcSubscription<unknown>("updater://restart-complete", onRestartComplete);

  return <RestartOverlay state={uiState} restarting={restarting} elapsedSec={elapsedSec} />;
}
```

- [ ] **Step 2: Mount inside `RootLayout`**

In `packages/ui/src/layouts/RootLayout.tsx`, add the import alongside the other component imports (`Sidebar`, `GatewayOfflineBanner`, `HotkeyFailedBanner`):

```ts
import { UpdaterRestartChrome } from "../components/updater/UpdaterRestartChrome";
```

In the returned JSX, add `<UpdaterRestartChrome />` immediately after the existing `<HotkeyFailedBanner />` line (it renders nothing when no apply is in flight, so position is mostly cosmetic — picking right after the banners keeps app-shell concerns grouped):

```tsx
  return (
    <div className="h-screen flex flex-col">
      {offline && <GatewayOfflineBanner />}
      <HotkeyFailedBanner />
      <UpdaterRestartChrome />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
```

- [ ] **Step 3: Verify**

```bash
cd packages/ui && bunx tsc --noEmit && cd ../..
```

Expected: exit 0.

### Task 20: Add Vitest spec for `UpdaterRestartChrome`

**Files:**
- Create: `packages/ui/test/components/updater/UpdaterRestartChrome.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/ipc/client");
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

import { diagGetVersionMock, updaterGetStatusMock } from "../../../src/ipc/__mocks__/client";
import { UpdaterRestartChrome } from "../../../src/components/updater/UpdaterRestartChrome";
import { useNimbusStore } from "../../../src/store";

beforeEach(() => {
  diagGetVersionMock.mockReset();
  updaterGetStatusMock.mockReset();
  useNimbusStore.setState({
    updaterStatus: null,
    updaterUiState: "idle",
    updaterCheck: null,
    updaterDownload: null,
    updaterRestarting: null,
    updaterFailure: null,
  } as never);
});

afterEach(() => {
  useNimbusStore.setState({
    updaterStatus: null,
    updaterUiState: "idle",
    updaterCheck: null,
    updaterDownload: null,
    updaterRestarting: null,
    updaterFailure: null,
  } as never);
});

describe("UpdaterRestartChrome", () => {
  it("renders nothing when uiState is idle", () => {
    const { queryByTestId } = render(<UpdaterRestartChrome />);
    expect(queryByTestId("restart-overlay")).toBeNull();
  });

  it("renders the overlay when uiState transitions to restarting", () => {
    const { queryByTestId } = render(<UpdaterRestartChrome />);
    expect(queryByTestId("restart-overlay")).toBeNull();
    act(() => {
      useNimbusStore.getState().setUpdaterRestarting({ fromVersion: "0.1.0", toVersion: "0.2.0" });
      useNimbusStore.getState().setUpdaterUiState("restarting");
    });
    expect(queryByTestId("restart-overlay")).not.toBeNull();
  });

  it("renders the overlay when uiState is reconnecting", () => {
    const { queryByTestId } = render(<UpdaterRestartChrome />);
    act(() => {
      useNimbusStore.getState().setUpdaterRestarting({ fromVersion: "0.1.0", toVersion: "0.2.0" });
      useNimbusStore.getState().setUpdaterUiState("reconnecting");
    });
    expect(queryByTestId("restart-overlay")).not.toBeNull();
  });

  it("flips to failed with reconnect_timeout after 2 minutes in reconnecting", async () => {
    vi.useFakeTimers();
    try {
      render(<UpdaterRestartChrome />);
      act(() => {
        useNimbusStore.getState().setUpdaterRestarting({ fromVersion: "0.1.0", toVersion: "0.2.0" });
        useNimbusStore.getState().setUpdaterUiState("reconnecting");
      });
      await act(async () => {
        vi.advanceTimersByTime(60_000); // 1 minute — still reconnecting
      });
      expect(useNimbusStore.getState().updaterUiState).toBe("reconnecting");
      await act(async () => {
        vi.advanceTimersByTime(61_000); // pass the 2-minute mark
      });
      expect(useNimbusStore.getState().updaterUiState).toBe("failed");
      expect(useNimbusStore.getState().updaterFailure).toEqual({ reason: "reconnect_timeout" });
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: Run test**

```bash
cd packages/ui && bunx vitest run test/components/updater/UpdaterRestartChrome.test.tsx && cd ../..
```

Expected: 4 tests passed.

### Task 21: Build the slimmed `UpdatesPanel` page

The panel reads from the slice (already populated by `UpdaterRestartChrome`'s subscriptions) and owns user-driven actions. No restart machinery here — that all lives in the chrome.

**Files:**
- Create: `packages/ui/src/pages/settings/UpdatesPanel.tsx`
- Modify: `packages/ui/src/App.tsx`

- [ ] **Step 1: Write the panel**

```tsx
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { PanelError } from "../../components/settings/PanelError";
import { PanelHeader } from "../../components/settings/PanelHeader";
import { StaleChip } from "../../components/settings/StaleChip";
import { createIpcClient } from "../../ipc/client";
import { useNimbusStore } from "../../store";

export function UpdatesPanel() {
  const connectionState = useNimbusStore((s) => s.connectionState);
  const status = useNimbusStore((s) => s.updaterStatus);
  const uiState = useNimbusStore((s) => s.updaterUiState);
  const check = useNimbusStore((s) => s.updaterCheck);
  const download = useNimbusStore((s) => s.updaterDownload);
  const failure = useNimbusStore((s) => s.updaterFailure);
  const setStatus = useNimbusStore((s) => s.setUpdaterStatus);
  const setUiState = useNimbusStore((s) => s.setUpdaterUiState);
  const setCheck = useNimbusStore((s) => s.setUpdaterCheck);
  const setFailure = useNimbusStore((s) => s.setUpdaterFailure);
  const resetTransients = useNimbusStore((s) => s.resetUpdaterTransients);

  const offline = connectionState === "disconnected";
  const writeDisabled =
    offline ||
    uiState === "checking" ||
    uiState === "downloading" ||
    uiState === "verifying" ||
    uiState === "applying" ||
    uiState === "restarting" ||
    uiState === "reconnecting";

  const [fetchError, setFetchError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await createIpcClient().updaterGetStatus();
      setStatus(next);
      setFetchError(null);
    } catch (e) {
      setFetchError((e as Error).message);
    }
  }, [setStatus]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // No subscriptions, no timer here — `UpdaterRestartChrome` (mounted in RootLayout)
  // owns all of that. This panel only reads from the slice and exposes user actions.

  const onCheckNow = useCallback(async () => {
    setUiState("checking");
    try {
      const result = await createIpcClient().updaterCheckNow();
      setCheck(result);
      setUiState(result.updateAvailable ? "available" : "idle");
    } catch (e) {
      setFetchError((e as Error).message);
      setUiState("idle");
    }
  }, [setCheck, setUiState]);

  const onApply = useCallback(async () => {
    setUiState("applying");
    setFailure(null);
    try {
      await invoke("updater_apply_started");
      await createIpcClient().updaterApplyUpdate();
      // From here, state advances via notifications:
      //   applying → restarting (notification) → reconnecting (Rust event) → success / rolled_back.
    } catch (e) {
      setFetchError((e as Error).message);
      setUiState("failed");
      void invoke("updater_apply_finished").catch(() => undefined);
    }
  }, [setFailure, setUiState]);

  const onRollback = useCallback(async () => {
    setUiState("checking");
    try {
      await createIpcClient().updaterRollback();
      resetTransients();
      await refresh();
    } catch (e) {
      setFetchError((e as Error).message);
      setUiState("failed");
    }
  }, [refresh, resetTransients, setUiState]);

  const downloadPct =
    download?.totalBytes !== undefined && download.totalBytes > 0
      ? Math.min(100, Math.floor((download.receivedBytes / download.totalBytes) * 100))
      : null;

  return (
    <section className="p-6 space-y-6 relative">
      <PanelHeader
        title="Updates"
        description="Local-first updater. Manifest is fetched on demand; binaries are Ed25519-verified before install. Roll back if a previous install failed."
        livePill={offline ? <StaleChip /> : undefined}
      />

      {fetchError !== null && (
        <PanelError message={`Updater error: ${fetchError}`} onRetry={() => void refresh()} />
      )}

      {status !== null && (
        <div className="text-sm space-y-1">
          <div>
            <span className="text-[var(--color-text-muted)]">Current version:</span>{" "}
            <span className="font-mono">{status.currentVersion}</span>
          </div>
          <div>
            <span className="text-[var(--color-text-muted)]">Manifest URL:</span>{" "}
            <span className="font-mono text-xs">{status.configUrl}</span>
          </div>
          {status.lastCheckAt !== undefined && (
            <div>
              <span className="text-[var(--color-text-muted)]">Last checked:</span>{" "}
              {new Date(status.lastCheckAt).toLocaleString()}
            </div>
          )}
          {status.lastError !== undefined && (
            <div className="text-red-500 text-xs">Last error: {status.lastError}</div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void onCheckNow()}
          disabled={writeDisabled}
          className="px-3 py-1.5 text-sm rounded bg-[var(--color-accent)] text-white disabled:opacity-50"
        >
          {uiState === "checking" ? "Checking…" : "Check now"}
        </button>
        {check !== null && check.updateAvailable && uiState === "available" && (
          <button
            type="button"
            onClick={() => void onApply()}
            disabled={writeDisabled}
            className="px-3 py-1.5 text-sm rounded border border-[var(--color-accent)] text-[var(--color-accent)] disabled:opacity-50"
          >
            Apply {check.latestVersion}
          </button>
        )}
        {(uiState === "rolled_back" || uiState === "failed" || status?.state === "rolled_back" || status?.state === "failed") && (
          <button
            type="button"
            onClick={() => void onRollback()}
            disabled={writeDisabled}
            className="px-3 py-1.5 text-sm rounded border border-[var(--color-border)] disabled:opacity-50"
          >
            Rollback
          </button>
        )}
      </div>

      {check !== null && check.updateAvailable && (
        <div className="rounded border border-[var(--color-border)] p-3 text-sm">
          <div className="font-medium">
            New version available: {check.latestVersion}
          </div>
          {check.notes !== undefined && (
            <pre className="mt-2 whitespace-pre-wrap text-xs text-[var(--color-text-muted)]">
              {check.notes}
            </pre>
          )}
        </div>
      )}

      {uiState === "downloading" && download !== null && (
        <div className="text-sm">
          <div>Downloading update…</div>
          <div className="mt-1 h-1 w-48 bg-[var(--color-border)] rounded overflow-hidden">
            <div
              data-testid="download-progress-bar"
              className="h-full bg-[var(--color-accent)] transition-all"
              style={{ width: downloadPct !== null ? `${downloadPct}%` : "30%" }}
            />
          </div>
          {downloadPct !== null && (
            <div className="text-xs text-[var(--color-text-muted)] mt-1">{downloadPct}%</div>
          )}
        </div>
      )}

      {uiState === "success" && (
        <div role="status" className="text-sm text-green-600">
          Update applied successfully. Now running {status?.currentVersion ?? "new version"}.
        </div>
      )}

      {failure !== null && (uiState === "rolled_back" || uiState === "failed") && (
        <div role="alert" className="text-sm text-red-600">
          {failure.reason === "reconnect_timeout"
            ? "Gateway failed to restart within 2 minutes. Run `nimbus start` in a terminal, then reload."
            : failure.reason === "signature_invalid"
              ? "Update rejected: signature invalid. Your Nimbus is safe."
              : failure.reason === "hash_mismatch"
                ? "Update rejected: hash mismatch. Your Nimbus is safe."
                : `Update rolled back: ${failure.reason}.`}
        </div>
      )}

    </section>
  );
}
```

- [ ] **Step 2: Wire the route in `App.tsx`**

In `packages/ui/src/App.tsx`:

Add the import alphabetically:

```ts
import { UpdatesPanel } from "./pages/settings/UpdatesPanel";
```

Replace the existing route line:

```tsx
<Route path="updates" element={<PanelComingSoon title="Updates" />} />
```

with:

```tsx
<Route path="updates" element={<UpdatesPanel />} />
```

- [ ] **Step 3: Verify the panel compiles**

```bash
cd packages/ui && bunx tsc --noEmit && cd ../..
```

Expected: exit 0.

### Task 22: Add Vitest spec for the slimmed `UpdatesPanel`

**Files:**
- Create: `packages/ui/test/pages/settings/UpdatesPanel.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/ipc/client");
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));

import {
  callMock,
  updaterApplyUpdateMock,
  updaterCheckNowMock,
  updaterGetStatusMock,
  updaterRollbackMock,
} from "../../../src/ipc/__mocks__/client";
import { UpdatesPanel } from "../../../src/pages/settings/UpdatesPanel";
import { useNimbusStore } from "../../../src/store";

beforeEach(() => {
  callMock.mockReset();
  updaterApplyUpdateMock.mockReset();
  updaterCheckNowMock.mockReset();
  updaterGetStatusMock.mockReset();
  updaterRollbackMock.mockReset();
  useNimbusStore.setState({
    connectionState: "connected",
    updaterStatus: null,
    updaterUiState: "idle",
    updaterCheck: null,
    updaterDownload: null,
    updaterRestarting: null,
    updaterFailure: null,
  } as never);
  updaterGetStatusMock.mockResolvedValue({
    state: "idle",
    currentVersion: "0.1.0",
    configUrl: "https://updates.nimbus.dev/manifest.json",
  });
});

afterEach(() => {
  useNimbusStore.setState({
    updaterStatus: null,
    updaterUiState: "idle",
    updaterCheck: null,
    updaterDownload: null,
    updaterRestarting: null,
    updaterFailure: null,
  } as never);
});

describe("UpdatesPanel (slimmed; subscriptions live in UpdaterRestartChrome)", () => {
  it("renders current version once status loads", async () => {
    render(<UpdatesPanel />);
    await waitFor(() => expect(screen.getByText("0.1.0")).toBeTruthy());
  });

  it("Check now success with no update keeps state idle", async () => {
    updaterCheckNowMock.mockResolvedValueOnce({
      currentVersion: "0.1.0",
      latestVersion: "0.1.0",
      updateAvailable: false,
    });
    render(<UpdatesPanel />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Check now" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    await waitFor(() => expect(useNimbusStore.getState().updaterUiState).toBe("idle"));
    expect(useNimbusStore.getState().updaterCheck?.updateAvailable).toBe(false);
  });

  it("Check now success with update flips to `available` and surfaces Apply button + notes", async () => {
    updaterCheckNowMock.mockResolvedValueOnce({
      currentVersion: "0.1.0",
      latestVersion: "0.2.0",
      updateAvailable: true,
      notes: "Bug fixes and improvements.",
    });
    render(<UpdatesPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    await waitFor(() => expect(useNimbusStore.getState().updaterUiState).toBe("available"));
    expect(screen.getByRole("button", { name: /Apply 0.2.0/ })).toBeTruthy();
    expect(screen.getByText(/Bug fixes and improvements/)).toBeTruthy();
  });

  it("Apply runs updater_apply_started + updaterApplyUpdate and flips to applying", async () => {
    useNimbusStore.setState({
      updaterUiState: "available",
      updaterCheck: { currentVersion: "0.1.0", latestVersion: "0.2.0", updateAvailable: true },
    } as never);
    updaterApplyUpdateMock.mockResolvedValueOnce({ jobId: "x" });
    render(<UpdatesPanel />);
    await waitFor(() => screen.getByRole("button", { name: /Apply 0.2.0/ }));
    fireEvent.click(screen.getByRole("button", { name: /Apply 0.2.0/ }));
    await waitFor(() => expect(useNimbusStore.getState().updaterUiState).toBe("applying"));
    expect(updaterApplyUpdateMock).toHaveBeenCalledTimes(1);
  });

  it("Rollback button surfaces only when prior state is rolled_back/failed and runs updater.rollback", async () => {
    updaterGetStatusMock.mockResolvedValueOnce({
      state: "rolled_back",
      currentVersion: "0.1.0",
      configUrl: "u",
      lastError: "previous install failed",
    });
    updaterRollbackMock.mockResolvedValueOnce({ ok: true });
    render(<UpdatesPanel />);
    await waitFor(() => expect(screen.getByText(/previous install failed/)).toBeTruthy());
    const rollback = screen.getByRole("button", { name: "Rollback" });
    fireEvent.click(rollback);
    await waitFor(() => expect(updaterRollbackMock).toHaveBeenCalledTimes(1));
  });

  it("Disconnected state disables Check now", async () => {
    useNimbusStore.setState({ connectionState: "disconnected" } as never);
    render(<UpdatesPanel />);
    await waitFor(() => expect(screen.getByText("0.1.0")).toBeTruthy());
    expect((screen.getByRole("button", { name: "Check now" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run test**

```bash
cd packages/ui && bunx vitest run test/pages/settings/UpdatesPanel.test.tsx && cd ../..
```

Expected: 6 tests passed.

### Task 23: Commit Phase 6

- [ ] **Step 1: Commit**

```bash
git add packages/ui/src/components/settings/updater/RestartOverlay.tsx \
        packages/ui/src/components/updater/UpdaterRestartChrome.tsx \
        packages/ui/src/layouts/RootLayout.tsx \
        packages/ui/src/pages/settings/UpdatesPanel.tsx \
        packages/ui/src/App.tsx \
        packages/ui/test/components/updater/UpdaterRestartChrome.test.tsx \
        packages/ui/test/pages/settings/UpdatesPanel.test.tsx
git commit -m "feat(ui): Updates panel + RootLayout-mounted UpdaterRestartChrome (state machine, overlay, diag.getVersion check, rollback)"
```

---

## Phase 7 — Full verification

### Task 24: typecheck + lint + unit + Rust tests + coverage

- [ ] **Step 1: Repo-wide checks**

```bash
bun run typecheck
bun run lint
bun test
cd packages/ui && bunx vitest run && cd ../..
cd packages/ui/src-tauri && cargo test && cd ../../..
```

Expected: every command exits 0. Pay particular attention to:

- Vitest — all new tests pass (`client-ws5c-plan4`, `AuditFeed` corrected shape, `audit` slice, `updater` slice, `audit-row-utils`, `AuditPanel`, `UpdaterRestartChrome`, `UpdatesPanel`).
- Rust `cargo test` — `ALLOWED_METHODS.len() == 38` (unchanged from Plan 3); `GLOBAL_BROADCAST_METHODS.len() == 1` and `NO_TIMEOUT_METHODS.len() == 4` both unchanged; the three new `updater::tests::*` tests pass.
- Biome — no formatting drift.

- [ ] **Step 2: Coverage spot-check**

```bash
cd packages/ui && bunx vitest run --coverage && cd ../..
```

Must remain ≥ 80 % lines / ≥ 75 % branches (the existing `packages/ui` gate from WS5-B). If any new file falls short, add a targeted test; do not lower the gate.

### Task 25: Commit chain verification + push

- [ ] **Step 1: Expected commits on top of Plan 3**

```bash
git log --oneline 99e65f0..HEAD
```

(where `99e65f0` is the Plan-3-completion docs commit at the tip of Plan 3.) Expected (order of the newest 7 matters; exact SHAs vary):

```
xxxxxxx feat(ui): Updates panel + RootLayout-mounted UpdaterRestartChrome (state machine, overlay, diag.getVersion check, rollback)
xxxxxxx feat(ui-bridge): updater.rs Rust event listener for restart lifecycle
xxxxxxx feat(ui-store): add updater slice (state machine, manifest cache, transient)
xxxxxxx feat(ui): Audit panel with virtualized list, filter chips, verify, export (.json/.csv)
xxxxxxx feat(ui-store): add audit slice (filter state + summary cache, transient)
xxxxxxx fix(ui): align AuditEntry with Gateway wire shape; fix AuditFeed mapping
xxxxxxx feat(ui-ipc): audit + updater + diag wrappers for Audit/Updates panels
```

Seven commits total (matches the seven `git commit` steps in this plan).

- [ ] **Step 2: Push**

```bash
git push
```

Do NOT open the PR yet. Plan 5 will add the Data panel + opens the single WS5-C UI PR.

---

## Completion criteria

Plan 4 is complete when every checkbox above is ticked **and**:

- [ ] `bun run typecheck` passes at the repo root.
- [ ] `bun run lint` passes at the repo root.
- [ ] `bun test` passes at the repo root.
- [ ] `bunx vitest run` passes in `packages/ui/` with coverage ≥ 80 % lines / ≥ 75 % branches.
- [ ] `cargo test` passes in `packages/ui/src-tauri/`, including the new `updater::tests::*` cases. `ALLOWED_METHODS.len() == 38` is unchanged; `GLOBAL_BROADCAST_METHODS.len() == 1` is unchanged; `NO_TIMEOUT_METHODS.len() == 4` is unchanged.
- [ ] Seven commits from this plan appear on `dev/asafgolombek/ws5c-ui` on top of the Plan 3 commits.
- [ ] The branch is pushed to origin.

After completion, proceed to **Plan 5** (not yet written). Suggested scope: Data panel — ExportWizard (passphrase entry with `zxcvbn` strength meter, native save dialog, recovery-seed modal with clipboard countdown), ImportWizard (path open + passphrase-or-seed entry + schemaVersion-mismatch terminal dialog per spec §4.2), DeleteServiceDialog (preflight counts + typed-service-name confirmation). Plan 5 must include a **pre-merge Gateway review-gate** to confirm `data.import` implements stage-and-swap atomicity (spec §5.2 / §7 commit 10). Plan 5 ends with the docs/smoke commit (#11) and opens the single WS5-C UI PR.

---

## Notes carried forward

### For the eventual WS5-C UI PR description

When Plan 5 opens the single WS5-C UI PR, four points from this plan belong in the PR body:

1. **`tauri-plugin-fs` was added with the narrowest possible capability** (`fs:allow-write-text-file`). Read, append, and binary-write surfaces remain forbidden. The Data panel in Plan 5 may need additional capabilities for binary writes (encrypted backup tarball) — those will be added explicitly with the Plan 5 commit and called out in this PR body.
2. **`ALLOWED_METHODS` did not grow in Plan 4.** Every method the Audit and Updates panels consume was already in the 38-method allowlist landed by Plans 2–3. The size assertion in `gateway_bridge.rs` still locks at 38.
3. **The Updates restart machinery is mounted at `RootLayout`, not inside the panel.** A new always-mounted `UpdaterRestartChrome` (rendered next to the offline banner in `RootLayout`) owns the `gateway://notification` subscription, the `updater://restart-*` listeners, the 2-minute reconnect timer, and the post-reconnect `diag.getVersion` check. This survives navigation away from `/settings/updates` mid-apply. The `RestartOverlay` it renders is window-scoped (not a global Tauri broadcast) — each window's chrome runs its own copy. The 2-minute reconnect timeout is implemented in JS (`setTimeout`) rather than Rust to keep the Rust watcher state minimal — exactly one `AtomicBool` lives in `ApplyTracker`.
4. **`AuditEntry` was corrected to match the Gateway wire shape.** Plan 4 includes a one-commit pre-existing-bug fix (`fix(ui): align AuditEntry with Gateway wire shape; fix AuditFeed mapping`). The previous interface declared `{ ts, action, outcome, subject, hitlRejectReason }` while the Gateway returns `{ actionType, hitlStatus, actionJson, timestamp }`. The Dashboard's `AuditFeed` component was silently rendering blank rows in production; its test passed only because it used wrong-shape mocks. The fix updates the type, the consumer, and the test in one commit so the diff is reviewable.

### Known deferrals from this plan

- **Audit row payload preview is JSON-only and inline in the export.** A modal payload viewer (collapsible per row in the virtualized list) would let users inspect `actionJson` without round-tripping through export. Not shipped because it requires either a row click handler that disables `react-window`'s default optimisation or a sibling panel — both add complexity disproportionate to v0.1.0 needs.
- **`audit.list` does not return `rowHash` or `prevHash` — only `audit.export` does.** The list view therefore renders rows without their hash; the CSV/JSON export pulls fresh, hash-bearing rows via `auditExport()` so the exported file is always trustworthy. A reviewer who wants the list to surface hashes inline must extend the Gateway `audit.list` shape — not in scope here.
- **No persistence of updater state across UI reloads.** If the user reloads the UI mid-`applying`, the new mount calls `updater.getStatus` and re-derives the panel state from the Gateway-side state. The `applying` state is brief (download + verify + apply, typically < 30 s on a fast link) so re-deriving is acceptable. If users report losing progress, persist `updaterUiState` to localStorage with a 5-min TTL.
- **No "release-notes scrollable" component.** The Plan-4 `UpdatesPanel` renders `check.notes` inside a `<pre>` with `whitespace-pre-wrap`. Long release notes would benefit from a Markdown renderer (`react-markdown` or similar). Out of scope for v0.1.0; tracked as a polish item.
- **The Rollback button does not require a typed-name confirmation.** Rollback restores the previous binary and is reversible (the user can apply again). Profiles delete required typed-name because it is destructive; updater rollback is not. If a future requirement adds destructive rollback (e.g., schema downgrade), wrap this button in `useConfirm`.
- **Audit notification triggers are heuristic.** The panel re-fetches on `audit.entryAppended` and `data.delete.completed`. If the Gateway emits other audit-row-producing notifications, they need to be added to the switch in `onNotification` — the panel falls back to 60 s polling otherwise.
