# Security Fixes — High-tier (PR 1 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all 16 High-severity security findings across 5 root-cause commits on branch `dev/asafgolombek/fixing_security_issues`.

**Architecture:** Five independently committable groups in sequence: G1 strips `process.env` spreads from MCP child spawns; G2 extracts a `gate()` method from `ToolExecutor` and routes `data.delete`/`connector.remove` through it; G3 adds `extension.install`/`connector.addMcp` to the HITL gate and removes WebView install access; G4 wires the LAN allowlist that was built but never called; G5 guards the dev updater key from production and re-checks semver before download.

**Tech Stack:** Bun v1.2+ / TypeScript 6.x strict, Biome linter, `bun:test`. G3 also touches Rust (Tauri 2.0 `gateway_bridge.rs`) and `tauri.conf.json`.

---

## File map

| File | Groups | Change |
|---|---|---|
| `packages/gateway/src/extensions/spawn-env.ts` | G1 | Rewrite — add BASELINE_KEYS from `process.env` |
| `packages/gateway/src/extensions/spawn-env.test.ts` | G1 | Extend — baseline present, gateway secrets absent |
| `packages/gateway/src/connectors/lazy-mesh.ts` | G1 | Delete `compactProcessEnv`; replace all 29 spread sites |
| `packages/gateway/src/engine/executor.ts` | G2, G3 | Fix TS narrowing; extract `gate()`; add 6 HITL entries |
| `packages/gateway/src/engine/engine.test.ts` | G2, G3 | Tests for `gate()` + new HITL entries |
| `packages/gateway/src/commands/data-delete.ts` | G2 | Remove hardcoded `hitlStatus:"approved"` audit call |
| `packages/gateway/src/ipc/data-rpc.ts` | G2 | Add `toolExecutor` to context; call `gate()` before delete |
| `packages/gateway/src/ipc/connector-rpc.ts` | G2, G3 | Add `toolExecutor`; call `gate()` before `remove` + `addMcp` |
| `packages/gateway/src/ipc/server.ts` | G2, G3 | Create per-client `ToolExecutor`; thread to data + connector |
| `packages/gateway/src/ipc/lan-rpc.ts` | G3, G4 | Expand `FORBIDDEN_OVER_LAN`; reconcile `WRITE_METHODS` |
| `packages/gateway/src/ipc/lan-rpc.test.ts` | G3, G4 | Tests for new forbidden namespaces |
| `packages/gateway/src/ipc/lan-server.ts` | G4 | Wire `checkLanMethodAllowed` in `handleEncryptedMessage` |
| `packages/gateway/src/ipc/lan-server.test.ts` | G4 | Tests: forbidden method blocked; write method blocked/allowed |
| `packages/gateway/src/config/nimbus-toml.ts` | G4 | Change `bind` default to `"127.0.0.1"` |
| `packages/gateway/src/config/nimbus-toml-lan.test.ts` | G4 | Assert default bind is loopback |
| `packages/gateway/src/updater/public-key.ts` | G5 | Throw if `NIMBUS_DEV_UPDATER_PUBLIC_KEY` set in production |
| `packages/gateway/src/updater/updater.ts` | G5 | Re-check semver in `applyUpdate()` before download |
| `packages/gateway/src/updater/updater.test.ts` | G5 | Tests for guard + semver re-check |
| `packages/ui/src-tauri/src/gateway_bridge.rs` | G3 | Remove `"extension.install"`; update length assertion to 55 |
| `packages/ui/src-tauri/tauri.conf.json` | G3 | Set `app.security.csp` to restrict scripts + connections |

---

## Task 1 — G1: Add failing tests for spawn-env baseline vars

**Files:**
- Modify: `packages/gateway/src/extensions/spawn-env.test.ts`

- [ ] **Step 1: Add three new failing tests to the existing `describe` block**

Open `packages/gateway/src/extensions/spawn-env.test.ts` and add after the existing test:

```typescript
  test("output includes PATH baseline var from process.env", () => {
    const e = extensionProcessEnv({});
    expect(e["PATH"]).toBe(process.env["PATH"]);
  });

  test("output excludes ANTHROPIC_API_KEY even when set in process.env", () => {
    const prev = process.env["ANTHROPIC_API_KEY"];
    process.env["ANTHROPIC_API_KEY"] = "sk-test-secret";
    try {
      const e = extensionProcessEnv({});
      expect(e["ANTHROPIC_API_KEY"]).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env["ANTHROPIC_API_KEY"];
      else process.env["ANTHROPIC_API_KEY"] = prev;
    }
  });

  test("output excludes NIMBUS_DEV_UPDATER_PUBLIC_KEY even when set in process.env", () => {
    const prev = process.env["NIMBUS_DEV_UPDATER_PUBLIC_KEY"];
    process.env["NIMBUS_DEV_UPDATER_PUBLIC_KEY"] = "base64keyoverride";
    try {
      const e = extensionProcessEnv({});
      expect(e["NIMBUS_DEV_UPDATER_PUBLIC_KEY"]).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env["NIMBUS_DEV_UPDATER_PUBLIC_KEY"];
      else process.env["NIMBUS_DEV_UPDATER_PUBLIC_KEY"] = prev;
    }
  });
```

- [ ] **Step 2: Run to confirm the new tests fail**

```bash
bun test packages/gateway/src/extensions/spawn-env.test.ts
```

Expected: the two new tests fail ("output includes PATH baseline var", "output excludes NIMBUS_DEV_UPDATER_PUBLIC_KEY") — the third ("excludes ANTHROPIC_API_KEY") may pass already since the current implementation only copies injected keys.

---

## Task 2 — G1: Rewrite spawn-env.ts with BASELINE_KEYS

**Files:**
- Modify: `packages/gateway/src/extensions/spawn-env.ts`

- [ ] **Step 1: Replace the entire file content**

```typescript
/**
 * Build env for MCP child processes: BASELINE_KEYS from host plus caller-supplied extras only.
 * No `process.env` spread — gateway-private vars (API keys, updater overrides) must not leak.
 */
const BASELINE_KEYS = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TEMP",
  "TMP",
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
  "SYSTEMROOT",
  "BUN_INSTALL",
  "LANG",
  "TZ",
] as const;

export function extensionProcessEnv(
  extra: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of BASELINE_KEYS) {
    const v = process.env[k];
    if (v !== undefined) out[k] = v;
  }
  for (const [k, v] of Object.entries(extra)) {
    out[k] = v;
  }
  return out;
}
```

- [ ] **Step 2: Run tests to confirm all four pass**

```bash
bun test packages/gateway/src/extensions/spawn-env.test.ts
```

Expected: 4 tests pass including the previously failing "PATH baseline" test.

---

## Task 3 — G1: Replace all process.env spreads in lazy-mesh.ts

**Files:**
- Modify: `packages/gateway/src/connectors/lazy-mesh.ts`

The file currently has `compactProcessEnv()` (which spreads all of `process.env`) and ~29 direct `{ ...process.env, KEY: value }` spreads. This task replaces all of them.

- [ ] **Step 1: Add import at the top of lazy-mesh.ts**

Add after the last existing import:
```typescript
import { extensionProcessEnv } from "../extensions/spawn-env.ts";
```

- [ ] **Step 2: Delete compactProcessEnv helper (lines 58–70)**

Remove the entire function:
```typescript
/** MCP stdio `env` must be `Record<string, string>` (no undefined values). */
function compactProcessEnv(extra: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) {
      out[k] = v;
    }
  }
  for (const [k, v] of Object.entries(extra)) {
    out[k] = v;
  }
  return out;
}
```

- [ ] **Step 3: Add env to the filesystem connector (line ~105–112)**

Change:
```typescript
    this.filesystem = new MCPClient({
      servers: {
        filesystem: {
          command: "bunx",
          args: ["@modelcontextprotocol/server-filesystem", paths.dataDir],
        },
      },
    });
```
To:
```typescript
    this.filesystem = new MCPClient({
      servers: {
        filesystem: {
          command: "bunx",
          args: ["@modelcontextprotocol/server-filesystem", paths.dataDir],
          env: extensionProcessEnv({}),
        },
      },
    });
```

- [ ] **Step 4: Fix user MCP connector (line ~210)**

Change:
```typescript
          env: { ...process.env } as Record<string, string>,
```
To:
```typescript
          env: extensionProcessEnv({}),
```

- [ ] **Step 5: Replace compactProcessEnv calls in Phase 3 bundle methods**

Each `phase3Add*` method uses `compactProcessEnv(extra)`. Replace them:

| Location | Old | New |
|---|---|---|
| `phase3AddAwsMcp` | `env: compactProcessEnv(extra)` | `env: extensionProcessEnv(extra)` |
| `phase3AddAzureMcp` | `env: compactProcessEnv({AZURE_TENANT_ID: azT, AZURE_CLIENT_ID: azC, AZURE_CLIENT_SECRET: azS})` | `env: extensionProcessEnv({AZURE_TENANT_ID: azT, AZURE_CLIENT_ID: azC, AZURE_CLIENT_SECRET: azS})` |
| `phase3AddGcpMcp` | `env: compactProcessEnv({ GOOGLE_APPLICATION_CREDENTIALS: gcpPath })` | `env: extensionProcessEnv({ GOOGLE_APPLICATION_CREDENTIALS: gcpPath })` |
| `phase3AddIacMcp` | `env: compactProcessEnv({})` | `env: extensionProcessEnv({})` |
| `phase3AddGrafanaMcp` | `env: compactProcessEnv({ GRAFANA_URL: gfu, GRAFANA_API_TOKEN: gtk })` | `env: extensionProcessEnv({ GRAFANA_URL: gfu, GRAFANA_API_TOKEN: gtk })` |
| `phase3AddSentryMcp` | `env: compactProcessEnv(extra)` | `env: extensionProcessEnv(extra)` |
| `phase3AddNewrelicMcp` | `env: compactProcessEnv({ NEW_RELIC_API_KEY: nrKey })` | `env: extensionProcessEnv({ NEW_RELIC_API_KEY: nrKey })` |
| `phase3AddDatadogMcp` | `env: compactProcessEnv(extra)` | `env: extensionProcessEnv(extra)` |
| `ensureKubernetesRunning` | `env: compactProcessEnv(kubeExtra)` | `env: extensionProcessEnv(kubeExtra)` |

- [ ] **Step 6: Fix Google bundle (ensureGoogleDriveRunning)**

Change three identical blocks. Each looks like:
```typescript
          env: { ...process.env, GOOGLE_OAUTH_ACCESS_TOKEN: token },
```
Replace all three (google_drive, gmail, google_photos) with:
```typescript
          env: extensionProcessEnv({ GOOGLE_OAUTH_ACCESS_TOKEN: token }),
```

- [ ] **Step 7: Fix Microsoft bundle (ensureMicrosoftBundleRunning)**

The `outlookEnv` object is built with `{ ...process.env, ... }`. Replace the entire block:

Old:
```typescript
    const outlookEnv = {
      ...process.env,
      MICROSOFT_OAUTH_ACCESS_TOKEN: token,
    } as Record<string, string>;
    if (outlookScopes !== undefined) {
      outlookEnv["MICROSOFT_OAUTH_SCOPES"] = outlookScopes;
    }
```
New:
```typescript
    const outlookEnv = extensionProcessEnv({
      MICROSOFT_OAUTH_ACCESS_TOKEN: token,
      ...(outlookScopes !== undefined ? { MICROSOFT_OAUTH_SCOPES: outlookScopes } : {}),
    });
```

Also replace the two `onedrive` and `teams` entries:
```typescript
            env: { ...process.env, MICROSOFT_OAUTH_ACCESS_TOKEN: token },
```
→
```typescript
            env: extensionProcessEnv({ MICROSOFT_OAUTH_ACCESS_TOKEN: token }),
```

- [ ] **Step 8: Fix GitHub, GitLab, Bitbucket**

GitHub (two entries, same token `pat`):
```typescript
            env: { ...process.env, GITHUB_PAT: pat },
```
→
```typescript
            env: extensionProcessEnv({ GITHUB_PAT: pat }),
```

GitLab — the `gitlabServerEnv` variable is built with a ternary:
```typescript
    const gitlabServerEnv =
      trimmedBase === null
        ? { ...process.env, GITLAB_PAT: pat }
        : { ...process.env, GITLAB_PAT: pat, GITLAB_API_BASE_URL: trimmedBase };
```
Replace with:
```typescript
    const gitlabServerEnv = extensionProcessEnv(
      trimmedBase === null
        ? { GITLAB_PAT: pat }
        : { GITLAB_PAT: pat, GITLAB_API_BASE_URL: trimmedBase },
    );
```

Bitbucket:
```typescript
            env: {
              ...process.env,
              BITBUCKET_USERNAME: user,
              BITBUCKET_APP_PASSWORD: pass,
            },
```
→
```typescript
            env: extensionProcessEnv({
              BITBUCKET_USERNAME: user,
              BITBUCKET_APP_PASSWORD: pass,
            }),
```

- [ ] **Step 9: Fix remaining service connectors (Slack, Linear, Jira, Notion, Confluence, Discord, Jenkins, CircleCI, PagerDuty)**

Pattern: every `{ ...process.env, KEY: value }` → `extensionProcessEnv({ KEY: value })`.

| Method | Keys |
|---|---|
| `ensureSlackRunning` | `SLACK_USER_ACCESS_TOKEN: token` |
| `ensureLinearRunning` | `LINEAR_API_KEY: apiKey` |
| `ensureJiraRunning` | `JIRA_API_TOKEN: token, JIRA_EMAIL: email, JIRA_BASE_URL: baseUrl` |
| `ensureNotionRunning` | `NOTION_ACCESS_TOKEN: accessToken` |
| `ensureConfluenceRunning` | `CONFLUENCE_API_TOKEN: token, CONFLUENCE_EMAIL: em, CONFLUENCE_BASE_URL: baseUrl` |
| `ensureDiscordRunning` | `DISCORD_BOT_TOKEN: token` |
| `ensureJenkinsRunning` | `JENKINS_BASE_URL: base, JENKINS_USERNAME: user.trim(), JENKINS_API_TOKEN: token.trim()` |
| `ensureCircleciRunning` | `CIRCLECI_API_TOKEN: tok.trim()` |
| `ensurePagerdutyRunning` | `PAGERDUTY_API_TOKEN: tok.trim()` |

- [ ] **Step 10: Run typecheck to verify no type errors**

```bash
bun run typecheck 2>&1 | grep lazy-mesh
```

Expected: no errors from `lazy-mesh.ts`.

---

## Task 4 — G1: Run tests and commit

**Files:** No new changes — validate and commit.

- [ ] **Step 1: Run spawn-env tests**

```bash
bun test packages/gateway/src/extensions/spawn-env.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 2: Run full test suite to catch regressions**

```bash
bun test
```

Expected: all tests pass (lazy-mesh does not have its own unit test file; coverage is indirect through integration tests).

- [ ] **Step 3: Commit G1**

```bash
git add packages/gateway/src/extensions/spawn-env.ts \
        packages/gateway/src/extensions/spawn-env.test.ts \
        packages/gateway/src/connectors/lazy-mesh.ts
git commit -m "fix(security): isolate MCP child process env (G1)

Closes S2-F1 / S7-F1 / S8-F1. Reduces blast radius of C1/C2/C3.

- Extend extensionProcessEnv() in spawn-env.ts: baseline OS vars
  (PATH, HOME, TMPDIR, APPDATA, etc.) + caller-supplied extras only.
  No process.env spread — gateway secrets (ANTHROPIC_API_KEY,
  NIMBUS_DEV_UPDATER_PUBLIC_KEY, OAuth client IDs) cannot leak into
  MCP child processes.
- Delete compactProcessEnv() from lazy-mesh.ts (was the vulnerability).
- Replace all 29 process.env spreads across lazy-mesh.ts with
  extensionProcessEnv(). Filesystem connector gains explicit env.
- Add tests: PATH present, ANTHROPIC_API_KEY absent,
  NIMBUS_DEV_UPDATER_PUBLIC_KEY absent even when set.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5 — G2: Fix TypeScript narrowing bug in executor.ts

The `ae27fe9` commit introduced `const resolvedToolId = action.payload?.["mcpToolId"] ?? action.type`. Because `action.payload` is `Record<string, unknown>`, the indexed access returns `unknown`, and `unknown ?? string` yields `unknown`. `HITL_REQUIRED.has()` (typed as `ReadonlySet<string>.has(value: string)`) then fails TypeScript strict-mode check `TS2345`.

**Files:**
- Modify: `packages/gateway/src/engine/executor.ts`

- [ ] **Step 1: Run typecheck to confirm the error is present**

```bash
bun run typecheck 2>&1 | grep executor
```

Expected: `error TS2345: Argument of type 'unknown' is not assignable to parameter of type 'string'` at or near line 180.

(If the error is absent, skip to Task 6 — the fix may already be in a different branch state.)

- [ ] **Step 2: Apply the narrowing fix (lines 178–180 in executor.ts)**

Change:
```typescript
    const resolvedToolId = action.payload?.["mcpToolId"] ?? action.type;
    const requiresHITL = HITL_REQUIRED.has(resolvedToolId);
```
To:
```typescript
    const rawToolId = action.payload?.["mcpToolId"];
    const resolvedToolId = typeof rawToolId === "string" ? rawToolId : action.type;
    const requiresHITL = HITL_REQUIRED.has(resolvedToolId);
```

- [ ] **Step 3: Confirm typecheck passes**

```bash
bun run typecheck 2>&1 | grep executor
```

Expected: no output (no errors).

---

## Task 6 — G2: Extract gate(), add HITL entries to executor.ts

**Files:**
- Modify: `packages/gateway/src/engine/executor.ts`

The `execute()` method mixes consent + audit logic (reusable) with MCP dispatch (not reusable for IPC-native ops). This task extracts a `gate()` method.

Also adds four new entries to `HITL_REQUIRED_BACKING`: `data.delete`, `connector.remove`, `extension.install`, `connector.addMcp`.

- [ ] **Step 1: Add entries to HITL_REQUIRED_BACKING**

In the set declaration, add after `"incident.resolve"`:
```typescript
  // IPC-native destructive operations
  "data.delete",
  "connector.remove",
  "extension.install",
  "connector.addMcp",
```

- [ ] **Step 2: Add the gate() method to ToolExecutor**

Replace the `execute()` method with the `gate()` method followed by a refactored `execute()`:

```typescript
  /**
   * Runs the HITL consent gate and writes the audit record.
   * Returns `"proceed"` when the action is approved or not gate-required.
   * Returns an `ActionResult` with status `"rejected"` when the user declines
   * or the consent channel disconnects — audit already written, do NOT write again.
   *
   * Use this when the caller owns execution (not MCP dispatch). For MCP dispatch
   * use `execute()` which calls `gate()` internally.
   */
  async gate(action: PlannedAction): Promise<ActionResult | "proceed"> {
    const rawToolId = action.payload?.["mcpToolId"];
    const resolvedToolId = typeof rawToolId === "string" ? rawToolId : action.type;
    const requiresHITL = HITL_REQUIRED.has(resolvedToolId);

    let hitlStatus: "approved" | "rejected" | "not_required";
    let rejectReason: string | undefined;
    let auditExtras: { hitlRejectReason?: string } | undefined;

    try {
      if (requiresHITL) {
        const details =
          action.payload === undefined
            ? undefined
            : (redactPayloadForConsentDisplay(action.payload) as Record<string, unknown>);
        const approved = await this.consent.requestApproval(formatConsentPrompt(action), details);
        hitlStatus = approved ? "approved" : "rejected";
        if (!approved) rejectReason = "User declined consent gate.";
      } else {
        hitlStatus = "not_required";
      }
    } catch (e) {
      if (e instanceof ConsentDisconnectedError) {
        hitlStatus = "rejected";
        rejectReason = e.message;
        auditExtras = { hitlRejectReason: e.hitlAuditReason };
      } else {
        throw e;
      }
    }

    // ALWAYS write audit record BEFORE any execution
    this.audit.recordAudit({
      actionType: action.type,
      hitlStatus,
      actionJson: auditPayload(action, auditExtras),
      timestamp: Date.now(),
    });

    if (hitlStatus === "rejected") {
      return { status: "rejected", reason: rejectReason ?? "User declined consent gate." };
    }
    return "proceed";
  }

  async execute(action: PlannedAction): Promise<ActionResult> {
    const gateResult = await this.gate(action);
    if (gateResult !== "proceed") return gateResult;
    const result = await this.connectors.dispatch(action);
    return { status: "ok", result };
  }
```

The old `execute()` body can be deleted entirely — it is fully replaced by the `gate()` + new `execute()` above.

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck 2>&1 | grep executor
```

Expected: no errors.

---

## Task 7 — G2: Add gate() tests and HITL entry tests

**Files:**
- Modify: `packages/gateway/src/engine/engine.test.ts`

- [ ] **Step 1: Write failing tests first**

Add a new `describe("ToolExecutor.gate()")` block at the end of the test file, before any closing braces:

```typescript
describe("ToolExecutor.gate()", () => {
  test("gate() returns 'proceed' for non-gated action without calling consent", async () => {
    const m = createMocks(true);
    const exec = new ToolExecutor(m.consent, m.audit, m.connectors);
    const result = await exec.gate({ type: "filesystem.search" });
    expect(result).toBe("proceed");
    expect(m.consentCalls.length).toBe(0);
    expect(m.auditCalls[0]?.hitlStatus).toBe("not_required");
  });

  test("gate() returns 'proceed' for gated action when approved", async () => {
    const m = createMocks(true);
    const exec = new ToolExecutor(m.consent, m.audit, m.connectors);
    const result = await exec.gate({ type: "data.delete", payload: { service: "github" } });
    expect(result).toBe("proceed");
    expect(m.consentCalls.length).toBe(1);
    expect(m.auditCalls[0]?.hitlStatus).toBe("approved");
    expect(m.dispatchCalls.length).toBe(0); // gate() does not dispatch
  });

  test("gate() returns rejected ActionResult when user declines", async () => {
    const m = createMocks(false);
    const exec = new ToolExecutor(m.consent, m.audit, m.connectors);
    const result = await exec.gate({ type: "connector.remove", payload: { serviceId: "github" } });
    expect(result).not.toBe("proceed");
    expect((result as { status: string }).status).toBe("rejected");
    expect(m.auditCalls[0]?.hitlStatus).toBe("rejected");
    expect(m.dispatchCalls.length).toBe(0);
  });

  test("execute() does not dispatch when gate rejects", async () => {
    const m = createMocks(false);
    const exec = new ToolExecutor(m.consent, m.audit, m.connectors);
    const result = await exec.execute({ type: "data.delete", payload: { service: "github" } });
    expect(result.status).toBe("rejected");
    expect(m.dispatchCalls.length).toBe(0);
  });
});

describe("HITL_REQUIRED new entries (G2/G3)", () => {
  for (const t of ["data.delete", "connector.remove", "extension.install", "connector.addMcp"]) {
    test(`HITL_REQUIRED includes ${t}`, () => {
      expect(HITL_REQUIRED.has(t)).toBe(true);
    });
  }
});
```

- [ ] **Step 2: Run tests to confirm they fail (gate() method doesn't exist yet)**

```bash
bun test packages/gateway/src/engine/engine.test.ts
```

Expected: failures on `gate()` tests; HITL entry tests may fail too.

- [ ] **Step 3: Run tests again after Task 6 is complete**

```bash
bun test packages/gateway/src/engine/engine.test.ts
```

Expected: all tests pass.

---

## Task 8 — G2: Remove hardcoded audit from data-delete.ts

**Files:**
- Modify: `packages/gateway/src/commands/data-delete.ts`

The `runDataDelete` function writes its own audit record with `hitlStatus: "approved"` hardcoded. After G2, the audit is written by `gate()` before `runDataDelete` is called. The function must no longer write its own record.

- [ ] **Step 1: Remove the audit call (lines 80–89)**

Delete this block from `runDataDelete`:

```typescript
  input.index.recordAudit({
    actionType: "data.delete",
    hitlStatus: "approved",
    actionJson: JSON.stringify({
      service: input.service,
      itemsDeleted: preflight.itemsToDelete,
      vaultEntriesDeleted: preflight.vaultEntriesToDelete,
    }),
    timestamp: Date.now(),
  });
```

- [ ] **Step 2: Run data-delete tests to confirm they still pass**

```bash
bun test packages/gateway/src/commands/data-delete.test.ts
```

Expected: all tests pass (they don't check audit records directly).

---

## Task 9 — G2: Thread ToolExecutor into data-rpc.ts

**Files:**
- Modify: `packages/gateway/src/ipc/data-rpc.ts`

- [ ] **Step 1: Add toolExecutor import and to DataRpcContext**

Add to imports at the top:
```typescript
import type { ToolExecutor } from "../engine/executor.ts";
```

Add `toolExecutor` field to `DataRpcContext`:
```typescript
export type DataRpcContext = {
  index: LocalIndex | undefined;
  vault: NimbusVault | undefined;
  platform: "win32" | "darwin" | "linux";
  nimbusVersion: string;
  schemaVersion?: number;
  kdfParams?: KdfParams;
  notify?: (method: string, params: Record<string, unknown>) => void;
  /** Required for data.delete — runs HITL gate before deletion. */
  toolExecutor?: ToolExecutor;
};
```

- [ ] **Step 2: Update handleDataDelete to call gate() before deletion**

Replace `handleDataDelete`:
```typescript
async function handleDataDelete(
  rec: Record<string, unknown>,
  ctx: DataRpcContext,
): Promise<unknown> {
  const { index, vault } = requireDeps(ctx);
  const service = rec["service"];
  const dryRun = rec["dryRun"] === true;
  if (typeof service !== "string" || service === "")
    throw new DataRpcError(-32602, "Missing param: service");
  if (!dryRun) {
    const executor = ctx.toolExecutor;
    if (executor === undefined) {
      throw new DataRpcError(-32603, "data.delete requires a toolExecutor in context");
    }
    const gateResult = await executor.gate({
      type: "data.delete",
      payload: { service },
    });
    if (gateResult !== "proceed") {
      return gateResult;
    }
  }
  return runDataDelete({ service, dryRun, vault, index });
}
```

Note: dry-run calls skip the gate — they are read-only preflight checks, not actual deletions.

- [ ] **Step 3: Run typecheck**

```bash
bun run typecheck 2>&1 | grep data-rpc
```

Expected: no errors.

---

## Task 10 — G2: Thread ToolExecutor into connector-rpc.ts for connector.remove

**Files:**
- Modify: `packages/gateway/src/ipc/connector-rpc.ts`

- [ ] **Step 1: Add toolExecutor to the options type and dispatch call**

Add import at the top:
```typescript
import type { ToolExecutor } from "../engine/executor.ts";
```

Add `toolExecutor?: ToolExecutor` to the options object in `dispatchConnectorRpc`:

```typescript
export async function dispatchConnectorRpc(options: {
  method: string;
  params: unknown;
  vault: NimbusVault;
  localIndex: LocalIndex;
  openUrl: (url: string) => Promise<void>;
  syncScheduler: SyncScheduler | undefined;
  connectorMesh?: LazyConnectorMesh;
  notify?: (method: string, params: Record<string, unknown>) => void;
  toolExecutor?: ToolExecutor;
}): Promise<{ kind: "hit"; value: unknown } | { kind: "miss" }> {
```

- [ ] **Step 2: Gate connector.remove and connector.addMcp before dispatch**

In the switch statement, replace the `connector.remove` case:

```typescript
    case "connector.remove": {
      if (options.toolExecutor === undefined) {
        throw new ConnectorRpcError(-32603, "connector.remove requires a toolExecutor");
      }
      const gateResult = await options.toolExecutor.gate({
        type: "connector.remove",
        payload: { service: asRecord(options.params)?.["service"] },
      });
      if (gateResult !== "proceed") return { kind: "hit", value: gateResult };
      return handleConnectorRemove(ctx);
    }
    case "connector.addMcp": {
      if (options.toolExecutor === undefined) {
        throw new ConnectorRpcError(-32603, "connector.addMcp requires a toolExecutor");
      }
      const addMcpRec = asRecord(options.params) ?? {};
      const gateResult = await options.toolExecutor.gate({
        type: "connector.addMcp",
        payload: {
          command: addMcpRec["command"],
          args: addMcpRec["args"],
        },
      });
      if (gateResult !== "proceed") return { kind: "hit", value: gateResult };
      return handleConnectorAddMcp(ctx);
    }
```

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck 2>&1 | grep connector-rpc
```

Expected: no errors.

---

## Task 11 — G2/G3: Create per-client ToolExecutor in server.ts and thread it

**Files:**
- Modify: `packages/gateway/src/ipc/server.ts`

The IPC server has a `consentImpl` (a `ConsentCoordinator`) in scope. For `data.delete` and `connector.remove` / `connector.addMcp`, a `ToolExecutor` must be created per-client using the client's consent channel.

- [ ] **Step 1: Add imports**

Add to the import block at the top of `server.ts`:
```typescript
import { bindConsentChannel, ToolExecutor } from "../engine/executor.ts";
import type { ConnectorDispatcher } from "../engine/types.ts";
```

- [ ] **Step 2: Update tryDispatchDataRpc to accept clientId**

Change signature:
```typescript
  async function tryDispatchDataRpc(method: string, params: unknown, clientId: string): Promise<unknown> {
```

Inside, before calling `dispatchDataRpc`, create a `ToolExecutor`:
```typescript
    // A stub dispatcher is intentional — gate() for IPC-native ops never calls dispatch().
    const stubDispatcher: ConnectorDispatcher = {
      dispatch(): Promise<unknown> {
        return Promise.reject(new Error("IPC-native gate does not dispatch to MCP"));
      },
    };
    const toolExecutor =
      options.localIndex !== undefined
        ? new ToolExecutor(
            bindConsentChannel(consentImpl, clientId),
            options.localIndex,
            stubDispatcher,
          )
        : undefined;
    const out = await dispatchDataRpc(method, params, {
      index: options.localIndex,
      vault: options.vault,
      platform: rpcPlatform,
      nimbusVersion: options.version ?? "0.1.0",
      schemaVersion: CURRENT_SCHEMA_VERSION,
      ...(toolExecutor !== undefined ? { toolExecutor } : {}),
    });
```

- [ ] **Step 3: Update tryDispatchConnectorRpc to accept clientId**

Change signature:
```typescript
  async function tryDispatchConnectorRpc(method: string, params: unknown, clientId: string): Promise<unknown> {
```

Inside, create a `ToolExecutor` (same stub dispatcher pattern):
```typescript
    const stubDispatcher: ConnectorDispatcher = {
      dispatch(): Promise<unknown> {
        return Promise.reject(new Error("IPC-native gate does not dispatch to MCP"));
      },
    };
    const toolExecutor =
      options.localIndex !== undefined
        ? new ToolExecutor(
            bindConsentChannel(consentImpl, clientId),
            options.localIndex,
            stubDispatcher,
          )
        : undefined;
    const out = await dispatchConnectorRpc({
      method,
      params,
      vault: options.vault,
      localIndex: options.localIndex,
      openUrl: openUrl ?? (async () => {}),
      syncScheduler: options.syncScheduler,
      ...(options.connectorMesh === undefined ? {} : { connectorMesh: options.connectorMesh }),
      notify: broadcastNotification,
      ...(toolExecutor !== undefined ? { toolExecutor } : {}),
    });
```

- [ ] **Step 4: Update the call sites in dispatchMethod to pass clientId**

Change:
```typescript
    const dataOutcome = await tryDispatchDataRpc(method, params);
```
To:
```typescript
    const dataOutcome = await tryDispatchDataRpc(method, params, clientId);
```

Change:
```typescript
    const connectorOutcome = await tryDispatchConnectorRpc(method, params);
```
To:
```typescript
    const connectorOutcome = await tryDispatchConnectorRpc(method, params, clientId);
```

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck 2>&1 | grep server
```

Expected: no errors.

---

## Task 12 — G2: Run tests and commit

- [ ] **Step 1: Run engine tests**

```bash
bun test packages/gateway/src/engine/engine.test.ts
```

Expected: all tests pass including the new `gate()` tests.

- [ ] **Step 2: Run engine coverage gate**

```bash
bun run test:coverage:engine
```

Expected: ≥85% coverage.

- [ ] **Step 3: Run full test suite**

```bash
bun test
```

Expected: all tests pass.

- [ ] **Step 4: Commit G2**

```bash
git add packages/gateway/src/engine/executor.ts \
        packages/gateway/src/engine/engine.test.ts \
        packages/gateway/src/commands/data-delete.ts \
        packages/gateway/src/ipc/data-rpc.ts \
        packages/gateway/src/ipc/connector-rpc.ts \
        packages/gateway/src/ipc/server.ts
git commit -m "fix(security): route data.delete + connector.remove through HITL gate (G2)

Closes S1-F1, S1-F5, C6.

- Fix TS2345 narrowing bug in executor.ts (ae27fe9 introduced unknown
  type for resolvedToolId; add typeof rawToolId === 'string' guard).
- Extract ToolExecutor.gate() — consent + audit logic decoupled from
  MCP dispatch so IPC-native ops can use the same gate.
- Add data.delete, connector.remove, extension.install, connector.addMcp
  to HITL_REQUIRED_BACKING (last two also used by G3).
- Remove hardcoded hitlStatus:'approved' audit write from data-delete.ts.
- Thread ToolExecutor (per-client, using bindConsentChannel) into
  tryDispatchDataRpc and tryDispatchConnectorRpc in server.ts.
- data.delete dry-run skips gate (read-only preflight).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 13 — G3: Remove extension.install from Tauri ALLOWED_METHODS

**Files:**
- Modify: `packages/ui/src-tauri/src/gateway_bridge.rs`

`extension.install` being in `ALLOWED_METHODS` means WebView JavaScript can invoke it via `invoke('rpc_call', { method: 'extension.install', ... })`. A XSS payload in any page can trigger extension installation silently. Remove it.

- [ ] **Step 1: Remove "extension.install" from the ALLOWED_METHODS array**

Find and delete this line in the `ALLOWED_METHODS` const:
```rust
    "extension.install",
```

- [ ] **Step 2: Update the count assertion (currently 56, becomes 55)**

Find:
```rust
        assert_eq!(ALLOWED_METHODS.len(), 56);
```
Change to:
```rust
        assert_eq!(ALLOWED_METHODS.len(), 55);
```

- [ ] **Step 3: Run Rust tests (if Cargo/Rust toolchain is available)**

```bash
cd packages/ui && cargo test --features __test 2>&1 | grep -E "FAILED|ok|error"
```

Expected: all tests pass including `allowlist_is_alphabetized`, `allowlist_has_no_duplicates`, and the count assertion.

---

## Task 14 — G3: Add CSP to tauri.conf.json

**Files:**
- Modify: `packages/ui/src-tauri/tauri.conf.json`

The current CSP is `null` (no restriction). This allows inline scripts (XSS entry point for C1) and unrestricted outbound connections (data exfiltration).

- [ ] **Step 1: Update the security.csp field**

In `packages/ui/src-tauri/tauri.conf.json`, change:
```json
    "security": {
      "csp": null
    },
```
To:
```json
    "security": {
      "csp": "default-src 'self'; script-src 'self'; connect-src 'self' ipc: http://ipc.localhost ws://localhost:* http://localhost:*; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    },
```

---

## Task 15 — G3: Update FORBIDDEN_OVER_LAN for connector.addMcp, audit, data

**Files:**
- Modify: `packages/gateway/src/ipc/lan-rpc.ts`
- Modify: `packages/gateway/src/ipc/lan-rpc.test.ts`

`connector.addMcp` registers arbitrary binaries as persistent MCP servers — this must never be reachable over the network regardless of write grant. The `audit` and `data` namespace prefixes (e.g. `audit.export`, `data.delete`) are exfiltration-class — blocked for all LAN peers.

`checkLanMethodAllowed` uses `method.split(".")[0]` for namespace matching, so forbidden entries must be bare prefixes (e.g., `"audit"`, not `"audit.*"`).

- [ ] **Step 1: Write the failing tests first (lan-rpc.test.ts)**

Add to the existing `describe("checkLanMethodAllowed")` block:

```typescript
  test("rejects audit namespace regardless of grant-write", () => {
    expect(() =>
      checkLanMethodAllowed("audit.export", { peerId: "p", writeAllowed: true }),
    ).toThrow(LanError);
    expect(() =>
      checkLanMethodAllowed("audit.list", { peerId: "p", writeAllowed: true }),
    ).toThrow(LanError);
  });

  test("rejects data namespace regardless of grant-write", () => {
    expect(() =>
      checkLanMethodAllowed("data.delete", { peerId: "p", writeAllowed: true }),
    ).toThrow(LanError);
    expect(() =>
      checkLanMethodAllowed("data.export", { peerId: "p", writeAllowed: true }),
    ).toThrow(LanError);
  });

  test("rejects connector.addMcp regardless of grant-write", () => {
    expect(() =>
      checkLanMethodAllowed("connector.addMcp", { peerId: "p", writeAllowed: true }),
    ).toThrow(LanError);
  });

  test("rejects connector.addMcp even with writeAllowed false (also forbidden, not just write-gated)", () => {
    expect(() =>
      checkLanMethodAllowed("connector.addMcp", { peerId: "p", writeAllowed: false }),
    ).toThrow(LanError);
    // Verify the error is ERR_METHOD_NOT_ALLOWED, not ERR_LAN_WRITE_FORBIDDEN
    let thrown: LanError | undefined;
    try { checkLanMethodAllowed("connector.addMcp", { peerId: "p", writeAllowed: false }); }
    catch (e) { thrown = e as LanError; }
    expect(thrown?.message).toMatch(/ERR_METHOD_NOT_ALLOWED/);
  });
```

- [ ] **Step 2: Run to confirm they fail**

```bash
bun test packages/gateway/src/ipc/lan-rpc.test.ts
```

Expected: the three new tests fail.

- [ ] **Step 3: Update FORBIDDEN_OVER_LAN in lan-rpc.ts**

Replace:
```typescript
const FORBIDDEN_OVER_LAN = new Set(["vault", "updater", "lan", "profile"]);
```
With:
```typescript
const FORBIDDEN_OVER_LAN = new Set([
  "vault",
  "updater",
  "lan",
  "profile",
  "audit",         // exfiltration-class namespace
  "data",          // exfiltration-class namespace
  "connector.addMcp", // full method — arbitrary command execution over network
]);
```

Note: `"connector.addMcp"` is a full method string, not a namespace prefix. `checkLanMethodAllowed` checks `FORBIDDEN_OVER_LAN.has(ns)` where `ns` is `method.split(".")[0]`. For `"connector.addMcp"` the namespace is `"connector"` — so blocking the full method string via `FORBIDDEN_OVER_LAN` won't work. Instead, add a second check in `checkLanMethodAllowed`:

```typescript
export function checkLanMethodAllowed(method: string, peer: LanPeerContext): void {
  const ns = method.split(".")[0] ?? "";
  if (FORBIDDEN_OVER_LAN.has(ns) || FORBIDDEN_OVER_LAN.has(method)) {
    throw new LanError(-32601, `ERR_METHOD_NOT_ALLOWED: ${method} is not callable over LAN`);
  }
  if (WRITE_METHODS.has(method) && !peer.writeAllowed) {
    throw new LanError(
      -32603,
      `ERR_LAN_WRITE_FORBIDDEN: peer ${peer.peerId} lacks write permission for ${method}`,
    );
  }
}
```

This allows both namespace-prefix entries (`"audit"`, `"data"`) and exact-method entries (`"connector.addMcp"`) in `FORBIDDEN_OVER_LAN`.

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun test packages/gateway/src/ipc/lan-rpc.test.ts
```

Expected: all tests pass.

---

## Task 16 — G3: Commit G3

- [ ] **Step 1: Run full test suite**

```bash
bun test
```

Expected: all tests pass.

- [ ] **Step 2: Commit G3**

```bash
git add packages/gateway/src/engine/executor.ts \
        packages/gateway/src/ipc/connector-rpc.ts \
        packages/gateway/src/ipc/lan-rpc.ts \
        packages/gateway/src/ipc/lan-rpc.test.ts \
        packages/ui/src-tauri/src/gateway_bridge.rs \
        packages/ui/src-tauri/tauri.conf.json
git commit -m "fix(security): gate extension.install + connector.addMcp behind HITL (G3)

Closes S7-F2, S8-F2, S4-F1. Reduces C1 and C3 chains.

- Add extension.install + connector.addMcp to HITL_REQUIRED_BACKING
  (entries already added in G2 commit — this commit only adds the
  enforcement wiring and LAN protection).
- Wire gate() before connector.addMcp in connector-rpc.ts.
- Add connector.addMcp to FORBIDDEN_OVER_LAN (arbitrary binary
  execution must never be reachable from a network peer).
- Add audit and data namespace prefixes to FORBIDDEN_OVER_LAN
  (exfiltration-class — blocked regardless of write grant).
- Extend checkLanMethodAllowed to check both namespace prefix and
  exact method string in FORBIDDEN_OVER_LAN.
- Remove extension.install from Tauri ALLOWED_METHODS (WebView XSS
  can no longer invoke it directly; update count assertion 56→55).
- Add Content-Security-Policy: script-src 'self' blocks inline script
  execution; connect-src restricts outbound to IPC + localhost only.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 17 — G4: Write failing LAN gate tests

**Files:**
- Modify: `packages/gateway/src/ipc/lan-server.test.ts`

Before wiring `checkLanMethodAllowed` into `LanServer`, write the tests that prove the gate fires.

The existing test file only tests boot/stop. We need end-to-end tests that send actual encrypted RPC messages and verify forbidden methods are rejected at the `LanServer` level.

- [ ] **Step 1: Add helper and new tests to lan-server.test.ts**

```typescript
import { describe, expect, test, afterEach } from "bun:test";
import { generateBoxKeypair, sealBoxFrame, openBoxFrame } from "./lan-crypto.ts";
import { LanServer } from "./lan-server.ts";

// ... existing tests ...

async function sendEncryptedRpc(
  serverPubkey: Uint8Array,
  clientKeypair: ReturnType<typeof generateBoxKeypair>,
  serverPort: number,
  msg: { id: number; method: string; params?: unknown },
): Promise<{ result?: unknown; error?: { code: string; message: string } }> {
  const payload = new TextEncoder().encode(JSON.stringify(msg));
  const frame = sealBoxFrame(payload, serverPubkey, clientKeypair.secretKey);
  const header = new Uint8Array(4);
  new DataView(header.buffer).setUint32(0, frame.length, false);

  // Build hello handshake frame
  const helloMsg = JSON.stringify({
    kind: "hello",
    client_pubkey: Buffer.from(clientKeypair.publicKey).toString("base64"),
  });
  const helloBytes = new TextEncoder().encode(helloMsg);
  const helloHeader = new Uint8Array(4);
  new DataView(helloHeader.buffer).setUint32(0, helloBytes.length, false);

  return new Promise((resolve, reject) => {
    const conn = Bun.connect({
      hostname: "127.0.0.1",
      port: serverPort,
      socket: {
        open(socket) {
          socket.write(helloHeader);
          socket.write(helloBytes);
        },
        data(socket, chunk) {
          // First response is hello_ok; second is our RPC response
          // Simple: collect bytes and try to parse after hello_ok (32-byte frame)
          // For test purposes, just send RPC immediately after hello_ok
          // This is a simplified sequence — production code handles this properly
          try {
            const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
            if (chunk.length >= 4) {
              const len = view.getUint32(0, false);
              const body = chunk.slice(4, 4 + len);
              const text = new TextDecoder().decode(body);
              if (text.includes("hello_ok")) {
                // Now send encrypted RPC
                socket.write(header);
                socket.write(frame);
              } else {
                // Encrypted response
                const plain = openBoxFrame(body, serverPubkey, clientKeypair.secretKey);
                resolve(JSON.parse(new TextDecoder().decode(plain)) as { result?: unknown; error?: { code: string; message: string } });
                socket.end();
              }
            }
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        },
        error(_, err) { reject(err); },
        close() {},
      },
    });
    setTimeout(() => { conn.then(s => s.end()); reject(new Error("timeout")); }, 3000);
  });
}

describe("LanServer gate (G4)", () => {
  let server: LanServer | undefined;
  let hostKeypair: ReturnType<typeof generateBoxKeypair>;

  afterEach(async () => {
    await server?.stop();
    server = undefined;
  });

  test("forbidden method (vault.list) is rejected with ERR_METHOD_NOT_ALLOWED", async () => {
    hostKeypair = generateBoxKeypair();
    const clientKeypair = generateBoxKeypair();
    const onMessageCalls: string[] = [];
    server = new LanServer({
      bind: "127.0.0.1",
      port: 0,
      hostKeypair,
      onMessage: async (method) => { onMessageCalls.push(method); return {}; },
      isKnownPeer: () => ({ peerId: "test-peer", writeAllowed: false }),
      rateLimit: { checkAllowed: () => true, recordFailure: () => {}, recordSuccess: () => {} },
      pairing: { isOpen: () => false, consume: () => false, open: () => {}, close: () => {}, getExpiresAt: () => undefined },
      registerPeer: () => "test-peer",
    });
    await server.start();
    const port = server.listenAddr()!.port;

    const resp = await sendEncryptedRpc(hostKeypair.publicKey, clientKeypair, port, { id: 1, method: "vault.list" });
    expect(resp.error?.message).toMatch(/ERR_METHOD_NOT_ALLOWED/);
    expect(onMessageCalls.length).toBe(0);
  });

  test("write method without write grant is rejected with ERR_LAN_WRITE_FORBIDDEN", async () => {
    hostKeypair = generateBoxKeypair();
    const clientKeypair = generateBoxKeypair();
    const onMessageCalls: string[] = [];
    server = new LanServer({
      bind: "127.0.0.1",
      port: 0,
      hostKeypair,
      onMessage: async (method) => { onMessageCalls.push(method); return {}; },
      isKnownPeer: () => ({ peerId: "test-peer", writeAllowed: false }),
      rateLimit: { checkAllowed: () => true, recordFailure: () => {}, recordSuccess: () => {} },
      pairing: { isOpen: () => false, consume: () => false, open: () => {}, close: () => {}, getExpiresAt: () => undefined },
      registerPeer: () => "test-peer",
    });
    await server.start();
    const port = server.listenAddr()!.port;

    const resp = await sendEncryptedRpc(hostKeypair.publicKey, clientKeypair, port, { id: 1, method: "engine.ask" });
    expect(resp.error?.message).toMatch(/ERR_LAN_WRITE_FORBIDDEN/);
    expect(onMessageCalls.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run to confirm tests fail (gate not yet wired)**

```bash
bun test packages/gateway/src/ipc/lan-server.test.ts
```

Expected: the two new G4 tests fail (forbidden methods currently reach `onMessage`).

---

## Task 18 — G4: Wire checkLanMethodAllowed in lan-server.ts

**Files:**
- Modify: `packages/gateway/src/ipc/lan-server.ts`

- [ ] **Step 1: Add import**

Add at the top:
```typescript
import { checkLanMethodAllowed, LanError } from "./lan-rpc.ts";
```

- [ ] **Step 2: Wire the gate in handleEncryptedMessage**

Inside `handleEncryptedMessage`, just before `let result: unknown`:
```typescript
    let result: unknown;
    let error: { code: string; message: string } | undefined;
    try {
      result = await this.opts.onMessage(msg.method, msg.params, socket.data.peerMatch);
    } catch (err) {
```

Replace with:
```typescript
    let result: unknown;
    let error: { code: string; message: string } | undefined;
    try {
      checkLanMethodAllowed(msg.method, socket.data.peerMatch);
      result = await this.opts.onMessage(msg.method, msg.params, socket.data.peerMatch);
    } catch (err) {
      if (err instanceof LanError) {
        error = { code: `ERR_${err.rpcCode}`, message: err.message };
      } else {
```

Full updated catch block:
```typescript
    } catch (err) {
      if (err instanceof LanError) {
        error = { code: `ERR_${String(err.rpcCode)}`, message: err.message };
      } else {
        const e = err as { code?: string; message?: string };
        error = { code: e.code ?? "ERR_INTERNAL", message: e.message ?? String(err) };
      }
    }
```

- [ ] **Step 3: Run tests**

```bash
bun test packages/gateway/src/ipc/lan-server.test.ts
```

Expected: all tests pass including the two new G4 tests.

---

## Task 19 — G4: Reconcile WRITE_METHODS + change lan.bind default

**Files:**
- Modify: `packages/gateway/src/ipc/lan-rpc.ts`
- Modify: `packages/gateway/src/config/nimbus-toml.ts`
- Modify: `packages/gateway/src/config/nimbus-toml-lan.test.ts`

- [ ] **Step 1: Reconcile WRITE_METHODS in lan-rpc.ts**

The current `WRITE_METHODS` contains ghost entries (`workflow.create`, `workflow.update`) that no longer exist as IPC handlers, and is missing some mutating methods. Replace the set:

```typescript
const WRITE_METHODS = new Set([
  "engine.ask",
  "engine.askStream",
  "connector.sync",
  "connector.remove",
  "connector.addMcp",
  "connector.setConfig",
  "connector.setInterval",
  "watcher.create",
  "watcher.update",
  "watcher.delete",
  "workflow.run",
  "workflow.save",
  "workflow.delete",
  "extension.enable",
  "extension.remove",
  "data.import",
]);
```

Removed: `workflow.create`, `workflow.update` (handlers replaced by `workflow.save`), `extension.install` (moved to FORBIDDEN), `data.export` (read-only snapshot — does not modify index), `data.delete` (moved to FORBIDDEN via `"data"` namespace prefix).

Added: `connector.remove`, `connector.addMcp` (now gated), `connector.setConfig`, `connector.setInterval`, `workflow.save`.

- [ ] **Step 2: Write failing test for the default bind assertion**

In `packages/gateway/src/config/nimbus-toml-lan.test.ts`, add:

```typescript
test("DEFAULT_NIMBUS_LAN_TOML bind is loopback, not all-interfaces", () => {
  expect(DEFAULT_NIMBUS_LAN_TOML.bind).toBe("127.0.0.1");
});
```

Import `DEFAULT_NIMBUS_LAN_TOML` at the top if not already imported.

- [ ] **Step 3: Run to confirm it fails**

```bash
bun test packages/gateway/src/config/nimbus-toml-lan.test.ts
```

Expected: the new test fails (current default is `"0.0.0.0"`).

- [ ] **Step 4: Change bind default in nimbus-toml.ts**

Find `DEFAULT_NIMBUS_LAN_TOML` and change:
```typescript
  bind: "0.0.0.0",
```
To:
```typescript
  bind: "127.0.0.1",
```

- [ ] **Step 5: Run tests to confirm pass**

```bash
bun test packages/gateway/src/config/nimbus-toml-lan.test.ts
```

Expected: all tests pass.

---

## Task 20 — G4: Run LAN tests and commit

- [ ] **Step 1: Run LAN coverage gate**

```bash
bun run test:coverage:lan
```

Expected: ≥80% coverage.

- [ ] **Step 2: Run full test suite**

```bash
bun test
```

Expected: all tests pass.

- [ ] **Step 3: Commit G4**

```bash
git add packages/gateway/src/ipc/lan-rpc.ts \
        packages/gateway/src/ipc/lan-rpc.test.ts \
        packages/gateway/src/ipc/lan-server.ts \
        packages/gateway/src/ipc/lan-server.test.ts \
        packages/gateway/src/config/nimbus-toml.ts \
        packages/gateway/src/config/nimbus-toml-lan.test.ts
git commit -m "fix(security): wire checkLanMethodAllowed + fix allowlist drift (G4)

Closes S1-F2=S3-F1, S3-F2, S3-F7.

- Wire checkLanMethodAllowed() into LanServer.handleEncryptedMessage()
  before onMessage — FORBIDDEN_OVER_LAN and WRITE_METHODS are now
  enforced intrinsically; onMessage is never called for blocked methods.
  LanError is caught and converted to a typed error response.
- Reconcile WRITE_METHODS: remove ghosts (workflow.create/update),
  add connector.remove/setConfig/setInterval, workflow.save.
- Change DEFAULT_NIMBUS_LAN_TOML.bind from '0.0.0.0' to '127.0.0.1'
  — wide-area LAN is now an explicit opt-in in nimbus.toml.
- Add end-to-end LAN gate tests: forbidden method rejected before
  onMessage; write method without grant rejected; both verify
  onMessage is NOT called.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 21 — G5: Write failing updater tests

**Files:**
- Modify: `packages/gateway/src/updater/updater.test.ts`

- [ ] **Step 1: Add tests for production key guard and semver re-check**

Add a new describe block at the end of `updater.test.ts`:

```typescript
describe("G5 — production key guard + semver re-check", () => {
  test("loadUpdaterPublicKey throws in production when NIMBUS_DEV_UPDATER_PUBLIC_KEY is set", async () => {
    const { loadUpdaterPublicKey } = await import("./public-key.ts");
    const prevEnv = process.env["NODE_ENV"];
    const prevKey = process.env["NIMBUS_DEV_UPDATER_PUBLIC_KEY"];
    process.env["NODE_ENV"] = "production";
    process.env["NIMBUS_DEV_UPDATER_PUBLIC_KEY"] = "aHCEta3sioGdbjyRtS0TdSowop//jqaBr3MqDVb7nSc=";
    try {
      expect(() => loadUpdaterPublicKey()).toThrow(/not permitted in production/);
    } finally {
      if (prevEnv === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = prevEnv;
      if (prevKey === undefined) delete process.env["NIMBUS_DEV_UPDATER_PUBLIC_KEY"];
      else process.env["NIMBUS_DEV_UPDATER_PUBLIC_KEY"] = prevKey;
    }
  });

  test("loadUpdaterPublicKey works in development when NIMBUS_DEV_UPDATER_PUBLIC_KEY is set", async () => {
    const { loadUpdaterPublicKey } = await import("./public-key.ts");
    const prevEnv = process.env["NODE_ENV"];
    const prevKey = process.env["NIMBUS_DEV_UPDATER_PUBLIC_KEY"];
    process.env["NODE_ENV"] = "development";
    process.env["NIMBUS_DEV_UPDATER_PUBLIC_KEY"] = "aHCEta3sioGdbjyRtS0TdSowop//jqaBr3MqDVb7nSc=";
    try {
      const key = loadUpdaterPublicKey();
      expect(key.length).toBe(32);
    } finally {
      if (prevEnv === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = prevEnv;
      if (prevKey === undefined) delete process.env["NIMBUS_DEV_UPDATER_PUBLIC_KEY"];
      else process.env["NIMBUS_DEV_UPDATER_PUBLIC_KEY"] = prevKey;
    }
  });

  test("applyUpdate throws before download when manifest version equals current", async () => {
    const binary = new Uint8Array(randomBytes(512));
    downloadServer = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(binary) });
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () =>
        jsonResponse(
          buildSignedManifest(binary, kp, `http://127.0.0.1:${downloadServer.port}/bin`, "0.1.0"),
        ),
    });
    const fetched: string[] = [];
    const updater = makeUpdater({
      currentVersion: "0.1.0",
      invokeInstaller: async () => { fetched.push("install"); },
    });
    await updater.checkNow();
    await expect(updater.applyUpdate()).rejects.toThrow(/not newer than/);
    expect(fetched.length).toBe(0);
  });

  test("applyUpdate throws before download when manifest version is older than current", async () => {
    const binary = new Uint8Array(randomBytes(512));
    downloadServer = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(binary) });
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () =>
        jsonResponse(
          buildSignedManifest(binary, kp, `http://127.0.0.1:${downloadServer.port}/bin`, "0.0.9"),
        ),
    });
    const fetched: string[] = [];
    const updater = makeUpdater({
      currentVersion: "0.1.0",
      invokeInstaller: async () => { fetched.push("install"); },
    });
    // Force lastManifest to an older version
    await updater.checkNow().catch(() => {});
    // Manually override via test backdoor — need to expose or patch manifest
    // Instead, patch currentVersion to be higher than the manifest:
    const updater2 = makeUpdater({
      currentVersion: "0.2.0",
      invokeInstaller: async () => { fetched.push("install"); },
    });
    downloadServer = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(binary) });
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () =>
        jsonResponse(
          buildSignedManifest(binary, kp, `http://127.0.0.1:${downloadServer.port}/bin`, "0.1.0"),
        ),
    });
    await updater2.checkNow();
    await expect(updater2.applyUpdate()).rejects.toThrow(/not newer than/);
    expect(fetched.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run to confirm the new tests fail**

```bash
bun test packages/gateway/src/updater/updater.test.ts 2>&1 | grep -E "FAIL|pass|error"
```

Expected: `production key guard` and `semver re-check` tests fail.

---

## Task 22 — G5: Add production guard to public-key.ts

**Files:**
- Modify: `packages/gateway/src/updater/public-key.ts`

- [ ] **Step 1: Add the production guard**

Replace `loadUpdaterPublicKey`:

```typescript
export function loadUpdaterPublicKey(): Uint8Array {
  const override = processEnvGet("NIMBUS_DEV_UPDATER_PUBLIC_KEY");
  if (override !== undefined) {
    if (processEnvGet("NODE_ENV") === "production") {
      throw new Error(
        "NIMBUS_DEV_UPDATER_PUBLIC_KEY is not permitted in production builds. " +
          "Remove the environment variable or use a non-production build.",
      );
    }
    const bytes = Buffer.from(override, "base64");
    if (bytes.length !== 32) {
      throw new Error(`updater public key must be 32 bytes, got ${bytes.length}`);
    }
    return new Uint8Array(bytes);
  }
  const source = UPDATER_PUBLIC_KEY_BASE64;
  if (source === "<DEV-PLACEHOLDER>") {
    throw new Error(
      "updater public key is unset — run `bun scripts/generate-updater-keypair.ts` or set NIMBUS_DEV_UPDATER_PUBLIC_KEY",
    );
  }
  const bytes = Buffer.from(source, "base64");
  if (bytes.length !== 32) {
    throw new Error(`updater public key must be 32 bytes, got ${bytes.length}`);
  }
  return new Uint8Array(bytes);
}
```

- [ ] **Step 2: Run the production key guard tests**

```bash
bun test packages/gateway/src/updater/updater.test.ts --test-name-pattern="production key guard|development when"
```

Expected: both tests pass.

---

## Task 23 — G5: Add semver re-check to updater.ts

**Files:**
- Modify: `packages/gateway/src/updater/updater.ts`

- [ ] **Step 1: Add re-check at the start of applyUpdate()**

In `applyUpdate()`, after the `if (!this.lastManifest)` guard (line ~74), add:

```typescript
    if (!semverGreater(this.lastManifest.version, this.opts.currentVersion)) {
      throw new Error(
        `Manifest version ${this.lastManifest.version} is not newer than ` +
          `current version ${this.opts.currentVersion}; aborting download`,
      );
    }
```

The full start of `applyUpdate()` becomes:

```typescript
  async applyUpdate(): Promise<void> {
    if (!this.lastManifest) {
      throw new Error("no manifest loaded — call checkNow() first");
    }
    if (!semverGreater(this.lastManifest.version, this.opts.currentVersion)) {
      throw new Error(
        `Manifest version ${this.lastManifest.version} is not newer than ` +
          `current version ${this.opts.currentVersion}; aborting download`,
      );
    }
    const asset = this.lastManifest.platforms[this.opts.target];
```

- [ ] **Step 2: Run semver re-check tests**

```bash
bun test packages/gateway/src/updater/updater.test.ts --test-name-pattern="semver re-check|not newer than|older than"
```

Expected: both semver tests pass.

---

## Task 24 — G5: Run updater coverage and commit

- [ ] **Step 1: Run updater coverage gate**

```bash
bun run test:coverage:updater
```

Expected: ≥80% coverage.

- [ ] **Step 2: Run full test suite**

```bash
bun test
```

Expected: all tests pass.

- [ ] **Step 3: Commit G5**

```bash
git add packages/gateway/src/updater/public-key.ts \
        packages/gateway/src/updater/updater.ts \
        packages/gateway/src/updater/updater.test.ts
git commit -m "fix(security): gate dev-key override to non-prod + add semver re-check (G5)

Closes S6-F2. Reduces C2 chain.

- public-key.ts: throw if NIMBUS_DEV_UPDATER_PUBLIC_KEY is set when
  NODE_ENV=production. The CI release workflow sets NODE_ENV=production;
  dev/test environments are unaffected.
- updater.ts applyUpdate(): re-check semverGreater(manifest, current)
  immediately before downloadAsset(). Prevents replay attacks and
  downgrade installs regardless of how lastManifest was populated.
- Tests: production guard throws; dev override accepted; applyUpdate
  throws before any fetch when manifest version == or < current.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 25 — Final CI parity run

- [ ] **Step 1: Run full typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 2: Run linter**

```bash
bun run lint
```

Expected: zero errors.

- [ ] **Step 3: Run full test suite with coverage**

```bash
bun run test:coverage:engine
bun run test:coverage:lan
bun run test:coverage:updater
```

Expected: engine ≥85%, lan ≥80%, updater ≥80%.

- [ ] **Step 4: Run full test suite**

```bash
bun test
```

Expected: all tests pass with no regressions.

---

## Self-review notes

- G1 and G5 are fully independent. G2 must precede G3 (G3 uses `gate()` from G2). G3 partially overlaps lan-rpc.ts with G4 (FORBIDDEN_OVER_LAN) — G3 adds `connector.addMcp` / `audit` / `data`; G4 reconciles `WRITE_METHODS`. Order: G1 → G2 → G3 → G4 → G5.
- Task 15 Step 3 notes that `connector.addMcp` needs both `FORBIDDEN_OVER_LAN.has(ns)` AND `FORBIDDEN_OVER_LAN.has(method)` — the updated `checkLanMethodAllowed` handles both.
- `data.delete` dry-run skips the gate (read-only) — specified in Task 9.
- The stub `ConnectorDispatcher` in server.ts will never be called — `gate()` returns before dispatch. If it somehow were called, it throws `Error` which surfaces as an RPC error, which is the safe failure mode.
- `extension.install` being removed from Tauri `ALLOWED_METHODS` (Task 13) means the Marketplace panel's current install flow will break — the panel UI change (Tauri event flow with native dialog) is called out in the spec as "create if absent" and is deferred to a follow-up UI task, not part of this PR. The PR intentionally breaks the install path to prevent XSS exploitation; the safe replacement path should be built before re-enabling the feature in the UI.
