# WS5-C UI — Plan 2: Shell + Rust bridge + Profiles + Telemetry

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the Settings shell (route + sidebar + persisted-slice infrastructure + Rust allowlist growth + cross-window `profile.switched` rebroadcast) and the first two real panels — Profiles and Telemetry — against the Gateway surface shipped in the WS5-C IPC-plumbing plan.

**Architecture:** Additive only. A new `/settings` route renders a three-column layout (`MainSidebar | SettingsSidebar | <Outlet />`). Five new store slices (`settings`, `profile`, `telemetry`, plus stub `connectors` / `model` slices that only exist to carry persisted fields) are composed into `useNimbusStore`, with Zustand `persist` middleware wrapping exactly three slice surfaces (`connectors` / `model` / `profile`) behind a `partialize` whitelist that excludes five forbidden secret field names. The Rust `gateway_bridge.rs` ALLOWED_METHODS grows from 10 → 38, with a new `NO_TIMEOUT_METHODS` allowlist covering four long-running calls and a new `GLOBAL_BROADCAST_METHODS` list so that `profile.switched` is rebroadcast as a **global** Tauri event; every window's listener calls `Tauri app.restart()` because the profile switch invalidates Vault key prefixes, MCP singletons, and IPC subscription channels. The Profiles panel (list + create + switch + delete) and Telemetry panel (toggle + counter cards + payload-sample expander) are full implementations; the remaining five panels render a shared `PanelComingSoon` placeholder so the sidebar route surface already matches the spec today.

**Tech Stack:** Tauri 2 · React 18 · TypeScript 6 strict · Zustand v5 with `zustand/middleware` `persist` · React Router v6 · Tailwind CSS v4 · Vitest + `@testing-library/react` for UI tests (located under `packages/ui/test/`, **not** alongside source) · `cargo test` for Rust.

**Parent spec:** [`docs/superpowers/specs/2026-04-19-ws5c-settings-design.md`](../specs/2026-04-19-ws5c-settings-design.md) — §2.1 (shell + persistence), §2.2 (Rust bridge), §2.3 (IPC contract), §3.1–3.3 (allowlist), §5.2 (profile.switch cross-window restart), §5.4 (error-message redaction), §7 commits 3–5.

**Depends on:** Plan 1 (Gateway prerequisites + UI dependencies) merged to `dev/asafgolombek/ws5c-ui`.

**Branching strategy:** Continue on the existing feature branch `dev/asafgolombek/ws5c-ui`. Commits from this plan append to the eight already pushed by Plan 1. No PR is opened yet (Plans 3–5 add more commits; one PR ships after Plan 5).

**Test convention (important):** UI tests live under `packages/ui/test/` mirroring the `src/` layout. For example, a test for `packages/ui/src/pages/settings/ProfilesPanel.tsx` lives at `packages/ui/test/pages/settings/ProfilesPanel.test.tsx`. The IPC mock file at `packages/ui/src/ipc/__mocks__/client.ts` is auto-discovered by `vi.mock("../../src/ipc/client")` and exports **module-scope `vi.fn()` mocks** (e.g. `callMock`) that are stable across `createIpcClient()` calls — see `packages/ui/test/pages/OnboardingConnect.test.tsx` for the canonical pattern.

---

## Pre-flight (do once before Task 1)

- [ ] **Step A — Confirm branch + baseline green**

```bash
git checkout dev/asafgolombek/ws5c-ui
git status                       # expect clean
git log --oneline -8              # expect the 8 Plan 1 commits on top of phase_4_ws5
bun install
bun run typecheck
bun test --bail
cd packages/ui && bunx vitest run && cd ../..
cd packages/ui/src-tauri && cargo check && cd ../../..
```

Expected: every command exits 0. If anything is red on the Plan 1 tip, stop and fix before continuing.

- [ ] **Step B — Skim the patterns this plan mirrors**

Open each of these once; every task below assumes you have them in your head:

- `packages/ui/src/store/slices/connection.ts` — canonical `StateCreator<T, [], [], T>` slice shape.
- `packages/ui/src/store/index.ts` — slice composition via Zustand `create`; Phase 5 wraps it in `persist`.
- `packages/ui/src/components/chrome/Sidebar.tsx` + `packages/ui/src/components/chrome/NavItem.tsx` — main sidebar pattern; `SettingsSidebar` mirrors it.
- `packages/ui/src/layouts/RootLayout.tsx` — main sidebar placed next to `<Outlet />`; `Settings` layout does the same inside the outlet.
- `packages/ui/src/ipc/client.ts` — `NimbusIpcClient` + singleton + `parseError`; Phase 1 extends all three.
- `packages/ui/src/ipc/__mocks__/client.ts` — the `vi.mock`-auto-resolved mock module used by every panel test; Phase 1 extends it with module-scope mocks for each new method.
- `packages/ui/src-tauri/src/gateway_bridge.rs` — `ALLOWED_METHODS`, `rpc_call`, `classify_notification`; Phase 2 + 3 grow all three.
- `packages/ui/test/pages/OnboardingConnect.test.tsx` — canonical `vi.mock("../../src/ipc/client") + import { callMock } from "../../src/ipc/__mocks__/client"` test pattern.
- `packages/ui/test/ipc/client.test.ts` — canonical `vi.hoisted` + `vi.mock("@tauri-apps/api/core")` pattern for testing the real client directly.
- `packages/gateway/src/ipc/profile-rpc.ts:42` — Gateway emits `profile.switched`; the bridge rebroadcasts it globally.
- `packages/gateway/src/ipc/diagnostics-rpc.ts:423–456` — `telemetry.getStatus` / `telemetry.setEnabled` shapes.

---

## Phase 1 — Shared IPC contract: types + client wrappers + parseError redaction

WS5-C adds 12 read + 16 write methods to the UI's IPC surface. This phase lands every Profile and Telemetry type + wrapper the next phases will consume, plus `parseError` hardening that applies to the whole PR. Types for panels not in this plan (Model / Connector / Audit / Data / Updater) are deferred so later plans just append.

### Task 1: Extend `packages/ui/src/ipc/types.ts`

**Files:**
- Modify: `packages/ui/src/ipc/types.ts`

- [ ] **Step 1: Append the new types**

At the bottom of `packages/ui/src/ipc/types.ts` (after the existing `HitlRequest` interface at line 85), append:

```ts
// ---- WS5-C Plan 2 additions (Profiles + Telemetry) ----

/** `profile.list` response row. */
export interface ProfileSummary {
  /** Profile name as stored on disk. */
  readonly name: string;
  /** ISO timestamp of last switch; optional because the active profile may never have been switched. */
  readonly lastSwitchedAt?: string;
}

export interface ProfileListResult {
  readonly profiles: ReadonlyArray<ProfileSummary>;
  /** Active profile name; `null` when no active profile exists on a fresh install. */
  readonly active: string | null;
}

/** `telemetry.getStatus` returns either `{ enabled: false }` or `{ enabled: true, ...TelemetryPreviewPayload }`. */
export interface TelemetryStatusDisabled {
  readonly enabled: false;
}

export interface TelemetryPreviewPayload {
  readonly session_id: string;
  readonly nimbus_version: string;
  readonly platform: "win32" | "darwin" | "linux";
  readonly connector_error_rate: Readonly<Record<string, number>>;
  readonly connector_health_transitions: Readonly<Record<string, number>>;
  readonly query_latency_p50_ms: number;
  readonly query_latency_p95_ms: number;
  readonly query_latency_p99_ms: number;
  readonly agent_invocation_latency_p50_ms: number;
  readonly agent_invocation_latency_p95_ms: number;
  readonly sync_duration_p50_ms: Readonly<Record<string, number>>;
  readonly cold_start_ms: number;
  readonly extension_installs_by_id: Readonly<Record<string, number>>;
  readonly extension_uninstalls_by_id: Readonly<Record<string, number>>;
}

export interface TelemetryStatusEnabled extends TelemetryPreviewPayload {
  readonly enabled: true;
}

export type TelemetryStatus = TelemetryStatusDisabled | TelemetryStatusEnabled;
```

### Task 2: Write failing tests for the new client wrappers

**Files:**
- Create: `packages/ui/test/ipc/client-ws5c.test.ts`

A separate file (distinct from the existing `packages/ui/test/ipc/client.test.ts`) keeps the WS5-C additions traceable commit-by-commit.

- [ ] **Step 1: Write the failing test**

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

describe("NimbusIpcClient — Profile wrappers", () => {
  it("profileList calls rpc_call with method=profile.list, params={}", async () => {
    invokeMock.mockResolvedValueOnce({ profiles: [{ name: "default" }], active: "default" });
    const client = createIpcClient();
    const result = await client.profileList();
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", { method: "profile.list", params: {} });
    expect(result).toEqual({ profiles: [{ name: "default" }], active: "default" });
  });

  it("profileCreate passes { name } as params", async () => {
    invokeMock.mockResolvedValueOnce({ name: "scratch" });
    await createIpcClient().profileCreate("scratch");
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "profile.create",
      params: { name: "scratch" },
    });
  });

  it("profileSwitch passes { name } as params", async () => {
    invokeMock.mockResolvedValueOnce({ active: "work" });
    await createIpcClient().profileSwitch("work");
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "profile.switch",
      params: { name: "work" },
    });
  });

  it("profileDelete passes { name } as params", async () => {
    invokeMock.mockResolvedValueOnce({ deleted: "scratch" });
    await createIpcClient().profileDelete("scratch");
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "profile.delete",
      params: { name: "scratch" },
    });
  });
});

describe("NimbusIpcClient — Telemetry wrappers", () => {
  it("telemetryGetStatus returns disabled shape unchanged", async () => {
    invokeMock.mockResolvedValueOnce({ enabled: false });
    const result = await createIpcClient().telemetryGetStatus();
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "telemetry.getStatus",
      params: {},
    });
    expect(result).toEqual({ enabled: false });
  });

  it("telemetryGetStatus returns enabled + preview payload intact", async () => {
    invokeMock.mockResolvedValueOnce({
      enabled: true,
      session_id: "preview-not-persisted",
      nimbus_version: "0.1.0",
      platform: "linux",
      connector_error_rate: {},
      connector_health_transitions: {},
      query_latency_p50_ms: 5,
      query_latency_p95_ms: 20,
      query_latency_p99_ms: 40,
      agent_invocation_latency_p50_ms: 0,
      agent_invocation_latency_p95_ms: 0,
      sync_duration_p50_ms: {},
      cold_start_ms: 120,
      extension_installs_by_id: {},
      extension_uninstalls_by_id: {},
    });
    const result = await createIpcClient().telemetryGetStatus();
    expect(result.enabled).toBe(true);
    if (result.enabled) {
      expect(result.query_latency_p95_ms).toBe(20);
    }
  });

  it("telemetrySetEnabled passes { enabled: boolean }", async () => {
    invokeMock.mockResolvedValueOnce({ enabled: false });
    await createIpcClient().telemetrySetEnabled(false);
    expect(invokeMock).toHaveBeenCalledWith("rpc_call", {
      method: "telemetry.setEnabled",
      params: { enabled: false },
    });
  });
});
```

- [ ] **Step 2: Run and expect FAIL**

```bash
cd packages/ui && bunx vitest run test/ipc/client-ws5c.test.ts && cd ../..
```

Expected: `client.profileList is not a function` and equivalents.

### Task 3: Implement the six new client wrappers

**Files:**
- Modify: `packages/ui/src/ipc/client.ts`

- [ ] **Step 1: Extend imports**

At the top of `packages/ui/src/ipc/client.ts`, replace the existing types import with:

```ts
import {
  type AuditEntry,
  type ConnectionState,
  type ConnectorStatus,
  GatewayOfflineError,
  type IndexMetrics,
  JsonRpcError,
  type JsonRpcErrorPayload,
  type JsonRpcNotification,
  MethodNotAllowedError,
  type ProfileListResult,
  type TelemetryStatus,
} from "./types";
```

- [ ] **Step 2: Extend the `NimbusIpcClient` interface**

Replace the existing interface block (lines 15–23) with:

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
}
```

- [ ] **Step 3: Implement the wrappers inside `createIpcClient`**

Inside the `client` object literal in `createIpcClient`, after the existing `consentRespond` entry, append:

```ts
    async profileList(): Promise<ProfileListResult> {
      const res = await this.call<unknown>("profile.list", {});
      if (typeof res !== "object" || res === null)
        throw new Error("profile.list: expected object");
      return res as ProfileListResult;
    },
    async profileCreate(name): Promise<{ name: string }> {
      return await this.call<{ name: string }>("profile.create", { name });
    },
    async profileSwitch(name): Promise<{ active: string }> {
      return await this.call<{ active: string }>("profile.switch", { name });
    },
    async profileDelete(name): Promise<{ deleted: string }> {
      return await this.call<{ deleted: string }>("profile.delete", { name });
    },
    async telemetryGetStatus(): Promise<TelemetryStatus> {
      const res = await this.call<unknown>("telemetry.getStatus", {});
      if (typeof res !== "object" || res === null)
        throw new Error("telemetry.getStatus: expected object");
      return res as TelemetryStatus;
    },
    async telemetrySetEnabled(enabled): Promise<{ enabled: boolean }> {
      return await this.call<{ enabled: boolean }>("telemetry.setEnabled", { enabled });
    },
```

- [ ] **Step 4: Run the new tests, expect PASS**

```bash
cd packages/ui && bunx vitest run test/ipc/client-ws5c.test.ts && cd ../..
```

Expected: all 7 tests pass.

### Task 4: Extend `__mocks__/client.ts` with module-scope mocks for every new method

Per WS5-B convention (see `packages/ui/test/pages/OnboardingConnect.test.tsx`), tests `vi.mock("../../src/ipc/client")` to auto-resolve to this module, then import specific `*Mock` symbols from `__mocks__/client.ts`. Those symbols must be **module-scope singletons** so `createIpcClient()` always returns an object wiring to the same `vi.fn()` — otherwise `.mockResolvedValueOnce` set up in a test would not affect the panel's runtime call.

**Files:**
- Modify: `packages/ui/src/ipc/__mocks__/client.ts`

- [ ] **Step 1: Replace the entire mock module**

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
});

export const __resetIpcClientForTests = () => {};
```

- [ ] **Step 2: Run the full UI test suite — expect no regressions**

```bash
cd packages/ui && bunx vitest run && cd ../..
```

Expected: the existing WS5-B tests (which only consume `callMock`) still pass; the two new `client-ws5c.test.ts` tests pass because they use the real client, not the mock module.

### Task 5: Write failing parseError redaction tests

**Files:**
- Create: `packages/ui/test/ipc/parse-error-redaction.test.ts`

- [ ] **Step 1: Write the tests**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

type InvokeArgs = { method: string; params: unknown };
const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn<(cmd: string, args?: InvokeArgs) => Promise<unknown>>(),
  listenMock: vi.fn<
    (event: string, handler: (e: { payload: unknown }) => void) => Promise<() => void>
  >(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

import { __resetIpcClientForTests, createIpcClient } from "../../src/ipc/client";

const FORBIDDEN_KEYS = [
  "passphrase",
  "recoverySeed",
  "mnemonic",
  "privateKey",
  "encryptedVaultManifest",
] as const;

beforeEach(() => {
  __resetIpcClientForTests();
  invokeMock.mockReset();
  listenMock.mockResolvedValue(() => {});
});

describe("parseError — credential redaction", () => {
  for (const key of FORBIDDEN_KEYS) {
    it(`redacts '${key}=<value>' in raw error strings`, async () => {
      invokeMock.mockRejectedValueOnce(`boom with ${key}=super-secret-value-12345 in body`);
      let thrown: Error | null = null;
      try {
        await createIpcClient().call("profile.list", {});
      } catch (e) {
        thrown = e as Error;
      }
      expect(thrown).not.toBeNull();
      expect(thrown?.message).not.toContain("super-secret-value-12345");
      expect(thrown?.message).toContain("[REDACTED]");
    });

    it(`redacts '"${key}":"..."' in JSON-RPC error payloads`, async () => {
      const leaking = JSON.stringify({
        code: -32010,
        message: `error containing ${key}: sekret-phrase`,
        data: { [key]: "sekret-phrase" },
      });
      invokeMock.mockRejectedValueOnce(leaking);
      let thrown: Error | null = null;
      try {
        await createIpcClient().call("data.import", {});
      } catch (e) {
        thrown = e as Error;
      }
      expect(thrown?.message).not.toContain("sekret-phrase");
    });
  }
});
```

- [ ] **Step 2: Run and expect FAIL**

```bash
cd packages/ui && bunx vitest run test/ipc/parse-error-redaction.test.ts && cd ../..
```

Expected: 10 failures (5 keys × 2 shapes) — secret values leak through.

### Task 6: Implement `parseError` redaction

**Files:**
- Modify: `packages/ui/src/ipc/client.ts`

- [ ] **Step 1: Add the redactor helper**

Insert immediately after the imports (before the existing `parseError` function) in `packages/ui/src/ipc/client.ts`:

```ts
const FORBIDDEN_VALUE_KEYS: readonly string[] = [
  "passphrase",
  "recoverySeed",
  "mnemonic",
  "privateKey",
  "encryptedVaultManifest",
];

function redactSensitiveSubstrings(input: string): string {
  let out = input;
  for (const key of FORBIDDEN_VALUE_KEYS) {
    // `key=<run-of-non-whitespace-non-comma-non-brace>` — covers raw strings and JSON shards.
    const assignRe = new RegExp(`${key}\\s*[=:]\\s*"?([^\\s",}]+)"?`, "gi");
    out = out.replace(assignRe, `${key}=[REDACTED]`);
    // `"key":"value"` explicit JSON form (assignRe alone can miss quoted JSON).
    const jsonRe = new RegExp(`"${key}"\\s*:\\s*"[^"]*"`, "gi");
    out = out.replace(jsonRe, `"${key}":"[REDACTED]"`);
  }
  return out;
}
```

- [ ] **Step 2: Use the redactor in `parseError`**

Replace the body of `parseError` (the function starting at line 25 originally):

```ts
function parseError(err: unknown): Error {
  let msg: string;
  if (typeof err === "string") {
    msg = err;
  } else if (err instanceof Error) {
    msg = err.message;
  } else {
    msg = JSON.stringify(err);
  }
  msg = redactSensitiveSubstrings(msg);
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
```

- [ ] **Step 3: Run the failing tests, expect PASS**

```bash
cd packages/ui && bunx vitest run test/ipc/parse-error-redaction.test.ts && cd ../..
```

Expected: all 10 pass.

- [ ] **Step 4: Run the full UI test suite — expect no regressions**

```bash
cd packages/ui && bunx vitest run && cd ../..
```

Pay attention to `test/ipc/client.test.ts`: those tests use `ERR_METHOD_NOT_ALLOWED:vault.get` — redaction would rewrite `vault.get` only if it matched a forbidden key (it doesn't), so the existing assertions still hold.

### Task 7: Commit Phase 1

- [ ] **Step 1: Commit**

```bash
git add packages/ui/src/ipc/types.ts \
        packages/ui/src/ipc/client.ts \
        packages/ui/src/ipc/__mocks__/client.ts \
        packages/ui/test/ipc/client-ws5c.test.ts \
        packages/ui/test/ipc/parse-error-redaction.test.ts
git commit -m "feat(ui-ipc): profile + telemetry wrappers + parseError secret redaction"
```

---

## Phase 2 — Rust bridge: ALLOWED_METHODS growth + NO_TIMEOUT_METHODS

Per spec §3, WS5-C grows the allowlist by 28 (12 read + 16 write). Plan 2 lands **all 28 at once** so later plans don't re-touch `gateway_bridge.rs`; the methods whose UI lands later are harmless until then.

### Task 8: Write failing Rust tests for the allowlist growth

**Files:**
- Modify: `packages/ui/src-tauri/src/gateway_bridge.rs` (test module only)

- [ ] **Step 1: Replace the existing `tests` module**

In `packages/ui/src-tauri/src/gateway_bridge.rs`, replace the entire `#[cfg(test)] mod tests { ... }` block (currently lines 244–288) with:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlist_ws5a_methods() {
        assert!(is_method_allowed("diag.snapshot"));
        assert!(is_method_allowed("connector.list"));
        assert!(is_method_allowed("connector.startAuth"));
        assert!(is_method_allowed("engine.askStream"));
        assert!(is_method_allowed("db.getMeta"));
        assert!(is_method_allowed("db.setMeta"));
    }

    #[test]
    fn allowlist_ws5b_additions() {
        assert!(is_method_allowed("connector.listStatus"));
        assert!(is_method_allowed("index.metrics"));
        assert!(is_method_allowed("audit.list"));
        assert!(is_method_allowed("consent.respond"));
    }

    #[test]
    fn allowlist_ws5c_llm_reads() {
        assert!(is_method_allowed("llm.listModels"));
        assert!(is_method_allowed("llm.getRouterStatus"));
    }

    #[test]
    fn allowlist_ws5c_llm_writes() {
        assert!(is_method_allowed("llm.pullModel"));
        assert!(is_method_allowed("llm.cancelPull"));
        assert!(is_method_allowed("llm.loadModel"));
        assert!(is_method_allowed("llm.unloadModel"));
        assert!(is_method_allowed("llm.setDefault"));
    }

    #[test]
    fn allowlist_ws5c_connector_writes() {
        assert!(is_method_allowed("connector.setConfig"));
    }

    #[test]
    fn allowlist_ws5c_profile_crud() {
        assert!(is_method_allowed("profile.list"));
        assert!(is_method_allowed("profile.create"));
        assert!(is_method_allowed("profile.switch"));
        assert!(is_method_allowed("profile.delete"));
    }

    #[test]
    fn allowlist_ws5c_audit_surface() {
        assert!(is_method_allowed("audit.getSummary"));
        assert!(is_method_allowed("audit.verify"));
        assert!(is_method_allowed("audit.export"));
    }

    #[test]
    fn allowlist_ws5c_telemetry_surface() {
        assert!(is_method_allowed("telemetry.getStatus"));
        assert!(is_method_allowed("telemetry.setEnabled"));
    }

    #[test]
    fn allowlist_ws5c_updater_surface() {
        assert!(is_method_allowed("updater.getStatus"));
        assert!(is_method_allowed("updater.checkNow"));
        assert!(is_method_allowed("updater.applyUpdate"));
        assert!(is_method_allowed("updater.rollback"));
        assert!(is_method_allowed("diag.getVersion"));
    }

    #[test]
    fn allowlist_ws5c_data_surface() {
        assert!(is_method_allowed("data.getExportPreflight"));
        assert!(is_method_allowed("data.getDeletePreflight"));
        assert!(is_method_allowed("data.export"));
        assert!(is_method_allowed("data.import"));
        assert!(is_method_allowed("data.delete"));
    }

    #[test]
    fn allowlist_rejects_vault_and_raw_db_writes() {
        assert!(!is_method_allowed("vault.get"));
        assert!(!is_method_allowed("vault.set"));
        assert!(!is_method_allowed("vault.list"));
        assert!(!is_method_allowed("db.put"));
        assert!(!is_method_allowed("db.delete"));
        assert!(!is_method_allowed("config.set"));
        assert!(!is_method_allowed("index.rebuild"));
    }

    #[test]
    fn allowlist_exact_size() {
        // Plan 2 target: 10 (WS5-A+B) + 28 (WS5-C) = 38.
        assert_eq!(ALLOWED_METHODS.len(), 38);
    }

    #[test]
    fn allowlist_is_alphabetized() {
        let mut sorted: Vec<&&str> = ALLOWED_METHODS.iter().collect();
        sorted.sort();
        let actual: Vec<&&str> = ALLOWED_METHODS.iter().collect();
        assert_eq!(actual, sorted, "ALLOWED_METHODS must be alphabetized");
    }

    #[test]
    fn allowlist_has_no_duplicates() {
        let mut seen: std::collections::HashSet<&str> = std::collections::HashSet::new();
        for m in ALLOWED_METHODS {
            assert!(seen.insert(m), "duplicate method in ALLOWED_METHODS: {m}");
        }
    }

    #[test]
    fn allowlist_rejects_empty_and_unknown() {
        assert!(!is_method_allowed(""));
        assert!(!is_method_allowed("unknown.method"));
    }

    #[test]
    fn no_timeout_methods_contains_expected_four() {
        assert!(is_no_timeout_method("data.export"));
        assert!(is_no_timeout_method("data.import"));
        assert!(is_no_timeout_method("llm.pullModel"));
        assert!(is_no_timeout_method("updater.applyUpdate"));
        assert!(!is_no_timeout_method("profile.list"));
        assert!(!is_no_timeout_method("audit.list"));
    }

    #[test]
    fn no_timeout_methods_exact_size() {
        assert_eq!(NO_TIMEOUT_METHODS.len(), 4);
    }

    #[test]
    fn no_timeout_methods_are_subset_of_allowlist() {
        for m in NO_TIMEOUT_METHODS {
            assert!(
                is_method_allowed(m),
                "{m} is in NO_TIMEOUT_METHODS but not in ALLOWED_METHODS"
            );
        }
    }
}
```

- [ ] **Step 2: Run and expect FAIL**

```bash
cd packages/ui/src-tauri && cargo test gateway_bridge::tests --no-fail-fast 2>&1 | tail -40 && cd ../../..
```

Expected: multiple failures — the new methods aren't in `ALLOWED_METHODS`, and `NO_TIMEOUT_METHODS` / `is_no_timeout_method` don't exist.

### Task 9: Implement `ALLOWED_METHODS` growth + `NO_TIMEOUT_METHODS`

**Files:**
- Modify: `packages/ui/src-tauri/src/gateway_bridge.rs`

- [ ] **Step 1: Replace the `ALLOWED_METHODS` constant**

Replace the current `ALLOWED_METHODS` block (lines 58–71) with the alphabetized 38-entry version:

```rust
/// Methods exposed to the frontend over `rpc_call`. Alphabetized; size asserted by
/// `allowlist_exact_size` to prevent accidental additions without a test update.
///
/// Vault and raw db writes are NEVER in this list
/// (see `allowlist_rejects_vault_and_raw_db_writes`). Destructive domain ops
/// (`data.delete`) live at the Gateway level, not the raw db layer.
pub const ALLOWED_METHODS: &[&str] = &[
    "audit.export",
    "audit.getSummary",
    "audit.list",
    "audit.verify",
    "connector.list",
    "connector.listStatus",
    "connector.setConfig",
    "connector.startAuth",
    "consent.respond",
    "data.delete",
    "data.export",
    "data.getDeletePreflight",
    "data.getExportPreflight",
    "data.import",
    "db.getMeta",
    "db.setMeta",
    "diag.getVersion",
    "diag.snapshot",
    "engine.askStream",
    "index.metrics",
    "llm.cancelPull",
    "llm.getRouterStatus",
    "llm.listModels",
    "llm.loadModel",
    "llm.pullModel",
    "llm.setDefault",
    "llm.unloadModel",
    "profile.create",
    "profile.delete",
    "profile.list",
    "profile.switch",
    "telemetry.getStatus",
    "telemetry.setEnabled",
    "updater.applyUpdate",
    "updater.checkNow",
    "updater.getStatus",
    "updater.rollback",
];
```

- [ ] **Step 2: Add `NO_TIMEOUT_METHODS` + helper**

Immediately below the `ALLOWED_METHODS` block add:

```rust
/// Methods that must **not** be subject to the default `rpc_call` timeout — they are
/// run-to-completion or fire-and-forget-with-progress-notifications. The UI relies
/// on streamed notifications (`llm.pullProgress`, `data.exportProgress`, etc.) for
/// liveness, and the native RPC may legitimately take many minutes on slow machines
/// or large backups. See spec §2.2.
pub const NO_TIMEOUT_METHODS: &[&str] = &[
    "data.export",
    "data.import",
    "llm.pullModel",
    "updater.applyUpdate",
];

pub fn is_no_timeout_method(method: &str) -> bool {
    NO_TIMEOUT_METHODS.contains(&method)
}
```

- [ ] **Step 3: Run the tests, expect PASS**

```bash
cd packages/ui/src-tauri && cargo test gateway_bridge::tests && cd ../../..
```

Expected: all tests pass.

### Task 10: Commit Phase 2

- [ ] **Step 1: Commit**

```bash
git add packages/ui/src-tauri/src/gateway_bridge.rs
git commit -m "feat(ui-bridge): ALLOWED_METHODS grows to 38 + NO_TIMEOUT_METHODS for long ops"
```

---

## Phase 3 — Cross-window `profile.switched` rebroadcast

Per spec §2.2 + §5.2, the Gateway emits `profile.switched` as a standard notification. The UI has multiple open windows (main, HITL popup, Quick Query, onboarding) that must each call Tauri `app.restart()` because the Vault key-prefix change invalidates MCP client singletons, IPC subscriptions, and module-scope caches. The Rust bridge rebroadcasts this **one** method as a **global** event on a dedicated channel (`profile://switched`); every other notification remains window-scoped.

### Task 11: Write failing Rust test for the classifier

**Files:**
- Modify: `packages/ui/src-tauri/src/gateway_bridge.rs` (extend the `tests` module)

- [ ] **Step 1: Append the failing tests**

Append inside the existing `mod tests { ... }` block:

```rust
    #[test]
    fn profile_switched_is_classified_for_global_rebroadcast() {
        assert!(is_global_broadcast_method("profile.switched"));
        assert!(!is_global_broadcast_method("consent.request"));
        assert!(!is_global_broadcast_method("connector.healthChanged"));
    }

    #[test]
    fn global_broadcast_methods_exact_size() {
        assert_eq!(GLOBAL_BROADCAST_METHODS.len(), 1);
    }
```

- [ ] **Step 2: Run and expect FAIL**

```bash
cd packages/ui/src-tauri && cargo test gateway_bridge::tests::profile_switched 2>&1 | tail -15 && cd ../../..
```

Expected: `cannot find function 'is_global_broadcast_method' in this scope`.

### Task 12: Implement the classifier + global-emit branch

**Files:**
- Modify: `packages/ui/src-tauri/src/gateway_bridge.rs`

- [ ] **Step 1: Add the global-method list + classifier**

Below `NO_TIMEOUT_METHODS` / `is_no_timeout_method` add:

```rust
/// Notification methods rebroadcast as **global** Tauri events (received by every
/// window) rather than as window-scoped `gateway://notification`. Keep this tight —
/// noisy methods (HITL, health changes) stay scoped to avoid fan-out.
pub const GLOBAL_BROADCAST_METHODS: &[&str] = &["profile.switched"];

pub fn is_global_broadcast_method(method: &str) -> bool {
    GLOBAL_BROADCAST_METHODS.contains(&method)
}
```

- [ ] **Step 2: Extend `classify_notification` with the global-emit branch**

In `classify_notification` (around line 322), add a new branch **before** the final `_ => {}`:

```rust
        "profile.switched" => {
            // Global rebroadcast so every window (main, HITL popup, Quick Query,
            // onboarding) can react. Each window's JS listener triggers `app.restart()`;
            // the first to fire wins, the rest are no-ops because the process has
            // already exited.
            if let Some(p) = params.cloned() {
                let _ = app.emit("profile://switched", p);
            }
        }
```

`app.emit(...)` on an `AppHandle` broadcasts to every window in Tauri 2; the dedicated channel name (`profile://switched`) keeps the listener shape simple.

- [ ] **Step 3: Run all Rust tests, expect PASS**

```bash
cd packages/ui/src-tauri && cargo test gateway_bridge::tests && cd ../../..
```

Expected: every test passes.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src-tauri/src/gateway_bridge.rs
git commit -m "feat(ui-bridge): rebroadcast profile.switched as global Tauri event"
```

---

## Phase 4 — New store slices

Five slices: three real (`settings`, `profile`, `telemetry`) and two stubs that exist only to carry persisted fields (`connectors`, `model`). Stub slices will be fleshed out in later plans when their panels ship.

### Task 13: `settings` slice

**Files:**
- Create: `packages/ui/src/store/slices/settings.ts`
- Create: `packages/ui/test/store/settings.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { create } from "zustand";
import { beforeEach, describe, expect, it } from "vitest";
import { createSettingsSlice, type SettingsSlice } from "../../src/store/slices/settings";

function makeStore() {
  return create<SettingsSlice>()((...a) => createSettingsSlice(...a));
}

describe("settings slice", () => {
  let store: ReturnType<typeof makeStore>;
  beforeEach(() => {
    store = makeStore();
  });

  it("initial activePanel is null", () => {
    expect(store.getState().activePanel).toBeNull();
  });

  it("setActivePanel stores the panel key", () => {
    store.getState().setActivePanel("profiles");
    expect(store.getState().activePanel).toBe("profiles");
  });

  it("setActivePanel(null) clears the active panel", () => {
    store.getState().setActivePanel("telemetry");
    store.getState().setActivePanel(null);
    expect(store.getState().activePanel).toBeNull();
  });
});
```

- [ ] **Step 2: Run and expect FAIL (module not found)**

```bash
cd packages/ui && bunx vitest run test/store/settings.test.ts && cd ../..
```

- [ ] **Step 3: Create the slice**

```ts
import type { StateCreator } from "zustand";

export type SettingsPanelKey =
  | "model"
  | "connectors"
  | "profiles"
  | "audit"
  | "data"
  | "telemetry"
  | "updates";

export interface SettingsSlice {
  readonly activePanel: SettingsPanelKey | null;
  setActivePanel: (p: SettingsPanelKey | null) => void;
}

export const createSettingsSlice: StateCreator<SettingsSlice, [], [], SettingsSlice> = (set) => ({
  activePanel: null,
  setActivePanel: (p) => set({ activePanel: p }),
});
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd packages/ui && bunx vitest run test/store/settings.test.ts && cd ../..
```

### Task 14: `profile` slice

**Files:**
- Create: `packages/ui/src/store/slices/profile.ts`
- Create: `packages/ui/test/store/profile.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { create } from "zustand";
import { beforeEach, describe, expect, it } from "vitest";
import { createProfileSlice, type ProfileSlice } from "../../src/store/slices/profile";

function makeStore() {
  return create<ProfileSlice>()((...a) => createProfileSlice(...a));
}

describe("profile slice", () => {
  let store: ReturnType<typeof makeStore>;
  beforeEach(() => {
    store = makeStore();
  });

  it("initial state: active=null, profiles=[], lastFetchAt=null", () => {
    const s = store.getState();
    expect(s.active).toBeNull();
    expect(s.profiles).toEqual([]);
    expect(s.lastFetchAt).toBeNull();
  });

  it("setProfileList replaces list + active + stamps lastFetchAt", () => {
    const before = Date.now();
    store.getState().setProfileList({
      profiles: [{ name: "default" }, { name: "work" }],
      active: "default",
    });
    const s = store.getState();
    expect(s.profiles.map((p) => p.name)).toEqual(["default", "work"]);
    expect(s.active).toBe("default");
    expect(s.lastFetchAt).not.toBeNull();
    expect(s.lastFetchAt!).toBeGreaterThanOrEqual(before);
  });

  it("setActiveProfileOptimistic updates active without altering the list", () => {
    store.getState().setProfileList({
      profiles: [{ name: "default" }, { name: "work" }],
      active: "default",
    });
    store.getState().setActiveProfileOptimistic("work");
    expect(store.getState().active).toBe("work");
    expect(store.getState().profiles.map((p) => p.name)).toEqual(["default", "work"]);
  });

  it("setProfileActionInFlight toggles the flag", () => {
    store.getState().setProfileActionInFlight(true);
    expect(store.getState().actionInFlight).toBe(true);
    store.getState().setProfileActionInFlight(false);
    expect(store.getState().actionInFlight).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd packages/ui && bunx vitest run test/store/profile.test.ts && cd ../..
```

- [ ] **Step 3: Create the slice**

```ts
import type { StateCreator } from "zustand";
import type { ProfileListResult, ProfileSummary } from "../../ipc/types";

export interface ProfileSlice {
  readonly active: string | null;
  readonly profiles: ReadonlyArray<ProfileSummary>;
  readonly lastFetchAt: number | null;
  readonly actionInFlight: boolean;
  setProfileList: (r: ProfileListResult) => void;
  setActiveProfileOptimistic: (name: string) => void;
  setProfileActionInFlight: (v: boolean) => void;
}

export const createProfileSlice: StateCreator<ProfileSlice, [], [], ProfileSlice> = (set) => ({
  active: null,
  profiles: [],
  lastFetchAt: null,
  actionInFlight: false,
  setProfileList: (r) =>
    set({
      profiles: r.profiles,
      active: r.active,
      lastFetchAt: Date.now(),
    }),
  setActiveProfileOptimistic: (name) => set({ active: name }),
  setProfileActionInFlight: (v) => set({ actionInFlight: v }),
});
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd packages/ui && bunx vitest run test/store/profile.test.ts && cd ../..
```

### Task 15: `telemetry` slice

**Files:**
- Create: `packages/ui/src/store/slices/telemetry.ts`
- Create: `packages/ui/test/store/telemetry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { create } from "zustand";
import { beforeEach, describe, expect, it } from "vitest";
import type { TelemetryStatus } from "../../src/ipc/types";
import { createTelemetrySlice, type TelemetrySlice } from "../../src/store/slices/telemetry";

function makeStore() {
  return create<TelemetrySlice>()((...a) => createTelemetrySlice(...a));
}

describe("telemetry slice", () => {
  let store: ReturnType<typeof makeStore>;
  beforeEach(() => {
    store = makeStore();
  });

  it("initial status is null", () => {
    expect(store.getState().status).toBeNull();
  });

  it("setTelemetryStatus stores a disabled payload", () => {
    store.getState().setTelemetryStatus({ enabled: false });
    expect(store.getState().status?.enabled).toBe(false);
  });

  it("setTelemetryStatus stores an enabled payload with preview fields", () => {
    const payload: TelemetryStatus = {
      enabled: true,
      session_id: "preview-not-persisted",
      nimbus_version: "0.1.0",
      platform: "linux",
      connector_error_rate: {},
      connector_health_transitions: {},
      query_latency_p50_ms: 3,
      query_latency_p95_ms: 14,
      query_latency_p99_ms: 22,
      agent_invocation_latency_p50_ms: 0,
      agent_invocation_latency_p95_ms: 0,
      sync_duration_p50_ms: {},
      cold_start_ms: 90,
      extension_installs_by_id: {},
      extension_uninstalls_by_id: {},
    };
    store.getState().setTelemetryStatus(payload);
    const s = store.getState().status;
    expect(s?.enabled).toBe(true);
    if (s?.enabled) {
      expect(s.query_latency_p95_ms).toBe(14);
    }
  });

  it("setTelemetryActionInFlight toggles correctly", () => {
    store.getState().setTelemetryActionInFlight(true);
    expect(store.getState().telemetryActionInFlight).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd packages/ui && bunx vitest run test/store/telemetry.test.ts && cd ../..
```

- [ ] **Step 3: Create the slice**

```ts
import type { StateCreator } from "zustand";
import type { TelemetryStatus } from "../../ipc/types";

export interface TelemetrySlice {
  readonly status: TelemetryStatus | null;
  readonly telemetryActionInFlight: boolean;
  setTelemetryStatus: (s: TelemetryStatus) => void;
  setTelemetryActionInFlight: (v: boolean) => void;
}

export const createTelemetrySlice: StateCreator<TelemetrySlice, [], [], TelemetrySlice> = (
  set,
) => ({
  status: null,
  telemetryActionInFlight: false,
  setTelemetryStatus: (s) => set({ status: s }),
  setTelemetryActionInFlight: (v) => set({ telemetryActionInFlight: v }),
});
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd packages/ui && bunx vitest run test/store/telemetry.test.ts && cd ../..
```

### Task 16: Stub `connectors` + `model` slices (persist carriers)

**Files:**
- Create: `packages/ui/src/store/slices/connectors.ts`
- Create: `packages/ui/test/store/connectors.test.ts`
- Create: `packages/ui/src/store/slices/model.ts`
- Create: `packages/ui/test/store/model.test.ts`

- [ ] **Step 1: Write the `connectors` slice test**

```ts
import { create } from "zustand";
import { describe, expect, it } from "vitest";
import {
  createConnectorsSlice,
  type ConnectorsSlice,
} from "../../src/store/slices/connectors";

function makeStore() {
  return create<ConnectorsSlice>()((...a) => createConnectorsSlice(...a));
}

describe("connectors slice (Plan 2 stub — persists list only)", () => {
  it("initial list is empty", () => {
    expect(makeStore().getState().connectorsList).toEqual([]);
  });

  it("setConnectorsList replaces the list", () => {
    const store = makeStore();
    store.getState().setConnectorsList([
      {
        service: "github",
        intervalMs: 300_000,
        depth: "summary",
        enabled: true,
        health: "healthy",
      },
    ]);
    expect(store.getState().connectorsList).toHaveLength(1);
    expect(store.getState().connectorsList[0]?.service).toBe("github");
  });
});
```

- [ ] **Step 2: Create the `connectors` slice**

```ts
import type { StateCreator } from "zustand";
import type { ConnectorHealth } from "../../ipc/types";

/**
 * Minimal per-connector snapshot persisted across UI reloads so cold-opening the app
 * with the Gateway already down still shows the last-known grid (spec §2.1).
 * Full Connectors-panel wiring lands in a later plan.
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
  setConnectorsList: (list: ReadonlyArray<PersistedConnectorRow>) => void;
}

export const createConnectorsSlice: StateCreator<ConnectorsSlice, [], [], ConnectorsSlice> = (
  set,
) => ({
  connectorsList: [],
  setConnectorsList: (list) => set({ connectorsList: list }),
});
```

- [ ] **Step 3: Write the `model` slice test**

```ts
import { create } from "zustand";
import { describe, expect, it } from "vitest";
import { createModelSlice, type ModelSlice } from "../../src/store/slices/model";

function makeStore() {
  return create<ModelSlice>()((...a) => createModelSlice(...a));
}

describe("model slice (Plan 2 stub — persists installed list + activePullId)", () => {
  it("initial state is empty list + null pullId", () => {
    const s = makeStore().getState();
    expect(s.installedModels).toEqual([]);
    expect(s.activePullId).toBeNull();
  });

  it("setInstalledModels + setActivePullId update correctly", () => {
    const store = makeStore();
    store.getState().setInstalledModels([{ id: "gemma:2b", provider: "ollama" }]);
    store.getState().setActivePullId("pull-abc123");
    expect(store.getState().installedModels).toHaveLength(1);
    expect(store.getState().activePullId).toBe("pull-abc123");
  });

  it("setActivePullId(null) clears the active pull", () => {
    const store = makeStore();
    store.getState().setActivePullId("pull-abc");
    store.getState().setActivePullId(null);
    expect(store.getState().activePullId).toBeNull();
  });
});
```

- [ ] **Step 4: Create the `model` slice**

```ts
import type { StateCreator } from "zustand";

export interface PersistedModelRow {
  readonly id: string;
  readonly provider: "ollama" | "llamacpp";
}

export interface ModelSlice {
  readonly installedModels: ReadonlyArray<PersistedModelRow>;
  readonly activePullId: string | null;
  setInstalledModels: (list: ReadonlyArray<PersistedModelRow>) => void;
  setActivePullId: (id: string | null) => void;
}

export const createModelSlice: StateCreator<ModelSlice, [], [], ModelSlice> = (set) => ({
  installedModels: [],
  activePullId: null,
  setInstalledModels: (list) => set({ installedModels: list }),
  setActivePullId: (id) => set({ activePullId: id }),
});
```

- [ ] **Step 5: Run every slice test, expect PASS**

```bash
cd packages/ui && bunx vitest run test/store/ && cd ../..
```

### Task 17: Commit Phase 4

- [ ] **Step 1: Commit**

```bash
git add packages/ui/src/store/slices/settings.ts \
        packages/ui/src/store/slices/profile.ts \
        packages/ui/src/store/slices/telemetry.ts \
        packages/ui/src/store/slices/connectors.ts \
        packages/ui/src/store/slices/model.ts \
        packages/ui/test/store/settings.test.ts \
        packages/ui/test/store/profile.test.ts \
        packages/ui/test/store/telemetry.test.ts \
        packages/ui/test/store/connectors.test.ts \
        packages/ui/test/store/model.test.ts
git commit -m "feat(ui-store): settings/profile/telemetry slices + connectors/model persist stubs"
```

---

## Phase 5 — Compose slices into `useNimbusStore` with persist middleware

### Task 18: Partialize whitelist + tests

**Files:**
- Create: `packages/ui/src/store/partialize.ts`
- Create: `packages/ui/test/store/partialize.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { FORBIDDEN_PERSIST_KEYS, persistPartialize } from "../../src/store/partialize";

describe("persistPartialize", () => {
  it("output contains ONLY the whitelisted slice-root fields", () => {
    const full = {
      // Non-persisted slices (must be stripped):
      connectionState: "connected",
      aggregateHealth: "healthy",
      pendingHitl: 0,
      pending: [],
      tray: {},
      quickQuery: {},
      onboarding: {},
      dashboard: {},
      audit: [],
      // Whitelisted roots (must survive):
      connectorsList: [{ service: "github" }],
      installedModels: [{ id: "gemma:2b" }],
      activePullId: null,
      active: "work",
      profiles: [{ name: "work" }],
      // Slice-action functions must NOT be persisted:
      setConnectionState: () => {},
      setProfileList: () => {},
    } as unknown as Record<string, unknown>;
    const out = persistPartialize(full);
    expect(Object.keys(out).sort()).toEqual(
      ["active", "activePullId", "connectorsList", "installedModels", "profiles"].sort(),
    );
  });

  it("forbidden keys at the top level never survive partialize", () => {
    const poisoned = {
      connectorsList: [],
      installedModels: [],
      activePullId: null,
      active: null,
      profiles: [],
      // These should never reach persist. Even if something leaks a typo like
      // `passphrase` into a whitelisted slice shape, partialize re-scans and strips.
      passphrase: "very-secret",
      recoverySeed: "word-word-word",
      mnemonic: "m",
      privateKey: "pk",
      encryptedVaultManifest: "cipher",
    } as Record<string, unknown>;
    const out = persistPartialize(poisoned);
    for (const k of FORBIDDEN_PERSIST_KEYS) {
      expect(out).not.toHaveProperty(k);
    }
  });

  it("forbidden keys nested INSIDE a whitelisted value are stripped recursively", () => {
    // Guards against a future slice change (e.g. a ProfileSummary gaining a field
    // whose name collides with a forbidden key). The flat top-level check would
    // let a nested secret survive; the recursive scrub catches it.
    const poisoned = {
      connectorsList: [
        {
          service: "github",
          intervalMs: 300_000,
          passphrase: "nested-secret-1",
        },
      ],
      installedModels: [],
      activePullId: null,
      active: null,
      profiles: [
        {
          name: "work",
          // Deeply nested to prove recursion depth isn't limited to 1.
          meta: { debug: { mnemonic: "nested-secret-2" } },
        },
      ],
    } as unknown as Record<string, unknown>;
    const out = persistPartialize(poisoned);
    const flat = JSON.stringify(out);
    expect(flat).not.toContain("nested-secret-1");
    expect(flat).not.toContain("nested-secret-2");
    // Non-secret siblings are preserved.
    expect(flat).toContain("github");
    expect(flat).toContain("work");
  });

  it("recursion handles cycles without throwing", () => {
    // Defensive: if a future slice somehow produces a cyclic structure
    // (very unlikely for JSON-persisted state), the scrub should still return.
    const a: Record<string, unknown> = { name: "a" };
    const b: Record<string, unknown> = { name: "b", back: a };
    a["forward"] = b;
    const poisoned = {
      connectorsList: [],
      installedModels: [],
      activePullId: null,
      active: null,
      profiles: [a],
    } as unknown as Record<string, unknown>;
    expect(() => persistPartialize(poisoned)).not.toThrow();
  });

  it("FORBIDDEN_PERSIST_KEYS lists the five spec-mandated keys", () => {
    expect([...FORBIDDEN_PERSIST_KEYS].sort()).toEqual(
      [
        "encryptedVaultManifest",
        "mnemonic",
        "passphrase",
        "privateKey",
        "recoverySeed",
      ].sort(),
    );
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd packages/ui && bunx vitest run test/store/partialize.test.ts && cd ../..
```

- [ ] **Step 3: Create `partialize.ts`**

```ts
/**
 * Persist whitelist.
 *
 * Spec §2.1 persists exactly three slice surfaces (`connectors` / `model` / `profile`)
 * and nothing else. Transient state (HITL queue, tray, dashboard, audit, telemetry
 * counters, transient dialog state, pull progress, export/import progress, router
 * status, connection state) is memory-only and rebuilt on reconnect.
 *
 * The forbidden-key blocklist is redundant with the whitelist (none of the whitelisted
 * names collide with secrets today), but exists as defence in depth so that a future
 * slice typo cannot accidentally persist a secret value under a whitelisted name.
 */

export const WHITELISTED_PERSIST_KEYS = [
  // connectors slice
  "connectorsList",
  // model slice
  "installedModels",
  "activePullId",
  // profile slice
  "active",
  "profiles",
] as const;

export const FORBIDDEN_PERSIST_KEYS = [
  "passphrase",
  "recoverySeed",
  "mnemonic",
  "privateKey",
  "encryptedVaultManifest",
] as const;

type Whitelisted = (typeof WHITELISTED_PERSIST_KEYS)[number];

/**
 * Recursively walks `value` and deletes any key matching `FORBIDDEN_PERSIST_KEYS`,
 * regardless of nesting depth. Tolerates cycles via a seen-set. Mutates `value`
 * in place — callers supply an already-cloned/new value.
 */
function deepScrubForbidden(value: unknown, seen: WeakSet<object> = new WeakSet()): void {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value as object)) return;
  seen.add(value as object);
  if (Array.isArray(value)) {
    for (const item of value) deepScrubForbidden(item, seen);
    return;
  }
  const rec = value as Record<string, unknown>;
  for (const forbidden of FORBIDDEN_PERSIST_KEYS) {
    if (forbidden in rec) {
      delete rec[forbidden];
    }
  }
  for (const child of Object.values(rec)) {
    deepScrubForbidden(child, seen);
  }
}

export function persistPartialize(
  state: Record<string, unknown>,
): Partial<Record<Whitelisted, unknown>> {
  const out: Partial<Record<Whitelisted, unknown>> = {};
  for (const key of WHITELISTED_PERSIST_KEYS) {
    if (key in state) {
      // Structured clone so deep scrubbing never mutates the live store.
      out[key] = structuredClone(state[key]);
    }
  }
  // Top-level: strip any forbidden name that somehow matched a whitelist entry.
  for (const forbidden of FORBIDDEN_PERSIST_KEYS) {
    if (forbidden in out) {
      delete (out as Record<string, unknown>)[forbidden];
    }
  }
  // Deep: walk every persisted value and strip forbidden keys at any depth.
  // Protects against a future slice change that nests a secret inside a
  // whitelisted shape (e.g. `ProfileSummary` gaining a `mnemonic` field).
  deepScrubForbidden(out);
  return out;
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd packages/ui && bunx vitest run test/store/partialize.test.ts && cd ../..
```

### Task 19: Compose the full store with `persist` middleware

**Files:**
- Modify: `packages/ui/src/store/index.ts`
- Create: `packages/ui/test/store/store-persist.test.ts`

- [ ] **Step 1: Replace the store composition**

Replace the entire contents of `packages/ui/src/store/index.ts`:

```ts
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { persistPartialize } from "./partialize";
import { type ConnectionSlice, createConnectionSlice } from "./slices/connection";
import { createConnectorsSlice, type ConnectorsSlice } from "./slices/connectors";
import { createDashboardSlice, type DashboardSlice } from "./slices/dashboard";
import { createHitlSlice, type HitlSlice } from "./slices/hitl";
import { createModelSlice, type ModelSlice } from "./slices/model";
import { createOnboardingSlice, type OnboardingSlice } from "./slices/onboarding";
import { createProfileSlice, type ProfileSlice } from "./slices/profile";
import { createQuickQuerySlice, type QuickQuerySlice } from "./slices/quickQuery";
import { createSettingsSlice, type SettingsSlice } from "./slices/settings";
import { createTelemetrySlice, type TelemetrySlice } from "./slices/telemetry";
import { createTraySlice, type TraySlice } from "./slices/tray";

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
  ModelSlice;

export const useNimbusStore = create<NimbusStore>()(
  persist(
    (...a) => ({
      ...createConnectionSlice(...a),
      ...createTraySlice(...a),
      ...createQuickQuerySlice(...a),
      ...createOnboardingSlice(...a),
      ...createDashboardSlice(...a),
      ...createHitlSlice(...a),
      ...createSettingsSlice(...a),
      ...createProfileSlice(...a),
      ...createTelemetrySlice(...a),
      ...createConnectorsSlice(...a),
      ...createModelSlice(...a),
    }),
    {
      name: "nimbus-ui-store",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => persistPartialize(state as unknown as Record<string, unknown>),
    },
  ),
);
```

- [ ] **Step 2: Write the persist-integration test**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { FORBIDDEN_PERSIST_KEYS } from "../../src/store/partialize";
import { useNimbusStore } from "../../src/store";

describe("useNimbusStore — persist middleware integration", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("writes only whitelisted keys to localStorage after a mutation", () => {
    useNimbusStore.getState().setProfileList({
      profiles: [{ name: "work" }],
      active: "work",
    });
    const raw = localStorage.getItem("nimbus-ui-store");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    // zustand/persist wraps state in { state: ..., version: 1 }.
    expect(Object.keys(parsed.state).sort()).toEqual(
      ["active", "activePullId", "connectorsList", "installedModels", "profiles"].sort(),
    );
  });

  it("forbidden keys never appear in localStorage", () => {
    useNimbusStore.getState().setProfileList({ profiles: [], active: null });
    const raw = localStorage.getItem("nimbus-ui-store");
    const flat = JSON.stringify(JSON.parse(raw!));
    for (const forbidden of FORBIDDEN_PERSIST_KEYS) {
      expect(flat).not.toContain(`"${forbidden}"`);
    }
  });

  it("ephemeral slice fields (connectionState, pending, status) are NOT persisted", () => {
    useNimbusStore.getState().setProfileList({ profiles: [], active: null });
    const parsed = JSON.parse(localStorage.getItem("nimbus-ui-store")!);
    expect(parsed.state).not.toHaveProperty("connectionState");
    expect(parsed.state).not.toHaveProperty("pending");
    expect(parsed.state).not.toHaveProperty("status");
  });
});
```

- [ ] **Step 3: Run the new test, expect PASS**

```bash
cd packages/ui && bunx vitest run test/store/store-persist.test.ts && cd ../..
```

- [ ] **Step 4: Run the full UI suite, expect no regressions**

```bash
cd packages/ui && bunx vitest run && cd ../..
```

Existing slice tests don't touch persist; they continue to pass unchanged. If any existing test fails because it relied on an empty localStorage leak-through, add `beforeEach(() => localStorage.clear())` to that test.

### Task 20: Commit Phase 5

- [ ] **Step 1: Commit**

```bash
git add packages/ui/src/store/partialize.ts \
        packages/ui/src/store/index.ts \
        packages/ui/test/store/partialize.test.ts \
        packages/ui/test/store/store-persist.test.ts
git commit -m "feat(ui-store): persist middleware with tested partialize whitelist (5 forbidden keys)"
```

---

## Phase 6 — Settings shell: layout + sidebar + nested routes + PanelComingSoon

### Task 21: Shared panel primitives (TDD)

**Files:**
- Create: `packages/ui/src/components/settings/PanelHeader.tsx`
- Create: `packages/ui/src/components/settings/PanelError.tsx`
- Create: `packages/ui/src/components/settings/StaleChip.tsx`
- Create: `packages/ui/src/components/settings/PanelComingSoon.tsx`
- Create: `packages/ui/test/components/settings/PanelHeader.test.tsx`
- Create: `packages/ui/test/components/settings/PanelError.test.tsx`
- Create: `packages/ui/test/components/settings/StaleChip.test.tsx`
- Create: `packages/ui/test/components/settings/PanelComingSoon.test.tsx`

- [ ] **Step 1: `PanelHeader` — failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PanelHeader } from "../../../src/components/settings/PanelHeader";

describe("PanelHeader", () => {
  it("renders title (h2) + description", () => {
    render(<PanelHeader title="Profiles" description="Named configurations" />);
    expect(screen.getByRole("heading", { level: 2, name: "Profiles" })).toBeInTheDocument();
    expect(screen.getByText("Named configurations")).toBeInTheDocument();
  });

  it("renders the optional live-status pill when provided", () => {
    render(
      <PanelHeader
        title="Telemetry"
        description="d"
        livePill={<span data-testid="pill">On</span>}
      />,
    );
    expect(screen.getByTestId("pill")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Create `PanelHeader`**

```tsx
import type { ReactNode } from "react";

export interface PanelHeaderProps {
  readonly title: string;
  readonly description: string;
  readonly livePill?: ReactNode;
}

export function PanelHeader({ title, description, livePill }: PanelHeaderProps) {
  return (
    <header className="flex items-start justify-between pb-4 border-b border-[var(--color-border)]">
      <div>
        <h2 className="text-xl font-semibold text-[var(--color-text)]">{title}</h2>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">{description}</p>
      </div>
      {livePill !== undefined && <div className="shrink-0">{livePill}</div>}
    </header>
  );
}
```

- [ ] **Step 3: `PanelError` — failing test**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PanelError } from "../../../src/components/settings/PanelError";

describe("PanelError", () => {
  it("renders message and fires onRetry when the button is clicked", async () => {
    const onRetry = vi.fn();
    render(<PanelError message="Boom" onRetry={onRetry} />);
    expect(screen.getByText("Boom")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 4: Create `PanelError`**

```tsx
export interface PanelErrorProps {
  readonly message: string;
  readonly onRetry?: () => void;
}

export function PanelError({ message, onRetry }: PanelErrorProps) {
  return (
    <div className="p-4 rounded-md border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)]">
      <p className="text-sm text-[var(--color-danger-text)]">{message}</p>
      {onRetry !== undefined && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 px-3 py-1 text-sm rounded border border-[var(--color-danger-border)]"
        >
          Retry
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 5: `StaleChip` — failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StaleChip } from "../../../src/components/settings/StaleChip";

describe("StaleChip", () => {
  it("renders offline-since text when provided", () => {
    render(<StaleChip offlineSinceIso="2026-04-20T12:00:00Z" />);
    const chip = screen.getByLabelText(/stale/i);
    expect(chip).toBeInTheDocument();
    expect(chip.textContent).toMatch(/offline/i);
  });

  it("renders generic stale text when no timestamp is provided", () => {
    render(<StaleChip />);
    expect(screen.getByLabelText(/stale/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Create `StaleChip`**

```tsx
export interface StaleChipProps {
  /** ISO timestamp of last successful connection; omit to show generic stale chip. */
  readonly offlineSinceIso?: string;
}

export function StaleChip({ offlineSinceIso }: StaleChipProps) {
  const label =
    offlineSinceIso !== undefined
      ? `Stale · offline since ${offlineSinceIso}`
      : "Stale · gateway offline";
  return (
    <span
      aria-label={label}
      className="inline-block px-2 py-0.5 text-xs rounded-full bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] border border-[var(--color-warning-border)]"
    >
      {label}
    </span>
  );
}
```

- [ ] **Step 7: `PanelComingSoon` — failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PanelComingSoon } from "../../../src/components/settings/PanelComingSoon";

describe("PanelComingSoon", () => {
  it("renders the provided title as a h2 and a 'coming soon' message", () => {
    render(<PanelComingSoon title="Model" />);
    expect(screen.getByRole("heading", { level: 2, name: /model/i })).toBeInTheDocument();
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 8: Create `PanelComingSoon`**

```tsx
import { PanelHeader } from "./PanelHeader";

export interface PanelComingSoonProps {
  readonly title: string;
}

export function PanelComingSoon({ title }: PanelComingSoonProps) {
  return (
    <section className="p-6">
      <PanelHeader title={title} description="Coming soon — ships in a follow-up WS5-C plan." />
      <div className="mt-8 p-6 rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-bg-subtle)] text-center">
        <p className="text-sm text-[var(--color-text-muted)]">
          This panel is not yet implemented. Track progress in <code>docs/roadmap.md</code>.
        </p>
      </div>
    </section>
  );
}
```

- [ ] **Step 9: Run all four primitive test files, expect PASS**

```bash
cd packages/ui && bunx vitest run test/components/settings/ && cd ../..
```

### Task 22: `SettingsSidebar`

**Files:**
- Create: `packages/ui/src/components/settings/SettingsSidebar.tsx`
- Create: `packages/ui/test/components/settings/SettingsSidebar.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { SettingsSidebar } from "../../../src/components/settings/SettingsSidebar";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SettingsSidebar />
    </MemoryRouter>,
  );
}

describe("SettingsSidebar", () => {
  it("renders all 7 WS5-C panel entries", () => {
    renderAt("/settings/profiles");
    for (const label of [
      "Model",
      "Connectors",
      "Profiles",
      "Audit",
      "Data",
      "Telemetry",
      "Updates",
    ]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("every entry links to its sub-route", () => {
    renderAt("/settings/profiles");
    expect(screen.getByRole("link", { name: "Model" })).toHaveAttribute(
      "href",
      "/settings/model",
    );
    expect(screen.getByRole("link", { name: "Profiles" })).toHaveAttribute(
      "href",
      "/settings/profiles",
    );
    expect(screen.getByRole("link", { name: "Updates" })).toHaveAttribute(
      "href",
      "/settings/updates",
    );
  });

  it("has aria-label 'Settings' so screen readers pick up the nav", () => {
    renderAt("/settings/profiles");
    expect(screen.getByRole("navigation", { name: "Settings" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd packages/ui && bunx vitest run test/components/settings/SettingsSidebar.test.tsx && cd ../..
```

- [ ] **Step 3: Create the component**

```tsx
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

interface SettingsEntry {
  readonly to: string;
  readonly label: string;
}

const ENTRIES: ReadonlyArray<SettingsEntry> = [
  { to: "/settings/model", label: "Model" },
  { to: "/settings/connectors", label: "Connectors" },
  { to: "/settings/profiles", label: "Profiles" },
  { to: "/settings/audit", label: "Audit" },
  { to: "/settings/data", label: "Data" },
  { to: "/settings/telemetry", label: "Telemetry" },
  { to: "/settings/updates", label: "Updates" },
];

export function SettingsSidebar(): ReactNode {
  return (
    <nav
      aria-label="Settings"
      className="w-[180px] bg-[var(--color-bg-subtle)] border-r border-[var(--color-border)] py-3 flex flex-col"
    >
      {ENTRIES.map((e) => (
        <NavLink
          key={e.to}
          to={e.to}
          className={({ isActive }) =>
            [
              "px-4 py-2 text-sm",
              isActive
                ? "font-semibold text-[var(--color-text)] bg-[var(--color-bg)] border-l-2 border-[var(--color-accent)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
            ].join(" ")
          }
        >
          {e.label}
        </NavLink>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd packages/ui && bunx vitest run test/components/settings/SettingsSidebar.test.tsx && cd ../..
```

### Task 23: `Settings` layout page

**Files:**
- Create: `packages/ui/src/pages/Settings.tsx`
- Create: `packages/ui/test/pages/Settings.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { Settings } from "../../src/pages/Settings";

describe("Settings layout", () => {
  it("renders SettingsSidebar and the nested Outlet content", () => {
    render(
      <MemoryRouter initialEntries={["/settings/profiles"]}>
        <Routes>
          <Route path="/settings" element={<Settings />}>
            <Route
              path="profiles"
              element={<div data-testid="child-outlet">Profiles content</div>}
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole("navigation", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByTestId("child-outlet")).toHaveTextContent("Profiles content");
  });
});
```

- [ ] **Step 2: Create the layout**

```tsx
import type { ReactNode } from "react";
import { Outlet } from "react-router-dom";
import { SettingsSidebar } from "../components/settings/SettingsSidebar";

export function Settings(): ReactNode {
  return (
    <div className="flex h-full min-h-0">
      <SettingsSidebar />
      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run, expect PASS**

```bash
cd packages/ui && bunx vitest run test/pages/Settings.test.tsx && cd ../..
```

### Task 24: Wire nested `/settings` routes into `App.tsx`

**Files:**
- Modify: `packages/ui/src/App.tsx`
- Delete: `packages/ui/src/pages/stubs/SettingsStub.tsx`

Note: `ProfilesPanel` and `TelemetryPanel` don't exist yet; Tasks 26 + 29 create them. TypeScript will fail until both land. That's expected — defer a full typecheck until Task 32.

- [ ] **Step 1: Replace `App.tsx`**

Overwrite `packages/ui/src/App.tsx` entirely:

```tsx
import type { ReactNode } from "react";
import {
  createBrowserRouter,
  createRoutesFromElements,
  Navigate,
  Route,
  RouterProvider,
} from "react-router-dom";
import { PanelComingSoon } from "./components/settings/PanelComingSoon";
import { RootLayout } from "./layouts/RootLayout";
import { Dashboard } from "./pages/Dashboard";
import { HitlPopup } from "./pages/HitlPopup";
import { Onboarding } from "./pages/Onboarding";
import { Connect } from "./pages/onboarding/Connect";
import { Syncing } from "./pages/onboarding/Syncing";
import { Welcome } from "./pages/onboarding/Welcome";
import { QuickQuery } from "./pages/QuickQuery";
import { Settings } from "./pages/Settings";
import { ProfilesPanel } from "./pages/settings/ProfilesPanel";
import { TelemetryPanel } from "./pages/settings/TelemetryPanel";
import { HitlStub } from "./pages/stubs/HitlStub";
import { MarketplaceStub } from "./pages/stubs/MarketplaceStub";
import { WatchersStub } from "./pages/stubs/WatchersStub";
import { WorkflowsStub } from "./pages/stubs/WorkflowsStub";
import { GatewayConnectionProvider } from "./providers/GatewayConnectionProvider";

function Wrapper({ children }: { readonly children: ReactNode }) {
  return <GatewayConnectionProvider>{children}</GatewayConnectionProvider>;
}

const router = createBrowserRouter(
  createRoutesFromElements(
    <Route
      element={
        <Wrapper>
          <RootLayout />
        </Wrapper>
      }
    >
      <Route index element={<Dashboard />} />
      <Route path="onboarding" element={<Onboarding />}>
        <Route index element={<Navigate to="welcome" replace />} />
        <Route path="welcome" element={<Welcome />} />
        <Route path="connect" element={<Connect />} />
        <Route path="syncing" element={<Syncing />} />
      </Route>
      <Route path="quick" element={<QuickQuery />} />
      <Route path="hitl-popup" element={<HitlPopup />} />
      <Route path="hitl" element={<HitlStub />} />
      <Route path="settings" element={<Settings />}>
        <Route index element={<Navigate to="model" replace />} />
        <Route path="model" element={<PanelComingSoon title="Model" />} />
        <Route path="connectors" element={<PanelComingSoon title="Connectors" />} />
        <Route path="profiles" element={<ProfilesPanel />} />
        <Route path="audit" element={<PanelComingSoon title="Audit" />} />
        <Route path="data" element={<PanelComingSoon title="Data" />} />
        <Route path="telemetry" element={<TelemetryPanel />} />
        <Route path="updates" element={<PanelComingSoon title="Updates" />} />
      </Route>
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

- [ ] **Step 2: Delete the now-unused stub**

```bash
rm packages/ui/src/pages/stubs/SettingsStub.tsx
```

- [ ] **Step 3: Do NOT run typecheck yet** — proceed to Phase 7. Typecheck will pass once Phases 7 + 8 are complete.

---

## Phase 7 — Profiles panel + useConfirm hook + profile.switched → app.restart

### Task 25: `useConfirm` hook (TDD)

**Files:**
- Create: `packages/ui/src/hooks/useConfirm.tsx`
- Create: `packages/ui/test/hooks/useConfirm.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { useConfirm } from "../../src/hooks/useConfirm";

function Harness({ expected }: { expected: string }) {
  const confirm = useConfirm();
  const [result, setResult] = useState<string>("idle");
  return (
    <>
      <button
        type="button"
        onClick={async () => {
          const ok = await confirm({
            title: "Delete profile",
            description: `Type "${expected}" to confirm.`,
            expectedText: expected,
            confirmLabel: "Delete",
          });
          setResult(ok ? "confirmed" : "cancelled");
        }}
      >
        open
      </button>
      <div data-testid="out">{result}</div>
      {confirm.modal}
    </>
  );
}

describe("useConfirm", () => {
  it("resolves true when user types the exact expected text and clicks Delete", async () => {
    render(<Harness expected="github" />);
    await userEvent.click(screen.getByRole("button", { name: "open" }));
    await userEvent.type(screen.getByRole("textbox"), "github");
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByTestId("out")).toHaveTextContent("confirmed");
  });

  it("Delete button stays disabled until typed text matches expectedText exactly", async () => {
    render(<Harness expected="github" />);
    await userEvent.click(screen.getByRole("button", { name: "open" }));
    const confirmBtn = screen.getByRole("button", { name: "Delete" });
    expect(confirmBtn).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox"), "githu");
    expect(confirmBtn).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox"), "b");
    expect(confirmBtn).not.toBeDisabled();
  });

  it("resolves false when user clicks Cancel", async () => {
    render(<Harness expected="x" />);
    await userEvent.click(screen.getByRole("button", { name: "open" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByTestId("out")).toHaveTextContent("cancelled");
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd packages/ui && bunx vitest run test/hooks/useConfirm.test.tsx && cd ../..
```

- [ ] **Step 3: Create the hook**

```tsx
import { useCallback, useState, type ReactNode } from "react";

export interface ConfirmOptions {
  readonly title: string;
  readonly description: string;
  /** When set, the user must type this exact string to enable the confirm button. */
  readonly expectedText?: string;
  readonly confirmLabel: string;
}

interface InternalState {
  readonly options: ConfirmOptions;
  readonly resolve: (result: boolean) => void;
}

export function useConfirm(): ((options: ConfirmOptions) => Promise<boolean>) & {
  modal: ReactNode;
} {
  const [state, setState] = useState<InternalState | null>(null);
  const [typed, setTyped] = useState("");

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setTyped("");
        setState({ options, resolve });
      }),
    [],
  );

  const close = useCallback(
    (result: boolean) => {
      if (state !== null) state.resolve(result);
      setState(null);
      setTyped("");
    },
    [state],
  );

  const match = state?.options.expectedText;
  const canConfirm = match === undefined || typed === match;

  const modal: ReactNode =
    state === null ? null : (
      <div
        role="dialog"
        aria-modal="true"
        aria-label={state.options.title}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      >
        <div className="bg-[var(--color-bg)] rounded-md p-6 w-[420px] max-w-[90vw] border border-[var(--color-border)]">
          <h3 className="text-lg font-semibold mb-2">{state.options.title}</h3>
          <p className="text-sm text-[var(--color-text-muted)] mb-4">{state.options.description}</p>
          {match !== undefined && (
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              aria-label="confirmation"
              className="w-full px-3 py-2 rounded border border-[var(--color-border)] mb-4 bg-[var(--color-bg-subtle)]"
            />
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => close(false)}
              className="px-3 py-1 rounded border border-[var(--color-border)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => close(true)}
              disabled={!canConfirm}
              className="px-3 py-1 rounded bg-[var(--color-danger-bg)] text-[var(--color-danger-text)] disabled:opacity-50"
            >
              {state.options.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    );

  return Object.assign(confirm, { modal });
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd packages/ui && bunx vitest run test/hooks/useConfirm.test.tsx && cd ../..
```

### Task 26: `ProfilesPanel` (TDD)

**Files:**
- Create: `packages/ui/src/pages/settings/ProfilesPanel.tsx`
- Create: `packages/ui/test/pages/settings/ProfilesPanel.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/ipc/client");
import {
  profileCreateMock,
  profileDeleteMock,
  profileListMock,
  profileSwitchMock,
} from "../../../src/ipc/__mocks__/client";
import { ProfilesPanel } from "../../../src/pages/settings/ProfilesPanel";
import { useNimbusStore } from "../../../src/store";

function renderPanel() {
  return render(
    <MemoryRouter>
      <ProfilesPanel />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  profileListMock.mockReset();
  profileCreateMock.mockReset();
  profileSwitchMock.mockReset();
  profileDeleteMock.mockReset();
  useNimbusStore.setState({
    active: null,
    profiles: [],
    lastFetchAt: null,
    actionInFlight: false,
    connectionState: "connected",
  } as never);
});

describe("ProfilesPanel", () => {
  it("fetches and renders profiles on mount", async () => {
    profileListMock.mockResolvedValueOnce({
      profiles: [{ name: "default" }, { name: "work" }],
      active: "default",
    });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("default")).toBeInTheDocument();
      expect(screen.getByText("work")).toBeInTheDocument();
    });
    expect(screen.getByText(/active/i)).toBeInTheDocument();
  });

  it("create flow calls profileCreate then refetches the list", async () => {
    profileListMock
      .mockResolvedValueOnce({ profiles: [{ name: "default" }], active: "default" })
      .mockResolvedValueOnce({
        profiles: [{ name: "default" }, { name: "scratch" }],
        active: "default",
      });
    profileCreateMock.mockResolvedValueOnce({ name: "scratch" });
    renderPanel();
    await waitFor(() => screen.getByText("default"));
    await userEvent.click(screen.getByRole("button", { name: /create…/i }));
    await userEvent.type(screen.getByLabelText(/profile name/i), "scratch");
    await userEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() => expect(profileCreateMock).toHaveBeenCalledWith("scratch"));
    await waitFor(() => expect(screen.getByText("scratch")).toBeInTheDocument());
  });

  it("switch flow calls profileSwitch with the chosen name", async () => {
    profileListMock.mockResolvedValueOnce({
      profiles: [{ name: "default" }, { name: "work" }],
      active: "default",
    });
    profileSwitchMock.mockResolvedValueOnce({ active: "work" });
    renderPanel();
    await waitFor(() => screen.getByText("work"));
    const switchBtn = screen.getByRole("button", { name: "Switch to work" });
    await userEvent.click(switchBtn);
    await waitFor(() => expect(profileSwitchMock).toHaveBeenCalledWith("work"));
  });

  it("delete requires typed-name confirmation", async () => {
    profileListMock.mockResolvedValueOnce({
      profiles: [{ name: "default" }, { name: "scratch" }],
      active: "default",
    });
    profileDeleteMock.mockResolvedValueOnce({ deleted: "scratch" });
    renderPanel();
    await waitFor(() => screen.getByText("scratch"));
    await userEvent.click(screen.getByRole("button", { name: "Delete scratch" }));
    const delConfirm = await screen.findByRole("button", { name: "Delete" });
    expect(delConfirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/confirmation/i), "scratch");
    expect(delConfirm).not.toBeDisabled();
    await userEvent.click(delConfirm);
    await waitFor(() => expect(profileDeleteMock).toHaveBeenCalledWith("scratch"));
  });

  it("disables all write controls when connectionState is disconnected", async () => {
    profileListMock.mockResolvedValueOnce({
      profiles: [{ name: "default" }],
      active: "default",
    });
    renderPanel();
    await waitFor(() => screen.getByText("default"));
    useNimbusStore.setState({ connectionState: "disconnected" } as never);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /create…/i })).toBeDisabled(),
    );
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd packages/ui && bunx vitest run test/pages/settings/ProfilesPanel.test.tsx && cd ../..
```

- [ ] **Step 3: Create the panel**

```tsx
import { useCallback, useEffect, useState } from "react";
import { PanelError } from "../../components/settings/PanelError";
import { PanelHeader } from "../../components/settings/PanelHeader";
import { StaleChip } from "../../components/settings/StaleChip";
import { useConfirm } from "../../hooks/useConfirm";
import { createIpcClient } from "../../ipc/client";
import type { ProfileListResult, ProfileSummary } from "../../ipc/types";
import { useNimbusStore } from "../../store";

export function ProfilesPanel() {
  const profiles = useNimbusStore((s) => s.profiles);
  const active = useNimbusStore((s) => s.active);
  const actionInFlight = useNimbusStore((s) => s.actionInFlight);
  const connectionState = useNimbusStore((s) => s.connectionState);
  const setProfileList = useNimbusStore((s) => s.setProfileList);
  const setProfileActionInFlight = useNimbusStore((s) => s.setProfileActionInFlight);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const confirm = useConfirm();

  const offline = connectionState === "disconnected";
  const writeDisabled = offline || actionInFlight;

  const refresh = useCallback(async () => {
    try {
      const res: ProfileListResult = await createIpcClient().profileList();
      setProfileList(res);
      setFetchError(null);
    } catch (e) {
      setFetchError((e as Error).message);
    }
  }, [setProfileList]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onCreate = useCallback(async () => {
    if (newName.trim() === "") return;
    setProfileActionInFlight(true);
    try {
      await createIpcClient().profileCreate(newName.trim());
      setCreateOpen(false);
      setNewName("");
      await refresh();
    } finally {
      setProfileActionInFlight(false);
    }
  }, [newName, refresh, setProfileActionInFlight]);

  const onSwitch = useCallback(
    async (name: string) => {
      if (name === active) return;
      setProfileActionInFlight(true);
      try {
        await createIpcClient().profileSwitch(name);
        // The Gateway emits `profile.switched`; RootLayout's listener (Task 27)
        // calls `Tauri app.restart()` — no optimistic UI needed here.
      } finally {
        setProfileActionInFlight(false);
      }
    },
    [active, setProfileActionInFlight],
  );

  const onDelete = useCallback(
    async (name: string) => {
      const ok = await confirm({
        title: `Delete profile "${name}"`,
        description: `This cannot be undone. Type "${name}" to confirm.`,
        expectedText: name,
        confirmLabel: "Delete",
      });
      if (!ok) return;
      setProfileActionInFlight(true);
      try {
        await createIpcClient().profileDelete(name);
        await refresh();
      } finally {
        setProfileActionInFlight(false);
      }
    },
    [confirm, refresh, setProfileActionInFlight],
  );

  return (
    <section className="p-6 space-y-6">
      <PanelHeader
        title="Profiles"
        description="Named configurations — switch to change which Vault namespace Nimbus reads from."
        livePill={offline ? <StaleChip /> : undefined}
      />
      {fetchError !== null && (
        <PanelError
          message={`Failed to load profiles: ${fetchError}`}
          onRetry={() => void refresh()}
        />
      )}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          disabled={writeDisabled}
          className="px-3 py-1 rounded border border-[var(--color-border)] disabled:opacity-50"
        >
          Create…
        </button>
      </div>
      <ul className="divide-y divide-[var(--color-border)] border border-[var(--color-border)] rounded-md">
        {profiles.map((p: ProfileSummary) => (
          <li
            key={p.name}
            data-testid="profile-row"
            className="flex items-center justify-between px-4 py-3"
          >
            <div className="flex items-center gap-2">
              <span className="font-medium">{p.name}</span>
              {p.name === active && (
                <span className="text-xs rounded-full px-2 py-0.5 bg-[var(--color-accent-bg)] text-[var(--color-accent)]">
                  active
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                aria-label={`Switch to ${p.name}`}
                onClick={() => void onSwitch(p.name)}
                disabled={writeDisabled || p.name === active}
                className="px-2 py-1 text-sm rounded border border-[var(--color-border)] disabled:opacity-50"
              >
                Switch
              </button>
              <button
                type="button"
                aria-label={`Delete ${p.name}`}
                onClick={() => void onDelete(p.name)}
                disabled={writeDisabled || p.name === active}
                className="px-2 py-1 text-sm rounded border border-[var(--color-danger-border)] text-[var(--color-danger-text)] disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>

      {createOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Create profile"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        >
          <div className="bg-[var(--color-bg)] rounded-md p-6 w-[420px] border border-[var(--color-border)]">
            <h3 className="text-lg font-semibold mb-2">Create profile</h3>
            <label className="text-sm block mb-2" htmlFor="new-profile-name">
              Profile name
            </label>
            <input
              id="new-profile-name"
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full px-3 py-2 rounded border border-[var(--color-border)] bg-[var(--color-bg-subtle)] mb-4"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setCreateOpen(false);
                  setNewName("");
                }}
                className="px-3 py-1 rounded border border-[var(--color-border)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void onCreate()}
                disabled={newName.trim() === "" || actionInFlight}
                className="px-3 py-1 rounded bg-[var(--color-accent)] text-white disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
      {confirm.modal}
    </section>
  );
}
```

- [ ] **Step 4: Run the panel tests, expect PASS**

```bash
cd packages/ui && bunx vitest run test/pages/settings/ProfilesPanel.test.tsx && cd ../..
```

### Task 27: `profile://switched` listener in `RootLayout` → `restartApp()`

**Files:**
- Create: `packages/ui/src/lib/restart.ts`
- Modify: `packages/ui/src/layouts/RootLayout.tsx`
- Create: `packages/ui/test/layouts/RootLayout.profile-switched.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, listenMap } = vi.hoisted(() => ({
  invokeMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  listenMap: {} as Record<string, Array<(e: { payload: unknown }) => void>>,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, payload: unknown) => invokeMock(cmd, payload),
}));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async () => undefined),
  listen: vi.fn(async (event: string, cb: (e: { payload: unknown }) => void) => {
    (listenMap[event] ??= []).push(cb);
    return () => {
      listenMap[event] = (listenMap[event] ?? []).filter((x) => x !== cb);
    };
  }),
}));

const { restartAppMock } = vi.hoisted(() => ({ restartAppMock: vi.fn() }));
vi.mock("../../src/lib/restart", () => ({ restartApp: () => restartAppMock() }));

import { RootLayout } from "../../src/layouts/RootLayout";

beforeEach(() => {
  for (const k of Object.keys(listenMap)) delete listenMap[k];
  restartAppMock.mockReset();
  invokeMock.mockReset();
  invokeMock.mockResolvedValue([]);
});

describe("RootLayout — profile.switched → restartApp()", () => {
  it("calls restartApp() when profile://switched fires", async () => {
    render(
      <MemoryRouter>
        <RootLayout />
      </MemoryRouter>,
    );
    await waitFor(() => expect(listenMap["profile://switched"]).toBeDefined());
    for (const cb of listenMap["profile://switched"] ?? []) {
      cb({ payload: { name: "work" } });
    }
    await waitFor(() => expect(restartAppMock).toHaveBeenCalledTimes(1));
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd packages/ui && bunx vitest run test/layouts/RootLayout.profile-switched.test.tsx && cd ../..
```

Expected: failure because `../../src/lib/restart` module does not exist and `RootLayout` does not listen for `profile://switched`.

- [ ] **Step 3: Create the restart util**

Create `packages/ui/src/lib/restart.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";

/**
 * Tear down the whole Tauri process and relaunch it. Used on `profile.switched`
 * because the profile change alters the Vault key prefix, which invalidates MCP
 * client singletons, IPC subscription channels, and any module-scope cache —
 * `window.location.reload()` is insufficient because secondary windows (HITL popup,
 * Quick Query, onboarding) would keep serving stale profile data.
 *
 * In the Vitest jsdom environment there is no Tauri runtime; we swallow the error
 * and fall back to `window.location.reload()`. Most tests stub this module entirely.
 */
export async function restartApp(): Promise<void> {
  try {
    await invoke("plugin:app|restart");
  } catch {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  }
}
```

- [ ] **Step 4: Wire the listener into `RootLayout`**

Open `packages/ui/src/layouts/RootLayout.tsx`:

1. Add this import near the top with the other relative imports:

```tsx
import { restartApp } from "../lib/restart";
```

2. Inside the `RootLayout` component body, **after** the existing `useIpcSubscription<ConsentResolvedPayload>("consent://resolved", onConsentResolved);` line (around line 77), add:

```tsx
  const onProfileSwitched = useCallback(() => {
    void restartApp();
  }, []);
  useIpcSubscription<{ name: string }>("profile://switched", onProfileSwitched);
```

- [ ] **Step 5: Run the test, expect PASS**

```bash
cd packages/ui && bunx vitest run test/layouts/RootLayout.profile-switched.test.tsx && cd ../..
```

### Task 28: Commit Phase 7

- [ ] **Step 1: Commit**

```bash
git add packages/ui/src/hooks/useConfirm.tsx \
        packages/ui/src/pages/settings/ProfilesPanel.tsx \
        packages/ui/src/lib/restart.ts \
        packages/ui/src/layouts/RootLayout.tsx \
        packages/ui/src/App.tsx \
        packages/ui/src/pages/Settings.tsx \
        packages/ui/src/components/settings/PanelHeader.tsx \
        packages/ui/src/components/settings/PanelError.tsx \
        packages/ui/src/components/settings/StaleChip.tsx \
        packages/ui/src/components/settings/PanelComingSoon.tsx \
        packages/ui/src/components/settings/SettingsSidebar.tsx \
        packages/ui/test/hooks/useConfirm.test.tsx \
        packages/ui/test/pages/settings/ProfilesPanel.test.tsx \
        packages/ui/test/layouts/RootLayout.profile-switched.test.tsx \
        packages/ui/test/pages/Settings.test.tsx \
        packages/ui/test/components/settings/
git rm packages/ui/src/pages/stubs/SettingsStub.tsx
git commit -m "feat(ui): Settings shell + Profiles panel + profile.switched → app.restart"
```

---

## Phase 8 — Telemetry panel

### Task 29: `TelemetryPanel` (TDD)

**Files:**
- Create: `packages/ui/src/pages/settings/TelemetryPanel.tsx`
- Create: `packages/ui/test/pages/settings/TelemetryPanel.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/ipc/client");
import {
  telemetryGetStatusMock,
  telemetrySetEnabledMock,
} from "../../../src/ipc/__mocks__/client";
import { TelemetryPanel } from "../../../src/pages/settings/TelemetryPanel";
import { useNimbusStore } from "../../../src/store";

const ENABLED_PAYLOAD = {
  enabled: true as const,
  session_id: "preview-not-persisted",
  nimbus_version: "0.1.0",
  platform: "linux" as const,
  connector_error_rate: { github: 0.01 },
  connector_health_transitions: { github: 2 },
  query_latency_p50_ms: 3,
  query_latency_p95_ms: 14,
  query_latency_p99_ms: 22,
  agent_invocation_latency_p50_ms: 0,
  agent_invocation_latency_p95_ms: 0,
  sync_duration_p50_ms: {},
  cold_start_ms: 90,
  extension_installs_by_id: {},
  extension_uninstalls_by_id: {},
};

beforeEach(() => {
  localStorage.clear();
  telemetryGetStatusMock.mockReset();
  telemetrySetEnabledMock.mockReset();
  useNimbusStore.setState({
    status: null,
    telemetryActionInFlight: false,
    connectionState: "connected",
  } as never);
});

describe("TelemetryPanel", () => {
  it("renders disabled state when getStatus returns enabled=false", async () => {
    telemetryGetStatusMock.mockResolvedValueOnce({ enabled: false });
    render(<TelemetryPanel />);
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: /telemetry/i })).toHaveAttribute(
        "aria-checked",
        "false",
      ),
    );
  });

  it("renders counter cards when enabled", async () => {
    telemetryGetStatusMock.mockResolvedValueOnce(ENABLED_PAYLOAD);
    render(<TelemetryPanel />);
    await waitFor(() => expect(screen.getByText(/query p95/i)).toBeInTheDocument());
    expect(screen.getByText("14")).toBeInTheDocument();
  });

  it("toggling fires telemetrySetEnabled(false) and refetches", async () => {
    telemetryGetStatusMock
      .mockResolvedValueOnce(ENABLED_PAYLOAD)
      .mockResolvedValueOnce({ enabled: false });
    telemetrySetEnabledMock.mockResolvedValueOnce({ enabled: false });
    render(<TelemetryPanel />);
    await waitFor(() => screen.getByText(/query p95/i));
    await userEvent.click(screen.getByRole("switch", { name: /telemetry/i }));
    await waitFor(() => expect(telemetrySetEnabledMock).toHaveBeenCalledWith(false));
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: /telemetry/i })).toHaveAttribute(
        "aria-checked",
        "false",
      ),
    );
  });

  it("expander shows the raw JSON payload when opened", async () => {
    telemetryGetStatusMock.mockResolvedValueOnce(ENABLED_PAYLOAD);
    render(<TelemetryPanel />);
    await waitFor(() => screen.getByText(/query p95/i));
    await userEvent.click(screen.getByRole("button", { name: /view payload sample/i }));
    expect(screen.getByTestId("telemetry-payload-json")).toHaveTextContent(
      "preview-not-persisted",
    );
  });

  it("toggle is disabled when connectionState is disconnected", async () => {
    telemetryGetStatusMock.mockResolvedValueOnce({ enabled: false });
    render(<TelemetryPanel />);
    await waitFor(() => screen.getByRole("switch", { name: /telemetry/i }));
    useNimbusStore.setState({ connectionState: "disconnected" } as never);
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: /telemetry/i })).toBeDisabled(),
    );
  });
});
```

- [ ] **Step 2: Run, expect FAIL (module not found)**

```bash
cd packages/ui && bunx vitest run test/pages/settings/TelemetryPanel.test.tsx && cd ../..
```

- [ ] **Step 3: Create the panel**

```tsx
import { useCallback, useEffect, useState } from "react";
import { PanelError } from "../../components/settings/PanelError";
import { PanelHeader } from "../../components/settings/PanelHeader";
import { StaleChip } from "../../components/settings/StaleChip";
import { createIpcClient } from "../../ipc/client";
import type { TelemetryStatus } from "../../ipc/types";
import { useNimbusStore } from "../../store";

interface CounterCardProps {
  readonly label: string;
  readonly value: string | number;
  readonly unit?: string;
}

function CounterCard({ label, value, unit }: CounterCardProps) {
  return (
    <div className="p-3 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-subtle)]">
      <div className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{label}</div>
      <div className="text-xl font-semibold mt-1">
        {value}
        {unit !== undefined && <span className="ml-1 text-sm font-normal">{unit}</span>}
      </div>
    </div>
  );
}

export function TelemetryPanel() {
  const status = useNimbusStore((s) => s.status);
  const inFlight = useNimbusStore((s) => s.telemetryActionInFlight);
  const connectionState = useNimbusStore((s) => s.connectionState);
  const setStatus = useNimbusStore((s) => s.setTelemetryStatus);
  const setInFlight = useNimbusStore((s) => s.setTelemetryActionInFlight);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const offline = connectionState === "disconnected";
  const writeDisabled = offline || inFlight;

  const refresh = useCallback(async () => {
    try {
      const res: TelemetryStatus = await createIpcClient().telemetryGetStatus();
      setStatus(res);
      setFetchError(null);
    } catch (e) {
      setFetchError((e as Error).message);
    }
  }, [setStatus]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onToggle = useCallback(async () => {
    if (status === null) return;
    const target = !status.enabled;
    setInFlight(true);
    try {
      await createIpcClient().telemetrySetEnabled(target);
      await refresh();
    } finally {
      setInFlight(false);
    }
  }, [refresh, setInFlight, status]);

  const enabled = status?.enabled === true;

  return (
    <section className="p-6 space-y-6">
      <PanelHeader
        title="Telemetry"
        description="Opt-in, aggregate-only counters. No content, no payloads. The payload sample below is exactly what would be sent."
        livePill={offline ? <StaleChip /> : undefined}
      />
      {fetchError !== null && (
        <PanelError
          message={`Failed to load telemetry status: ${fetchError}`}
          onRetry={() => void refresh()}
        />
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Telemetry"
          onClick={() => void onToggle()}
          disabled={writeDisabled || status === null}
          className={[
            "relative inline-block w-12 h-6 rounded-full transition-colors",
            enabled ? "bg-[var(--color-accent)]" : "bg-[var(--color-border)]",
            "disabled:opacity-50",
          ].join(" ")}
        >
          <span
            className={[
              "absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform",
              enabled ? "translate-x-6" : "translate-x-0",
            ].join(" ")}
          />
        </button>
        <span className="text-sm">{enabled ? "Telemetry enabled" : "Telemetry disabled"}</span>
      </div>

      {status?.enabled === true && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <CounterCard label="Query p50" value={status.query_latency_p50_ms} unit="ms" />
            <CounterCard label="Query p95" value={status.query_latency_p95_ms} unit="ms" />
            <CounterCard label="Query p99" value={status.query_latency_p99_ms} unit="ms" />
            <CounterCard label="Cold start" value={status.cold_start_ms} unit="ms" />
          </div>

          <div>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-sm text-[var(--color-accent)] underline"
            >
              {expanded ? "Hide payload sample" : "View payload sample"}
            </button>
            {expanded && (
              <pre
                data-testid="telemetry-payload-json"
                className="mt-3 text-xs p-3 rounded-md bg-[var(--color-bg-subtle)] border border-[var(--color-border)] overflow-auto"
              >
                {JSON.stringify(status, null, 2)}
              </pre>
            )}
          </div>
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd packages/ui && bunx vitest run test/pages/settings/TelemetryPanel.test.tsx && cd ../..
```

### Task 30: Commit Phase 8

- [ ] **Step 1: Commit**

```bash
git add packages/ui/src/pages/settings/TelemetryPanel.tsx \
        packages/ui/test/pages/settings/TelemetryPanel.test.tsx
git commit -m "feat(ui): Telemetry panel with toggle, counter cards, and payload sample expander"
```

---

## Phase 9 — Full verification

### Task 31: typecheck + lint + unit + Rust tests + coverage

- [ ] **Step 1: Repo-wide checks**

```bash
bun run typecheck
bun run lint
bun test
cd packages/ui && bunx vitest run && cd ../..
cd packages/ui/src-tauri && cargo test && cd ../../..
```

Expected: every command exits 0. Pay particular attention to:
- Vitest — all new tests pass (client-ws5c, parse-error-redaction, slice tests, store-persist, settings primitives, SettingsSidebar, Settings layout, useConfirm, ProfilesPanel, TelemetryPanel, RootLayout.profile-switched).
- Rust `cargo test` — `ALLOWED_METHODS.len() == 38`; `NO_TIMEOUT_METHODS.len() == 4`; `GLOBAL_BROADCAST_METHODS.len() == 1`.
- Biome — no formatting drift.

- [ ] **Step 2: Coverage spot-check**

```bash
cd packages/ui && bunx vitest run --coverage && cd ../..
```

Must remain ≥ 80 % lines / ≥ 75 % branches (the existing `packages/ui` gate). If any new file falls short, add a targeted test; do not lower the gate.

### Task 32: Commit chain verification + push

- [ ] **Step 1: Expected commits on top of Plan 1**

```bash
git log --oneline dev/asafgolombek/phase_4_ws5..HEAD
```

Expected (order of the newest 6 matters; exact SHAs vary):

```
xxxxxxx feat(ui): Telemetry panel with toggle, counter cards, and payload sample expander
xxxxxxx feat(ui): Settings shell + Profiles panel + profile.switched → app.restart
xxxxxxx feat(ui-store): persist middleware with tested partialize whitelist (5 forbidden keys)
xxxxxxx feat(ui-store): settings/profile/telemetry slices + connectors/model persist stubs
xxxxxxx feat(ui-bridge): rebroadcast profile.switched as global Tauri event
xxxxxxx feat(ui-bridge): ALLOWED_METHODS grows to 38 + NO_TIMEOUT_METHODS for long ops
xxxxxxx feat(ui-ipc): profile + telemetry wrappers + parseError secret redaction
(... 8 Plan 1 commits below ...)
```

- [ ] **Step 2: Push**

```bash
git push
```

Do NOT open the PR yet. Plans 3–5 will add Connectors / Model / Audit / Updates / Data panels to the same branch. The single WS5-C UI PR opens after Plan 5 lands.

---

## Completion criteria

Plan 2 is complete when every checkbox above is ticked **and**:

- [ ] `bun run typecheck` passes at the repo root.
- [ ] `bun run lint` passes at the repo root.
- [ ] `bun test` passes at the repo root.
- [ ] `bunx vitest run` passes in `packages/ui/` with coverage ≥ 80 % lines / ≥ 75 % branches.
- [ ] `cargo test` passes in `packages/ui/src-tauri/`, including the new allowlist / no-timeout / global-broadcast assertions.
- [ ] Seven commits from this plan appear on `dev/asafgolombek/ws5c-ui` on top of the eight Plan 1 commits.
- [ ] The branch is pushed to origin.

After completion, proceed to **Plan 3** (not yet written). Suggested scope: Connectors panel + Model panel (spec §7 commits 6 and 7).

---

## Notes carried forward

### For the eventual WS5-C UI PR description

When Plan 5 opens the single WS5-C UI PR, three points from this plan belong in the PR body above the feature scope:

1. **`persist` partialize has a dual whitelist + blocklist by design.** The whitelist enforces "only these five root keys may be persisted"; the blocklist re-strips five forbidden secret names even if a future slice introduces a field that collides with a whitelisted name. Both exist for v0.1.0 defence in depth — do not simplify to one without an explicit security review.
2. **`profile.switched` is the only notification rebroadcast globally.** `GLOBAL_BROADCAST_METHODS` is held to exactly one entry, asserted by `global_broadcast_methods_exact_size`. Expanding it (e.g. to fan HITL or health events out to every window) would amplify cross-window traffic and must be justified; the test will fail on addition and force the conversation.
3. **`parseError` now redacts five credential field names inside error strings.** Extending `FORBIDDEN_VALUE_KEYS` is cheap but deleting entries is a breaking safety change — any removal requires a new security-review note.

### Known deferrals from this plan

- The Settings sidebar exposes all seven panel routes today, but five render `PanelComingSoon`. The Model / Connectors / Audit / Updates / Data panels ship in later plans and replace the placeholder routes atomically — no route surface changes.
- `connectors` and `model` slices exist only to carry their persisted fields; their full reducers and IPC bindings ship with the matching panel plan.
- The main-sidebar "Settings" entry is unchanged from WS5-B — no Settings-specific badge. If the Updates panel needs an update-available badge on the outer sidebar, that lives in the Updates plan, not here.
- **Profile-switch-during-in-flight-operation warning** — if the user clicks *Switch* on a profile while `llm.pullModel`, `data.export`, `data.import`, or `updater.applyUpdate` is active, the `profile.switch` call fires immediately and `app.restart()` tears down the UI. The Gateway's in-flight operation continues under the pre-switch profile briefly, then the new profile's vault prefix takes effect. Adding a blocking "you have an in-flight operation" confirmation requires cross-slice in-flight tracking (pull progress + export progress + import progress + updater apply state) that does not all land until later plans. Track this as a WS5-C-final polish item; not a Plan 2 blocker. Data safety is covered by the Gateway's stage-and-swap contract, so the concern is UX (lost progress visibility), not correctness.
