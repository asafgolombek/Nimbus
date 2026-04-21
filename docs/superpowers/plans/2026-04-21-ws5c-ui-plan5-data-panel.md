# WS5-C UI — Plan 5: Data panel + WS5-C wrap-up

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `PanelComingSoon` placeholder at `/settings/data` with a fully-wired Data panel (Export + Import + Delete wizards), then close out WS5-C with a consolidated manual-smoke checklist, roadmap row update, and PR-open instructions.

**Architecture:** Pure UI-layer wiring. Zero Rust, zero Gateway, zero new dependencies. Five typed `data.*` wrappers already allow-listed in the 38-method Rust bridge; `data.export` and `data.import` already in the 4-method `NO_TIMEOUT_METHODS` set. Persist whitelist stays at exactly 5 keys — the new `data` slice is fully transient. The recovery-seed modal branches on `recoverySeedGenerated` per Plan 5's documented divergence from parent spec §4.1.

**Tech Stack:** Tauri 2 · React 18 · TypeScript 6 strict · Zustand v5 · React Router v6 · Tailwind CSS v4 · `zxcvbn` · `@tauri-apps/plugin-dialog` · `@tauri-apps/plugin-fs` · `@tauri-apps/plugin-clipboard-manager` · Vitest + `@testing-library/react`.

**Parent design spec:** [`docs/superpowers/specs/2026-04-21-ws5c-ui-plan5-data-panel-design.md`](../specs/2026-04-21-ws5c-ui-plan5-data-panel-design.md).

**Depends on:** Plan 4 (commits `bb2f359` through `b9a0b2b`) merged to `dev/asafgolombek/ws5c-ui`.

**Branching strategy:** Continue on the existing feature branch `dev/asafgolombek/ws5c-ui`. This plan appends three commits:

1. `feat(ui-ipc+store): data.* plumbing for Data panel`
2. `feat(ui): Data panel (Export + Import + Delete wizards)`
3. `docs: WS5-C wrap-up — manual smoke + roadmap + status`

After commit 3, the single WS5-C UI PR opens against `dev/asafgolombek/phase_4_ws5`.

**Test convention:** UI tests live under `packages/ui/test/` mirroring the `src/` layout. Use `vi.mock("../../../src/ipc/client")` + the module-scope `vi.fn()` mocks exported from `packages/ui/src/ipc/__mocks__/client.ts`. Timer-driven behaviors use `vi.useFakeTimers()` + `vi.advanceTimersByTime(...)`.

---

## Pre-flight (do once before Task 1)

- [ ] **Step A — Confirm branch + baseline green**

```bash
git checkout dev/asafgolombek/ws5c-ui
git status                        # expect clean (except local settings noise)
git log --oneline -6              # expect Plan 4 commits on top
bun install
bun run typecheck
bun test --bail
cd packages/ui && bunx vitest run && cd ../..
cd packages/ui/src-tauri && cargo test && cd ../../..
```

Expected: every command exits 0. If anything is red on the Plan 4 tip, stop and fix before continuing.

- [ ] **Step B — Skim the patterns this plan mirrors**

Open each of these once; every task below assumes you have them in your head:

- `packages/ui/src/pages/settings/TelemetryPanel.tsx` — canonical `PanelHeader` / `PanelError` / `StaleChip` / offline-driven `writeDisabled` pattern. `DataPanel` mirrors this.
- `packages/ui/src/pages/settings/ProfilesPanel.tsx` — canonical typed-name confirmation pattern for delete flows. `DeleteServiceDialog` reuses this.
- `packages/ui/src/components/settings/model/PullDialog.tsx` — canonical multi-step dialog with progress bar + cancel + timers. `ExportWizard` and `ImportWizard` mirror this structure.
- `packages/ui/src/ipc/client.ts` — append new wrappers alongside existing ones at the bottom of the `NimbusIpcClient` interface and the `createIpcClient()` factory. Every wrapper goes through `parseError`.
- `packages/ui/src/ipc/__mocks__/client.ts` — module-scope `vi.fn()` mocks. Extend with one per new wrapper.
- `packages/ui/src/store/slices/updater.ts` — closest shape reference for a transient state-machine slice.
- `packages/ui/src/store/partialize.ts` — persist whitelist is exactly 5 keys. The new slice adds zero entries.
- `packages/ui/test/pages/settings/ProfilesPanel.test.tsx` — canonical panel test scaffold.
- `packages/ui/test/components/settings/model/PullDialog.test.tsx` — canonical timer-driven test scaffold.
- `packages/gateway/src/ipc/data-rpc.ts` — confirms wire shapes:
  - `data.getExportPreflight` returns `{ lastExportAt: number|null, estimatedSizeBytes: number, itemCount: number }`
  - `data.getDeletePreflight` requires `{ service: string }` and returns `{ service, itemCount, embeddingCount, vaultKeyCount }`
  - `data.export` requires `{ output, passphrase, includeIndex? }` and returns `{ outputPath, recoverySeed, recoverySeedGenerated, itemsExported }`
  - `data.import` requires `{ bundlePath, passphrase? | recoverySeed? }` and returns `{ credentialsRestored, oauthEntriesFlagged }`; throws JSON-RPC `-32010` with `data: { kind: "version_incompatible", archiveSchemaVersion, currentSchemaVersion, relation: "archive_newer" | "archive_older_unsupported" }` on schema mismatch
  - `data.delete` requires `{ service, dryRun? }` and returns `{ preflight: DataDeletePreflight, deleted: boolean }`
- `packages/gateway/src/commands/data-delete.ts:21-24` — confirms `RunDataDeleteResult = { preflight, deleted }`.
- `packages/gateway/src/commands/data-import.ts:57-60` — confirms `RunDataImportResult = { credentialsRestored, oauthEntriesFlagged }`.
- `packages/ui/src-tauri/src/gateway_bridge.rs:74-78` — confirms all five `data.*` methods allow-listed; **no Rust changes needed this plan**.

---

## Phase 1 — IPC + store plumbing

Commits as a single unit at the end of Phase 1.

### Task 1: Append Data-panel types to `packages/ui/src/ipc/types.ts`

**Files:**
- Modify: `packages/ui/src/ipc/types.ts`

- [ ] **Step 1: Append the new types at the bottom of the file**

At the bottom of `packages/ui/src/ipc/types.ts` (after the existing `DiagVersionResult` interface from Plan 4), append:

```ts
// ---- WS5-C Plan 5 additions (Data panel) ----

/** `data.getExportPreflight` response. */
export interface ExportPreflightResult {
  readonly lastExportAt: number | null;
  readonly estimatedSizeBytes: number;
  readonly itemCount: number;
}

/** `data.getDeletePreflight` response. */
export interface DeletePreflightResult {
  readonly service: string;
  readonly itemCount: number;
  readonly embeddingCount: number;
  readonly vaultKeyCount: number;
}

/** `data.export` response. `recoverySeedGenerated === true` only on the first-ever export. */
export interface DataExportResult {
  readonly outputPath: string;
  readonly recoverySeed: string;
  readonly recoverySeedGenerated: boolean;
  readonly itemsExported: number;
}

/** `data.import` response. */
export interface DataImportResult {
  readonly credentialsRestored: number;
  readonly oauthEntriesFlagged: number;
}

/** Mirrors the Gateway's `DataDeletePreflight` from `packages/gateway/src/commands/data-delete.ts`. */
export interface DataDeletePreflight {
  readonly service: string;
  readonly itemsToDelete: number;
  readonly vecRowsToDelete: number;
  readonly syncTokensToDelete: number;
  readonly vaultEntriesToDelete: number;
  readonly vaultKeys: readonly string[];
  readonly peopleUnlinked: number;
}

/** `data.delete` response. `deleted === true` when a real deletion ran. */
export interface DataDeleteResult {
  readonly preflight: DataDeletePreflight;
  readonly deleted: boolean;
}

/** `data.exportProgress` notification payload. */
export interface DataExportProgressPayload {
  readonly stage: string;
  readonly bytesWritten: number;
  readonly totalBytes?: number;
}

/** `data.importProgress` notification payload. */
export interface DataImportProgressPayload {
  readonly stage: string;
  readonly bytesRead: number;
  readonly totalBytes?: number;
}

/** `data.importCompleted` notification payload — informational only, RPC result is the source of truth. */
export interface DataImportCompletedPayload {
  readonly credentialsRestored: number;
}

/** `-32010` JSON-RPC error payload for version-mismatched import archives. */
export interface DataImportVersionIncompatibleData {
  readonly kind: "version_incompatible";
  readonly archiveSchemaVersion: number;
  readonly currentSchemaVersion: number;
  readonly relation: "archive_newer" | "archive_older_unsupported";
}
```

- [ ] **Step 2: Verify typecheck passes**

```bash
bun run typecheck
```

Expected: 0 errors.

### Task 2: Add `data.*` wrappers to `packages/ui/src/ipc/client.ts`

**Files:**
- Modify: `packages/ui/src/ipc/client.ts`

- [ ] **Step 1: Extend the top-of-file type imports**

Replace the existing import block at lines 1-29 with one that adds the new types:

```ts
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  type AuditEntry,
  type AuditExportRow,
  type AuditSummary,
  type AuditVerifyResult,
  type ConnectionState,
  type ConnectorConfigPatch,
  type ConnectorStatus,
  type DataDeleteResult,
  type DataExportResult,
  type DataImportResult,
  type DeletePreflightResult,
  type DiagVersionResult,
  type ExportPreflightResult,
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

Inside the `NimbusIpcClient` interface (currently ends at the `diagGetVersion()` line), append these five wrappers just before the closing `}`:

```ts
  /** WS5-C Plan 5 additions — Data panel. */
  dataGetExportPreflight(): Promise<ExportPreflightResult>;
  dataGetDeletePreflight(args: { service: string }): Promise<DeletePreflightResult>;
  dataExport(args: {
    output: string;
    passphrase: string;
    includeIndex: boolean;
  }): Promise<DataExportResult>;
  dataImport(args: {
    bundlePath: string;
    passphrase?: string;
    recoverySeed?: string;
  }): Promise<DataImportResult>;
  dataDelete(args: { service: string; dryRun: false }): Promise<DataDeleteResult>;
```

- [ ] **Step 3: Add shape-guard helpers + wrapper implementations**

Scroll to the bottom of the file — find the `createIpcClient()` factory function. Locate the block where `diagGetVersion` is implemented (added by Plan 4). Immediately **after** `diagGetVersion`'s implementation and before the closing `};` of the returned object, insert the five new wrapper implementations.

First, add these three shape-guard helpers at the top of the file (right after the existing `redactSensitiveSubstrings` function around line 98):

```ts
function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function assertShape<T>(v: unknown, name: string, check: (r: Record<string, unknown>) => boolean): T {
  if (!isRecord(v) || !check(v)) {
    throw new Error(`IPC response for ${name} has unexpected shape`);
  }
  return v as unknown as T;
}

function assertArrayShape<T>(v: unknown, name: string): readonly T[] {
  if (!Array.isArray(v)) throw new Error(`IPC response for ${name} must be an array`);
  return v as readonly T[];
}
```

Then, inside the returned client object (after `diagGetVersion`), add:

```ts
    async dataGetExportPreflight() {
      try {
        const raw = await call("data.getExportPreflight");
        return assertShape<ExportPreflightResult>(raw, "data.getExportPreflight", (r) => {
          return (
            (r.lastExportAt === null || typeof r.lastExportAt === "number") &&
            typeof r.estimatedSizeBytes === "number" &&
            typeof r.itemCount === "number"
          );
        });
      } catch (err) {
        throw parseError(err);
      }
    },
    async dataGetDeletePreflight(args) {
      try {
        const raw = await call("data.getDeletePreflight", { service: args.service });
        return assertShape<DeletePreflightResult>(raw, "data.getDeletePreflight", (r) => {
          return (
            typeof r.service === "string" &&
            typeof r.itemCount === "number" &&
            typeof r.embeddingCount === "number" &&
            typeof r.vaultKeyCount === "number"
          );
        });
      } catch (err) {
        throw parseError(err);
      }
    },
    async dataExport(args) {
      try {
        const raw = await call("data.export", {
          output: args.output,
          passphrase: args.passphrase,
          includeIndex: args.includeIndex,
        });
        return assertShape<DataExportResult>(raw, "data.export", (r) => {
          return (
            typeof r.outputPath === "string" &&
            typeof r.recoverySeed === "string" &&
            typeof r.recoverySeedGenerated === "boolean" &&
            typeof r.itemsExported === "number"
          );
        });
      } catch (err) {
        throw parseError(err);
      }
    },
    async dataImport(args) {
      try {
        const params: Record<string, unknown> = { bundlePath: args.bundlePath };
        if (args.passphrase !== undefined) params.passphrase = args.passphrase;
        if (args.recoverySeed !== undefined) params.recoverySeed = args.recoverySeed;
        const raw = await call("data.import", params);
        return assertShape<DataImportResult>(raw, "data.import", (r) => {
          return (
            typeof r.credentialsRestored === "number" &&
            typeof r.oauthEntriesFlagged === "number"
          );
        });
      } catch (err) {
        throw parseError(err);
      }
    },
    async dataDelete(args) {
      try {
        const raw = await call("data.delete", { service: args.service, dryRun: args.dryRun });
        return assertShape<DataDeleteResult>(raw, "data.delete", (r) => {
          return (
            typeof r.deleted === "boolean" &&
            isRecord(r.preflight) &&
            typeof (r.preflight as Record<string, unknown>).service === "string"
          );
        });
      } catch (err) {
        throw parseError(err);
      }
    },
```

- [ ] **Step 4: Typecheck**

```bash
bun run typecheck
```

Expected: 0 errors.

### Task 3: Mirror wrappers in `packages/ui/src/ipc/__mocks__/client.ts`

**Files:**
- Modify: `packages/ui/src/ipc/__mocks__/client.ts`

- [ ] **Step 1: Append module-scope mocks**

At the bottom of `packages/ui/src/ipc/__mocks__/client.ts` (after the Plan-4 mocks), append:

```ts
// WS5-C Plan 5 additions — Data panel
export const dataGetExportPreflightMock = vi.fn<() => Promise<unknown>>();
export const dataGetDeletePreflightMock = vi.fn<(args: { service: string }) => Promise<unknown>>();
export const dataExportMock =
  vi.fn<(args: { output: string; passphrase: string; includeIndex: boolean }) => Promise<unknown>>();
export const dataImportMock =
  vi.fn<
    (args: { bundlePath: string; passphrase?: string; recoverySeed?: string }) => Promise<unknown>
  >();
export const dataDeleteMock =
  vi.fn<(args: { service: string; dryRun: false }) => Promise<unknown>>();
```

- [ ] **Step 2: Extend the `createIpcClient` mock**

Find the `createIpcClient` factory in the same file that returns the test client and add the new method references. The factory is typically lower in the file — look for the line that references `diagGetVersion: diagGetVersionMock`. Add after it:

```ts
    dataGetExportPreflight: dataGetExportPreflightMock,
    dataGetDeletePreflight: dataGetDeletePreflightMock,
    dataExport: dataExportMock,
    dataImport: dataImportMock,
    dataDelete: dataDeleteMock,
```

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck
```

Expected: 0 errors.

### Task 4: Create the `data` store slice

**Files:**
- Create: `packages/ui/src/store/slices/data.ts`

- [ ] **Step 1: Write the failing test skeleton** (next task fleshes it out)

Create `packages/ui/test/store/slices/data-slice.test.ts` with minimal scaffold (fuller tests added in Task 6):

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { createDataSlice, type DataSlice } from "../../../src/store/slices/data";

function makeSlice(): DataSlice {
  const storeLike: { current: Partial<DataSlice> } = { current: {} };
  const set = (partial: Partial<DataSlice> | ((s: DataSlice) => Partial<DataSlice>)) => {
    const patch = typeof partial === "function" ? partial(storeLike.current as DataSlice) : partial;
    Object.assign(storeLike.current, patch);
  };
  const get = () => storeLike.current as DataSlice;
  const api = {
    setState: set,
    getState: get,
    subscribe: () => () => {},
    destroy: () => {},
  } as never;
  const slice = createDataSlice(set as never, get as never, api);
  Object.assign(storeLike.current, slice);
  return storeLike.current as DataSlice;
}

describe("data slice — initial state", () => {
  let slice: DataSlice;
  beforeEach(() => {
    slice = makeSlice();
  });

  it("starts with all three flows idle", () => {
    expect(slice.exportFlow.status).toBe("idle");
    expect(slice.importFlow.status).toBe("idle");
    expect(slice.deleteFlow.status).toBe("idle");
  });

  it("has no cached preflight", () => {
    expect(slice.lastExportPreflight).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test — it should fail (module not found)**

```bash
cd packages/ui && bunx vitest run test/store/slices/data-slice.test.ts
```

Expected: FAIL with `Cannot find module '.../src/store/slices/data'`.

- [ ] **Step 3: Create the slice**

Create `packages/ui/src/store/slices/data.ts`:

```ts
import type { StateCreator } from "zustand";
import type {
  DataExportProgressPayload,
  DataImportProgressPayload,
  ExportPreflightResult,
} from "../../ipc/types";

/** Reason string attached to transient error state. Keyed so tests can match against constants. */
export type DataFlowErrorKind =
  | "gateway_disconnected"
  | "rpc_failed"
  | "validation"
  | "terminal";

export interface ExportFlowState {
  readonly status: "idle" | "running" | "error";
  readonly progress?: DataExportProgressPayload;
  readonly errorKind?: DataFlowErrorKind;
  readonly errorMessage?: string;
}

export interface ImportFlowState {
  readonly status: "idle" | "running" | "error";
  readonly progress?: DataImportProgressPayload;
  readonly errorKind?: DataFlowErrorKind;
  readonly errorMessage?: string;
}

export interface DeleteFlowState {
  readonly status: "idle" | "running" | "error";
  readonly service?: string;
  readonly errorKind?: DataFlowErrorKind;
  readonly errorMessage?: string;
}

export interface DataSlice {
  readonly exportFlow: ExportFlowState;
  readonly importFlow: ImportFlowState;
  readonly deleteFlow: DeleteFlowState;
  /** Memory-only cache so the Export card keeps data visible under `StaleChip` when offline. */
  readonly lastExportPreflight?: ExportPreflightResult;
  setExportFlow: (patch: Partial<ExportFlowState>) => void;
  setImportFlow: (patch: Partial<ImportFlowState>) => void;
  setDeleteFlow: (patch: Partial<DeleteFlowState>) => void;
  setExportProgress: (progress: DataExportProgressPayload) => void;
  setImportProgress: (progress: DataImportProgressPayload) => void;
  setLastExportPreflight: (preflight: ExportPreflightResult | undefined) => void;
  /**
   * Called by the connection-state subscription in DataPanel. Transitions any
   * currently-running flow to `{ status: "error", errorKind: "gateway_disconnected" }`
   * so the concurrent-flow guard releases the other two cards.
   */
  markDisconnected: () => void;
  resetDataTransients: () => void;
}

export const createDataSlice: StateCreator<DataSlice, [], [], DataSlice> = (set) => ({
  exportFlow: { status: "idle" },
  importFlow: { status: "idle" },
  deleteFlow: { status: "idle" },
  lastExportPreflight: undefined,
  setExportFlow: (patch) =>
    set((s) => ({ exportFlow: { ...s.exportFlow, ...patch } })),
  setImportFlow: (patch) =>
    set((s) => ({ importFlow: { ...s.importFlow, ...patch } })),
  setDeleteFlow: (patch) =>
    set((s) => ({ deleteFlow: { ...s.deleteFlow, ...patch } })),
  setExportProgress: (progress) =>
    set((s) => ({ exportFlow: { ...s.exportFlow, progress } })),
  setImportProgress: (progress) =>
    set((s) => ({ importFlow: { ...s.importFlow, progress } })),
  setLastExportPreflight: (preflight) => set({ lastExportPreflight: preflight }),
  markDisconnected: () =>
    set((s) => ({
      exportFlow:
        s.exportFlow.status === "running"
          ? { status: "error", errorKind: "gateway_disconnected" }
          : s.exportFlow,
      importFlow:
        s.importFlow.status === "running"
          ? { status: "error", errorKind: "gateway_disconnected" }
          : s.importFlow,
      deleteFlow:
        s.deleteFlow.status === "running"
          ? { status: "error", errorKind: "gateway_disconnected", service: s.deleteFlow.service }
          : s.deleteFlow,
    })),
  resetDataTransients: () =>
    set({
      exportFlow: { status: "idle" },
      importFlow: { status: "idle" },
      deleteFlow: { status: "idle" },
      lastExportPreflight: undefined,
    }),
});
```

- [ ] **Step 4: Run test — initial-state test should pass**

```bash
cd packages/ui && bunx vitest run test/store/slices/data-slice.test.ts
```

Expected: PASS for both `initial-state` cases.

### Task 5: Register the slice in `packages/ui/src/store/index.ts`

**Files:**
- Modify: `packages/ui/src/store/index.ts`

- [ ] **Step 1: Add the import alphabetically between `dashboard` and `hitl`**

After the existing `createDashboardSlice` import line, add:

```ts
import { createDataSlice, type DataSlice } from "./slices/data";
```

- [ ] **Step 2: Extend the `NimbusStore` type**

Add `DataSlice` into the intersection (alphabetical, after `DashboardSlice`):

```ts
export type NimbusStore = ConnectionSlice &
  TraySlice &
  QuickQuerySlice &
  OnboardingSlice &
  DashboardSlice &
  DataSlice &
  HitlSlice &
  SettingsSlice &
  ProfileSlice &
  TelemetrySlice &
  ConnectorsSlice &
  ModelSlice &
  AuditSlice &
  UpdaterSlice;
```

- [ ] **Step 3: Extend the store factory**

Add `...createDataSlice(...a),` after `...createDashboardSlice(...a),`:

```ts
    (...a) => ({
      ...createConnectionSlice(...a),
      ...createTraySlice(...a),
      ...createQuickQuerySlice(...a),
      ...createOnboardingSlice(...a),
      ...createDashboardSlice(...a),
      ...createDataSlice(...a),
      ...createHitlSlice(...a),
      ...createSettingsSlice(...a),
      ...createProfileSlice(...a),
      ...createTelemetrySlice(...a),
      ...createConnectorsSlice(...a),
      ...createModelSlice(...a),
      ...createAuditSlice(...a),
      ...createUpdaterSlice(...a),
    }),
```

- [ ] **Step 4: Typecheck**

```bash
bun run typecheck
```

Expected: 0 errors.

### Task 6: Flesh out `data-slice.test.ts`

**Files:**
- Modify: `packages/ui/test/store/slices/data-slice.test.ts`

- [ ] **Step 1: Replace with the full test**

Replace the file's contents with:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { createDataSlice, type DataSlice } from "../../../src/store/slices/data";

function makeSlice(): DataSlice {
  const storeLike: { current: Partial<DataSlice> } = { current: {} };
  const set = (partial: Partial<DataSlice> | ((s: DataSlice) => Partial<DataSlice>)) => {
    const patch = typeof partial === "function" ? partial(storeLike.current as DataSlice) : partial;
    Object.assign(storeLike.current, patch);
  };
  const get = () => storeLike.current as DataSlice;
  const api = {
    setState: set,
    getState: get,
    subscribe: () => () => {},
    destroy: () => {},
  } as never;
  const slice = createDataSlice(set as never, get as never, api);
  Object.assign(storeLike.current, slice);
  return storeLike.current as DataSlice;
}

describe("data slice — initial state", () => {
  it("starts with all three flows idle and no preflight cache", () => {
    const s = makeSlice();
    expect(s.exportFlow.status).toBe("idle");
    expect(s.importFlow.status).toBe("idle");
    expect(s.deleteFlow.status).toBe("idle");
    expect(s.lastExportPreflight).toBeUndefined();
  });
});

describe("data slice — flow transitions", () => {
  let s: DataSlice;
  beforeEach(() => {
    s = makeSlice();
  });

  it("setExportFlow patches a subset of the running state", () => {
    s.setExportFlow({ status: "running" });
    expect(s.exportFlow.status).toBe("running");
    s.setExportFlow({ status: "error", errorKind: "rpc_failed", errorMessage: "boom" });
    expect(s.exportFlow).toEqual({
      status: "error",
      errorKind: "rpc_failed",
      errorMessage: "boom",
    });
  });

  it("setExportProgress upserts the progress field without dropping status", () => {
    s.setExportFlow({ status: "running" });
    s.setExportProgress({ stage: "packing", bytesWritten: 128, totalBytes: 1024 });
    expect(s.exportFlow.status).toBe("running");
    expect(s.exportFlow.progress).toEqual({
      stage: "packing",
      bytesWritten: 128,
      totalBytes: 1024,
    });
  });

  it("setImportFlow + setImportProgress behave symmetrically", () => {
    s.setImportFlow({ status: "running" });
    s.setImportProgress({ stage: "unpacking", bytesRead: 64 });
    expect(s.importFlow.status).toBe("running");
    expect(s.importFlow.progress).toEqual({ stage: "unpacking", bytesRead: 64 });
  });

  it("setDeleteFlow tracks service across transitions", () => {
    s.setDeleteFlow({ status: "running", service: "github" });
    expect(s.deleteFlow).toEqual({ status: "running", service: "github" });
  });
});

describe("data slice — preflight cache", () => {
  it("setLastExportPreflight stores and clears", () => {
    const s = makeSlice();
    s.setLastExportPreflight({ lastExportAt: 1000, estimatedSizeBytes: 2048, itemCount: 42 });
    expect(s.lastExportPreflight?.itemCount).toBe(42);
    s.setLastExportPreflight(undefined);
    expect(s.lastExportPreflight).toBeUndefined();
  });
});

describe("data slice — markDisconnected", () => {
  it("transitions a running export flow to error with kind=gateway_disconnected", () => {
    const s = makeSlice();
    s.setExportFlow({ status: "running" });
    s.markDisconnected();
    expect(s.exportFlow).toEqual({
      status: "error",
      errorKind: "gateway_disconnected",
    });
  });

  it("leaves idle flows untouched", () => {
    const s = makeSlice();
    s.setExportFlow({ status: "running" });
    s.markDisconnected();
    expect(s.importFlow.status).toBe("idle");
    expect(s.deleteFlow.status).toBe("idle");
  });

  it("preserves service label on deleteFlow when transitioning", () => {
    const s = makeSlice();
    s.setDeleteFlow({ status: "running", service: "linear" });
    s.markDisconnected();
    expect(s.deleteFlow).toEqual({
      status: "error",
      errorKind: "gateway_disconnected",
      service: "linear",
    });
  });

  it("is a no-op when nothing is running", () => {
    const s = makeSlice();
    s.markDisconnected();
    expect(s.exportFlow.status).toBe("idle");
    expect(s.importFlow.status).toBe("idle");
    expect(s.deleteFlow.status).toBe("idle");
  });
});

describe("data slice — resetDataTransients", () => {
  it("wipes all three flows and the preflight cache", () => {
    const s = makeSlice();
    s.setExportFlow({ status: "running" });
    s.setImportFlow({ status: "error", errorKind: "rpc_failed" });
    s.setDeleteFlow({ status: "running", service: "github" });
    s.setLastExportPreflight({ lastExportAt: 1, estimatedSizeBytes: 1, itemCount: 1 });
    s.resetDataTransients();
    expect(s.exportFlow).toEqual({ status: "idle" });
    expect(s.importFlow).toEqual({ status: "idle" });
    expect(s.deleteFlow).toEqual({ status: "idle" });
    expect(s.lastExportPreflight).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test**

```bash
cd packages/ui && bunx vitest run test/store/slices/data-slice.test.ts
```

Expected: all cases PASS.

### Task 7: Extend `partialize.test.ts` to assert new keys are not persisted

**Files:**
- Modify: `packages/ui/test/store/partialize.test.ts`

- [ ] **Step 1: Peek at existing tests**

Run:

```bash
cat packages/ui/test/store/partialize.test.ts | head -40
```

You should see existing assertions covering the 5-key whitelist and 5-key forbidden blocklist. The file structure uses `persistPartialize` directly. Identify the test block that builds a synthetic state object with all slice keys and asserts the output contains only the whitelisted ones.

- [ ] **Step 2: Add a new describe-block asserting the Data slice is not persisted**

Append to `packages/ui/test/store/partialize.test.ts`:

```ts
describe("persistPartialize — Data slice (Plan 5)", () => {
  it("does not persist any data-slice fields", () => {
    const state = {
      // transient data-slice fields
      exportFlow: { status: "running", progress: { stage: "packing", bytesWritten: 0 } },
      importFlow: { status: "error", errorKind: "rpc_failed" },
      deleteFlow: { status: "running", service: "github" },
      lastExportPreflight: { lastExportAt: 123, estimatedSizeBytes: 456, itemCount: 789 },
      // plus one whitelisted key so the output isn't empty
      profiles: ["default"],
    };
    const out = persistPartialize(state as unknown as Record<string, unknown>);
    expect(out).not.toHaveProperty("exportFlow");
    expect(out).not.toHaveProperty("importFlow");
    expect(out).not.toHaveProperty("deleteFlow");
    expect(out).not.toHaveProperty("lastExportPreflight");
    expect(out).toHaveProperty("profiles", ["default"]);
  });

  it("still has WHITELISTED_PERSIST_KEYS at exactly 5 entries", () => {
    expect(WHITELISTED_PERSIST_KEYS).toHaveLength(5);
  });
});
```

If `WHITELISTED_PERSIST_KEYS` or `persistPartialize` or `describe` isn't already imported at the top of the file, make sure the import block covers them — e.g.:

```ts
import { describe, expect, it } from "vitest";
import { persistPartialize, WHITELISTED_PERSIST_KEYS } from "../../src/store/partialize";
```

- [ ] **Step 3: Run test**

```bash
cd packages/ui && bunx vitest run test/store/partialize.test.ts
```

Expected: PASS for every case, including the two new ones.

### Task 8: Commit Phase 1

- [ ] **Step 1: Confirm Phase 1 is fully green**

```bash
bun run typecheck
cd packages/ui && bunx vitest run && cd ../..
```

Expected: 0 TS errors; all Vitest cases pass.

- [ ] **Step 2: Stage and commit**

```bash
git add packages/ui/src/ipc/types.ts \
        packages/ui/src/ipc/client.ts \
        packages/ui/src/ipc/__mocks__/client.ts \
        packages/ui/src/store/slices/data.ts \
        packages/ui/src/store/index.ts \
        packages/ui/test/store/slices/data-slice.test.ts \
        packages/ui/test/store/partialize.test.ts
git commit -m "$(cat <<'EOF'
feat(ui-ipc+store): data.* plumbing for Data panel

Adds the five typed wrappers (dataGetExportPreflight, dataGetDeletePreflight,
dataExport, dataImport, dataDelete) alongside the nine supporting types and
mirrors them in the Vitest mock module. Introduces the transient `data` slice
with three flow state machines and a preflight cache used for offline
StaleChip rendering. Persist whitelist stays at exactly 5 keys — regression
test added.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds; pre-commit hooks pass.

---

## Phase 2 — Data panel + wizards + tests

Commits as a single unit at the end of Phase 2.

### Task 9: Create `DataPanel.tsx`

**Files:**
- Create: `packages/ui/src/pages/settings/DataPanel.tsx`

- [ ] **Step 1: Write the panel skeleton (wizards are stubbed until Tasks 10-12)**

Create `packages/ui/src/pages/settings/DataPanel.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { PanelError } from "../../components/settings/PanelError";
import { PanelHeader } from "../../components/settings/PanelHeader";
import { StaleChip } from "../../components/settings/StaleChip";
import { DeleteServiceDialog } from "../../components/settings/data/DeleteServiceDialog";
import { ExportWizard } from "../../components/settings/data/ExportWizard";
import { ImportWizard } from "../../components/settings/data/ImportWizard";
import { createIpcClient } from "../../ipc/client";
import { useNimbusStore } from "../../store";

type OpenWizard = "none" | "export" | "import" | "delete";

function formatTs(ms: number | null): string {
  if (ms === null) return "Never";
  const d = new Date(ms);
  return d.toLocaleString();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function DataPanel() {
  const connectionState = useNimbusStore((s) => s.connectionState);
  const exportFlow = useNimbusStore((s) => s.exportFlow);
  const importFlow = useNimbusStore((s) => s.importFlow);
  const deleteFlow = useNimbusStore((s) => s.deleteFlow);
  const lastExportPreflight = useNimbusStore((s) => s.lastExportPreflight);
  const setLastExportPreflight = useNimbusStore((s) => s.setLastExportPreflight);
  const markDisconnected = useNimbusStore((s) => s.markDisconnected);

  const [fetchError, setFetchError] = useState<string | null>(null);
  const [open, setOpen] = useState<OpenWizard>("none");

  const offline = connectionState === "disconnected";
  const anyRunning =
    exportFlow.status === "running" ||
    importFlow.status === "running" ||
    deleteFlow.status === "running";

  const refreshPreflight = useCallback(async () => {
    try {
      const res = await createIpcClient().dataGetExportPreflight();
      setLastExportPreflight(res);
      setFetchError(null);
    } catch (err) {
      setFetchError((err as Error).message);
    }
  }, [setLastExportPreflight]);

  useEffect(() => {
    if (!offline) void refreshPreflight();
  }, [offline, refreshPreflight]);

  useEffect(() => {
    if (offline && anyRunning) markDisconnected();
  }, [offline, anyRunning, markDisconnected]);

  const disabledReason = offline
    ? "Gateway offline"
    : anyRunning
      ? "An export / import / delete is already in progress."
      : null;
  const writeDisabled = disabledReason !== null;

  return (
    <section className="p-6 space-y-6">
      <PanelHeader
        title="Data"
        description="Back up, restore, and selectively delete your Nimbus data."
        livePill={offline ? <StaleChip /> : undefined}
      />
      {fetchError !== null && (
        <PanelError
          message={`Failed to load preflight: ${fetchError}`}
          onRetry={() => void refreshPreflight()}
        />
      )}

      {/* Export card */}
      <article
        data-testid="data-card-export"
        className="p-4 rounded-md border border-[var(--color-border)] space-y-3"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Back up your data</h3>
          {offline && lastExportPreflight !== undefined ? <StaleChip /> : null}
        </div>
        <p className="text-sm text-[var(--color-text-muted)]">
          Exports an encrypted <code>.tar.gz</code> containing your index, vault, and settings.
          Requires a passphrase; also produces a recovery seed.
        </p>
        <dl className="text-xs grid grid-cols-2 gap-1 max-w-md">
          <dt className="text-[var(--color-text-muted)]">Last export</dt>
          <dd>{formatTs(lastExportPreflight?.lastExportAt ?? null)}</dd>
          <dt className="text-[var(--color-text-muted)]">Index size</dt>
          <dd>{formatBytes(lastExportPreflight?.estimatedSizeBytes ?? 0)}</dd>
          <dt className="text-[var(--color-text-muted)]">Items</dt>
          <dd>{lastExportPreflight?.itemCount ?? 0}</dd>
        </dl>
        <button
          type="button"
          disabled={writeDisabled}
          onClick={() => setOpen("export")}
          title={disabledReason ?? undefined}
          className="px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
        >
          Export backup…
        </button>
      </article>

      {/* Import card */}
      <article
        data-testid="data-card-import"
        className="p-4 rounded-md border border-[var(--color-border)] space-y-3"
      >
        <h3 className="text-lg font-semibold">Restore from backup</h3>
        <p className="text-sm text-[var(--color-text-muted)]">
          Replaces your current index and vault with the contents of a Nimbus backup.
          Requires either the passphrase or the 12-word recovery seed.
        </p>
        <button
          type="button"
          disabled={writeDisabled}
          onClick={() => setOpen("import")}
          title={disabledReason ?? undefined}
          className="px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
        >
          Restore backup…
        </button>
      </article>

      {/* Delete card */}
      <article
        data-testid="data-card-delete"
        className="p-4 rounded-md border border-[var(--color-border)] space-y-3"
      >
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold">Delete service data</h3>
          <span className="text-xs px-2 py-0.5 rounded bg-[var(--color-warn-bg)] text-[var(--color-warn-fg)]">
            destructive
          </span>
        </div>
        <p className="text-sm text-[var(--color-text-muted)]">
          Permanently removes all items, embeddings, and vault credentials for one service
          (GDPR-style delete). The action is recorded in the audit log.
        </p>
        <button
          type="button"
          disabled={writeDisabled}
          onClick={() => setOpen("delete")}
          title={disabledReason ?? undefined}
          className="px-3 py-1.5 rounded-md border border-[var(--color-border)] disabled:opacity-50"
        >
          Delete service…
        </button>
      </article>

      {open === "export" && (
        <ExportWizard
          onClose={() => {
            setOpen("none");
            void refreshPreflight();
          }}
        />
      )}
      {open === "import" && <ImportWizard onClose={() => setOpen("none")} />}
      {open === "delete" && (
        <DeleteServiceDialog
          onClose={() => {
            setOpen("none");
            void refreshPreflight();
          }}
        />
      )}
    </section>
  );
}
```

The three wizard components do not yet exist; compilation will fail until Tasks 10-12.

### Task 10: Create `ExportWizard.tsx`

**Files:**
- Create: `packages/ui/src/components/settings/data/ExportWizard.tsx`

- [ ] **Step 1: Write the component**

Create `packages/ui/src/components/settings/data/ExportWizard.tsx`:

```tsx
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { exists } from "@tauri-apps/plugin-fs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import zxcvbn from "zxcvbn";
import { useIpcSubscription } from "../../../hooks/useIpcSubscription";
import { createIpcClient } from "../../../ipc/client";
import type {
  DataExportProgressPayload,
  DataExportResult,
  JsonRpcNotification,
} from "../../../ipc/types";
import { useNimbusStore } from "../../../store";

type Step =
  | "scope"
  | "passphrase"
  | "destination"
  | "overwrite-confirm"
  | "exporting"
  | "seed-first-time"
  | "seed-reminder"
  | "done"
  | "error";

interface ExportWizardProps {
  readonly onClose: () => void;
}

function todayYyyyMmDd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function ExportWizard({ onClose }: ExportWizardProps) {
  const [step, setStep] = useState<Step>("scope");
  const [includeIndex, setIncludeIndex] = useState(true);
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [destPath, setDestPath] = useState<string | null>(null);
  const [overwriteTarget, setOverwriteTarget] = useState<string | null>(null);
  const [result, setResult] = useState<DataExportResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [seedChecked, setSeedChecked] = useState(false);
  const [countdownMs, setCountdownMs] = useState<number | null>(null);

  const setExportFlow = useNimbusStore((s) => s.setExportFlow);
  const setExportProgress = useNimbusStore((s) => s.setExportProgress);
  const progress = useNimbusStore((s) => s.exportFlow.progress);

  const copyTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelCountdown = useCallback(() => {
    if (copyTimerRef.current !== null) {
      clearInterval(copyTimerRef.current);
      copyTimerRef.current = null;
    }
    if (clearTimerRef.current !== null) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
    setCountdownMs(null);
  }, []);

  useEffect(() => {
    return () => {
      // On any unmount: scrub local secrets + clear clipboard if countdown was active.
      setPassphrase("");
      setConfirmPassphrase("");
      if (countdownMs !== null) {
        void writeText("");
      }
      cancelCountdown();
    };
    // Intentionally empty deps — runs only on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onNotification = useCallback(
    (n: JsonRpcNotification) => {
      if (n.method === "data.exportProgress") {
        setExportProgress(n.params as DataExportProgressPayload);
      }
    },
    [setExportProgress],
  );
  useIpcSubscription<JsonRpcNotification>("gateway://notification", onNotification);

  const zxcvbnScore = useMemo(
    () => (passphrase.length === 0 ? 0 : zxcvbn(passphrase).score),
    [passphrase],
  );
  const passphraseValid =
    passphrase.length >= 12 && passphrase === confirmPassphrase && zxcvbnScore >= 3;

  const onPickDestination = useCallback(async () => {
    const defaultPath = `nimbus-backup-${todayYyyyMmDd()}.tar.gz`;
    const picked = await saveDialog({
      defaultPath,
      filters: [{ name: "Nimbus backup", extensions: ["tar.gz"] }],
    });
    if (picked === null) return;
    const conflict = await exists(picked);
    if (conflict) {
      setOverwriteTarget(picked);
      setStep("overwrite-confirm");
    } else {
      setDestPath(picked);
      void runExport(picked);
    }
  }, []);

  const runExport = useCallback(
    async (output: string) => {
      setStep("exporting");
      setExportFlow({ status: "running" });
      try {
        const res = await createIpcClient().dataExport({
          output,
          passphrase,
          includeIndex,
        });
        setResult(res);
        setExportFlow({ status: "idle" });
        setStep(res.recoverySeedGenerated ? "seed-first-time" : "seed-reminder");
      } catch (err) {
        setErrorMessage((err as Error).message);
        setExportFlow({
          status: "error",
          errorKind: "rpc_failed",
          errorMessage: (err as Error).message,
        });
        setStep("error");
      }
    },
    [passphrase, includeIndex, setExportFlow],
  );

  const onOverwriteConfirm = useCallback(() => {
    if (overwriteTarget === null) return;
    setDestPath(overwriteTarget);
    void runExport(overwriteTarget);
  }, [overwriteTarget, runExport]);

  const onCopySeed = useCallback(async () => {
    if (result === null) return;
    await writeText(result.recoverySeed);
    cancelCountdown();
    setCountdownMs(30_000);
    copyTimerRef.current = setInterval(() => {
      setCountdownMs((ms) => (ms === null ? null : Math.max(0, ms - 1000)));
    }, 1000);
    clearTimerRef.current = setTimeout(() => {
      void writeText("");
      cancelCountdown();
    }, 30_000);
  }, [result, cancelCountdown]);

  const progressPct =
    progress !== undefined && progress.totalBytes !== undefined && progress.totalBytes > 0
      ? Math.min(100, Math.round((progress.bytesWritten / progress.totalBytes) * 100))
      : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="export-wizard"
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
    >
      <div className="bg-[var(--color-bg)] rounded-lg max-w-lg w-full p-6 space-y-4 border border-[var(--color-border)]">
        {step === "scope" && (
          <>
            <h2 className="text-xl font-semibold">Backup scope</h2>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeIndex}
                onChange={(e) => setIncludeIndex(e.target.checked)}
              />
              Include search index (.db)
            </label>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setStep("passphrase")}
                className="px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white"
              >
                Next
              </button>
            </div>
          </>
        )}

        {step === "passphrase" && (
          <>
            <h2 className="text-xl font-semibold">Choose a passphrase</h2>
            <p className="text-sm text-[var(--color-text-muted)]">
              Encrypts the vault inside your backup. Minimum 12 characters. Strength must be
              Fair or higher.
            </p>
            <input
              type="password"
              autoComplete="new-password"
              placeholder="Passphrase"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className="w-full px-2 py-1 border border-[var(--color-border)] rounded"
            />
            <input
              type="password"
              autoComplete="new-password"
              placeholder="Confirm passphrase"
              value={confirmPassphrase}
              onChange={(e) => setConfirmPassphrase(e.target.value)}
              className="w-full px-2 py-1 border border-[var(--color-border)] rounded"
            />
            <div data-testid="zxcvbn-score" className="text-xs">
              Strength: {["Very weak", "Weak", "Fair", "Good", "Strong"][zxcvbnScore]}
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setStep("scope")}>
                Back
              </button>
              <button
                type="button"
                disabled={!passphraseValid}
                onClick={() => setStep("destination")}
                className="px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </>
        )}

        {step === "destination" && (
          <>
            <h2 className="text-xl font-semibold">Choose destination</h2>
            <p className="text-sm">
              A save dialog will open. The file defaults to{" "}
              <code>nimbus-backup-{todayYyyyMmDd()}.tar.gz</code>.
            </p>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setStep("passphrase")}>
                Back
              </button>
              <button
                type="button"
                onClick={() => void onPickDestination()}
                className="px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white"
              >
                Choose file…
              </button>
            </div>
          </>
        )}

        {step === "overwrite-confirm" && overwriteTarget !== null && (
          <>
            <h2 className="text-xl font-semibold">File already exists</h2>
            <p className="text-sm">
              Overwrite <code>{overwriteTarget}</code>?
            </p>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setStep("destination")}>
                Cancel
              </button>
              <button
                type="button"
                onClick={onOverwriteConfirm}
                className="px-3 py-1.5 rounded-md bg-[var(--color-danger)] text-white"
              >
                Overwrite
              </button>
            </div>
          </>
        )}

        {step === "exporting" && (
          <>
            <h2 className="text-xl font-semibold">Creating backup…</h2>
            {progressPct !== null ? (
              <div className="w-full h-2 bg-[var(--color-bg-subtle)] rounded overflow-hidden">
                <div
                  data-testid="export-progress-bar"
                  role="progressbar"
                  aria-valuenow={progressPct}
                  style={{ width: `${progressPct}%` }}
                  className="h-full bg-[var(--color-accent)] transition-all"
                />
              </div>
            ) : (
              <div
                data-testid="export-progress-indeterminate"
                role="progressbar"
                aria-valuetext="indeterminate"
                className="w-full h-2 bg-[var(--color-bg-subtle)] rounded overflow-hidden animate-pulse"
              />
            )}
            <p className="text-xs text-[var(--color-text-muted)]">
              Stage: {progress?.stage ?? "starting"}
            </p>
          </>
        )}

        {step === "seed-first-time" && result !== null && (
          <>
            <h2 className="text-xl font-semibold">Save your recovery seed</h2>
            <p className="text-sm font-semibold text-[var(--color-danger)]">
              Nimbus cannot recover this seed for you if you lose it.
            </p>
            <pre
              data-testid="recovery-seed"
              className="p-3 bg-[var(--color-bg-subtle)] rounded text-sm whitespace-pre-wrap"
            >
              {result.recoverySeed}
            </pre>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void onCopySeed()}
                className="px-2 py-1 rounded border border-[var(--color-border)] text-sm"
              >
                Copy
              </button>
              {countdownMs !== null && (
                <span data-testid="clipboard-countdown" className="text-xs">
                  Clipboard clears in 0:{String(Math.ceil(countdownMs / 1000)).padStart(2, "0")}
                </span>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={seedChecked}
                onChange={(e) => setSeedChecked(e.target.checked)}
              />
              I have stored this seed somewhere safe.
            </label>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                disabled={!seedChecked}
                onClick={onClose}
                className="px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
              >
                Done
              </button>
            </div>
          </>
        )}

        {step === "seed-reminder" && (
          <>
            <h2 className="text-xl font-semibold">Backup saved</h2>
            <p className="text-sm">
              Your recovery seed hasn't changed — keep your saved copy somewhere safe.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white"
              >
                Done
              </button>
            </div>
          </>
        )}

        {step === "error" && (
          <>
            <h2 className="text-xl font-semibold">Export failed</h2>
            <p className="text-sm">
              {errorMessage}
              {destPath !== null && (
                <>
                  {" "}
                  A partial file may exist at <code>{destPath}</code> — delete it before retrying.
                </>
              )}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-md border border-[var(--color-border)]"
              >
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

### Task 11: Create `ImportWizard.tsx`

**Files:**
- Create: `packages/ui/src/components/settings/data/ImportWizard.tsx`

- [ ] **Step 1: Get the BIP39 wordlist reference**

`bip39` is not currently a UI dependency. Reuse the Gateway's wordlist via a static import from `packages/gateway/src/db/recovery-seed.ts` is not an option (cross-package boundary). Instead, validate by calling `dataImport` with the seed; local validation can use a simple heuristic that a BIP39 word is `a-z, 3-8 chars`. Full wordlist validation happens server-side when `dataImport` tries to reconstruct the seed.

(Pragmatic choice: reject non-a-z inputs or blank cells on blur; accept any lowercase word of plausible length. Server returns `-32002 decryption_failed` if the word set is actually wrong — surfaced as the inline retry error described in the spec §5.1.)

- [ ] **Step 2: Write the component**

Create `packages/ui/src/components/settings/data/ImportWizard.tsx`:

```tsx
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createIpcClient } from "../../../ipc/client";
import { useIpcSubscription } from "../../../hooks/useIpcSubscription";
import type {
  DataImportProgressPayload,
  DataImportVersionIncompatibleData,
  JsonRpcNotification,
} from "../../../ipc/types";
import { JsonRpcError } from "../../../ipc/types";
import { useNimbusStore } from "../../../store";

type AuthMethod = "passphrase" | "recoverySeed";
type Step =
  | "file"
  | "auth"
  | "confirm"
  | "importing"
  | "done"
  | "error-retryable"
  | "error-terminal";

interface ImportWizardProps {
  readonly onClose: () => void;
}

const TYPED_CONFIRM_PHRASE = "replace my data";
const RELOAD_DELAY_MS = 3000;

function looksLikeBip39Word(v: string): boolean {
  return /^[a-z]{3,8}$/.test(v.trim());
}

export function ImportWizard({ onClose }: ImportWizardProps) {
  const [step, setStep] = useState<Step>("file");
  const [bundlePath, setBundlePath] = useState<string | null>(null);
  const [authMethod, setAuthMethod] = useState<AuthMethod>("passphrase");
  const [passphrase, setPassphrase] = useState("");
  const [seedWords, setSeedWords] = useState<string[]>(() => Array<string>(12).fill(""));
  const [typedConfirm, setTypedConfirm] = useState("");
  const [errorCopy, setErrorCopy] = useState<string | null>(null);
  const [credentialsRestored, setCredentialsRestored] = useState(0);
  const [oauthEntriesFlagged, setOauthEntriesFlagged] = useState(0);

  const setImportFlow = useNimbusStore((s) => s.setImportFlow);
  const setImportProgress = useNimbusStore((s) => s.setImportProgress);
  const progress = useNimbusStore((s) => s.importFlow.progress);

  useEffect(() => {
    return () => {
      setPassphrase("");
      setSeedWords(Array<string>(12).fill(""));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onNotification = useCallback(
    (n: JsonRpcNotification) => {
      if (n.method === "data.importProgress") {
        setImportProgress(n.params as DataImportProgressPayload);
      }
    },
    [setImportProgress],
  );
  useIpcSubscription<JsonRpcNotification>("gateway://notification", onNotification);

  const seedValid = useMemo(() => seedWords.every(looksLikeBip39Word), [seedWords]);
  const authValid =
    authMethod === "passphrase" ? passphrase.length > 0 : seedValid;

  const onPickFile = useCallback(async () => {
    const picked = await openDialog({
      filters: [{ name: "Nimbus backup", extensions: ["tar.gz"] }],
    });
    if (typeof picked === "string") {
      setBundlePath(picked);
      setStep("auth");
    }
  }, []);

  const runImport = useCallback(async () => {
    if (bundlePath === null) return;
    setStep("importing");
    setImportFlow({ status: "running" });
    try {
      const client = createIpcClient();
      const res = await client.dataImport({
        bundlePath,
        ...(authMethod === "passphrase" ? { passphrase } : {}),
        ...(authMethod === "recoverySeed" ? { recoverySeed: seedWords.join(" ") } : {}),
      });
      setCredentialsRestored(res.credentialsRestored);
      setOauthEntriesFlagged(res.oauthEntriesFlagged);
      setImportFlow({ status: "idle" });
      setStep("done");
      setTimeout(() => {
        window.location.reload();
      }, RELOAD_DELAY_MS);
    } catch (err) {
      const rpcErr = err instanceof JsonRpcError ? err : null;
      if (rpcErr !== null && rpcErr.code === -32010) {
        const data = rpcErr.data as DataImportVersionIncompatibleData | undefined;
        setErrorCopy(
          data?.relation === "archive_newer"
            ? "This backup is from a newer Nimbus. Update Nimbus, then retry."
            : "This backup is from an older, unsupported Nimbus. No migration path in v0.1.0.",
        );
        setImportFlow({ status: "error", errorKind: "terminal" });
        setStep("error-terminal");
        return;
      }
      if (rpcErr !== null && rpcErr.code === -32003) {
        setErrorCopy("Archive is corrupt or tampered. No changes made.");
        setImportFlow({ status: "error", errorKind: "terminal" });
        setStep("error-terminal");
        return;
      }
      if (rpcErr !== null && rpcErr.code === -32002) {
        setErrorCopy(
          authMethod === "passphrase"
            ? "Could not decrypt with that passphrase. Check and retry."
            : "Could not decrypt with that recovery seed. Check each word and retry.",
        );
        setImportFlow({ status: "error", errorKind: "validation" });
        setStep("error-retryable");
        return;
      }
      setErrorCopy(`Import failed — your data was not changed. ${(err as Error).message}`);
      setImportFlow({
        status: "error",
        errorKind: "rpc_failed",
        errorMessage: (err as Error).message,
      });
      setStep("error-retryable");
    }
  }, [bundlePath, authMethod, passphrase, seedWords, setImportFlow]);

  const progressPct =
    progress !== undefined && progress.totalBytes !== undefined && progress.totalBytes > 0
      ? Math.min(100, Math.round((progress.bytesRead / progress.totalBytes) * 100))
      : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="import-wizard"
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
    >
      <div className="bg-[var(--color-bg)] rounded-lg max-w-lg w-full p-6 space-y-4 border border-[var(--color-border)]">
        {step === "file" && (
          <>
            <h2 className="text-xl font-semibold">Pick a backup file</h2>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void onPickFile()}
                className="px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white"
              >
                Choose file…
              </button>
            </div>
          </>
        )}

        {step === "auth" && bundlePath !== null && (
          <>
            <h2 className="text-xl font-semibold">Unlock the backup</h2>
            <p className="text-xs text-[var(--color-text-muted)]">
              File: <code>{bundlePath}</code>
            </p>
            <fieldset className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="auth-method"
                  checked={authMethod === "passphrase"}
                  onChange={() => setAuthMethod("passphrase")}
                />
                Passphrase
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="auth-method"
                  checked={authMethod === "recoverySeed"}
                  onChange={() => setAuthMethod("recoverySeed")}
                />
                Recovery seed (12 words)
              </label>
            </fieldset>
            {authMethod === "passphrase" ? (
              <input
                type="password"
                autoComplete="current-password"
                placeholder="Passphrase"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                className="w-full px-2 py-1 border border-[var(--color-border)] rounded"
              />
            ) : (
              <div className="grid grid-cols-3 gap-2" data-testid="bip39-grid">
                {seedWords.map((w, i) => (
                  <input
                    // eslint-disable-next-line react/no-array-index-key
                    key={i}
                    type="text"
                    aria-label={`Word ${i + 1}`}
                    value={w}
                    onChange={(e) => {
                      const next = [...seedWords];
                      next[i] = e.target.value.toLowerCase();
                      setSeedWords(next);
                    }}
                    className={[
                      "px-2 py-1 border rounded text-sm",
                      w.length === 0 || looksLikeBip39Word(w)
                        ? "border-[var(--color-border)]"
                        : "border-[var(--color-danger)]",
                    ].join(" ")}
                  />
                ))}
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setStep("file")}>
                Back
              </button>
              <button
                type="button"
                disabled={!authValid}
                onClick={() => setStep("confirm")}
                className="px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </>
        )}

        {step === "confirm" && (
          <>
            <h2 className="text-xl font-semibold">This replaces your current data</h2>
            <p className="text-sm">
              Importing this backup will overwrite your current index and vault. This cannot be
              undone. Type <code>{TYPED_CONFIRM_PHRASE}</code> to proceed.
            </p>
            <input
              type="text"
              value={typedConfirm}
              onChange={(e) => setTypedConfirm(e.target.value)}
              placeholder={TYPED_CONFIRM_PHRASE}
              className="w-full px-2 py-1 border border-[var(--color-border)] rounded"
            />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setStep("auth")}>
                Back
              </button>
              <button
                type="button"
                disabled={typedConfirm !== TYPED_CONFIRM_PHRASE}
                onClick={() => void runImport()}
                className="px-3 py-1.5 rounded-md bg-[var(--color-danger)] text-white disabled:opacity-50"
              >
                Replace my data
              </button>
            </div>
          </>
        )}

        {step === "importing" && (
          <>
            <h2 className="text-xl font-semibold">Restoring backup…</h2>
            {progressPct !== null ? (
              <div className="w-full h-2 bg-[var(--color-bg-subtle)] rounded overflow-hidden">
                <div
                  data-testid="import-progress-bar"
                  role="progressbar"
                  aria-valuenow={progressPct}
                  style={{ width: `${progressPct}%` }}
                  className="h-full bg-[var(--color-accent)] transition-all"
                />
              </div>
            ) : (
              <div
                data-testid="import-progress-indeterminate"
                role="progressbar"
                aria-valuetext="indeterminate"
                className="w-full h-2 bg-[var(--color-bg-subtle)] rounded overflow-hidden animate-pulse"
              />
            )}
            <p className="text-xs text-[var(--color-text-muted)]">
              Stage: {progress?.stage ?? "starting"}
            </p>
          </>
        )}

        {step === "done" && (
          <>
            <h2 className="text-xl font-semibold">Restore complete</h2>
            <p className="text-sm">
              Restored {credentialsRestored} credential{credentialsRestored === 1 ? "" : "s"}.
            </p>
            {oauthEntriesFlagged > 0 && (
              <p className="text-sm text-[var(--color-warn-fg)]">
                {oauthEntriesFlagged} OAuth connector{oauthEntriesFlagged === 1 ? "" : "s"} need
                re-authorization.
              </p>
            )}
            <p className="text-sm text-[var(--color-text-muted)]">Reloading in 3 seconds…</p>
          </>
        )}

        {step === "error-retryable" && (
          <>
            <h2 className="text-xl font-semibold">Restore failed</h2>
            <p className="text-sm">{errorCopy}</p>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={onClose}>
                Close
              </button>
              <button
                type="button"
                onClick={() => setStep("auth")}
                className="px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white"
              >
                Retry
              </button>
            </div>
          </>
        )}

        {step === "error-terminal" && (
          <>
            <h2 className="text-xl font-semibold">Restore failed</h2>
            <p className="text-sm">{errorCopy}</p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-md border border-[var(--color-border)]"
              >
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

Note: `JsonRpcError` comes from `ipc/types.ts` (already exported — grep-verify if unsure).

### Task 12: Create `DeleteServiceDialog.tsx`

**Files:**
- Create: `packages/ui/src/components/settings/data/DeleteServiceDialog.tsx`

- [ ] **Step 1: Write the component**

Create `packages/ui/src/components/settings/data/DeleteServiceDialog.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { createIpcClient } from "../../../ipc/client";
import type { DataDeleteResult, DeletePreflightResult } from "../../../ipc/types";
import { useNimbusStore } from "../../../store";

type Step = "pick" | "preview" | "confirming" | "deleting" | "done" | "error";

interface DeleteServiceDialogProps {
  readonly onClose: () => void;
}

export function DeleteServiceDialog({ onClose }: DeleteServiceDialogProps) {
  const [step, setStep] = useState<Step>("pick");
  const [service, setService] = useState<string>("");
  const [preflight, setPreflight] = useState<DeletePreflightResult | null>(null);
  const [typedName, setTypedName] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [result, setResult] = useState<DataDeleteResult | null>(null);

  const connectors = useNimbusStore((s) => s.connectorsList) ?? [];
  const setDeleteFlow = useNimbusStore((s) => s.setDeleteFlow);

  const configuredServices = connectors
    .filter((c) => c.status !== "not_configured")
    .map((c) => c.service);

  useEffect(() => {
    if (configuredServices.length > 0 && service === "") {
      setService(configuredServices[0] as string);
    }
  }, [configuredServices, service]);

  const onLoadPreflight = useCallback(async () => {
    if (service === "") return;
    setPreflightLoading(true);
    try {
      const res = await createIpcClient().dataGetDeletePreflight({ service });
      setPreflight(res);
      setStep("preview");
    } catch (err) {
      setErrorMessage((err as Error).message);
      setStep("error");
    } finally {
      setPreflightLoading(false);
    }
  }, [service]);

  const onDelete = useCallback(async () => {
    setStep("deleting");
    setDeleteFlow({ status: "running", service });
    try {
      const res = await createIpcClient().dataDelete({ service, dryRun: false });
      setResult(res);
      setDeleteFlow({ status: "idle" });
      setStep("done");
    } catch (err) {
      setErrorMessage((err as Error).message);
      setDeleteFlow({
        status: "error",
        errorKind: "rpc_failed",
        errorMessage: (err as Error).message,
        service,
      });
      setStep("error");
    }
  }, [service, setDeleteFlow]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="delete-dialog"
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
    >
      <div className="bg-[var(--color-bg)] rounded-lg max-w-lg w-full p-6 space-y-4 border border-[var(--color-border)]">
        {step === "pick" && (
          <>
            <h2 className="text-xl font-semibold">Delete service data</h2>
            <p className="text-sm text-[var(--color-text-muted)]">
              Pick a configured service to permanently delete all its items, embeddings, and
              vault credentials.
            </p>
            <select
              aria-label="Service"
              value={service}
              onChange={(e) => setService(e.target.value)}
              disabled={configuredServices.length === 0}
              className="w-full px-2 py-1 border border-[var(--color-border)] rounded"
            >
              {configuredServices.length === 0 && <option value="">No services configured</option>}
              {configuredServices.map((sv) => (
                <option key={sv} value={sv}>
                  {sv}
                </option>
              ))}
            </select>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                disabled={service === ""}
                onClick={() => void onLoadPreflight()}
                className="px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </>
        )}

        {preflightLoading && step === "pick" && (
          <p
            data-testid="preflight-loading"
            className="text-sm text-[var(--color-text-muted)]"
          >
            Calculating…
          </p>
        )}

        {step === "preview" && preflight !== null && (
          <>
            <h2 className="text-xl font-semibold">
              Confirm deletion of <code>{service}</code>
            </h2>
            <ul className="text-sm list-disc pl-5 space-y-1">
              <li>
                Deletes <strong>{preflight.itemCount}</strong> items
              </li>
              <li>
                Deletes <strong>{preflight.embeddingCount}</strong> embeddings
              </li>
              <li>
                Deletes <strong>{preflight.vaultKeyCount}</strong> vault keys
              </li>
            </ul>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setStep("pick")}>
                Back
              </button>
              <button
                type="button"
                onClick={() => setStep("confirming")}
                className="px-3 py-1.5 rounded-md bg-[var(--color-danger)] text-white"
              >
                Proceed
              </button>
            </div>
          </>
        )}

        {step === "confirming" && (
          <>
            <h2 className="text-xl font-semibold">Type to confirm</h2>
            <p className="text-sm">
              Type the service id <code>{service}</code> exactly to confirm. This comparison is
              case-sensitive.
            </p>
            <input
              type="text"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              placeholder={service}
              className="w-full px-2 py-1 border border-[var(--color-border)] rounded"
            />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setStep("preview")}>
                Back
              </button>
              <button
                type="button"
                disabled={typedName !== service}
                onClick={() => void onDelete()}
                className="px-3 py-1.5 rounded-md bg-[var(--color-danger)] text-white disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </>
        )}

        {step === "deleting" && (
          <>
            <h2 className="text-xl font-semibold">Deleting…</h2>
            <p className="text-sm text-[var(--color-text-muted)]">Removing data for {service}.</p>
          </>
        )}

        {step === "done" && result !== null && (
          <>
            <h2 className="text-xl font-semibold">Deleted</h2>
            <p className="text-sm">
              {result.deleted ? (
                <>
                  Deleted {result.preflight.itemsToDelete} items from <code>{service}</code>.
                </>
              ) : (
                <>Nothing was deleted (server returned `deleted: false`).</>
              )}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white"
              >
                Close
              </button>
            </div>
          </>
        )}

        {step === "error" && (
          <>
            <h2 className="text-xl font-semibold">Delete failed</h2>
            <p className="text-sm">
              {errorMessage ?? "Delete failed — data unchanged."}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-md border border-[var(--color-border)]"
              >
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

### Task 13: Wire the route in `packages/ui/src/App.tsx`

**Files:**
- Modify: `packages/ui/src/App.tsx`

- [ ] **Step 1: Add the import**

After the existing `import { AuditPanel } from "./pages/settings/AuditPanel";` line, add:

```tsx
import { DataPanel } from "./pages/settings/DataPanel";
```

- [ ] **Step 2: Replace the placeholder route**

Replace line 60:

```tsx
<Route path="data" element={<PanelComingSoon title="Data" />} />
```

with:

```tsx
<Route path="data" element={<DataPanel />} />
```

- [ ] **Step 3: Typecheck + build**

```bash
bun run typecheck
cd packages/ui && bunx vite build && cd ../..
```

Expected: 0 errors, clean build.

### Task 14: `DataPanel.test.tsx`

**Files:**
- Create: `packages/ui/test/pages/settings/DataPanel.test.tsx`

- [ ] **Step 1: Write the tests**

```tsx
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataPanel } from "../../../src/pages/settings/DataPanel";
import { useNimbusStore } from "../../../src/store";
import {
  dataGetExportPreflightMock,
} from "../../../src/ipc/__mocks__/client";

vi.mock("../../../src/ipc/client");

function resetStore() {
  useNimbusStore.setState({
    connectionState: "connected",
    exportFlow: { status: "idle" },
    importFlow: { status: "idle" },
    deleteFlow: { status: "idle" },
    lastExportPreflight: undefined,
    connectorsList: [],
  } as never);
}

describe("DataPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    dataGetExportPreflightMock.mockResolvedValue({
      lastExportAt: null,
      estimatedSizeBytes: 0,
      itemCount: 0,
    });
  });

  it("renders the three cards", async () => {
    render(<DataPanel />);
    expect(screen.getByTestId("data-card-export")).toBeInTheDocument();
    expect(screen.getByTestId("data-card-import")).toBeInTheDocument();
    expect(screen.getByTestId("data-card-delete")).toBeInTheDocument();
  });

  it("displays 'Never' when lastExportAt is null", async () => {
    render(<DataPanel />);
    await vi.waitFor(() => {
      expect(screen.getByText("Never")).toBeInTheDocument();
    });
  });

  it("disables all three buttons when connectionState === 'disconnected'", async () => {
    useNimbusStore.setState({ connectionState: "disconnected" } as never);
    render(<DataPanel />);
    const exportBtn = screen.getByRole("button", { name: /Export backup/ });
    const importBtn = screen.getByRole("button", { name: /Restore backup/ });
    const deleteBtn = screen.getByRole("button", { name: /Delete service/ });
    expect(exportBtn).toBeDisabled();
    expect(importBtn).toBeDisabled();
    expect(deleteBtn).toBeDisabled();
  });

  it("disables siblings while one flow is running", async () => {
    useNimbusStore.setState({ exportFlow: { status: "running" } } as never);
    render(<DataPanel />);
    expect(screen.getByRole("button", { name: /Restore backup/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Delete service/ })).toBeDisabled();
  });

  it("calls markDisconnected when connection drops during a running flow", async () => {
    const mark = vi.fn();
    useNimbusStore.setState({
      exportFlow: { status: "running" },
      markDisconnected: mark,
    } as never);
    // First render in connected state
    const { rerender } = render(<DataPanel />);
    // Flip to disconnected
    useNimbusStore.setState({ connectionState: "disconnected" } as never);
    rerender(<DataPanel />);
    await vi.waitFor(() => {
      expect(mark).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run**

```bash
cd packages/ui && bunx vitest run test/pages/settings/DataPanel.test.tsx
```

Expected: all cases pass.

### Task 15: `ExportWizard.test.tsx`

**Files:**
- Create: `packages/ui/test/components/settings/data/ExportWizard.test.tsx`

- [ ] **Step 1: Write the tests**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExportWizard } from "../../../../src/components/settings/data/ExportWizard";
import { useNimbusStore } from "../../../../src/store";
import { dataExportMock } from "../../../../src/ipc/__mocks__/client";

vi.mock("../../../../src/ipc/client");

const saveMock = vi.fn<() => Promise<string | null>>();
const existsMock = vi.fn<() => Promise<boolean>>();
const writeTextMock = vi.fn<(text: string) => Promise<void>>();

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: (...args: unknown[]) => saveMock(...(args as [])),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: (...args: unknown[]) => existsMock(...(args as [])),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: (text: string) => writeTextMock(text),
  open: () => undefined,
}));

function resetStore() {
  useNimbusStore.setState({
    connectionState: "connected",
    exportFlow: { status: "idle" },
    setExportFlow: (patch) =>
      useNimbusStore.setState((s) => ({
        exportFlow: { ...s.exportFlow, ...patch },
      }) as never),
    setExportProgress: (progress) =>
      useNimbusStore.setState((s) => ({
        exportFlow: { ...s.exportFlow, progress },
      }) as never),
  } as never);
}

describe("ExportWizard — passphrase gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it("blocks Next when zxcvbn score < 3", async () => {
    render(<ExportWizard onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    const input = screen.getAllByPlaceholderText(/assphrase/)[0] as HTMLInputElement;
    const confirm = screen.getAllByPlaceholderText(/Confirm/)[0] as HTMLInputElement;
    await userEvent.type(input, "password1234");
    await userEvent.type(confirm, "password1234");
    const nextBtns = screen.getAllByRole("button", { name: "Next" });
    const next = nextBtns[nextBtns.length - 1] as HTMLButtonElement;
    expect(next).toBeDisabled();
  });

  it("allows Next when zxcvbn score ≥ 3 and passphrase === confirm and length ≥ 12", async () => {
    render(<ExportWizard onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    const input = screen.getAllByPlaceholderText(/assphrase/)[0] as HTMLInputElement;
    const confirm = screen.getAllByPlaceholderText(/Confirm/)[0] as HTMLInputElement;
    // A long, varied passphrase zxcvbn scores 3+
    await userEvent.type(input, "reasonably-strong-example-phrase!");
    await userEvent.type(confirm, "reasonably-strong-example-phrase!");
    const nextBtns = screen.getAllByRole("button", { name: "Next" });
    const next = nextBtns[nextBtns.length - 1] as HTMLButtonElement;
    expect(next).not.toBeDisabled();
  });
});

describe("ExportWizard — destination + overwrite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it("save dialog is called with a YYYY-MM-DD default filename", async () => {
    saveMock.mockResolvedValue(null);
    render(<ExportWizard onClose={() => {}} />);
    // Step through scope + passphrase
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.type(
      screen.getAllByPlaceholderText(/assphrase/)[0] as HTMLInputElement,
      "reasonably-strong-example-phrase!",
    );
    await userEvent.type(
      screen.getAllByPlaceholderText(/Confirm/)[0] as HTMLInputElement,
      "reasonably-strong-example-phrase!",
    );
    const nextBtns = screen.getAllByRole("button", { name: "Next" });
    await userEvent.click(nextBtns[nextBtns.length - 1] as HTMLElement);
    await userEvent.click(screen.getByRole("button", { name: /Choose file/ }));
    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: expect.stringMatching(/^nimbus-backup-\d{4}-\d{2}-\d{2}\.tar\.gz$/),
      }),
    );
  });

  it("shows overwrite sub-step when exists() returns true", async () => {
    saveMock.mockResolvedValue("/tmp/existing.tar.gz");
    existsMock.mockResolvedValue(true);
    render(<ExportWizard onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.type(
      screen.getAllByPlaceholderText(/assphrase/)[0] as HTMLInputElement,
      "reasonably-strong-example-phrase!",
    );
    await userEvent.type(
      screen.getAllByPlaceholderText(/Confirm/)[0] as HTMLInputElement,
      "reasonably-strong-example-phrase!",
    );
    const nextBtns = screen.getAllByRole("button", { name: "Next" });
    await userEvent.click(nextBtns[nextBtns.length - 1] as HTMLElement);
    await userEvent.click(screen.getByRole("button", { name: /Choose file/ }));
    await vi.waitFor(() => {
      expect(screen.getByText(/already exists/i)).toBeInTheDocument();
    });
  });
});

describe("ExportWizard — progress bar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it("renders the indeterminate bar when totalBytes is undefined", async () => {
    useNimbusStore.setState({
      exportFlow: {
        status: "running",
        progress: { stage: "packing", bytesWritten: 100 },
      },
    } as never);
    dataExportMock.mockImplementation(() => new Promise(() => {}));
    saveMock.mockResolvedValue("/tmp/nimbus.tar.gz");
    existsMock.mockResolvedValue(false);
    render(<ExportWizard onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.type(
      screen.getAllByPlaceholderText(/assphrase/)[0] as HTMLInputElement,
      "reasonably-strong-example-phrase!",
    );
    await userEvent.type(
      screen.getAllByPlaceholderText(/Confirm/)[0] as HTMLInputElement,
      "reasonably-strong-example-phrase!",
    );
    const nextBtns = screen.getAllByRole("button", { name: "Next" });
    await userEvent.click(nextBtns[nextBtns.length - 1] as HTMLElement);
    await userEvent.click(screen.getByRole("button", { name: /Choose file/ }));
    await vi.waitFor(() => {
      expect(screen.getByTestId("export-progress-indeterminate")).toBeInTheDocument();
    });
  });

  it("renders the determinate bar when totalBytes is present", async () => {
    useNimbusStore.setState({
      exportFlow: {
        status: "running",
        progress: { stage: "packing", bytesWritten: 50, totalBytes: 100 },
      },
    } as never);
    dataExportMock.mockImplementation(() => new Promise(() => {}));
    saveMock.mockResolvedValue("/tmp/nimbus.tar.gz");
    existsMock.mockResolvedValue(false);
    render(<ExportWizard onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.type(
      screen.getAllByPlaceholderText(/assphrase/)[0] as HTMLInputElement,
      "reasonably-strong-example-phrase!",
    );
    await userEvent.type(
      screen.getAllByPlaceholderText(/Confirm/)[0] as HTMLInputElement,
      "reasonably-strong-example-phrase!",
    );
    const nextBtns = screen.getAllByRole("button", { name: "Next" });
    await userEvent.click(nextBtns[nextBtns.length - 1] as HTMLElement);
    await userEvent.click(screen.getByRole("button", { name: /Choose file/ }));
    await vi.waitFor(() => {
      expect(screen.getByTestId("export-progress-bar")).toBeInTheDocument();
    });
  });
});

describe("ExportWizard — seed branching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    saveMock.mockResolvedValue("/tmp/nimbus.tar.gz");
    existsMock.mockResolvedValue(false);
  });

  async function stepToSeed(generated: boolean) {
    dataExportMock.mockResolvedValue({
      outputPath: "/tmp/nimbus.tar.gz",
      recoverySeed: "abandon ability able about above absent absorb abstract absurd abuse access accident",
      recoverySeedGenerated: generated,
      itemsExported: 7,
    });
    render(<ExportWizard onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.type(
      screen.getAllByPlaceholderText(/assphrase/)[0] as HTMLInputElement,
      "reasonably-strong-example-phrase!",
    );
    await userEvent.type(
      screen.getAllByPlaceholderText(/Confirm/)[0] as HTMLInputElement,
      "reasonably-strong-example-phrase!",
    );
    const nextBtns = screen.getAllByRole("button", { name: "Next" });
    await userEvent.click(nextBtns[nextBtns.length - 1] as HTMLElement);
    await userEvent.click(screen.getByRole("button", { name: /Choose file/ }));
  }

  it("first-time: shows mnemonic + 'Nimbus cannot recover' warning + gated checkbox", async () => {
    await stepToSeed(true);
    await vi.waitFor(() => {
      expect(screen.getByTestId("recovery-seed")).toBeInTheDocument();
    });
    expect(screen.getByText(/Nimbus cannot recover/i)).toBeInTheDocument();
    const done = screen.getByRole("button", { name: "Done" });
    expect(done).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox"));
    expect(done).not.toBeDisabled();
  });

  it("re-export: shows reminder card without mnemonic", async () => {
    await stepToSeed(false);
    await vi.waitFor(() => {
      expect(screen.queryByTestId("recovery-seed")).not.toBeInTheDocument();
    });
    expect(screen.getByText(/Your recovery seed hasn't changed/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).not.toBeDisabled();
  });
});

describe("ExportWizard — clipboard countdown and unmount scrubs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetStore();
    saveMock.mockResolvedValue("/tmp/nimbus.tar.gz");
    existsMock.mockResolvedValue(false);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("countdown fires writeText('') after 30 s", async () => {
    dataExportMock.mockResolvedValue({
      outputPath: "/tmp/nimbus.tar.gz",
      recoverySeed: "one two three four five six seven eight nine ten eleven twelve",
      recoverySeedGenerated: true,
      itemsExported: 1,
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<ExportWizard onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.type(
      screen.getAllByPlaceholderText(/assphrase/)[0] as HTMLInputElement,
      "reasonably-strong-example-phrase!",
    );
    await user.type(
      screen.getAllByPlaceholderText(/Confirm/)[0] as HTMLInputElement,
      "reasonably-strong-example-phrase!",
    );
    const nextBtns = screen.getAllByRole("button", { name: "Next" });
    await user.click(nextBtns[nextBtns.length - 1] as HTMLElement);
    await user.click(screen.getByRole("button", { name: /Choose file/ }));
    await vi.waitFor(() => {
      expect(screen.getByTestId("recovery-seed")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeTextMock).toHaveBeenCalledWith(
      "one two three four five six seven eight nine ten eleven twelve",
    );
    vi.advanceTimersByTime(30_000);
    expect(writeTextMock).toHaveBeenCalledWith("");
  });

  it("unmounting during active countdown clears clipboard immediately", async () => {
    dataExportMock.mockResolvedValue({
      outputPath: "/tmp/nimbus.tar.gz",
      recoverySeed: "one two three four five six seven eight nine ten eleven twelve",
      recoverySeedGenerated: true,
      itemsExported: 1,
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { unmount } = render(<ExportWizard onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.type(
      screen.getAllByPlaceholderText(/assphrase/)[0] as HTMLInputElement,
      "reasonably-strong-example-phrase!",
    );
    await user.type(
      screen.getAllByPlaceholderText(/Confirm/)[0] as HTMLInputElement,
      "reasonably-strong-example-phrase!",
    );
    const nextBtns = screen.getAllByRole("button", { name: "Next" });
    await user.click(nextBtns[nextBtns.length - 1] as HTMLElement);
    await user.click(screen.getByRole("button", { name: /Choose file/ }));
    await vi.waitFor(() => {
      expect(screen.getByTestId("recovery-seed")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Copy" }));
    writeTextMock.mockClear();
    // Unmount while countdown still active
    unmount();
    expect(writeTextMock).toHaveBeenCalledWith("");
  });
});
```

- [ ] **Step 2: Run**

```bash
cd packages/ui && bunx vitest run test/components/settings/data/ExportWizard.test.tsx
```

Expected: PASS on all cases. If any case times out, rerun with `--reporter=verbose` to identify which await broke.

### Task 16: `ImportWizard.test.tsx`

**Files:**
- Create: `packages/ui/test/components/settings/data/ImportWizard.test.tsx`

- [ ] **Step 1: Write the tests**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImportWizard } from "../../../../src/components/settings/data/ImportWizard";
import { JsonRpcError } from "../../../../src/ipc/types";
import { dataImportMock } from "../../../../src/ipc/__mocks__/client";
import { useNimbusStore } from "../../../../src/store";

vi.mock("../../../../src/ipc/client");
const openMock = vi.fn<() => Promise<string | null>>();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => openMock(...(args as [])),
}));

function resetStore() {
  useNimbusStore.setState({
    importFlow: { status: "idle" },
    setImportFlow: (patch) =>
      useNimbusStore.setState((s) => ({
        importFlow: { ...s.importFlow, ...patch },
      }) as never),
    setImportProgress: (progress) =>
      useNimbusStore.setState((s) => ({
        importFlow: { ...s.importFlow, progress },
      }) as never),
  } as never);
}

async function toConfirmStep(
  user: ReturnType<typeof userEvent.setup>,
  method: "passphrase" | "recoverySeed" = "passphrase",
) {
  openMock.mockResolvedValue("/tmp/nimbus.tar.gz");
  render(<ImportWizard onClose={() => {}} />);
  await user.click(screen.getByRole("button", { name: /Choose file/ }));
  if (method === "recoverySeed") {
    await user.click(screen.getByRole("radio", { name: /Recovery seed/ }));
    const inputs = screen.getAllByRole("textbox");
    for (let i = 0; i < 12; i++) {
      await user.type(inputs[i] as HTMLElement, "abandon");
    }
  } else {
    await user.type(screen.getByPlaceholderText(/Passphrase/), "demo-passphrase");
  }
  await user.click(screen.getByRole("button", { name: "Next" }));
}

describe("ImportWizard — happy path + reload", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetStore();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows oauthEntriesFlagged copy when > 0 and triggers reload after 3 s", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    dataImportMock.mockResolvedValue({ credentialsRestored: 4, oauthEntriesFlagged: 2 });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await toConfirmStep(user, "passphrase");
    await user.type(screen.getByPlaceholderText("replace my data"), "replace my data");
    await user.click(screen.getByRole("button", { name: /Replace my data/ }));
    await vi.waitFor(() => {
      expect(screen.getByText(/Restore complete/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/2 OAuth connectors need re-authorization/i)).toBeInTheDocument();
    vi.advanceTimersByTime(3000);
    expect(reload).toHaveBeenCalled();
  });
});

describe("ImportWizard — error paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it("-32010 archive_newer → terminal dialog with 'Update Nimbus' copy", async () => {
    dataImportMock.mockRejectedValue(
      new JsonRpcError(-32010, "version mismatch", {
        kind: "version_incompatible",
        archiveSchemaVersion: 99,
        currentSchemaVersion: 17,
        relation: "archive_newer",
      }),
    );
    const user = userEvent.setup();
    await toConfirmStep(user, "passphrase");
    await user.type(screen.getByPlaceholderText("replace my data"), "replace my data");
    await user.click(screen.getByRole("button", { name: /Replace my data/ }));
    await vi.waitFor(() => {
      expect(screen.getByText(/newer Nimbus/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /Retry/ })).not.toBeInTheDocument();
  });

  it("-32010 archive_older_unsupported → terminal dialog with 'older, unsupported' copy", async () => {
    dataImportMock.mockRejectedValue(
      new JsonRpcError(-32010, "version mismatch", {
        kind: "version_incompatible",
        archiveSchemaVersion: 1,
        currentSchemaVersion: 17,
        relation: "archive_older_unsupported",
      }),
    );
    const user = userEvent.setup();
    await toConfirmStep(user, "passphrase");
    await user.type(screen.getByPlaceholderText("replace my data"), "replace my data");
    await user.click(screen.getByRole("button", { name: /Replace my data/ }));
    await vi.waitFor(() => {
      expect(screen.getByText(/older, unsupported Nimbus/i)).toBeInTheDocument();
    });
  });

  it("-32002 decryption_failed shows retryable inline error", async () => {
    dataImportMock.mockRejectedValue(new JsonRpcError(-32002, "decryption failed"));
    const user = userEvent.setup();
    await toConfirmStep(user, "passphrase");
    await user.type(screen.getByPlaceholderText("replace my data"), "replace my data");
    await user.click(screen.getByRole("button", { name: /Replace my data/ }));
    await vi.waitFor(() => {
      expect(screen.getByText(/Could not decrypt with that passphrase/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Retry/ })).toBeInTheDocument();
  });
});

describe("ImportWizard — typed confirmation gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it("blocks Replace when the phrase is wrong", async () => {
    const user = userEvent.setup();
    await toConfirmStep(user, "passphrase");
    const btn = screen.getByRole("button", { name: /Replace my data/ });
    expect(btn).toBeDisabled();
    await user.type(screen.getByPlaceholderText("replace my data"), "wrong phrase");
    expect(btn).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run**

```bash
cd packages/ui && bunx vitest run test/components/settings/data/ImportWizard.test.tsx
```

Expected: PASS on all cases. Note that `JsonRpcError` must be constructible from test code; if it is not, adapt imports.

### Task 17: `DeleteServiceDialog.test.tsx`

**Files:**
- Create: `packages/ui/test/components/settings/data/DeleteServiceDialog.test.tsx`

- [ ] **Step 1: Write the tests**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeleteServiceDialog } from "../../../../src/components/settings/data/DeleteServiceDialog";
import {
  dataDeleteMock,
  dataGetDeletePreflightMock,
} from "../../../../src/ipc/__mocks__/client";
import { useNimbusStore } from "../../../../src/store";

vi.mock("../../../../src/ipc/client");

function resetStore() {
  useNimbusStore.setState({
    deleteFlow: { status: "idle" },
    setDeleteFlow: (patch) =>
      useNimbusStore.setState((s) => ({
        deleteFlow: { ...s.deleteFlow, ...patch },
      }) as never),
    connectorsList: [
      { service: "github", status: "idle" },
      { service: "filesystem", status: "idle" },
      { service: "linear", status: "not_configured" },
    ],
  } as never);
}

describe("DeleteServiceDialog — dropdown population", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it("filters out services whose status is 'not_configured'", async () => {
    render(<DeleteServiceDialog onClose={() => {}} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toContain("github");
    expect(values).toContain("filesystem");
    expect(values).not.toContain("linear");
  });
});

describe("DeleteServiceDialog — preflight + typed confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it("renders preflight counts after loading", async () => {
    dataGetDeletePreflightMock.mockResolvedValue({
      service: "github",
      itemCount: 1247,
      embeddingCount: 89,
      vaultKeyCount: 3,
    });
    const user = userEvent.setup();
    render(<DeleteServiceDialog onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Next" }));
    await vi.waitFor(() => {
      expect(screen.getByText("1247")).toBeInTheDocument();
    });
    expect(screen.getByText("89")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("typed confirmation is case-sensitive and rejects trailing space", async () => {
    dataGetDeletePreflightMock.mockResolvedValue({
      service: "github",
      itemCount: 1,
      embeddingCount: 0,
      vaultKeyCount: 0,
    });
    const user = userEvent.setup();
    render(<DeleteServiceDialog onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(await screen.findByRole("button", { name: "Proceed" }));
    const input = screen.getByPlaceholderText("github") as HTMLInputElement;
    const deleteBtn = screen.getByRole("button", { name: "Delete" });
    await user.type(input, "GitHub");
    expect(deleteBtn).toBeDisabled();
    await user.clear(input);
    await user.type(input, "github ");
    expect(deleteBtn).toBeDisabled();
    await user.clear(input);
    await user.type(input, "github");
    expect(deleteBtn).not.toBeDisabled();
  });

  it("calls dataDelete with explicit dryRun: false", async () => {
    dataGetDeletePreflightMock.mockResolvedValue({
      service: "github",
      itemCount: 5,
      embeddingCount: 0,
      vaultKeyCount: 0,
    });
    dataDeleteMock.mockResolvedValue({
      preflight: {
        service: "github",
        itemsToDelete: 5,
        vecRowsToDelete: 0,
        syncTokensToDelete: 0,
        vaultEntriesToDelete: 0,
        vaultKeys: [],
        peopleUnlinked: 0,
      },
      deleted: true,
    });
    const user = userEvent.setup();
    render(<DeleteServiceDialog onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(await screen.findByRole("button", { name: "Proceed" }));
    await user.type(screen.getByPlaceholderText("github"), "github");
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(dataDeleteMock).toHaveBeenCalledWith({ service: "github", dryRun: false });
  });

  it("renders success copy with itemsToDelete count from preflight", async () => {
    dataGetDeletePreflightMock.mockResolvedValue({
      service: "github",
      itemCount: 5,
      embeddingCount: 0,
      vaultKeyCount: 0,
    });
    dataDeleteMock.mockResolvedValue({
      preflight: {
        service: "github",
        itemsToDelete: 42,
        vecRowsToDelete: 0,
        syncTokensToDelete: 0,
        vaultEntriesToDelete: 0,
        vaultKeys: [],
        peopleUnlinked: 0,
      },
      deleted: true,
    });
    const user = userEvent.setup();
    render(<DeleteServiceDialog onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(await screen.findByRole("button", { name: "Proceed" }));
    await user.type(screen.getByPlaceholderText("github"), "github");
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await vi.waitFor(() => {
      expect(screen.getByText(/Deleted 42 items/)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run**

```bash
cd packages/ui && bunx vitest run test/components/settings/data/DeleteServiceDialog.test.tsx
```

Expected: PASS on all cases.

### Task 18: Full UI test suite + coverage check

- [ ] **Step 1: Run the complete Vitest suite**

```bash
cd packages/ui && bunx vitest run && cd ../..
```

Expected: all suites pass, including existing ones.

- [ ] **Step 2: Check coverage gate**

```bash
cd packages/ui && bunx vitest run --coverage && cd ../..
```

Expected: coverage ≥ 80 % lines / ≥ 75 % branches. If below the gate, inspect the coverage report and add assertions for the uncovered branches (most likely a missing error path or an `if` branch).

- [ ] **Step 3: Root-level typecheck**

```bash
bun run typecheck
bun run lint
```

Expected: 0 errors, 0 lint issues.

### Task 19: Commit Phase 2

- [ ] **Step 1: Stage + commit**

```bash
git add packages/ui/src/pages/settings/DataPanel.tsx \
        packages/ui/src/components/settings/data/ExportWizard.tsx \
        packages/ui/src/components/settings/data/ImportWizard.tsx \
        packages/ui/src/components/settings/data/DeleteServiceDialog.tsx \
        packages/ui/src/App.tsx \
        packages/ui/test/pages/settings/DataPanel.test.tsx \
        packages/ui/test/components/settings/data/ExportWizard.test.tsx \
        packages/ui/test/components/settings/data/ImportWizard.test.tsx \
        packages/ui/test/components/settings/data/DeleteServiceDialog.test.tsx
git commit -m "$(cat <<'EOF'
feat(ui): Data panel (Export + Import + Delete wizards)

Replaces the /settings/data PanelComingSoon placeholder with a three-card
Data panel backed by three modal wizards:

- ExportWizard: scope → passphrase (zxcvbn ≥ 3 + length ≥ 12 + match gate)
  → destination with default nimbus-backup-YYYY-MM-DD.tar.gz filename and
  overwrite pre-check → progress bar (determinate or indeterminate based on
  totalBytes) → recovery-seed step that branches on recoverySeedGenerated
  (first-time: non-dismissable modal with "cannot recover" warning, copy
  button with 30 s clipboard auto-clear, typed-checkbox gate; re-export:
  light reminder card). Clipboard is scrubbed on unmount during active
  countdown.
- ImportWizard: file picker → passphrase/seed radio (BIP39 12-cell grid
  with basic heuristic validation) → typed "replace my data" confirmation
  → progress bar → success toast + window.location.reload() after 3 s.
  Handles -32010 (version_incompatible, terminal, branches on relation),
  -32003 (integrity_failed, terminal), -32002 (decryption_failed,
  retryable inline).
- DeleteServiceDialog: service dropdown filtered by connectorsList status
  → dataGetDeletePreflight with loading state → preflight counts →
  case-sensitive typed service-name confirmation → dataDelete with
  explicit dryRun: false → success copy sourced from preflight.itemsToDelete.

Full Vitest suite added (four component test files + panel test file);
coverage stays at ≥ 80 % lines / ≥ 75 % branches.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3 — Wrap-up docs + PR

### Task 20: Create `docs/manual-smoke-ws5c.md`

**Files:**
- Create: `docs/manual-smoke-ws5c.md`

- [ ] **Step 1: Write the consolidated checklist**

```markdown
# WS5-C manual smoke checklist

Follow these steps on **each of Windows, macOS, and Linux** before merging the WS5-C UI PR. Record the OS and date next to each checkbox.

## Navigation

- [ ] Sidebar → Settings → redirects to `/settings/model` within 2 s.
- [ ] Each of the seven panel entries in `SettingsSidebar` renders within 2 s of click.
- [ ] The active nav entry highlights correctly on each panel.

## Model panel

- [ ] Pull a small model (e.g. `gemma:2b`) end-to-end; watch progress; cancel.
- [ ] Load + unload a locally-installed model.
- [ ] `setDefault` per task type updates the router status card immediately.
- [ ] Provider filter in the Pull dialog hides llama.cpp when unavailable (check `llm.getStatus`).
- [ ] Unplug the network mid-pull; observe the "Connecting…" stall state within 15 s; reconnect and observe progress resume.

## Connectors panel

- [ ] Edit a sync interval to 30 s; verify inline "minimum 60 seconds" error and disabled save.
- [ ] Save a valid interval; confirm next poll uses the new interval.
- [ ] Change depth in a second UI window; confirm first window reconciles via `connector.configChanged`.
- [ ] Toggle enable/disable on one connector; confirm health pill reacts.

## Profiles panel

- [ ] Create → switch → delete round-trip.
- [ ] After switch, **all** open windows (main + HITL popup + Quick Query) reload, not just the Settings window.

## Audit panel

- [ ] Filter by outcome; the virtualized list updates without flicker.
- [ ] "Verify chain" success toast fires on a healthy chain.
- [ ] Export to `.json`, re-open in a text editor — see full payload rows.
- [ ] Export to `.csv`, open in a spreadsheet — see exactly the six whitelisted columns.

## Data panel (Plan 5)

- [ ] **Export with passphrase → seed modal (first-time):**
  - Strength bar refuses weak passphrases (zxcvbn < 3).
  - Save dialog opens with default filename `nimbus-backup-<today>.tar.gz`.
  - `.tar.gz` file exists at chosen path after progress completes.
  - Modal shows the mnemonic + "Nimbus cannot recover this seed for you" warning.
  - Copy button shows a 30 s countdown; after 30 s the OS clipboard is cleared (paste in external editor returns empty).
  - "I have stored this seed" checkbox is required before `Done` enables.
- [ ] **Re-export:** seed-reminder card appears; no mnemonic is rendered; `Done` is immediately available.
- [ ] **Import with passphrase** on a scratch machine → 3-s toast → reload → audit feed populated.
- [ ] **Import with recovery seed** (no passphrase) on a different scratch machine → succeeds.
- [ ] **Import incompatible schemaVersion archive** (use test fixture) → terminal dialog, no data change.
- [ ] **Delete a service** (e.g., `filesystem`) → preflight spinner during load → preflight counts → typed match → delete → Dashboard audit feed shows new `data.delete` row within its next poll.
- [ ] **Concurrent-flow guard:** start an export; while it runs the Import and Delete buttons are disabled with tooltip "An export / import / delete is already in progress."
- [ ] **Offline regression:** kill the Gateway mid-export; wizard freezes with "Gateway disconnected — operation may be incomplete" copy; on reconnect the audit feed reveals completion state.
- [ ] **Clipboard auto-clear on early close:** copy seed, close modal before 30 s; clipboard is cleared immediately.
- [ ] **Close-on-escape:** confirm wizard dismisses cleanly via the explicit Cancel / Close button (no accidental `Escape` behavior leaking).

## Telemetry panel

- [ ] Toggle off; `telemetry.events` counter freezes (no new increments).
- [ ] "View payload sample" expander shows valid JSON matching `telemetry.getStatus`.

## Updates panel

- [ ] Force a fake manifest via env-var override; check → apply → overlay → reconnect → success toast.
- [ ] Force-fail reconnect (block the updater binary); after 2 min the overlay transitions to the error state with the documented copy.
- [ ] Rollback button is visible when the previous install failed.

## Gateway-offline regression

- [ ] Kill the Gateway while viewing each panel in turn; no panel crashes.
- [ ] Every write control shows the "Gateway offline" tooltip.
- [ ] On reconnect the panels refetch and the `StaleChip` disappears where applicable.
```

### Task 21: Update `docs/roadmap.md`, `CLAUDE.md`, `GEMINI.md`

**Files:**
- Modify: `docs/roadmap.md`
- Modify: `CLAUDE.md`
- Modify: `GEMINI.md`

- [ ] **Step 1: Update `docs/roadmap.md`**

Locate the WS5-C row (search for `WS5-C`). Change its status cell from whatever it currently shows to `✅` and bump its completion date to today (2026-04-21). If the row has a sub-list of Plans 1-5, mark each ✅.

- [ ] **Step 2: Update `CLAUDE.md` — Status line**

Find the status line near the top:

```
**Status:** Phase 3.5 ✅ Complete; **Phase 4** — Presence 🔵 Active (WS1–4 ✅ · WS5-A ✅ · WS5-B ✅ · WS5-C Plans 1–3 ✅ on branch · Plans 4–5 🔵 Pending)
```

Replace with:

```
**Status:** Phase 3.5 ✅ Complete; **Phase 4** — Presence 🔵 Active (WS1–4 ✅ · WS5-A ✅ · WS5-B ✅ · WS5-C ✅ on branch, PR pending)
```

- [ ] **Step 3: Update `GEMINI.md` symmetrically**

`GEMINI.md` mirrors `CLAUDE.md` — apply the same single-line status edit there.

### Task 22: Final sanity — typecheck + lint + test

- [ ] **Step 1: Run the full gate**

```bash
bun run typecheck
bun run lint
bun test --bail
cd packages/ui && bunx vitest run && cd ../..
cd packages/ui/src-tauri && cargo test && cd ../../..
```

Expected: every command exits 0. If anything is red, stop and fix before Task 23.

### Task 23: Commit Phase 3 + PR-open instructions

- [ ] **Step 1: Stage + commit**

```bash
git add docs/manual-smoke-ws5c.md docs/roadmap.md CLAUDE.md GEMINI.md
git commit -m "$(cat <<'EOF'
docs: WS5-C wrap-up — manual smoke + roadmap + status

Adds the consolidated manual-smoke checklist covering all seven WS5-C
panels (Model, Connectors, Profiles, Audit, Data, Telemetry, Updates)
plus gateway-offline regression. Updates the roadmap row and the
CLAUDE.md / GEMINI.md status lines to reflect WS5-C ✅ pending PR.

Closes the WS5-C UI workstream. Next step is opening the single WS5-C
UI PR against dev/asafgolombek/phase_4_ws5; see commit body below.

PR body draft:

## Summary
- Completes WS5-C UI: the seven Settings panels (Model, Connectors,
  Profiles, Audit, Data, Telemetry, Updates) on dev/asafgolombek/ws5c-ui.
- 38-method Rust bridge allowlist unchanged; 4-method NO_TIMEOUT set
  unchanged; persist whitelist stays at exactly 5 keys.
- Coverage stays at ≥ 80 % lines / ≥ 75 % branches in packages/ui.

## Test plan
- [ ] `bun run typecheck`
- [ ] `bun run lint`
- [ ] `bun test`
- [ ] `cd packages/ui && bunx vitest run --coverage`
- [ ] `cd packages/ui/src-tauri && cargo test`
- [ ] Manual smoke checklist on Windows, macOS, Linux
  (docs/manual-smoke-ws5c.md).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 2: Push**

```bash
git push origin dev/asafgolombek/ws5c-ui
```

- [ ] **Step 3: Open the PR**

```bash
gh pr create \
  --base dev/asafgolombek/phase_4_ws5 \
  --head dev/asafgolombek/ws5c-ui \
  --title "feat(ui): WS5-C Settings — seven panels complete" \
  --body "$(cat <<'EOF'
## Summary
- Completes WS5-C UI: the seven Settings panels (Model, Connectors, Profiles, Audit, Data, Telemetry, Updates) on `dev/asafgolombek/ws5c-ui`.
- 38-method Rust bridge allowlist unchanged; 4-method NO_TIMEOUT set unchanged; persist whitelist stays at exactly 5 keys.
- Coverage stays at ≥ 80 % lines / ≥ 75 % branches in `packages/ui`.

## Test plan
- [ ] `bun run typecheck`
- [ ] `bun run lint`
- [ ] `bun test`
- [ ] `cd packages/ui && bunx vitest run --coverage`
- [ ] `cd packages/ui/src-tauri && cargo test`
- [ ] Manual smoke checklist on Windows, macOS, Linux (`docs/manual-smoke-ws5c.md`).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed. Confirm with the user before merging.

---

## Self-review checklist (completed by plan author)

**Spec coverage:**
- §1.1 Deliverables — all 8 covered (Task 9 panel; Tasks 10-12 wizards; Task 4 slice; Task 2 wrappers; Tasks 14-17 tests + Task 7 partialize; Task 20 smoke; Task 21 roadmap/CLAUDE/GEMINI; Task 23 PR instructions).
- §1.4 Divergence from parent spec — seed-modal branching implemented in Task 10 (`step === "seed-first-time"` vs `step === "seed-reminder"`) and tested in Task 15.
- §2.1 Files created / §2.2 Files modified — all accounted for across Tasks 1-7, 9-13, 20-21.
- §2.3 Files not touched — Rust bridge, capabilities, Gateway, partialize.ts (beyond tests), parseError all explicitly untouched by any task.
- §2.4 Slice shape — Task 4 matches shape letter-for-letter.
- §3.1 Types — Task 1 appends all 10 types (including `DataDeletePreflight`).
- §3.2 Wrappers — Task 2 adds the 5 wrappers with shape guards.
- §3.3 Notifications — `data.exportProgress` / `data.importProgress` subscribed in Tasks 10 + 11; `data.exportCompleted` / `data.importCompleted` treated as informational per the design (RPC resolve drives terminal states).
- §3.4 Rust bridge — no changes; pre-flight Step A validates existing tests still green.
- §4.1-§4.4 — Tasks 9-12 produce components matching each wizard's spec section.
- §5.1 Error matrix — error code handling in Tasks 10-12 covers every row; tests in Tasks 15-17 assert the user-facing copies.
- §5.3 Concurrent-flow guard + disconnect — Task 4 `markDisconnected`; Task 9 effect wiring; Task 14 test.
- §5.4 Security invariants — passphrase / seed scrubbed on unmount (Tasks 10-11), clipboard cleared on early unmount (Task 10); test coverage in Task 15.
- §6.1 Test matrix — all six rows covered across Tasks 14-17 + Task 6 + Task 7.
- §6.5 Manual smoke — Task 20 adds `docs/manual-smoke-ws5c.md`.
- §7 Commit shape — three commits matching the spec breakdown (Tasks 8, 19, 23).

**Placeholder scan:** no "TBD"/"TODO"/"implement later" anywhere. Every code step has full code. Every command has expected output. Every test has assertions.

**Type consistency:**
- `ExportPreflightResult`, `DeletePreflightResult`, `DataExportResult`, `DataImportResult`, `DataDeleteResult`, `DataDeletePreflight` used identically across Tasks 1, 2, 9, 10, 11, 12, 14, 17.
- Slice method names (`setExportFlow`, `setImportProgress`, `markDisconnected`, etc.) consistent between Task 4 (definition) and Tasks 9-12 + 14-17 (call sites).
- `dataGetExportPreflightMock` / `dataExportMock` / etc. consistent between Task 3 (definition) and Tasks 14-17 (test usage).
- `JsonRpcError` imported from `../../ipc/types` in Task 11 matches ipc/types.ts exports (verified during spec drafting).
