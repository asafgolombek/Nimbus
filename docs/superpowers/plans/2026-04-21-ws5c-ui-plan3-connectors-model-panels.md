# WS5-C UI — Plan 3: Connectors panel + Model panel

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `PanelComingSoon` placeholders at `/settings/connectors` and `/settings/model` with fully wired panels. Connectors gets per-service interval editor (with 60 s min inline validation), depth selector, enable toggle, cross-window `connector.configChanged` reconciliation, and Dashboard deep-link highlight. Model gets router status cards, per-task default pickers, load/unload actions, and a streaming `PullDialog` that honours `llm.getStatus` availability, detects 15 s stalls, and re-attaches to an in-flight pull on UI reload via the persisted `activePullId`.

**Architecture:** Additive only — no files deleted, no signatures removed. One new method (`llm.getStatus`) joins the Rust `ALLOWED_METHODS` allowlist (38 → 39) so the PullDialog can filter providers by availability. Nine new IPC-client wrappers land in `packages/ui/src/ipc/client.ts`; the existing `connectors` and `model` store slices are expanded in place (persisted-key whitelist unchanged — new fields are all transient). Two self-contained panels (`ConnectorsPanel`, `ModelPanel`) + three shared components (`RouterStatus`, `PullDialog`, `DepthSelect`) compose them. Notifications (`connector.configChanged`, `llm.pullProgress`, `llm.pullCompleted`, `llm.pullFailed`, `llm.modelLoaded`, `llm.modelUnloaded`) flow through the existing `gateway://notification` window-scoped channel — **no** new global broadcasts, `GLOBAL_BROADCAST_METHODS` stays at 1.

**Tech Stack:** Tauri 2 · React 18 · TypeScript 6 strict · Zustand v5 · React Router v6 (`useSearchParams`) · Tailwind CSS v4 · Vitest + `@testing-library/react` · `cargo test` for Rust.

**Parent spec:** [`docs/superpowers/specs/2026-04-19-ws5c-settings-design.md`](../specs/2026-04-19-ws5c-settings-design.md) — §2.1 (panel pages + `PullDialog` + `RouterStatus` + `useConfirm` reuse), §2.3 (IPC contract additions), §3.1–3.2 (allowlist entries), §6.1 (Vitest requirements: `connectors-panel.test.tsx`, `pull-dialog.test.tsx`, `model-panel.test.tsx`), §7 commits 6–7.

**Depends on:** Plan 2 (`feat(ui): Telemetry panel …` through `feat(ui-ipc): profile + telemetry wrappers …`) merged to `dev/asafgolombek/ws5c-ui`. All Plan 2 commits are expected on `HEAD` at the start of this plan.

**Branching strategy:** Continue on the existing feature branch `dev/asafgolombek/ws5c-ui`. Commits from this plan append to the seven pushed by Plan 2 + one WS5-C-Plan-2 docs commit. No PR opens yet — Plans 4–5 still add panels to this branch.

**Test convention:** UI tests live under `packages/ui/test/` mirroring the `src/` layout. The mock module at `packages/ui/src/ipc/__mocks__/client.ts` exports module-scope `vi.fn()` instances so `createIpcClient()` always resolves to the same mocks across a test. Pattern reference: `packages/ui/test/pages/settings/ProfilesPanel.test.tsx`.

---

## Pre-flight (do once before Task 1)

- [ ] **Step A — Confirm branch + baseline green**

```bash
git checkout dev/asafgolombek/ws5c-ui
git status                        # expect clean
git log --oneline -10             # expect Plan 2's 7 feat/docs commits on top of Plan 1
bun install
bun run typecheck
bun test --bail
cd packages/ui && bunx vitest run && cd ../..
cd packages/ui/src-tauri && cargo test && cd ../../..
```

Expected: every command exits 0. If anything is red on the Plan 2 tip, stop and fix before continuing.

- [ ] **Step B — Skim the patterns this plan mirrors**

Open each of these once; every task below assumes you have them in your head:

- `packages/ui/src/pages/settings/ProfilesPanel.tsx` — canonical panel shape: `PanelHeader` + offline-driven `writeDisabled` + `useConfirm` + per-row controls + dialog. The Connectors panel and Model panel both follow this structure.
- `packages/ui/src/pages/settings/TelemetryPanel.tsx` — pattern for fetching → rendering typed status + expander.
- `packages/ui/test/pages/settings/ProfilesPanel.test.tsx` — canonical panel test: `vi.mock("../../../src/ipc/client")` + module-scope mock imports + `useNimbusStore.setState({...} as never)` to force connection/offline state.
- `packages/ui/src/hooks/useIpcQuery.ts` — typed polling hook (pauses on `visibilityState === "hidden"` and when `connectionState !== "connected"`). The ConnectorsPanel uses this at 30 s cadence for live health updates.
- `packages/ui/src/hooks/useIpcSubscription.ts` — typed Tauri event listener. Used by both panels to subscribe to `gateway://notification`.
- `packages/ui/src/ipc/client.ts` — notice the `call()` plus typed wrappers pattern; this plan adds nine more typed wrappers alongside them.
- `packages/ui/src/ipc/__mocks__/client.ts` — module-scope `vi.fn()` mocks; extend with one mock per new wrapper.
- `packages/ui/src-tauri/src/gateway_bridge.rs` — `ALLOWED_METHODS` (38 today, grows to 39), `allowlist_exact_size` hard-asserts the count.
- `packages/gateway/src/ipc/llm-rpc.ts` — confirms wire shapes for `llm.listModels` (returns `{ models }`), `llm.getRouterStatus` (returns `{ decisions: Record<LlmTaskType, {providerId, modelName, reason} | undefined> }`), `llm.getStatus` (returns `{ available: Record<string, boolean> }`), `llm.pullModel` (returns `{ pullId }` immediately, streams `llm.pullProgress` / `llm.pullCompleted` / `llm.pullFailed` notifications), `llm.cancelPull` (returns `{ cancelled: boolean }`).
- `packages/gateway/src/ipc/connector-rpc-handlers.ts:196–210` — confirms `connector.configChanged` notification payload: `{ service, intervalMs, depth, enabled }`.
- `packages/gateway/src/sync/types.ts:107–124` — confirms `SyncStatus` wire row: `{ serviceId, status, lastSyncAt, nextSyncAt, intervalMs, itemCount, lastError, consecutiveFailures, healthState?, healthRetryAfterMs?, depth, enabled }`.

---

## Phase 1 — Rust bridge: allowlist `llm.getStatus`

`PullDialog` needs to filter the provider radio (Ollama vs llama.cpp) by availability. The Gateway already ships `llm.getStatus` (returns `{ available: Record<string, boolean> }`, see `packages/gateway/src/ipc/llm-rpc.ts:120–123`). It is **not** in `ALLOWED_METHODS` today — `allowlist_exact_size` hard-asserts `== 38`. Add it + update the size assertion.

### Task 1: Grow `ALLOWED_METHODS` from 38 → 39

**Files:**
- Modify: `packages/ui/src-tauri/src/gateway_bridge.rs`

- [ ] **Step 1: Extend the allowlist**

In `packages/ui/src-tauri/src/gateway_bridge.rs`, the `ALLOWED_METHODS: &[&str] = &[ ... ]` block is alphabetized. Insert `"llm.getStatus"` on its own line immediately before `"llm.listModels"`:

```rust
    "llm.cancelPull",
    "llm.getRouterStatus",
    "llm.getStatus",
    "llm.listModels",
    "llm.loadModel",
```

- [ ] **Step 2: Update the count assertion**

In the same file's `mod tests` block, replace the body of `allowlist_exact_size`:

```rust
    #[test]
    fn allowlist_exact_size() {
        // Plan 3 target: 38 (Plan 2) + 1 (llm.getStatus for PullDialog provider filter) = 39.
        assert_eq!(ALLOWED_METHODS.len(), 39);
    }
```

- [ ] **Step 3: Add a new test asserting `llm.getStatus` is allowed**

Immediately after the existing `allowlist_ws5c_llm_reads` test, add:

```rust
    #[test]
    fn allowlist_ws5c_llm_availability_read() {
        assert!(is_method_allowed("llm.getStatus"));
    }
```

- [ ] **Step 4: Verify**

```bash
cd packages/ui/src-tauri && cargo test && cd ../../..
```

Expected: all tests pass, including `allowlist_is_alphabetized` (we inserted at the correct position), `allowlist_exact_size` (now 39), `allowlist_ws5c_llm_availability_read` (new), `allowlist_has_no_duplicates`.

### Task 2: Commit Phase 1

- [ ] **Step 1: Commit**

```bash
git add packages/ui/src-tauri/src/gateway_bridge.rs
git commit -m "feat(ui-bridge): allowlist llm.getStatus (→ 39) for PullDialog provider filter"
```

---

## Phase 2 — Shared IPC contract: types + wrappers + mocks

Plan 3 adds **nine** typed wrappers to `NimbusIpcClient`:

| Wrapper | Gateway method | Used by |
|---|---|---|
| `connectorSetConfig(service, patch)` | `connector.setConfig` | Connectors panel |
| `llmListModels()` | `llm.listModels` | Model panel |
| `llmGetStatus()` | `llm.getStatus` | PullDialog |
| `llmGetRouterStatus()` | `llm.getRouterStatus` | Model panel |
| `llmPullModel(provider, modelName)` | `llm.pullModel` | PullDialog |
| `llmCancelPull(pullId)` | `llm.cancelPull` | PullDialog |
| `llmLoadModel(provider, modelName)` | `llm.loadModel` | Model panel row |
| `llmUnloadModel(provider, modelName)` | `llm.unloadModel` | Model panel row |
| `llmSetDefault(taskType, provider, modelName)` | `llm.setDefault` | Model panel RouterStatus |

Each wrapper just forwards `{ ...args }` as JSON-RPC params and returns the raw result, with a lightweight runtime shape guard on the two methods whose responses are non-primitive objects (list + router status + availability). No extra `parseError` redaction needed — Plan 2 already redacts the five forbidden credential keys.

### Task 3: Extend `packages/ui/src/ipc/types.ts`

**Files:**
- Modify: `packages/ui/src/ipc/types.ts`

- [ ] **Step 1: Append the new types**

At the bottom of `packages/ui/src/ipc/types.ts` (after the `TelemetryStatus` export at the current end of file), append:

```ts
// ---- WS5-C Plan 3 additions (Connectors + Model panels) ----

/** Router decision for one task type — shape returned by `llm.getRouterStatus`. */
export interface RouterDecision {
  readonly providerId: "ollama" | "llamacpp" | "remote";
  readonly modelName: string;
  readonly reason: string;
}

export type LlmTaskType = "classification" | "reasoning" | "summarisation" | "agent_step";

/** `llm.getRouterStatus` — `decisions` is a partial map; `undefined` means no provider available for that task. */
export interface RouterStatusResult {
  readonly decisions: Readonly<
    Partial<Record<LlmTaskType, RouterDecision | undefined>>
  >;
}

/** One row from `llm.listModels` — mirrors the Gateway's `LlmModelInfo`. */
export interface LlmModelInfo {
  readonly provider: "ollama" | "llamacpp" | "remote";
  readonly modelName: string;
  readonly parameterCount?: number;
  readonly contextWindow?: number;
  readonly quantization?: string;
  readonly vramEstimateMb?: number;
}

export interface LlmListModelsResult {
  readonly models: ReadonlyArray<LlmModelInfo>;
}

/** `llm.getStatus` — per-provider availability used by PullDialog to filter the provider radio. */
export interface LlmAvailabilityResult {
  readonly available: Readonly<Record<string, boolean>>;
}

/** `llm.pullModel` response — progress is streamed via `llm.pullProgress` notifications. */
export interface LlmPullStartedResult {
  readonly pullId: string;
}

/** `llm.pullProgress` notification payload. */
export interface LlmPullProgressPayload {
  readonly pullId: string;
  readonly provider: "ollama" | "llamacpp";
  readonly modelName: string;
  readonly status: string;
  readonly completedBytes?: number;
  readonly totalBytes?: number;
}

/** `llm.pullCompleted` / `llm.pullFailed` shared envelope. `error` is only present on failure. */
export interface LlmPullTerminalPayload {
  readonly pullId: string;
  readonly provider: "ollama" | "llamacpp";
  readonly modelName: string;
  readonly error?: string;
}

/** `llm.modelLoaded` / `llm.modelUnloaded` shared payload. */
export interface LlmModelLoadPayload {
  readonly provider: "ollama" | "llamacpp";
  readonly modelName: string;
}

/** Patch accepted by `connector.setConfig` — every field is optional (partial update). */
export interface ConnectorConfigPatch {
  readonly intervalMs?: number;
  readonly depth?: "metadata_only" | "summary" | "full";
  readonly enabled?: boolean;
}

/** `connector.configChanged` notification payload emitted by the Gateway after any successful setConfig. */
export interface ConnectorConfigChangedPayload {
  readonly service: string;
  readonly intervalMs: number;
  readonly depth: "metadata_only" | "summary" | "full";
  readonly enabled: boolean;
}
```

- [ ] **Step 2: Extend the existing `ConnectorStatus` alias with the three fields the Connectors panel needs**

Locate the existing `ConnectorStatus` type (currently at line ~55) and **replace it** with:

```ts
export type ConnectorStatus = {
  name: string;
  health: ConnectorHealth;
  lastSyncAt?: string;
  degradationReason?: string;
  itemCount?: number;
  /** Current sync interval in milliseconds — surfaced by `connector.listStatus` (WS5-C Plan 1 Gateway patch). */
  intervalMs?: number;
  /** Default reindex depth — surfaced by `connector.listStatus` (WS5-C Plan 1 Gateway patch). */
  depth?: "metadata_only" | "summary" | "full";
  /** `false` when paused. Surfaced by `connector.listStatus` (WS5-C Plan 1 Gateway patch). */
  enabled?: boolean;
};
```

The three new fields are **optional** so existing WS5-B consumers (`ConnectorGrid`, `ConnectorTile`) are unaffected — they already only read `name` and `health`.

### Task 4: Write failing client-wrapper tests

**Files:**
- Create: `packages/ui/test/ipc/client-ws5c-plan3.test.ts`

A separate file (distinct from `client-ws5c.test.ts` from Plan 2) keeps the Plan 3 additions traceable commit-by-commit.

- [ ] **Step 1: Write the failing tests**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

type InvokeArgs = { method: string; params: unknown };

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn<(cmd: string, args?: InvokeArgs) => Promise<unknown>>(),
  listenMock: vi.fn<(event: string, handler: (e: { payload: unknown }) => void) => Promise<() => void>>(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

import { __resetIpcClientForTests, createIpcClient } from "../../src/ipc/client";

beforeEach(() => {
  __resetIpcClientForTests();
  invokeMock.mockReset();
  listenMock.mockReset();
  listenMock.mockResolvedValue(() => {});
});

describe("NimbusIpcClient — Connector setConfig wrapper", () => {
  it("passes a full patch with service + all optional fields", async () => {
    invokeMock.mockResolvedValueOnce({
      service: "github",
      intervalMs: 120000,
      depth: "summary",
      enabled: true,
    });
    const client = createIpcClient();
    const res = await client.connectorSetConfig("github", {
      intervalMs: 120000,
      depth: "summary",
      enabled: true,
    });
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "connector.setConfig",
      params: { service: "github", intervalMs: 120000, depth: "summary", enabled: true },
    });
    expect(res).toEqual({
      service: "github",
      intervalMs: 120000,
      depth: "summary",
      enabled: true,
    });
  });

  it("allows partial patches (enabled only)", async () => {
    invokeMock.mockResolvedValueOnce({
      service: "slack",
      intervalMs: null,
      depth: null,
      enabled: false,
    });
    await createIpcClient().connectorSetConfig("slack", { enabled: false });
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "connector.setConfig",
      params: { service: "slack", enabled: false },
    });
  });
});

describe("NimbusIpcClient — LLM wrappers", () => {
  it("llmListModels rejects non-object responses", async () => {
    invokeMock.mockResolvedValueOnce("not an object");
    await expect(createIpcClient().llmListModels()).rejects.toThrow(/expected object/);
  });

  it("llmListModels returns the parsed envelope", async () => {
    invokeMock.mockResolvedValueOnce({
      models: [{ provider: "ollama", modelName: "gemma:2b" }],
    });
    const res = await createIpcClient().llmListModels();
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "llm.listModels",
      params: {},
    });
    expect(res.models).toEqual([{ provider: "ollama", modelName: "gemma:2b" }]);
  });

  it("llmGetStatus returns the availability map", async () => {
    invokeMock.mockResolvedValueOnce({ available: { ollama: true, llamacpp: false } });
    const res = await createIpcClient().llmGetStatus();
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "llm.getStatus",
      params: {},
    });
    expect(res.available).toEqual({ ollama: true, llamacpp: false });
  });

  it("llmGetRouterStatus returns the decisions map", async () => {
    invokeMock.mockResolvedValueOnce({
      decisions: {
        classification: { providerId: "ollama", modelName: "gemma:2b", reason: "default" },
      },
    });
    const res = await createIpcClient().llmGetRouterStatus();
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "llm.getRouterStatus",
      params: {},
    });
    expect(res.decisions.classification?.modelName).toBe("gemma:2b");
  });

  it("llmPullModel passes provider + modelName and returns pullId", async () => {
    invokeMock.mockResolvedValueOnce({ pullId: "pull_abc" });
    const res = await createIpcClient().llmPullModel("ollama", "gemma:2b");
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "llm.pullModel",
      params: { provider: "ollama", modelName: "gemma:2b" },
    });
    expect(res).toEqual({ pullId: "pull_abc" });
  });

  it("llmCancelPull passes pullId and returns cancelled boolean", async () => {
    invokeMock.mockResolvedValueOnce({ cancelled: true });
    const res = await createIpcClient().llmCancelPull("pull_abc");
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "llm.cancelPull",
      params: { pullId: "pull_abc" },
    });
    expect(res.cancelled).toBe(true);
  });

  it("llmLoadModel passes provider + modelName", async () => {
    invokeMock.mockResolvedValueOnce({ isLoaded: true });
    await createIpcClient().llmLoadModel("ollama", "gemma:2b");
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "llm.loadModel",
      params: { provider: "ollama", modelName: "gemma:2b" },
    });
  });

  it("llmUnloadModel passes provider + modelName", async () => {
    invokeMock.mockResolvedValueOnce({ isLoaded: false });
    await createIpcClient().llmUnloadModel("llamacpp", "llama3:8b-q4");
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "llm.unloadModel",
      params: { provider: "llamacpp", modelName: "llama3:8b-q4" },
    });
  });

  it("llmSetDefault passes taskType + provider + modelName", async () => {
    invokeMock.mockResolvedValueOnce({
      taskType: "reasoning",
      provider: "ollama",
      modelName: "gemma:2b",
    });
    await createIpcClient().llmSetDefault("reasoning", "ollama", "gemma:2b");
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "llm.setDefault",
      params: { taskType: "reasoning", provider: "ollama", modelName: "gemma:2b" },
    });
  });
});
```

- [ ] **Step 2: Run and expect FAIL**

```bash
cd packages/ui && bunx vitest run test/ipc/client-ws5c-plan3.test.ts && cd ../..
```

Expected: every `*Mock` assertion fails with `client.connectorSetConfig is not a function` (and equivalents).

### Task 5: Implement the nine new wrappers

**Files:**
- Modify: `packages/ui/src/ipc/client.ts`

- [ ] **Step 1: Extend the type imports**

At the top of `packages/ui/src/ipc/client.ts`, replace the existing types import block with:

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

- [ ] **Step 2: Extend the `NimbusIpcClient` interface**

Replace the existing interface block with:

```ts
export interface NimbusIpcClient {
  call<TResult>(method: string, params?: unknown): Promise<TResult>;
  subscribe(handler: (n: JsonRpcNotification) => void): Promise<() => void>;
  onConnectionState(handler: (s: ConnectionState) => void): Promise<() => void>;
  connectorListStatus(): Promise<ConnectorStatus[]>;
  indexMetrics(): Promise<IndexMetrics>;
  auditList(limit?: number): Promise<AuditEntry[]>;
  consentRespond(requestId: string, approved: boolean): Promise<void>;
  /** WS5-C Plan 2 additions. */
  profileList(): Promise<ProfileListResult>;
  profileCreate(name: string): Promise<{ name: string }>;
  profileSwitch(name: string): Promise<{ active: string }>;
  profileDelete(name: string): Promise<{ deleted: string }>;
  telemetryGetStatus(): Promise<TelemetryStatus>;
  telemetrySetEnabled(enabled: boolean): Promise<{ enabled: boolean }>;
  /** WS5-C Plan 3 additions — Connectors + Model panels. */
  connectorSetConfig(
    service: string,
    patch: ConnectorConfigPatch,
  ): Promise<{
    service: string;
    intervalMs: number | null;
    depth: "metadata_only" | "summary" | "full" | null;
    enabled: boolean | null;
  }>;
  llmListModels(): Promise<LlmListModelsResult>;
  llmGetStatus(): Promise<LlmAvailabilityResult>;
  llmGetRouterStatus(): Promise<RouterStatusResult>;
  llmPullModel(
    provider: "ollama" | "llamacpp",
    modelName: string,
  ): Promise<LlmPullStartedResult>;
  llmCancelPull(pullId: string): Promise<{ cancelled: boolean }>;
  llmLoadModel(
    provider: "ollama" | "llamacpp",
    modelName: string,
  ): Promise<{ isLoaded: true }>;
  llmUnloadModel(
    provider: "ollama" | "llamacpp",
    modelName: string,
  ): Promise<{ isLoaded: false }>;
  llmSetDefault(
    taskType: LlmTaskType,
    provider: "ollama" | "llamacpp" | "remote",
    modelName: string,
  ): Promise<{ taskType: LlmTaskType; provider: string; modelName: string }>;
}
```

- [ ] **Step 3: Implement the wrappers inside `createIpcClient`**

Inside the `client` object literal in `createIpcClient`, after the existing `telemetrySetEnabled` entry (end of the WS5-C Plan 2 additions), append:

```ts
    async connectorSetConfig(service, patch) {
      const params: Record<string, unknown> = { service };
      if (patch.intervalMs !== undefined) params.intervalMs = patch.intervalMs;
      if (patch.depth !== undefined) params.depth = patch.depth;
      if (patch.enabled !== undefined) params.enabled = patch.enabled;
      return await this.call("connector.setConfig", params);
    },
    async llmListModels(): Promise<LlmListModelsResult> {
      const res = await this.call<unknown>("llm.listModels", {});
      if (typeof res !== "object" || res === null)
        throw new Error("llm.listModels: expected object");
      return res as LlmListModelsResult;
    },
    async llmGetStatus(): Promise<LlmAvailabilityResult> {
      const res = await this.call<unknown>("llm.getStatus", {});
      if (typeof res !== "object" || res === null)
        throw new Error("llm.getStatus: expected object");
      return res as LlmAvailabilityResult;
    },
    async llmGetRouterStatus(): Promise<RouterStatusResult> {
      const res = await this.call<unknown>("llm.getRouterStatus", {});
      if (typeof res !== "object" || res === null)
        throw new Error("llm.getRouterStatus: expected object");
      return res as RouterStatusResult;
    },
    async llmPullModel(provider, modelName) {
      return await this.call("llm.pullModel", { provider, modelName });
    },
    async llmCancelPull(pullId) {
      return await this.call("llm.cancelPull", { pullId });
    },
    async llmLoadModel(provider, modelName) {
      return await this.call("llm.loadModel", { provider, modelName });
    },
    async llmUnloadModel(provider, modelName) {
      return await this.call("llm.unloadModel", { provider, modelName });
    },
    async llmSetDefault(taskType, provider, modelName) {
      return await this.call("llm.setDefault", { taskType, provider, modelName });
    },
```

- [ ] **Step 4: Run the new tests, expect PASS**

```bash
cd packages/ui && bunx vitest run test/ipc/client-ws5c-plan3.test.ts && cd ../..
```

Expected: all 11 tests pass.

### Task 6: Extend `__mocks__/client.ts` with module-scope mocks

**Files:**
- Modify: `packages/ui/src/ipc/__mocks__/client.ts`

- [ ] **Step 1: Append the new mocks**

The mock module already has an explicit Plan-2 section with `profileListMock` etc. Keep its whole existing body and append the Plan 3 additions + wire them into the `createIpcClient()` factory. Apply this edit (the full updated file contents):

```ts
import { vi } from "vitest";

// Module-scope `vi.fn()` instances are stable across `createIpcClient()` calls.
// Tests import these directly to set up mocked return values / rejections.

export const callMock = vi.fn<(method: string, params?: unknown) => Promise<unknown>>();
export const subscribeMock = vi.fn<
  (handler: (n: { method: string; params: unknown }) => void) => Promise<() => void>
>(async () => () => {});
export const onConnectionStateMock = vi.fn<() => Promise<() => void>>(async () => () => {});

// WS5-B
export const connectorListStatusMock = vi.fn<() => Promise<unknown>>();
export const indexMetricsMock = vi.fn<() => Promise<unknown>>();
export const auditListMock = vi.fn<(limit?: number) => Promise<unknown>>();
export const consentRespondMock = vi.fn<(requestId: string, approved: boolean) => Promise<void>>(
  async () => undefined,
);

// WS5-C Plan 2 additions
export const profileListMock = vi.fn<() => Promise<unknown>>();
export const profileCreateMock = vi.fn<(name: string) => Promise<unknown>>();
export const profileSwitchMock = vi.fn<(name: string) => Promise<unknown>>();
export const profileDeleteMock = vi.fn<(name: string) => Promise<unknown>>();
export const telemetryGetStatusMock = vi.fn<() => Promise<unknown>>();
export const telemetrySetEnabledMock = vi.fn<(enabled: boolean) => Promise<unknown>>();

// WS5-C Plan 3 additions
export const connectorSetConfigMock = vi.fn<
  (service: string, patch: Record<string, unknown>) => Promise<unknown>
>();
export const llmListModelsMock = vi.fn<() => Promise<unknown>>();
export const llmGetStatusMock = vi.fn<() => Promise<unknown>>();
export const llmGetRouterStatusMock = vi.fn<() => Promise<unknown>>();
export const llmPullModelMock = vi.fn<
  (provider: string, modelName: string) => Promise<unknown>
>();
export const llmCancelPullMock = vi.fn<(pullId: string) => Promise<unknown>>();
export const llmLoadModelMock = vi.fn<
  (provider: string, modelName: string) => Promise<unknown>
>();
export const llmUnloadModelMock = vi.fn<
  (provider: string, modelName: string) => Promise<unknown>
>();
export const llmSetDefaultMock = vi.fn<
  (taskType: string, provider: string, modelName: string) => Promise<unknown>
>();

export const createIpcClient = () => ({
  call: callMock,
  subscribe: subscribeMock,
  onConnectionState: onConnectionStateMock,
  connectorListStatus: connectorListStatusMock,
  indexMetrics: indexMetricsMock,
  auditList: auditListMock,
  consentRespond: consentRespondMock,
  profileList: profileListMock,
  profileCreate: profileCreateMock,
  profileSwitch: profileSwitchMock,
  profileDelete: profileDeleteMock,
  telemetryGetStatus: telemetryGetStatusMock,
  telemetrySetEnabled: telemetrySetEnabledMock,
  connectorSetConfig: connectorSetConfigMock,
  llmListModels: llmListModelsMock,
  llmGetStatus: llmGetStatusMock,
  llmGetRouterStatus: llmGetRouterStatusMock,
  llmPullModel: llmPullModelMock,
  llmCancelPull: llmCancelPullMock,
  llmLoadModel: llmLoadModelMock,
  llmUnloadModel: llmUnloadModelMock,
  llmSetDefault: llmSetDefaultMock,
});

export const __resetIpcClientForTests = () => {};
```

- [ ] **Step 2: Run the full UI test suite — expect no regressions**

```bash
cd packages/ui && bunx vitest run && cd ../..
```

Expected: every Plan 1 + Plan 2 test still passes; the 11 Plan 3 `client-ws5c-plan3.test.ts` tests added in Task 4 now pass.

### Task 7: Commit Phase 2

- [ ] **Step 1: Commit**

```bash
git add packages/ui/src/ipc/types.ts \
        packages/ui/src/ipc/client.ts \
        packages/ui/src/ipc/__mocks__/client.ts \
        packages/ui/test/ipc/client-ws5c-plan3.test.ts
git commit -m "feat(ui-ipc): connector.setConfig + llm.* wrappers for Connectors/Model panels"
```

---

## Phase 3 — Connectors slice expansion

The existing `connectors` slice from Plan 2 holds `connectorsList: ReadonlyArray<PersistedConnectorRow>` and a single `setConnectorsList` action — persisted so a cold-open offline shows the last-known grid. Plan 3 adds two transient (non-persisted) fields:

- `perServiceInFlight: Readonly<Record<string, boolean>>` — tracks which rows are mid-setConfig. Shown as a "Saving…" inline indicator; also used to disable the row's controls.
- `highlightService: string | null` — deep-link target from the Dashboard's degraded-connector tile; drives the focus ring.

The persisted whitelist stays unchanged (still only `connectorsList`). The two new fields live at the slice root, memory-only.

### Task 8: Write failing slice tests

**Files:**
- Create: `packages/ui/test/store/slices/connectors-plan3.test.ts`

- [ ] **Step 1: Write the tests**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useNimbusStore } from "../../../src/store";

beforeEach(() => {
  localStorage.clear();
  useNimbusStore.setState({
    connectorsList: [],
    perServiceInFlight: {},
    highlightService: null,
  } as never);
});

describe("ConnectorsSlice — Plan 3 additions", () => {
  it("setConnectorInFlight flips the per-service flag", () => {
    useNimbusStore.getState().setConnectorInFlight("github", true);
    expect(useNimbusStore.getState().perServiceInFlight.github).toBe(true);
    useNimbusStore.getState().setConnectorInFlight("github", false);
    expect(useNimbusStore.getState().perServiceInFlight.github).toBe(false);
  });

  it("setConnectorInFlight does not leak across services", () => {
    useNimbusStore.getState().setConnectorInFlight("github", true);
    useNimbusStore.getState().setConnectorInFlight("slack", true);
    expect(useNimbusStore.getState().perServiceInFlight).toEqual({
      github: true,
      slack: true,
    });
  });

  it("setHighlightService stores and clears the highlight target", () => {
    useNimbusStore.getState().setHighlightService("slack");
    expect(useNimbusStore.getState().highlightService).toBe("slack");
    useNimbusStore.getState().setHighlightService(null);
    expect(useNimbusStore.getState().highlightService).toBeNull();
  });

  it("patchConnectorRow upserts an intervalMs change on a matching row", () => {
    useNimbusStore.setState({
      connectorsList: [
        {
          service: "github",
          intervalMs: 60000,
          depth: "summary",
          enabled: true,
          health: "healthy",
        },
      ],
    } as never);
    useNimbusStore.getState().patchConnectorRow("github", { intervalMs: 120000 });
    const row = useNimbusStore.getState().connectorsList.find((r) => r.service === "github");
    expect(row?.intervalMs).toBe(120000);
    expect(row?.depth).toBe("summary");
    expect(row?.enabled).toBe(true);
  });

  it("patchConnectorRow is a no-op for unknown services", () => {
    useNimbusStore.getState().patchConnectorRow("unknown", { enabled: false });
    expect(useNimbusStore.getState().connectorsList).toEqual([]);
  });
});

describe("ConnectorsSlice — persist whitelist unchanged", () => {
  it("perServiceInFlight and highlightService are NOT persisted", () => {
    useNimbusStore.setState({
      perServiceInFlight: { github: true },
      highlightService: "slack",
    } as never);
    const raw = localStorage.getItem("nimbus-ui-store");
    if (raw === null) {
      // Persist middleware flushes asynchronously in the first render; OK if nothing has been written.
      return;
    }
    const parsed = JSON.parse(raw);
    expect(parsed.state?.perServiceInFlight).toBeUndefined();
    expect(parsed.state?.highlightService).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd packages/ui && bunx vitest run test/store/slices/connectors-plan3.test.ts && cd ../..
```

Expected: `setConnectorInFlight is not a function`, `setHighlightService is not a function`, `patchConnectorRow is not a function`.

### Task 9: Expand `connectors` slice

**Files:**
- Modify: `packages/ui/src/store/slices/connectors.ts`

- [ ] **Step 1: Replace the slice**

```ts
import type { StateCreator } from "zustand";
import type { ConnectorHealth } from "../../ipc/types";

/**
 * Persisted per-connector snapshot — written to localStorage so cold-opening the app
 * with the Gateway already down still shows the last-known grid (spec §2.1).
 */
export interface PersistedConnectorRow {
  readonly service: string;
  readonly intervalMs: number;
  readonly depth: "metadata_only" | "summary" | "full";
  readonly enabled: boolean;
  readonly health: ConnectorHealth;
}

export interface ConnectorsSlice {
  readonly connectorsList: ReadonlyArray<PersistedConnectorRow>;
  /** Transient — tracks which rows are mid-setConfig. Not persisted. */
  readonly perServiceInFlight: Readonly<Record<string, boolean>>;
  /** Transient — deep-link target from Dashboard's degraded-connector tile. Not persisted. */
  readonly highlightService: string | null;
  setConnectorsList: (list: ReadonlyArray<PersistedConnectorRow>) => void;
  setConnectorInFlight: (service: string, inFlight: boolean) => void;
  setHighlightService: (service: string | null) => void;
  patchConnectorRow: (service: string, patch: Partial<PersistedConnectorRow>) => void;
}

export const createConnectorsSlice: StateCreator<ConnectorsSlice, [], [], ConnectorsSlice> = (
  set,
) => ({
  connectorsList: [],
  perServiceInFlight: {},
  highlightService: null,
  setConnectorsList: (list) => set({ connectorsList: list }),
  setConnectorInFlight: (service, inFlight) =>
    set((s) => ({
      perServiceInFlight: { ...s.perServiceInFlight, [service]: inFlight },
    })),
  setHighlightService: (service) => set({ highlightService: service }),
  patchConnectorRow: (service, patch) =>
    set((s) => ({
      connectorsList: s.connectorsList.map((r) => (r.service === service ? { ...r, ...patch } : r)),
    })),
});
```

- [ ] **Step 2: Run, expect PASS**

```bash
cd packages/ui && bunx vitest run test/store/slices/connectors-plan3.test.ts && cd ../..
```

Expected: all 6 slice tests pass.

### Task 10: Commit Phase 3

- [ ] **Step 1: Commit**

```bash
git add packages/ui/src/store/slices/connectors.ts \
        packages/ui/test/store/slices/connectors-plan3.test.ts
git commit -m "feat(ui-store): expand connectors slice (in-flight + highlight + row patch)"
```

---

## Phase 4 — Connectors panel

The panel polls `connector.listStatus` at 30 s via `useIpcQuery`, subscribes to `connector.configChanged` via `useIpcSubscription`, and renders one row per connector with:

- **Health dot** (reuses the `dotColour` logic inline — no shared helper extracted).
- **Interval input + unit select** (`sec` / `min` / `hr`, default `min`). Debounced 500 ms; on idle, calls `connectorSetConfig({ intervalMs })`. Inline validation: < 60 s shows "minimum 60 seconds" and disables the save.
- **Depth `<select>`** with three options: Metadata only / Summary / Full. Changes fire `connectorSetConfig({ depth })` immediately.
- **Enable toggle** (checkbox). Fires `connectorSetConfig({ enabled })` immediately.
- **Focus ring** when `highlightService === row.service`.

### Task 11: Write failing panel tests

The ConnectorsPanel uses `useIpcQuery("connector.listStatus", 30000)` so connector-health transitions that happen during a session (e.g. a connector going rate-limited mid-sync) surface without a notification — `connector.configChanged` only covers config writes, not health state. `useIpcQuery` internally calls `createIpcClient().call(method, params)`, so tests drive it via the module-scope `callMock`, not `connectorListStatusMock`.

**Files:**
- Create: `packages/ui/test/pages/settings/ConnectorsPanel.test.tsx`

- [ ] **Step 1: Write the tests**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/ipc/client");

import {
  callMock,
  connectorSetConfigMock,
  subscribeMock,
} from "../../../src/ipc/__mocks__/client";
import { ConnectorsPanel } from "../../../src/pages/settings/ConnectorsPanel";
import { useNimbusStore } from "../../../src/store";

function renderPanel(initialEntries: string[] = ["/settings/connectors"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ConnectorsPanel />
    </MemoryRouter>,
  );
}

/**
 * Helper: stub `callMock` so `useIpcQuery("connector.listStatus")` returns `rows`.
 * Other methods (none used by this panel today) fall through to an explicit reject
 * so a typo in the test surfaces immediately instead of hanging.
 */
function stubListStatus(rows: unknown): void {
  callMock.mockImplementation(async (method: string) => {
    if (method === "connector.listStatus") return rows;
    throw new Error(`unexpected method in test: ${method}`);
  });
}

beforeEach(() => {
  localStorage.clear();
  callMock.mockReset();
  connectorSetConfigMock.mockReset();
  subscribeMock.mockReset();
  subscribeMock.mockResolvedValue(() => {});
  useNimbusStore.setState({
    connectorsList: [],
    perServiceInFlight: {},
    highlightService: null,
    connectionState: "connected",
  } as never);
});

describe("ConnectorsPanel", () => {
  it("fetches listStatus on mount and renders one row per connector with the current fields", async () => {
    stubListStatus([
      {
        name: "github",
        health: "healthy",
        intervalMs: 120000,
        depth: "summary",
        enabled: true,
      },
      {
        name: "slack",
        health: "rate_limited",
        intervalMs: 300000,
        depth: "metadata_only",
        enabled: false,
      },
    ]);
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("github")).toBeInTheDocument();
      expect(screen.getByText("slack")).toBeInTheDocument();
    });
    // interval shown as the unit-appropriate number — 120000 ms == 2 min.
    expect(screen.getByLabelText("github interval value")).toHaveValue(2);
    expect(screen.getByLabelText("github interval unit")).toHaveValue("min");
    // slack is paused → enable checkbox unchecked.
    expect(screen.getByLabelText("slack enabled")).not.toBeChecked();
  });

  it("editing the interval debounces by 500 ms then calls setConfig in ms", async () => {
    vi.useFakeTimers();
    try {
      stubListStatus([
        {
          name: "github",
          health: "healthy",
          intervalMs: 120000,
          depth: "summary",
          enabled: true,
        },
      ]);
      connectorSetConfigMock.mockResolvedValueOnce({
        service: "github",
        intervalMs: 180000,
        depth: null,
        enabled: null,
      });
      renderPanel();
      await waitFor(() => screen.getByLabelText("github interval value"));
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const input = screen.getByLabelText("github interval value");
      await user.clear(input);
      await user.type(input, "3");
      // before the debounce fires, no call
      expect(connectorSetConfigMock).not.toHaveBeenCalled();
      vi.advanceTimersByTime(500);
      await waitFor(() =>
        expect(connectorSetConfigMock).toHaveBeenCalledWith("github", { intervalMs: 180000 }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("below-60-second interval shows inline error and never calls setConfig", async () => {
    vi.useFakeTimers();
    try {
      stubListStatus([
        {
          name: "github",
          health: "healthy",
          intervalMs: 120000,
          depth: "summary",
          enabled: true,
        },
      ]);
      renderPanel();
      await waitFor(() => screen.getByLabelText("github interval value"));
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const input = screen.getByLabelText("github interval value");
      const unit = screen.getByLabelText("github interval unit");
      await user.selectOptions(unit, "sec");
      await user.clear(input);
      await user.type(input, "30");
      vi.advanceTimersByTime(500);
      expect(screen.getByText(/minimum 60 seconds/i)).toBeInTheDocument();
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(connectorSetConfigMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("changing the depth select fires setConfig with the new depth", async () => {
    stubListStatus([
      {
        name: "github",
        health: "healthy",
        intervalMs: 120000,
        depth: "summary",
        enabled: true,
      },
    ]);
    connectorSetConfigMock.mockResolvedValueOnce({
      service: "github",
      intervalMs: null,
      depth: "full",
      enabled: null,
    });
    renderPanel();
    await waitFor(() => screen.getByLabelText("github depth"));
    await userEvent.selectOptions(screen.getByLabelText("github depth"), "full");
    await waitFor(() =>
      expect(connectorSetConfigMock).toHaveBeenCalledWith("github", { depth: "full" }),
    );
  });

  it("toggling the enabled checkbox fires setConfig with the flipped value", async () => {
    stubListStatus([
      {
        name: "github",
        health: "healthy",
        intervalMs: 120000,
        depth: "summary",
        enabled: true,
      },
    ]);
    connectorSetConfigMock.mockResolvedValueOnce({
      service: "github",
      intervalMs: null,
      depth: null,
      enabled: false,
    });
    renderPanel();
    await waitFor(() => screen.getByLabelText("github enabled"));
    await userEvent.click(screen.getByLabelText("github enabled"));
    await waitFor(() =>
      expect(connectorSetConfigMock).toHaveBeenCalledWith("github", { enabled: false }),
    );
  });

  it("disables write controls when connectionState=disconnected (renders cached rows)", async () => {
    // useIpcQuery pauses when connectionState !== "connected", so we drive the panel
    // from the persisted `connectorsList` instead of the mocked fetch.
    useNimbusStore.setState({
      connectionState: "disconnected",
      connectorsList: [
        {
          service: "github",
          intervalMs: 120000,
          depth: "summary",
          enabled: true,
          health: "healthy",
        },
      ],
    } as never);
    stubListStatus([]); // never invoked because useIpcQuery is paused
    renderPanel();
    await waitFor(() => screen.getByLabelText("github enabled"));
    expect(screen.getByLabelText("github enabled")).toBeDisabled();
    expect(screen.getByLabelText("github depth")).toBeDisabled();
    expect(screen.getByLabelText("github interval value")).toBeDisabled();
  });

  it("rings the row whose service matches ?highlight=<name>", async () => {
    stubListStatus([
      {
        name: "slack",
        health: "rate_limited",
        intervalMs: 300000,
        depth: "metadata_only",
        enabled: true,
      },
    ]);
    renderPanel(["/settings/connectors?highlight=slack"]);
    await waitFor(() => screen.getByText("slack"));
    const row = screen.getByTestId("connector-row-slack");
    expect(row.className).toMatch(/ring-2/);
  });
});

describe("ConnectorsPanel — connector.configChanged reconcile", () => {
  it("patches the matching row when a configChanged notification arrives", async () => {
    stubListStatus([
      {
        name: "github",
        health: "healthy",
        intervalMs: 120000,
        depth: "summary",
        enabled: true,
      },
    ]);
    // Capture the subscribe handler so the test can fire a notification.
    let captured: ((n: { method: string; params: unknown }) => void) | null = null;
    subscribeMock.mockImplementation(async (handler) => {
      captured = handler;
      return () => {};
    });
    renderPanel();
    await waitFor(() => screen.getByLabelText("github depth"));
    expect(captured).not.toBeNull();
    captured?.({
      method: "connector.configChanged",
      params: { service: "github", intervalMs: 600000, depth: "full", enabled: false },
    });
    await waitFor(() => {
      expect(screen.getByLabelText("github depth")).toHaveValue("full");
      expect(screen.getByLabelText("github enabled")).not.toBeChecked();
      expect(screen.getByLabelText("github interval value")).toHaveValue(10);
      expect(screen.getByLabelText("github interval unit")).toHaveValue("min");
    });
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd packages/ui && bunx vitest run test/pages/settings/ConnectorsPanel.test.tsx && cd ../..
```

Expected: `Cannot find module '.../ConnectorsPanel'`.

### Task 12: Implement the helper `toIntervalParts`

**Files:**
- Create: `packages/ui/src/pages/settings/connectors/interval-parts.ts`

A tiny, isolated helper lets the test exercise the conversion logic without mounting the panel.

- [ ] **Step 1: Write the file**

```ts
export type IntervalUnit = "sec" | "min" | "hr";

export interface IntervalParts {
  readonly value: number;
  readonly unit: IntervalUnit;
}

/**
 * Convert ms → the largest whole unit that divides ms evenly, biased toward minutes.
 * Returns `min` when ms is exactly zero (defensive — the UI should never send zero).
 */
export function fromMs(ms: number): IntervalParts {
  if (ms <= 0) return { value: 1, unit: "min" };
  if (ms % 3_600_000 === 0) return { value: ms / 3_600_000, unit: "hr" };
  if (ms % 60_000 === 0) return { value: ms / 60_000, unit: "min" };
  return { value: Math.round(ms / 1000), unit: "sec" };
}

export function toMs(parts: IntervalParts): number {
  switch (parts.unit) {
    case "sec":
      return parts.value * 1000;
    case "min":
      return parts.value * 60_000;
    case "hr":
      return parts.value * 3_600_000;
  }
}

/** 60 seconds, expressed in ms. Matches Gateway's `MIN_SYNC_INTERVAL_MS`. */
export const MIN_INTERVAL_MS = 60_000;
```

- [ ] **Step 2: Write a focused unit test for the helper**

Create `packages/ui/test/pages/settings/connectors/interval-parts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  fromMs,
  MIN_INTERVAL_MS,
  toMs,
} from "../../../../src/pages/settings/connectors/interval-parts";

describe("interval-parts", () => {
  it("MIN_INTERVAL_MS is 60_000", () => {
    expect(MIN_INTERVAL_MS).toBe(60_000);
  });
  it("fromMs(120000) → 2 min", () => {
    expect(fromMs(120_000)).toEqual({ value: 2, unit: "min" });
  });
  it("fromMs(3_600_000) → 1 hr", () => {
    expect(fromMs(3_600_000)).toEqual({ value: 1, unit: "hr" });
  });
  it("fromMs(90_000) → 90 sec (non-minute multiple)", () => {
    expect(fromMs(90_000)).toEqual({ value: 90, unit: "sec" });
  });
  it("toMs round-trips", () => {
    expect(toMs({ value: 3, unit: "min" })).toBe(180_000);
    expect(toMs({ value: 2, unit: "hr" })).toBe(7_200_000);
    expect(toMs({ value: 45, unit: "sec" })).toBe(45_000);
  });
});
```

- [ ] **Step 3: Run, expect PASS**

```bash
cd packages/ui && bunx vitest run test/pages/settings/connectors/interval-parts.test.ts && cd ../..
```

Expected: all 5 helper tests pass.

### Task 13: Implement `ConnectorsPanel`

**Files:**
- Create: `packages/ui/src/pages/settings/ConnectorsPanel.tsx`

- [ ] **Step 1: Write the panel**

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PanelError } from "../../components/settings/PanelError";
import { PanelHeader } from "../../components/settings/PanelHeader";
import { StaleChip } from "../../components/settings/StaleChip";
import { useIpcQuery } from "../../hooks/useIpcQuery";
import { createIpcClient } from "../../ipc/client";
import type {
  ConnectorConfigChangedPayload,
  ConnectorHealth,
  ConnectorStatus,
  JsonRpcNotification,
} from "../../ipc/types";
import { useNimbusStore } from "../../store";
import type { PersistedConnectorRow } from "../../store/slices/connectors";
import {
  fromMs,
  type IntervalParts,
  type IntervalUnit,
  MIN_INTERVAL_MS,
  toMs,
} from "./connectors/interval-parts";

const DEPTH_OPTIONS = [
  { value: "metadata_only", label: "Metadata only" },
  { value: "summary", label: "Summary" },
  { value: "full", label: "Full" },
] as const;

const DEBOUNCE_MS = 500;

function dotClass(h: ConnectorHealth): string {
  switch (h) {
    case "healthy":
      return "bg-green-500";
    case "degraded":
      return "bg-yellow-500";
    case "rate_limited":
      return "bg-amber-500";
    case "unauthenticated":
      return "bg-orange-500";
    case "error":
      return "bg-red-500";
    case "paused":
    default:
      return "bg-gray-400";
  }
}

function asPersistedRow(s: ConnectorStatus): PersistedConnectorRow {
  return {
    service: s.name,
    intervalMs: s.intervalMs ?? 60_000,
    depth: s.depth ?? "summary",
    enabled: s.enabled ?? true,
    health: s.health,
  };
}

interface RowProps {
  readonly row: PersistedConnectorRow;
  readonly inFlight: boolean;
  readonly writeDisabled: boolean;
  readonly highlighted: boolean;
  readonly onPatch: (patch: {
    intervalMs?: number;
    depth?: "metadata_only" | "summary" | "full";
    enabled?: boolean;
  }) => Promise<void>;
}

function ConnectorRow({ row, inFlight, writeDisabled, highlighted, onPatch }: RowProps) {
  const init = fromMs(row.intervalMs);
  const [parts, setParts] = useState<IntervalParts>(init);
  const [validationError, setValidationError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resync when the upstream row changes (e.g. configChanged reconcile).
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally resyncing on row intervalMs change
  useEffect(() => {
    setParts(fromMs(row.intervalMs));
    setValidationError(null);
  }, [row.intervalMs]);

  const scheduleIntervalSave = useCallback(
    (next: IntervalParts) => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const ms = toMs(next);
        if (ms < MIN_INTERVAL_MS) {
          setValidationError("minimum 60 seconds");
          return;
        }
        setValidationError(null);
        void onPatch({ intervalMs: ms });
      }, DEBOUNCE_MS);
    },
    [onPatch],
  );

  const onValueChange = useCallback(
    (raw: string) => {
      const v = Number.parseInt(raw, 10);
      if (!Number.isFinite(v) || v < 1) {
        setParts((p) => ({ ...p, value: 1 }));
        return;
      }
      const next: IntervalParts = { ...parts, value: v };
      setParts(next);
      scheduleIntervalSave(next);
    },
    [parts, scheduleIntervalSave],
  );

  const onUnitChange = useCallback(
    (u: IntervalUnit) => {
      const next: IntervalParts = { ...parts, unit: u };
      setParts(next);
      scheduleIntervalSave(next);
    },
    [parts, scheduleIntervalSave],
  );

  return (
    <li
      data-testid={`connector-row-${row.service}`}
      className={[
        "flex items-center gap-4 px-4 py-3",
        highlighted ? "ring-2 ring-[var(--color-accent)]" : "",
      ].join(" ")}
    >
      <span className={`inline-block w-2 h-2 rounded-full ${dotClass(row.health)}`} aria-hidden />
      <span className="font-medium w-28">{row.service}</span>

      <label className="flex items-center gap-1 text-sm">
        <span className="sr-only" id={`${row.service}-interval-label`}>
          {row.service} interval
        </span>
        <input
          type="number"
          min={1}
          step={1}
          value={parts.value}
          disabled={writeDisabled}
          onChange={(e) => onValueChange(e.target.value)}
          aria-label={`${row.service} interval value`}
          aria-invalid={validationError !== null ? true : undefined}
          className={[
            "w-16 px-2 py-1 rounded border bg-[var(--color-bg-subtle)] disabled:opacity-50",
            validationError !== null
              ? "border-[var(--color-danger-border)]"
              : "border-[var(--color-border)]",
          ].join(" ")}
        />
        <select
          value={parts.unit}
          disabled={writeDisabled}
          onChange={(e) => onUnitChange(e.target.value as IntervalUnit)}
          aria-label={`${row.service} interval unit`}
          className="px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-bg-subtle)] disabled:opacity-50"
        >
          <option value="sec">sec</option>
          <option value="min">min</option>
          <option value="hr">hr</option>
        </select>
      </label>

      <select
        value={row.depth}
        disabled={writeDisabled}
        onChange={(e) =>
          void onPatch({ depth: e.target.value as "metadata_only" | "summary" | "full" })
        }
        aria-label={`${row.service} depth`}
        className="px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-bg-subtle)] disabled:opacity-50"
      >
        {DEPTH_OPTIONS.map((d) => (
          <option key={d.value} value={d.value}>
            {d.label}
          </option>
        ))}
      </select>

      <label className="flex items-center gap-1 text-sm">
        <input
          type="checkbox"
          checked={row.enabled}
          disabled={writeDisabled}
          onChange={(e) => void onPatch({ enabled: e.target.checked })}
          aria-label={`${row.service} enabled`}
        />
        <span>Enabled</span>
      </label>

      {validationError !== null && (
        <span className="text-xs text-[var(--color-danger-text)]">{validationError}</span>
      )}
      {inFlight && validationError === null && (
        <span className="text-xs text-[var(--color-text-muted)]">Saving…</span>
      )}
    </li>
  );
}

export function ConnectorsPanel() {
  const connectorsList = useNimbusStore((s) => s.connectorsList);
  const perServiceInFlight = useNimbusStore((s) => s.perServiceInFlight);
  const highlightService = useNimbusStore((s) => s.highlightService);
  const connectionState = useNimbusStore((s) => s.connectionState);
  const setConnectorsList = useNimbusStore((s) => s.setConnectorsList);
  const setConnectorInFlight = useNimbusStore((s) => s.setConnectorInFlight);
  const setHighlightService = useNimbusStore((s) => s.setHighlightService);
  const patchConnectorRow = useNimbusStore((s) => s.patchConnectorRow);

  const [searchParams] = useSearchParams();

  const offline = connectionState === "disconnected";
  const writeDisabled = offline;

  // Sync ?highlight=<service> → store.
  useEffect(() => {
    const q = searchParams.get("highlight");
    setHighlightService(q ?? null);
  }, [searchParams, setHighlightService]);

  // Poll listStatus every 30 s so background health transitions (e.g. a connector
  // becoming rate-limited during a sync) surface without a dedicated notification.
  // `useIpcQuery` auto-pauses when the tab is hidden or the gateway is disconnected.
  const {
    data: listStatusRows,
    error: fetchError,
    refetch,
  } = useIpcQuery<ConnectorStatus[]>("connector.listStatus", 30_000);

  useEffect(() => {
    if (listStatusRows === null) return;
    setConnectorsList(listStatusRows.map(asPersistedRow));
  }, [listStatusRows, setConnectorsList]);

  // Consume `connector.configChanged` for cross-window reconcile.
  const onNotification = useCallback(
    (n: JsonRpcNotification) => {
      if (n.method !== "connector.configChanged") return;
      const p = n.params as ConnectorConfigChangedPayload | null;
      if (p === null || typeof p.service !== "string") return;
      patchConnectorRow(p.service, {
        intervalMs: p.intervalMs,
        depth: p.depth,
        enabled: p.enabled,
      });
    },
    [patchConnectorRow],
  );
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void createIpcClient()
      .subscribe(onNotification)
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [onNotification]);

  const buildPatch = useCallback(
    (service: string) =>
      async (patch: {
        intervalMs?: number;
        depth?: "metadata_only" | "summary" | "full";
        enabled?: boolean;
      }) => {
        setConnectorInFlight(service, true);
        try {
          await createIpcClient().connectorSetConfig(service, patch);
          // Optimistically patch locally; the configChanged notification will converge.
          patchConnectorRow(service, patch);
        } finally {
          setConnectorInFlight(service, false);
        }
      },
    [setConnectorInFlight, patchConnectorRow],
  );

  const rows = useMemo(() => connectorsList, [connectorsList]);

  return (
    <section className="p-6 space-y-6">
      <PanelHeader
        title="Connectors"
        description="Sync interval, reindex depth, and enable/disable per connector. Minimum interval is 60 seconds."
        livePill={offline ? <StaleChip /> : undefined}
      />
      {fetchError !== null && (
        <PanelError
          message={`Failed to load connector status: ${fetchError}`}
          onRetry={() => refetch()}
        />
      )}
      <ul className="divide-y divide-[var(--color-border)] border border-[var(--color-border)] rounded-md">
        {rows.map((r) => (
          <ConnectorRow
            key={r.service}
            row={r}
            inFlight={perServiceInFlight[r.service] === true}
            writeDisabled={writeDisabled}
            highlighted={highlightService === r.service}
            onPatch={buildPatch(r.service)}
          />
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: Wire the route**

In `packages/ui/src/App.tsx`, import the new panel and swap the placeholder. Replace:

```tsx
import { PanelComingSoon } from "./components/settings/PanelComingSoon";
```

with:

```tsx
import { PanelComingSoon } from "./components/settings/PanelComingSoon";
import { ConnectorsPanel } from "./pages/settings/ConnectorsPanel";
```

And replace the line:

```tsx
<Route path="connectors" element={<PanelComingSoon title="Connectors" />} />
```

with:

```tsx
<Route path="connectors" element={<ConnectorsPanel />} />
```

- [ ] **Step 3: Run the panel tests, expect PASS**

```bash
cd packages/ui && bunx vitest run test/pages/settings/ConnectorsPanel.test.tsx && cd ../..
```

Expected: all 8 tests pass.

- [ ] **Step 4: Run the full UI suite, expect no regressions**

```bash
cd packages/ui && bunx vitest run && cd ../..
```

Expected: every test in Plans 1, 2, and the Plan 3 tests-so-far passes.

### Task 14: Commit Phase 4

- [ ] **Step 1: Commit**

```bash
git add packages/ui/src/pages/settings/ConnectorsPanel.tsx \
        packages/ui/src/pages/settings/connectors/interval-parts.ts \
        packages/ui/src/App.tsx \
        packages/ui/test/pages/settings/ConnectorsPanel.test.tsx \
        packages/ui/test/pages/settings/connectors/interval-parts.test.ts
git commit -m "feat(ui): Connectors panel with interval editor, depth, enable, configChanged reconcile, highlight"
```

---

## Phase 5 — Model slice expansion

The stub `model` slice from Plan 2 carries `installedModels` + `activePullId` (both persisted). Plan 3 adds transient (non-persisted) state for:

- `routerStatus: RouterStatusResult | null` — from `llm.getRouterStatus`.
- `pullProgress: Record<string, LlmPullProgressPayload>` — keyed by `pullId`; one entry at a time in v0.1.0 but a map keeps the slice extensible.
- `pullStalled: boolean` — set by the 15 s watchdog in PullDialog.
- `loadedKeys: Readonly<Record<string, boolean>>` — keyed by `${provider}:${modelName}`; patched by `llm.modelLoaded` / `llm.modelUnloaded` notifications.

Persisted whitelist stays `{ installedModels, activePullId }` — no change to `partialize.ts`.

### Task 15: Write failing slice tests

**Files:**
- Create: `packages/ui/test/store/slices/model-plan3.test.ts`

- [ ] **Step 1: Write the tests**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useNimbusStore } from "../../../src/store";

beforeEach(() => {
  localStorage.clear();
  useNimbusStore.setState({
    installedModels: [],
    activePullId: null,
    routerStatus: null,
    pullProgress: {},
    pullStalled: false,
    loadedKeys: {},
  } as never);
});

describe("ModelSlice — Plan 3 additions", () => {
  it("setRouterStatus stores the decisions map", () => {
    const status = {
      decisions: {
        classification: { providerId: "ollama", modelName: "gemma:2b", reason: "default" },
      },
    } as const;
    useNimbusStore.getState().setRouterStatus(status);
    expect(useNimbusStore.getState().routerStatus?.decisions.classification?.modelName).toBe(
      "gemma:2b",
    );
  });

  it("upsertPullProgress + clearPullProgress round-trip one pullId", () => {
    useNimbusStore.getState().upsertPullProgress({
      pullId: "pull_abc",
      provider: "ollama",
      modelName: "gemma:2b",
      status: "downloading",
      completedBytes: 100,
      totalBytes: 1000,
    });
    expect(useNimbusStore.getState().pullProgress.pull_abc?.completedBytes).toBe(100);
    useNimbusStore.getState().clearPullProgress("pull_abc");
    expect(useNimbusStore.getState().pullProgress.pull_abc).toBeUndefined();
  });

  it("setPullStalled is idempotent", () => {
    useNimbusStore.getState().setPullStalled(true);
    useNimbusStore.getState().setPullStalled(true);
    expect(useNimbusStore.getState().pullStalled).toBe(true);
    useNimbusStore.getState().setPullStalled(false);
    expect(useNimbusStore.getState().pullStalled).toBe(false);
  });

  it("patchLoaded writes per-composite-key flags", () => {
    useNimbusStore.getState().patchLoaded("ollama", "gemma:2b", true);
    useNimbusStore.getState().patchLoaded("llamacpp", "llama3:8b", false);
    expect(useNimbusStore.getState().loadedKeys).toEqual({
      "ollama:gemma:2b": true,
      "llamacpp:llama3:8b": false,
    });
  });
});

describe("ModelSlice — persist whitelist unchanged", () => {
  it("routerStatus, pullProgress, pullStalled, loadedKeys are NOT persisted", () => {
    useNimbusStore.setState({
      routerStatus: {
        decisions: { classification: { providerId: "ollama", modelName: "x", reason: "r" } },
      },
      pullProgress: {
        pull_x: {
          pullId: "pull_x",
          provider: "ollama",
          modelName: "x",
          status: "s",
        },
      },
      pullStalled: true,
      loadedKeys: { "ollama:x": true },
    } as never);
    const raw = localStorage.getItem("nimbus-ui-store");
    if (raw === null) return;
    const parsed = JSON.parse(raw);
    expect(parsed.state?.routerStatus).toBeUndefined();
    expect(parsed.state?.pullProgress).toBeUndefined();
    expect(parsed.state?.pullStalled).toBeUndefined();
    expect(parsed.state?.loadedKeys).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd packages/ui && bunx vitest run test/store/slices/model-plan3.test.ts && cd ../..
```

Expected: `setRouterStatus is not a function` (and equivalents).

### Task 16: Expand `model` slice

**Files:**
- Modify: `packages/ui/src/store/slices/model.ts`

- [ ] **Step 1: Replace the slice**

```ts
import type { StateCreator } from "zustand";
import type { LlmPullProgressPayload, RouterStatusResult } from "../../ipc/types";

export interface PersistedModelRow {
  readonly id: string;
  readonly provider: "ollama" | "llamacpp";
}

export interface ModelSlice {
  readonly installedModels: ReadonlyArray<PersistedModelRow>;
  readonly activePullId: string | null;
  /** Transient — latest `llm.getRouterStatus` snapshot. Not persisted. */
  readonly routerStatus: RouterStatusResult | null;
  /** Transient — keyed by `pullId`. Not persisted. */
  readonly pullProgress: Readonly<Record<string, LlmPullProgressPayload>>;
  /** Transient — `true` when no `llm.pullProgress` arrived in the last 15 s. */
  readonly pullStalled: boolean;
  /** Transient — keyed by `${provider}:${modelName}`; patched by load/unload notifications. */
  readonly loadedKeys: Readonly<Record<string, boolean>>;
  setInstalledModels: (list: ReadonlyArray<PersistedModelRow>) => void;
  setActivePullId: (id: string | null) => void;
  setRouterStatus: (status: RouterStatusResult) => void;
  upsertPullProgress: (p: LlmPullProgressPayload) => void;
  clearPullProgress: (pullId: string) => void;
  setPullStalled: (stalled: boolean) => void;
  patchLoaded: (
    provider: "ollama" | "llamacpp",
    modelName: string,
    isLoaded: boolean,
  ) => void;
}

function loadedKey(provider: string, modelName: string): string {
  return `${provider}:${modelName}`;
}

export const createModelSlice: StateCreator<ModelSlice, [], [], ModelSlice> = (set) => ({
  installedModels: [],
  activePullId: null,
  routerStatus: null,
  pullProgress: {},
  pullStalled: false,
  loadedKeys: {},
  setInstalledModels: (list) => set({ installedModels: list }),
  setActivePullId: (id) => set({ activePullId: id }),
  setRouterStatus: (status) => set({ routerStatus: status }),
  upsertPullProgress: (p) =>
    set((s) => ({
      pullProgress: { ...s.pullProgress, [p.pullId]: p },
    })),
  clearPullProgress: (pullId) =>
    set((s) => {
      if (!(pullId in s.pullProgress)) return s;
      const next = { ...s.pullProgress };
      delete (next as Record<string, unknown>)[pullId];
      return { pullProgress: next };
    }),
  setPullStalled: (stalled) => set({ pullStalled: stalled }),
  patchLoaded: (provider, modelName, isLoaded) =>
    set((s) => ({
      loadedKeys: { ...s.loadedKeys, [loadedKey(provider, modelName)]: isLoaded },
    })),
});
```

- [ ] **Step 2: Run, expect PASS**

```bash
cd packages/ui && bunx vitest run test/store/slices/model-plan3.test.ts && cd ../..
```

Expected: all 5 slice tests pass.

### Task 17: Commit Phase 5

- [ ] **Step 1: Commit**

```bash
git add packages/ui/src/store/slices/model.ts \
        packages/ui/test/store/slices/model-plan3.test.ts
git commit -m "feat(ui-store): expand model slice (routerStatus + pullProgress + loadedKeys)"
```

---

## Phase 6 — RouterStatus component + PullDialog

These two reusable components land in `packages/ui/src/components/settings/model/` before the panel wires them in. Splitting them keeps each test file small and each commit reviewable.

### Task 18: Write failing RouterStatus tests

**Files:**
- Create: `packages/ui/test/components/settings/model/RouterStatus.test.tsx`

- [ ] **Step 1: Write the tests**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RouterStatus } from "../../../../src/components/settings/model/RouterStatus";
import type { RouterStatusResult } from "../../../../src/ipc/types";

describe("RouterStatus", () => {
  it("renders one badge per task type present in `decisions`", () => {
    const status: RouterStatusResult = {
      decisions: {
        classification: { providerId: "ollama", modelName: "gemma:2b", reason: "default" },
        reasoning: { providerId: "llamacpp", modelName: "llama3:8b", reason: "preferLocal" },
        summarisation: undefined,
      },
    };
    render(<RouterStatus status={status} />);
    expect(screen.getByText(/classification/i)).toBeInTheDocument();
    expect(screen.getByText(/reasoning/i)).toBeInTheDocument();
    expect(screen.getByText(/gemma:2b/)).toBeInTheDocument();
    expect(screen.getByText(/llama3:8b/)).toBeInTheDocument();
    expect(screen.getByText(/default/)).toBeInTheDocument();
    expect(screen.getByText(/preferLocal/)).toBeInTheDocument();
  });

  it("renders a 'none' pill for a task type with undefined decision", () => {
    const status: RouterStatusResult = {
      decisions: { classification: undefined },
    };
    render(<RouterStatus status={status} />);
    expect(screen.getByText(/no provider available/i)).toBeInTheDocument();
  });

  it("renders an empty state when `decisions` is empty", () => {
    render(<RouterStatus status={{ decisions: {} }} />);
    expect(screen.getByText(/router has not been queried/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd packages/ui && bunx vitest run test/components/settings/model/RouterStatus.test.tsx && cd ../..
```

Expected: `Cannot find module '.../RouterStatus'`.

### Task 19: Implement `RouterStatus`

**Files:**
- Create: `packages/ui/src/components/settings/model/RouterStatus.tsx`

- [ ] **Step 1: Write the component**

```tsx
import type { LlmTaskType, RouterStatusResult } from "../../../ipc/types";

const TASK_ORDER: ReadonlyArray<LlmTaskType> = [
  "classification",
  "reasoning",
  "summarisation",
  "agent_step",
];

interface Props {
  readonly status: RouterStatusResult;
}

export function RouterStatus({ status }: Props) {
  const keys = Object.keys(status.decisions) as LlmTaskType[];
  if (keys.length === 0) {
    return (
      <div className="p-4 text-sm text-[var(--color-text-muted)] rounded-md border border-[var(--color-border)]">
        Router has not been queried yet.
      </div>
    );
  }
  const rows = TASK_ORDER.filter((t) => t in status.decisions);
  return (
    <div
      data-testid="router-status"
      className="grid grid-cols-1 md:grid-cols-2 gap-2 rounded-md border border-[var(--color-border)] p-3"
    >
      {rows.map((t) => {
        const d = status.decisions[t];
        return (
          <div key={t} className="text-sm">
            <div className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{t}</div>
            {d === undefined ? (
              <div className="text-[var(--color-text-muted)]">no provider available</div>
            ) : (
              <div>
                <span className="font-medium">{d.modelName || d.providerId}</span>
                <span className="ml-2 text-xs text-[var(--color-text-muted)]">
                  {d.providerId} · {d.reason}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Run, expect PASS**

```bash
cd packages/ui && bunx vitest run test/components/settings/model/RouterStatus.test.tsx && cd ../..
```

Expected: all 3 tests pass.

### Task 20: Write failing PullDialog tests

**Files:**
- Create: `packages/ui/test/components/settings/model/PullDialog.test.tsx`

- [ ] **Step 1: Write the tests**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/ipc/client");

import {
  llmCancelPullMock,
  llmGetStatusMock,
  llmPullModelMock,
  subscribeMock,
} from "../../../../src/ipc/__mocks__/client";
import { PullDialog } from "../../../../src/components/settings/model/PullDialog";
import { useNimbusStore } from "../../../../src/store";

beforeEach(() => {
  localStorage.clear();
  llmGetStatusMock.mockReset();
  llmPullModelMock.mockReset();
  llmCancelPullMock.mockReset();
  subscribeMock.mockReset();
  subscribeMock.mockResolvedValue(() => {});
  useNimbusStore.setState({
    installedModels: [],
    activePullId: null,
    pullProgress: {},
    pullStalled: false,
    routerStatus: null,
    loadedKeys: {},
    connectionState: "connected",
  } as never);
});

describe("PullDialog", () => {
  it("hides the llama.cpp radio when availability reports it unavailable", async () => {
    llmGetStatusMock.mockResolvedValueOnce({ available: { ollama: true, llamacpp: false } });
    render(<PullDialog open onClose={() => {}} />);
    await waitFor(() => screen.getByLabelText(/ollama/i));
    expect(screen.queryByLabelText(/llama\.cpp/i)).not.toBeInTheDocument();
  });

  it("shows both providers when both are available", async () => {
    llmGetStatusMock.mockResolvedValueOnce({ available: { ollama: true, llamacpp: true } });
    render(<PullDialog open onClose={() => {}} />);
    await waitFor(() => screen.getByLabelText(/ollama/i));
    expect(screen.getByLabelText(/llama\.cpp/i)).toBeInTheDocument();
  });

  it("submitting calls llmPullModel, then pullProgress notifications update the bar", async () => {
    llmGetStatusMock.mockResolvedValueOnce({ available: { ollama: true, llamacpp: true } });
    llmPullModelMock.mockResolvedValueOnce({ pullId: "pull_abc" });
    let captured: ((n: { method: string; params: unknown }) => void) | null = null;
    subscribeMock.mockImplementation(async (handler) => {
      captured = handler;
      return () => {};
    });
    render(<PullDialog open onClose={() => {}} />);
    await waitFor(() => screen.getByLabelText(/model name/i));
    await userEvent.type(screen.getByLabelText(/model name/i), "gemma:2b");
    await userEvent.click(screen.getByRole("button", { name: /pull/i }));
    await waitFor(() =>
      expect(llmPullModelMock).toHaveBeenCalledWith("ollama", "gemma:2b"),
    );
    captured?.({
      method: "llm.pullProgress",
      params: {
        pullId: "pull_abc",
        provider: "ollama",
        modelName: "gemma:2b",
        status: "downloading",
        completedBytes: 500,
        totalBytes: 1000,
      },
    });
    await waitFor(() => {
      const bar = screen.getByRole("progressbar");
      expect(bar).toHaveAttribute("aria-valuenow", "50");
    });
  });

  it("cancel during an active pull calls llmCancelPull with the pullId", async () => {
    llmGetStatusMock.mockResolvedValueOnce({ available: { ollama: true, llamacpp: true } });
    llmPullModelMock.mockResolvedValueOnce({ pullId: "pull_abc" });
    llmCancelPullMock.mockResolvedValueOnce({ cancelled: true });
    render(<PullDialog open onClose={() => {}} />);
    await waitFor(() => screen.getByLabelText(/model name/i));
    await userEvent.type(screen.getByLabelText(/model name/i), "gemma:2b");
    await userEvent.click(screen.getByRole("button", { name: /pull/i }));
    await waitFor(() => screen.getByRole("button", { name: /cancel pull/i }));
    await userEvent.click(screen.getByRole("button", { name: /cancel pull/i }));
    await waitFor(() => expect(llmCancelPullMock).toHaveBeenCalledWith("pull_abc"));
  });

  it("15 s without a pullProgress chunk flips the row to amber 'Connecting…'", async () => {
    vi.useFakeTimers();
    try {
      llmGetStatusMock.mockResolvedValueOnce({ available: { ollama: true } });
      llmPullModelMock.mockResolvedValueOnce({ pullId: "pull_abc" });
      let captured: ((n: { method: string; params: unknown }) => void) | null = null;
      subscribeMock.mockImplementation(async (handler) => {
        captured = handler;
        return () => {};
      });
      render(<PullDialog open onClose={() => {}} />);
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await waitFor(() => screen.getByLabelText(/model name/i));
      await user.type(screen.getByLabelText(/model name/i), "gemma:2b");
      await user.click(screen.getByRole("button", { name: /pull/i }));
      await waitFor(() =>
        expect(llmPullModelMock).toHaveBeenCalledWith("ollama", "gemma:2b"),
      );
      vi.advanceTimersByTime(15_000);
      await waitFor(() => expect(screen.getByText(/connecting…/i)).toBeInTheDocument());
      // Next chunk clears the stall state.
      captured?.({
        method: "llm.pullProgress",
        params: {
          pullId: "pull_abc",
          provider: "ollama",
          modelName: "gemma:2b",
          status: "downloading",
          completedBytes: 100,
          totalBytes: 1000,
        },
      });
      await waitFor(() => expect(screen.queryByText(/connecting…/i)).not.toBeInTheDocument());
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-attach with a persisted activePullId arms the stall timer without waiting for a chunk", async () => {
    vi.useFakeTimers();
    try {
      useNimbusStore.setState({
        activePullId: "pull_abc",
        pullProgress: {
          pull_abc: {
            pullId: "pull_abc",
            provider: "ollama",
            modelName: "gemma:2b",
            status: "downloading",
            completedBytes: 100,
            totalBytes: 1000,
          },
        },
      } as never);
      llmGetStatusMock.mockResolvedValueOnce({ available: { ollama: true } });
      render(<PullDialog open onClose={() => {}} />);
      await waitFor(() => screen.getByLabelText(/model name/i));
      // Before 15 s elapses, no stall.
      expect(screen.queryByText(/connecting…/i)).not.toBeInTheDocument();
      vi.advanceTimersByTime(15_000);
      await waitFor(() => expect(screen.getByText(/connecting…/i)).toBeInTheDocument());
    } finally {
      vi.useRealTimers();
    }
  });

  it("llm.pullFailed clears the pullId and shows an error toast-style message", async () => {
    llmGetStatusMock.mockResolvedValueOnce({ available: { ollama: true } });
    llmPullModelMock.mockResolvedValueOnce({ pullId: "pull_abc" });
    let captured: ((n: { method: string; params: unknown }) => void) | null = null;
    subscribeMock.mockImplementation(async (handler) => {
      captured = handler;
      return () => {};
    });
    render(<PullDialog open onClose={() => {}} />);
    await waitFor(() => screen.getByLabelText(/model name/i));
    await userEvent.type(screen.getByLabelText(/model name/i), "gemma:2b");
    await userEvent.click(screen.getByRole("button", { name: /pull/i }));
    await waitFor(() => expect(llmPullModelMock).toHaveBeenCalled());
    captured?.({
      method: "llm.pullFailed",
      params: {
        pullId: "pull_abc",
        provider: "ollama",
        modelName: "gemma:2b",
        error: "disk full",
      },
    });
    await waitFor(() => {
      expect(screen.getByText(/disk full/i)).toBeInTheDocument();
      expect(useNimbusStore.getState().activePullId).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd packages/ui && bunx vitest run test/components/settings/model/PullDialog.test.tsx && cd ../..
```

Expected: `Cannot find module '.../PullDialog'`.

### Task 21: Implement `PullDialog`

**Files:**
- Create: `packages/ui/src/components/settings/model/PullDialog.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { createIpcClient } from "../../../ipc/client";
import type {
  JsonRpcNotification,
  LlmPullProgressPayload,
  LlmPullTerminalPayload,
} from "../../../ipc/types";
import { useNimbusStore } from "../../../store";

const STALL_MS = 15_000;

interface Props {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function PullDialog({ open, onClose }: Props) {
  const activePullId = useNimbusStore((s) => s.activePullId);
  const pullProgress = useNimbusStore((s) => s.pullProgress);
  const pullStalled = useNimbusStore((s) => s.pullStalled);
  const setActivePullId = useNimbusStore((s) => s.setActivePullId);
  const upsertPullProgress = useNimbusStore((s) => s.upsertPullProgress);
  const clearPullProgress = useNimbusStore((s) => s.clearPullProgress);
  const setPullStalled = useNimbusStore((s) => s.setPullStalled);

  const [provider, setProvider] = useState<"ollama" | "llamacpp">("ollama");
  const [modelName, setModelName] = useState("");
  const [available, setAvailable] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const { available: a } = await createIpcClient().llmGetStatus();
        setAvailable(a);
        // If ollama unavailable but llamacpp is, default to llamacpp; else leave ollama.
        if (a.ollama === false && a.llamacpp === true) setProvider("llamacpp");
      } catch {
        setAvailable({ ollama: true, llamacpp: true });
      }
    })();
  }, [open]);

  const onNotification = useCallback(
    (n: JsonRpcNotification) => {
      if (n.method === "llm.pullProgress") {
        const p = n.params as LlmPullProgressPayload;
        upsertPullProgress(p);
        setPullStalled(false);
        if (stallTimerRef.current !== null) clearTimeout(stallTimerRef.current);
        stallTimerRef.current = setTimeout(() => setPullStalled(true), STALL_MS);
        return;
      }
      if (n.method === "llm.pullCompleted") {
        const p = n.params as LlmPullTerminalPayload;
        clearPullProgress(p.pullId);
        setActivePullId(null);
        setPullStalled(false);
        if (stallTimerRef.current !== null) clearTimeout(stallTimerRef.current);
        return;
      }
      if (n.method === "llm.pullFailed") {
        const p = n.params as LlmPullTerminalPayload;
        clearPullProgress(p.pullId);
        setActivePullId(null);
        setPullStalled(false);
        if (stallTimerRef.current !== null) clearTimeout(stallTimerRef.current);
        setError(p.error ?? "Pull failed");
      }
    },
    [clearPullProgress, setActivePullId, setPullStalled, upsertPullProgress],
  );

  useEffect(() => {
    if (!open) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void createIpcClient()
      .subscribe(onNotification)
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    // Re-attach to an in-flight pull that was already stalled before the UI reloaded:
    // if `activePullId` is persisted but no notifications are flowing, we'd never arm
    // the stall timer via the chunk path. Arm it here so the "Connecting…" state shows.
    if (activePullId !== null) {
      if (stallTimerRef.current !== null) clearTimeout(stallTimerRef.current);
      stallTimerRef.current = setTimeout(() => setPullStalled(true), STALL_MS);
    }
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
      if (stallTimerRef.current !== null) clearTimeout(stallTimerRef.current);
    };
  }, [open, onNotification, activePullId, setPullStalled]);

  const onSubmit = useCallback(async () => {
    if (modelName.trim() === "") return;
    setSubmitting(true);
    setError(null);
    try {
      const { pullId } = await createIpcClient().llmPullModel(provider, modelName.trim());
      setActivePullId(pullId);
      if (stallTimerRef.current !== null) clearTimeout(stallTimerRef.current);
      stallTimerRef.current = setTimeout(() => setPullStalled(true), STALL_MS);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [modelName, provider, setActivePullId, setPullStalled]);

  const onCancel = useCallback(async () => {
    if (activePullId === null) return;
    await createIpcClient().llmCancelPull(activePullId);
  }, [activePullId]);

  if (!open) return null;

  const activeRow = activePullId !== null ? pullProgress[activePullId] : undefined;
  const percent =
    activeRow?.completedBytes !== undefined &&
    activeRow.totalBytes !== undefined &&
    activeRow.totalBytes > 0
      ? Math.min(100, Math.round((activeRow.completedBytes / activeRow.totalBytes) * 100))
      : 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Pull model"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <div className="bg-[var(--color-bg)] rounded-md p-6 w-[480px] border border-[var(--color-border)]">
        <h3 className="text-lg font-semibold mb-4">Pull a model</h3>

        <fieldset className="mb-4">
          <legend className="text-sm mb-2">Provider</legend>
          {available.ollama !== false && (
            <label className="mr-4 text-sm">
              <input
                type="radio"
                name="provider"
                value="ollama"
                checked={provider === "ollama"}
                onChange={() => setProvider("ollama")}
                aria-label="Ollama"
              />{" "}
              Ollama
            </label>
          )}
          {available.llamacpp === true && (
            <label className="text-sm">
              <input
                type="radio"
                name="provider"
                value="llamacpp"
                checked={provider === "llamacpp"}
                onChange={() => setProvider("llamacpp")}
                aria-label="llama.cpp"
              />{" "}
              llama.cpp
            </label>
          )}
        </fieldset>

        <label className="block mb-4 text-sm">
          <span className="block mb-1">Model name</span>
          <input
            type="text"
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            placeholder="gemma:2b"
            aria-label="Model name"
            className="w-full px-3 py-2 rounded border border-[var(--color-border)] bg-[var(--color-bg-subtle)]"
          />
        </label>

        {activeRow !== undefined && (
          <div className="mb-4">
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              className="w-full h-2 rounded-full bg-[var(--color-border)] overflow-hidden"
            >
              <div
                className="h-full bg-[var(--color-accent)]"
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className="mt-1 text-xs text-[var(--color-text-muted)]">
              {pullStalled ? (
                <span className="text-amber-500">Connecting…</span>
              ) : (
                <span>
                  {activeRow.status} · {percent}%
                </span>
              )}
            </div>
          </div>
        )}

        {error !== null && <p className="text-sm text-[var(--color-danger-text)] mb-3">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded border border-[var(--color-border)]"
          >
            Close
          </button>
          {activePullId !== null ? (
            <button
              type="button"
              onClick={() => void onCancel()}
              aria-label="Cancel pull"
              className="px-3 py-1 rounded border border-[var(--color-danger-border)] text-[var(--color-danger-text)]"
            >
              Cancel pull
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void onSubmit()}
              disabled={submitting || modelName.trim() === ""}
              aria-label="Pull"
              className="px-3 py-1 rounded bg-[var(--color-accent)] text-white disabled:opacity-50"
            >
              Pull
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run, expect PASS**

```bash
cd packages/ui && bunx vitest run test/components/settings/model/PullDialog.test.tsx && cd ../..
```

Expected: all 6 tests pass.

### Task 22: Commit Phase 6

- [ ] **Step 1: Commit**

```bash
git add packages/ui/src/components/settings/model/RouterStatus.tsx \
        packages/ui/src/components/settings/model/PullDialog.tsx \
        packages/ui/test/components/settings/model/RouterStatus.test.tsx \
        packages/ui/test/components/settings/model/PullDialog.test.tsx
git commit -m "feat(ui): RouterStatus + PullDialog (15s stall, cancel, availability-filtered providers)"
```

---

## Phase 7 — ModelPanel + route wiring

The panel itself is small: it fetches `llm.listModels` + `llm.getRouterStatus` on mount, renders a row per model with Load/Unload + Set-default buttons, hosts a button that toggles `PullDialog`, and subscribes to `llm.modelLoaded`/`llm.modelUnloaded` for the `loadedKeys` map. On mount, if `activePullId !== null` in the persisted slice, the subscription already rehydrates progress from the next notification chunk — no extra "re-attach" RPC needed.

### Task 23: Write failing panel tests

**Files:**
- Create: `packages/ui/test/pages/settings/ModelPanel.test.tsx`

- [ ] **Step 1: Write the tests**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/ipc/client");

import {
  llmGetRouterStatusMock,
  llmGetStatusMock,
  llmListModelsMock,
  llmLoadModelMock,
  llmSetDefaultMock,
  llmUnloadModelMock,
  subscribeMock,
} from "../../../src/ipc/__mocks__/client";
import { ModelPanel } from "../../../src/pages/settings/ModelPanel";
import { useNimbusStore } from "../../../src/store";

function renderPanel() {
  return render(
    <MemoryRouter>
      <ModelPanel />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  llmListModelsMock.mockReset();
  llmGetRouterStatusMock.mockReset();
  llmGetStatusMock.mockReset();
  llmLoadModelMock.mockReset();
  llmUnloadModelMock.mockReset();
  llmSetDefaultMock.mockReset();
  subscribeMock.mockReset();
  subscribeMock.mockResolvedValue(() => {});
  useNimbusStore.setState({
    installedModels: [],
    activePullId: null,
    pullProgress: {},
    pullStalled: false,
    routerStatus: null,
    loadedKeys: {},
    connectionState: "connected",
  } as never);
});

describe("ModelPanel", () => {
  it("fetches listModels and getRouterStatus on mount and renders both", async () => {
    llmListModelsMock.mockResolvedValueOnce({
      models: [
        { provider: "ollama", modelName: "gemma:2b" },
        { provider: "llamacpp", modelName: "llama3:8b-q4" },
      ],
    });
    llmGetRouterStatusMock.mockResolvedValueOnce({
      decisions: {
        classification: { providerId: "ollama", modelName: "gemma:2b", reason: "default" },
      },
    });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("gemma:2b")).toBeInTheDocument();
      expect(screen.getByText("llama3:8b-q4")).toBeInTheDocument();
      expect(screen.getByTestId("router-status")).toBeInTheDocument();
    });
  });

  it("Load button calls llmLoadModel with the row's provider + modelName", async () => {
    llmListModelsMock.mockResolvedValueOnce({
      models: [{ provider: "ollama", modelName: "gemma:2b" }],
    });
    llmGetRouterStatusMock.mockResolvedValueOnce({ decisions: {} });
    llmLoadModelMock.mockResolvedValueOnce({ isLoaded: true });
    renderPanel();
    await waitFor(() => screen.getByRole("button", { name: /load gemma:2b/i }));
    await userEvent.click(screen.getByRole("button", { name: /load gemma:2b/i }));
    await waitFor(() =>
      expect(llmLoadModelMock).toHaveBeenCalledWith("ollama", "gemma:2b"),
    );
  });

  it("Unload button calls llmUnloadModel when the row is loaded", async () => {
    useNimbusStore.setState({ loadedKeys: { "ollama:gemma:2b": true } } as never);
    llmListModelsMock.mockResolvedValueOnce({
      models: [{ provider: "ollama", modelName: "gemma:2b" }],
    });
    llmGetRouterStatusMock.mockResolvedValueOnce({ decisions: {} });
    llmUnloadModelMock.mockResolvedValueOnce({ isLoaded: false });
    renderPanel();
    await waitFor(() => screen.getByRole("button", { name: /unload gemma:2b/i }));
    await userEvent.click(screen.getByRole("button", { name: /unload gemma:2b/i }));
    await waitFor(() =>
      expect(llmUnloadModelMock).toHaveBeenCalledWith("ollama", "gemma:2b"),
    );
  });

  it("Set-default picker calls llmSetDefault with taskType, provider, modelName", async () => {
    llmListModelsMock.mockResolvedValueOnce({
      models: [{ provider: "ollama", modelName: "gemma:2b" }],
    });
    llmGetRouterStatusMock.mockResolvedValueOnce({ decisions: {} });
    llmSetDefaultMock.mockResolvedValueOnce({
      taskType: "reasoning",
      provider: "ollama",
      modelName: "gemma:2b",
    });
    // After setDefault we refetch getRouterStatus.
    llmGetRouterStatusMock.mockResolvedValueOnce({
      decisions: {
        reasoning: { providerId: "ollama", modelName: "gemma:2b", reason: "default" },
      },
    });
    renderPanel();
    await waitFor(() => screen.getByLabelText("gemma:2b default-for"));
    await userEvent.selectOptions(
      screen.getByLabelText("gemma:2b default-for"),
      "reasoning",
    );
    await waitFor(() =>
      expect(llmSetDefaultMock).toHaveBeenCalledWith("reasoning", "ollama", "gemma:2b"),
    );
  });

  it("opens PullDialog when 'Pull new model…' is clicked", async () => {
    llmListModelsMock.mockResolvedValueOnce({ models: [] });
    llmGetRouterStatusMock.mockResolvedValueOnce({ decisions: {} });
    llmGetStatusMock.mockResolvedValueOnce({ available: { ollama: true, llamacpp: true } });
    renderPanel();
    await waitFor(() => screen.getByRole("button", { name: /pull new model/i }));
    await userEvent.click(screen.getByRole("button", { name: /pull new model/i }));
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: /pull model/i })).toBeInTheDocument(),
    );
  });

  it("llm.modelLoaded notification patches the row's loaded indicator", async () => {
    llmListModelsMock.mockResolvedValueOnce({
      models: [{ provider: "ollama", modelName: "gemma:2b" }],
    });
    llmGetRouterStatusMock.mockResolvedValueOnce({ decisions: {} });
    let captured: ((n: { method: string; params: unknown }) => void) | null = null;
    subscribeMock.mockImplementation(async (handler) => {
      captured = handler;
      return () => {};
    });
    renderPanel();
    await waitFor(() => screen.getByRole("button", { name: /load gemma:2b/i }));
    captured?.({
      method: "llm.modelLoaded",
      params: { provider: "ollama", modelName: "gemma:2b" },
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /unload gemma:2b/i })).toBeInTheDocument(),
    );
  });

  it("surfaces pull progress from a persisted activePullId (re-attach on reload)", async () => {
    useNimbusStore.setState({
      activePullId: "pull_abc",
      pullProgress: {
        pull_abc: {
          pullId: "pull_abc",
          provider: "ollama",
          modelName: "gemma:2b",
          status: "downloading",
          completedBytes: 250,
          totalBytes: 1000,
        },
      },
    } as never);
    llmListModelsMock.mockResolvedValueOnce({ models: [] });
    llmGetRouterStatusMock.mockResolvedValueOnce({ decisions: {} });
    renderPanel();
    await waitFor(() =>
      expect(screen.getByTestId("active-pull-banner")).toHaveTextContent(/gemma:2b/),
    );
    expect(screen.getByTestId("active-pull-banner")).toHaveTextContent(/25%/);
  });

  it("disables write controls when connectionState=disconnected", async () => {
    useNimbusStore.setState({ connectionState: "disconnected" } as never);
    llmListModelsMock.mockRejectedValueOnce(new Error("offline"));
    llmGetRouterStatusMock.mockRejectedValueOnce(new Error("offline"));
    useNimbusStore.setState({
      installedModels: [{ id: "ollama:gemma:2b", provider: "ollama" }],
    } as never);
    renderPanel();
    await waitFor(() => screen.getByRole("button", { name: /pull new model/i }));
    expect(screen.getByRole("button", { name: /pull new model/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd packages/ui && bunx vitest run test/pages/settings/ModelPanel.test.tsx && cd ../..
```

Expected: `Cannot find module '.../ModelPanel'`.

### Task 24: Implement `ModelPanel`

**Files:**
- Create: `packages/ui/src/pages/settings/ModelPanel.tsx`

- [ ] **Step 1: Write the panel**

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { PullDialog } from "../../components/settings/model/PullDialog";
import { RouterStatus } from "../../components/settings/model/RouterStatus";
import { PanelError } from "../../components/settings/PanelError";
import { PanelHeader } from "../../components/settings/PanelHeader";
import { StaleChip } from "../../components/settings/StaleChip";
import { createIpcClient } from "../../ipc/client";
import type {
  JsonRpcNotification,
  LlmModelInfo,
  LlmModelLoadPayload,
  LlmPullProgressPayload,
  LlmPullTerminalPayload,
  LlmTaskType,
} from "../../ipc/types";
import { useNimbusStore } from "../../store";

const TASK_OPTIONS: ReadonlyArray<{ value: "" | LlmTaskType; label: string }> = [
  { value: "", label: "Set default for…" },
  { value: "classification", label: "classification" },
  { value: "reasoning", label: "reasoning" },
  { value: "summarisation", label: "summarisation" },
  { value: "agent_step", label: "agent_step" },
];

function loadedKeyFor(m: LlmModelInfo): string {
  return `${m.provider}:${m.modelName}`;
}

export function ModelPanel() {
  const [models, setModels] = useState<ReadonlyArray<LlmModelInfo>>([]);
  const routerStatus = useNimbusStore((s) => s.routerStatus);
  const loadedKeys = useNimbusStore((s) => s.loadedKeys);
  const activePullId = useNimbusStore((s) => s.activePullId);
  const pullProgress = useNimbusStore((s) => s.pullProgress);
  const setRouterStatus = useNimbusStore((s) => s.setRouterStatus);
  const patchLoaded = useNimbusStore((s) => s.patchLoaded);
  const upsertPullProgress = useNimbusStore((s) => s.upsertPullProgress);
  const clearPullProgress = useNimbusStore((s) => s.clearPullProgress);
  const setActivePullId = useNimbusStore((s) => s.setActivePullId);
  const connectionState = useNimbusStore((s) => s.connectionState);

  const [fetchError, setFetchError] = useState<string | null>(null);
  const [pullOpen, setPullOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const offline = connectionState === "disconnected";
  const writeDisabled = offline;

  const refresh = useCallback(async () => {
    try {
      const [{ models: ms }, rs] = await Promise.all([
        createIpcClient().llmListModels(),
        createIpcClient().llmGetRouterStatus(),
      ]);
      setModels(ms);
      setRouterStatus(rs);
      setFetchError(null);
    } catch (e) {
      setFetchError((e as Error).message);
    }
  }, [setRouterStatus]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onNotification = useCallback(
    (n: JsonRpcNotification) => {
      if (n.method === "llm.modelLoaded") {
        const p = n.params as LlmModelLoadPayload;
        patchLoaded(p.provider, p.modelName, true);
        return;
      }
      if (n.method === "llm.modelUnloaded") {
        const p = n.params as LlmModelLoadPayload;
        patchLoaded(p.provider, p.modelName, false);
        return;
      }
      if (n.method === "llm.pullProgress") {
        upsertPullProgress(n.params as LlmPullProgressPayload);
        return;
      }
      if (n.method === "llm.pullCompleted" || n.method === "llm.pullFailed") {
        const p = n.params as LlmPullTerminalPayload;
        clearPullProgress(p.pullId);
        setActivePullId(null);
        if (n.method === "llm.pullCompleted") void refresh();
      }
    },
    [clearPullProgress, patchLoaded, refresh, setActivePullId, upsertPullProgress],
  );
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void createIpcClient()
      .subscribe(onNotification)
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [onNotification]);

  const onLoad = useCallback(
    async (m: LlmModelInfo) => {
      if (m.provider === "remote") return;
      const key = loadedKeyFor(m);
      setBusyKey(key);
      try {
        await createIpcClient().llmLoadModel(m.provider, m.modelName);
      } finally {
        setBusyKey(null);
      }
    },
    [],
  );

  const onUnload = useCallback(
    async (m: LlmModelInfo) => {
      if (m.provider === "remote") return;
      const key = loadedKeyFor(m);
      setBusyKey(key);
      try {
        await createIpcClient().llmUnloadModel(m.provider, m.modelName);
      } finally {
        setBusyKey(null);
      }
    },
    [],
  );

  const onSetDefault = useCallback(
    async (m: LlmModelInfo, taskType: LlmTaskType) => {
      await createIpcClient().llmSetDefault(taskType, m.provider, m.modelName);
      await refresh();
    },
    [refresh],
  );

  const activeRow = activePullId !== null ? pullProgress[activePullId] : undefined;
  const activePercent = useMemo(() => {
    if (
      activeRow?.completedBytes === undefined ||
      activeRow.totalBytes === undefined ||
      activeRow.totalBytes === 0
    )
      return 0;
    return Math.min(100, Math.round((activeRow.completedBytes / activeRow.totalBytes) * 100));
  }, [activeRow]);

  return (
    <section className="p-6 space-y-6">
      <PanelHeader
        title="Model"
        description="Installed local models, task-type defaults, and router decisions."
        livePill={offline ? <StaleChip /> : undefined}
      />
      {fetchError !== null && (
        <PanelError
          message={`Failed to load model status: ${fetchError}`}
          onRetry={() => void refresh()}
        />
      )}

      {routerStatus !== null && <RouterStatus status={routerStatus} />}

      {activeRow !== undefined && (
        <div
          data-testid="active-pull-banner"
          className="rounded-md border border-[var(--color-border)] p-3 text-sm"
        >
          Pulling <span className="font-medium">{activeRow.modelName}</span> via{" "}
          {activeRow.provider} — {activePercent}%
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setPullOpen(true)}
          disabled={writeDisabled}
          className="px-3 py-1 rounded border border-[var(--color-border)] disabled:opacity-50"
        >
          Pull new model…
        </button>
      </div>

      <ul className="divide-y divide-[var(--color-border)] border border-[var(--color-border)] rounded-md">
        {models.map((m) => {
          const key = loadedKeyFor(m);
          const loaded = loadedKeys[key] === true;
          const busy = busyKey === key;
          return (
            <li key={key} className="flex items-center gap-3 px-4 py-3">
              <span className="font-medium w-64 truncate">{m.modelName}</span>
              <span className="text-xs text-[var(--color-text-muted)] w-20">{m.provider}</span>
              {loaded ? (
                <button
                  type="button"
                  disabled={writeDisabled || busy || m.provider === "remote"}
                  onClick={() => void onUnload(m)}
                  aria-label={`Unload ${m.modelName}`}
                  className="px-2 py-1 text-sm rounded border border-[var(--color-border)] disabled:opacity-50"
                >
                  Unload
                </button>
              ) : (
                <button
                  type="button"
                  disabled={writeDisabled || busy || m.provider === "remote"}
                  onClick={() => void onLoad(m)}
                  aria-label={`Load ${m.modelName}`}
                  className="px-2 py-1 text-sm rounded border border-[var(--color-border)] disabled:opacity-50"
                >
                  Load
                </button>
              )}
              <select
                defaultValue=""
                disabled={writeDisabled}
                onChange={(e) => {
                  const t = e.target.value;
                  if (t === "") return;
                  void onSetDefault(m, t as LlmTaskType);
                  e.target.value = "";
                }}
                aria-label={`${m.modelName} default-for`}
                className="px-2 py-1 text-sm rounded border border-[var(--color-border)] bg-[var(--color-bg-subtle)] disabled:opacity-50"
              >
                {TASK_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </li>
          );
        })}
      </ul>

      <PullDialog open={pullOpen} onClose={() => setPullOpen(false)} />
    </section>
  );
}
```

- [ ] **Step 2: Wire the route**

In `packages/ui/src/App.tsx`, import the new panel:

```tsx
import { ModelPanel } from "./pages/settings/ModelPanel";
```

And replace:

```tsx
<Route path="model" element={<PanelComingSoon title="Model" />} />
```

with:

```tsx
<Route path="model" element={<ModelPanel />} />
```

- [ ] **Step 3: Run the panel tests, expect PASS**

```bash
cd packages/ui && bunx vitest run test/pages/settings/ModelPanel.test.tsx && cd ../..
```

Expected: all 8 tests pass.

- [ ] **Step 4: Run the full UI suite, expect no regressions**

```bash
cd packages/ui && bunx vitest run && cd ../..
```

Expected: every Plan 1 + Plan 2 + Plan 3 test passes.

### Task 25: Commit Phase 7

- [ ] **Step 1: Commit**

```bash
git add packages/ui/src/pages/settings/ModelPanel.tsx \
        packages/ui/src/App.tsx \
        packages/ui/test/pages/settings/ModelPanel.test.tsx
git commit -m "feat(ui): Model panel with router status, load/unload, setDefault, PullDialog"
```

---

## Phase 8 — Full verification

### Task 26: typecheck + lint + unit + Rust tests + coverage

- [ ] **Step 1: Repo-wide checks**

```bash
bun run typecheck
bun run lint
bun test
cd packages/ui && bunx vitest run && cd ../..
cd packages/ui/src-tauri && cargo test && cd ../../..
```

Expected: every command exits 0. Pay particular attention to:

- Vitest — all new tests pass (`client-ws5c-plan3`, `connectors-plan3` slice, `model-plan3` slice, `interval-parts`, `ConnectorsPanel`, `RouterStatus`, `PullDialog`, `ModelPanel`).
- Rust `cargo test` — `ALLOWED_METHODS.len() == 39`; `allowlist_ws5c_llm_availability_read` passes; `allowlist_is_alphabetized` still passes (insertion order is correct); `GLOBAL_BROADCAST_METHODS.len() == 1` and `NO_TIMEOUT_METHODS.len() == 4` both unchanged.
- Biome — no formatting drift.

- [ ] **Step 2: Coverage spot-check**

```bash
cd packages/ui && bunx vitest run --coverage && cd ../..
```

Must remain ≥ 80 % lines / ≥ 75 % branches (the existing `packages/ui` gate from WS5-B). If any new file falls short, add a targeted test; do not lower the gate.

### Task 27: Commit chain verification + push

- [ ] **Step 1: Expected commits on top of Plan 2**

```bash
git log --oneline e3a3699..HEAD
```

(where `e3a3699` is the tip of Plan 2 — the docs commit). Expected (order of the newest 5 matters; exact SHAs vary):

```
xxxxxxx feat(ui): Model panel with router status, load/unload, setDefault, PullDialog
xxxxxxx feat(ui): RouterStatus + PullDialog (15s stall, cancel, availability-filtered providers)
xxxxxxx feat(ui-store): expand model slice (routerStatus + pullProgress + loadedKeys)
xxxxxxx feat(ui): Connectors panel with interval editor, depth, enable, configChanged reconcile, highlight
xxxxxxx feat(ui-store): expand connectors slice (in-flight + highlight + row patch)
xxxxxxx feat(ui-ipc): connector.setConfig + llm.* wrappers for Connectors/Model panels
xxxxxxx feat(ui-bridge): allowlist llm.getStatus (→ 39) for PullDialog provider filter
```

Seven commits total (matches the seven `git commit` steps in this plan).

- [ ] **Step 2: Push**

```bash
git push
```

Do NOT open the PR yet. Plans 4–5 will add Audit / Updates / Data panels to the same branch. The single WS5-C UI PR opens after Plan 5 lands.

---

## Completion criteria

Plan 3 is complete when every checkbox above is ticked **and**:

- [ ] `bun run typecheck` passes at the repo root.
- [ ] `bun run lint` passes at the repo root.
- [ ] `bun test` passes at the repo root.
- [ ] `bunx vitest run` passes in `packages/ui/` with coverage ≥ 80 % lines / ≥ 75 % branches.
- [ ] `cargo test` passes in `packages/ui/src-tauri/`, including the new `allowlist_ws5c_llm_availability_read` assertion and the updated `allowlist_exact_size == 39`.
- [ ] Seven commits from this plan appear on `dev/asafgolombek/ws5c-ui` on top of the Plan 2 commits.
- [ ] The branch is pushed to origin.

After completion, proceed to **Plan 4** (not yet written). Suggested scope: Audit panel + Updates panel (spec §7 commits 8 and 9). Plan 4 adds `react-window` usage (already installed by Plan 1) + the updater state machine + the reconnect overlay that consumes the `updater.restarting` notification.

---

## Notes carried forward

### For the eventual WS5-C UI PR description

When Plan 5 opens the single WS5-C UI PR, three points from this plan belong in the PR body:

1. **`ALLOWED_METHODS` grew 38 → 39 for `llm.getStatus`.** The size assertion in `gateway_bridge.rs` now locks at 39; any future bump must bump both the constant list and the assertion in the same commit. No other methods were added — `vault.*` and raw `db.*` writes still fail at the bridge.
2. **Cross-window `connector.configChanged` reconcile is window-scoped, not global.** Unlike `profile.switched` (global by spec §5.2), `connector.configChanged` stays on the existing `gateway://notification` channel. Every window's ConnectorsPanel subscribes independently; noise stays localized. If a future requirement calls for global fan-out, it must join `GLOBAL_BROADCAST_METHODS` with a new test case (currently asserted at exactly 1 entry).
3. **PullDialog detects a 15 s stall on `activePullId` via `setTimeout`, not wall-clock timestamps.** The timer resets on every `llm.pullProgress` chunk and clears on `llm.pullCompleted`/`llm.pullFailed`/cancel/unmount. If a reviewer proposes wall-clock polling, point them at the test `15 s without a pullProgress chunk flips the row to amber 'Connecting…'` — it relies on `vi.useFakeTimers()` advancing by exactly 15 s, which a wall-clock check would miss.

### Known deferrals from this plan

- **`Pull new model…` dialog does not surface a "popular models" catalog.** Users type the model name. The spec's full PullDialog (§2.1) mentions a searchable list; that lives in the Marketplace and is out of scope for v0.1.0 — WS5-D territory.
- **No per-row model "last used" or size metadata is rendered.** `LlmModelInfo` carries `parameterCount`, `contextWindow`, `quantization`, `vramEstimateMb`, but surfacing them cleanly requires a disclosure pattern that pulls in `Radix Accordion` or similar — not shipped in Plan 3 to keep the panel test surface bounded.
- **No in-flight confirmation for `profile.switch` when a pull is active.** Switching profile during a pull aborts the pull on the Gateway side (Vault key prefix changes), but the UI does not pre-warn. Tracked as a WS5-C-final polish item — same family as the in-flight export/import warning noted at the end of Plan 2.
- **Per-connector last-sync timestamp is not rendered in the Connectors panel.** `ConnectorStatus.lastSyncAt` is on the wire but surfacing it is cosmetic for v0.1.0 — the Dashboard already shows it per tile.
- **Shared `ConnectorHealthDot` component not extracted.** Both `ConnectorTile` (WS5-B, Dashboard) and the new `ConnectorRow` (this plan) reimplement the health-colour mapping locally. Extracting a shared component is correct engineering but touches Dashboard code outside WS5-C's scope. Tracked as a post-v0.1.0 cleanup — the fix is mechanical and the two mappings are small enough that drift between them surfaces immediately in manual smoke.
- **`ModelPanel` does not poll.** Unlike `ConnectorsPanel`, which polls `connector.listStatus` at 30 s for health transitions, `ModelPanel` stays notification-driven: `llm.modelLoaded` / `llm.modelUnloaded` / `llm.pullCompleted` cover the realistic state changes. Router-status drift without a notification is rare (would need an external `nimbus config set` mid-session) and refetched on the next `llm.pullCompleted` anyway. Revisit if users report stale router decisions.
- **Button "flicker" risk on load/unload is theoretical and accepted.** The RPC result and the `llm.modelLoaded`/`llm.modelUnloaded` notification race: the Gateway emits the notification *before* returning (`llm-rpc.ts:73–80`), so under normal socket ordering `loadedKeys` patches first and `busyKey` clears second — no flicker. In a pathological reorder the user sees a sub-frame "Load (enabled)" between "Load (disabled)" and "Unload (enabled)". Gating `busyKey` clearance on notification arrival would complicate the panel for a visual glitch no user will report. Left as-is.

