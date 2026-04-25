# Security fixes — High-severity tier (PR 1 of 3)

**Date:** 2026-04-25
**Branch:** `dev/asafgolombek/fixing_security_issues`
**Audit source:** [`2026-04-25-security-audit-results.md`](./2026-04-25-security-audit-results.md)
**Status:** Design approved — pending implementation plan

---

## Scope

This spec covers all 16 High-severity findings from the security audit, grouped into 5 root-cause commits. It is the first of three PRs (High → Medium → Low). Where a root-cause fix incidentally closes co-located Medium findings in the same diff, those are included and noted.

Already fixed before this PR: **S1-F3 / C4** (HITL check key aligned with dispatch key, commit `ae27fe9`).

---

## Commit structure

| # | Commit message | Findings closed | Active/Latent |
|---|---|---|---|
| 1 | `fix(security): isolate MCP child process env (G1)` | S2-F1, S7-F1, S8-F1 → reduces blast radius of C1/C2/C3 | Active |
| 2 | `fix(security): route data.delete + connector.remove through HITL gate (G2)` | S1-F1, S1-F5, C6 | Active |
| 3 | `fix(security): gate extension.install + connector.addMcp behind HITL (G3)` | S7-F2, S8-F2, S4-F1 → C1↓, C3↓ | Active |
| 4 | `fix(security): wire checkLanMethodAllowed + fix allowlist drift (G4)` | S1-F2=S3-F1, S3-F2, S3-F7 (Medium colocated) | Latent |
| 5 | `fix(security): gate dev-key override to non-prod + add semver re-check (G5)` | S6-F2 → C2↓ | Active |

Each commit is independently deployable and reviewable. G4 is latent (LAN server not yet wired in production) but is included in this PR because its findings are rated High and must land before LAN is wired.

---

## G1 — MCP child process env isolation

### Problem

All 21 `MCPClient` spawn sites in `packages/gateway/src/connectors/lazy-mesh.ts` pass `{ ...process.env }` as the child environment. Every connector process inherits the full gateway env: `ANTHROPIC_API_KEY`, `NIMBUS_DEV_UPDATER_PUBLIC_KEY`, `NIMBUS_UPDATER_URL`, OAuth client secrets, and any other operator-set vars. A compromised or malicious MCP child can exfiltrate all of these with a single `process.env` read.

**Root cause findings:** S2-F1 = S7-F1 = S8-F1 (same defect, three surfaces)
**Composite chains reduced:** C1 (XSS → credential exfil), C2 (env read → updater hijack), C3 (LAN → persistent RCE)

### Fix

**New file: `packages/gateway/src/connectors/extension-process-env.ts`**

```typescript
/**
 * Builds a minimal safe environment for MCP child processes.
 * Strips all gateway-private vars (API keys, updater overrides, OAuth secrets).
 * Callers pass only the explicit extras the connector needs (its own credentials).
 */
export function extensionProcessEnv(
  extra: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  const base: Record<string, string | undefined> = {
    // Shell / filesystem
    PATH:           process.env["PATH"],
    HOME:           process.env["HOME"],
    TMPDIR:         process.env["TMPDIR"],
    TEMP:           process.env["TEMP"],
    TMP:            process.env["TMP"],
    // Windows paths
    APPDATA:        process.env["APPDATA"],
    LOCALAPPDATA:   process.env["LOCALAPPDATA"],
    USERPROFILE:    process.env["USERPROFILE"],
    SYSTEMROOT:     process.env["SYSTEMROOT"],
    // Bun runtime
    BUN_INSTALL:    process.env["BUN_INSTALL"],
  };
  // Strip undefined keys so the child env is clean
  return Object.fromEntries(
    Object.entries({ ...base, ...extra }).filter(([, v]) => v !== undefined),
  ) as NodeJS.ProcessEnv;
}
```

**`lazy-mesh.ts` — all 21 spawn sites:**
Replace every `{ ...process.env, KEY: value }` with `extensionProcessEnv({ KEY: value })`.

**Extension registry spawn path:**
Same replacement wherever extensions are spawned as child processes.

### What is NOT broken

Each connector already receives its credentials via the `extras` argument (e.g. `{ GITHUB_TOKEN: await vault.get("github.pat") }`). Those still flow through. Only ambient gateway env is stripped.

### Incidental Mediums closed in this diff

Process-env leakage Mediums co-located in S2, S7, S8 that share the same root cause.

### Tests

- Unit test for `extensionProcessEnv`: assert that `ANTHROPIC_API_KEY`, `NIMBUS_DEV_UPDATER_PUBLIC_KEY`, `NIMBUS_UPDATER_URL` are absent from output even when set in `process.env` for the test run.
- Assert that explicitly-passed extras appear in output.
- Assert that `PATH` and `HOME` are present (baseline vars needed by child processes).

---

## G2 — `data.delete` / `connector.remove` HITL routing

### Problem

Both operations bypass `ToolExecutor` entirely:
- `dispatchDataRpc` calls `runDataDelete` directly
- `dispatchConnectorRpc` calls `handleConnectorRemove` directly

`data-delete.ts` hardcodes `hitlStatus: "approved"` in the audit record at line 82 without the action ever reaching the consent gate. Any IPC caller (including a LAN peer with write grant) can delete all indexed data and vault keys for any service with no user confirmation. The audit log records the deletion as user-approved.

**Findings:** S1-F1 (High), S1-F5 (High)
**Composite chain closed:** C6 (active — data.delete hardcoded HITL bypass)

### Architectural approach

`ToolExecutor.execute()` ends by calling `connectors.dispatch(action)` — an MCP call. `data.delete` and `connector.remove` are gateway-native operations that must not go through the MCP mesh. The fix extracts a `gate()` method from `ToolExecutor` containing all the consent + audit logic, which IPC handlers call independently.

### Fix

**`packages/gateway/src/engine/executor.ts`**

Extract gate logic into a new public method:

```typescript
/**
 * Runs the HITL consent gate and writes the audit record.
 * Returns "proceed" if the action is approved or not required.
 * Returns an ActionResult if rejected (audit already written — do not write again).
 * Use this when the caller owns the actual execution (not MCP dispatch).
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
      const details = action.payload === undefined
        ? undefined
        : (redactPayloadForConsentDisplay(action.payload) as Record<string, unknown>);
      const approved = await this.consent.requestApproval(
        formatConsentPrompt(action), details,
      );
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

// execute() now delegates to gate() then dispatches
async execute(action: PlannedAction): Promise<ActionResult> {
  const gateResult = await this.gate(action);
  if (gateResult !== "proceed") return gateResult;
  const result = await this.connectors.dispatch(action);
  return { status: "ok", result };
}
```

Add to `HITL_REQUIRED_BACKING`:
```typescript
"data.delete",
"connector.remove",
```

**`packages/gateway/src/commands/data-delete.ts`**

- Remove the `hitlStatus: "approved"` hardcode at line 82 — the audit record is now written by `gate()`.
- `runDataDelete` no longer writes its own audit entry.

**`packages/gateway/src/ipc/data-rpc.ts`**

`dispatchDataRpc` receives `toolExecutor` as an additional dependency. Before calling `runDataDelete`:

```typescript
const stats = await prefetchDeleteStats(index, service); // item count for consent display
const gateResult = await toolExecutor.gate({
  type: "data.delete",
  payload: { service, itemCount: stats.total },
});
if (gateResult !== "proceed") return gateResult;
await runDataDelete({ ...input, index, service });
```

**`packages/gateway/src/ipc/connector-rpc-handlers.ts`**

Same pattern: `gate({ type: "connector.remove", payload: { serviceId } })` before `handleConnectorRemove`.

### Consent display

The HITL dialog shows: `"Permanently delete all [N] items and credentials for [service]? This cannot be undone."` using the pre-fetched stats already computed for the UI preflight in `DataPanel.tsx`.

### Tests

- HITL test: call `data.delete` via test harness without going through the consent gate → assert `HITL_REQUIRED` intercepts before any DB deletion.
- Audit integrity test: assert that after `data.delete`, the audit row has `hitlStatus` set from actual consent gate result (not hardcoded `"approved"`).
- Rejection test: consent gate rejects → assert zero DB rows deleted, audit row has `hitlStatus: "rejected"`.

---

## G3 — `extension.install` / `connector.addMcp` gating

### Problem

Both operations execute arbitrary code:
- `extension.install` runs a new child process from an npm package or local path
- `connector.addMcp` spawns any binary on `PATH` as a persistent MCP server

Neither is in `HITL_REQUIRED`. `extension.install` is in the Tauri `ALLOWED_METHODS` list, so WebView JavaScript can invoke it directly — a XSS payload can trigger extension installation. `connector.addMcp` is in neither `WRITE_METHODS` nor `FORBIDDEN_OVER_LAN`, so a LAN peer with any auth level can register persistent RCE.

**Findings:** S7-F2 (High), S8-F2 (High), S4-F1 (High)
**Composite chains reduced:** C1 (XSS → extension.install → credential exfil), C3 (LAN → connector.addMcp → persistent RCE)

### Fix — three parts

**Part 1: Gateway HITL gate (same `gate()` pattern as G2)**

Add to `HITL_REQUIRED_BACKING` in `executor.ts`:
```typescript
"extension.install",
"connector.addMcp",
```

IPC handlers for both call `toolExecutor.gate()` before executing. Consent display:
- `extension.install`: `"Install extension [name] v[version] from [source]?"`
- `connector.addMcp`: `"Register MCP connector with command: [full command line]?"`

**Part 2: Remove `extension.install` from Tauri `ALLOWED_METHODS`**

`packages/ui/src-tauri/src/gateway_bridge.rs`:
- Remove `"extension.install"` from the `ALLOWED_METHODS` array
- The Marketplace panel in the WebView can no longer call it via `invoke('rpc_call', { method: 'extension.install' })`

Replace the WebView IPC call with a Tauri event flow:
- Marketplace panel emits `install_extension_requested` Tauri event with `{ source: string }`
- New Rust-side Tauri command `trigger_extension_install` handles the event:
  1. Shows a native system file-picker or confirmation dialog (outside WebView trust boundary)
  2. If confirmed, forwards to the Gateway over the internal socket connection
  3. Gateway's `gate()` still fires — double-gated
- This closes the XSS → auto-install chain: a WebView XSS payload can no longer reach `extension.install` through the bridge at all

**Part 3: `connector.addMcp` to `FORBIDDEN_OVER_LAN`**

`packages/gateway/src/ipc/lan-rpc.ts`:
```typescript
const FORBIDDEN_OVER_LAN = new Set([
  "consent.*",
  "vault.*",
  "connector.addMcp",   // arbitrary command execution — never over network
]);
```

Arbitrary command-line execution must not be reachable from a network peer regardless of write grant level.

**Part 4: CSP (defense-in-depth)**

Add `Content-Security-Policy` to the Tauri WebView configuration:
```
default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'
```

Blocks inline script execution, closing the XSS entry point that enables C1.

### Tests

- HITL test: call `extension.install` without consent → assert gate intercepts before any filesystem write.
- HITL test: call `connector.addMcp` without consent → assert gate intercepts before any DB write.
- LAN test: assert `connector.addMcp` is blocked for LAN peers regardless of write grant.
- Verify `extension.install` absent from `ALLOWED_METHODS` (static assertion on the array).

---

## G4 — LAN gate wiring + allowlist drift

### Problem

`checkLanMethodAllowed` is correctly designed and tested but is never called from `LanServer.handleEncryptedMessage`. All IPC methods are therefore accessible to any paired LAN peer — the `FORBIDDEN_OVER_LAN` and `WRITE_METHODS` sets are dead code. Additionally, those sets have drifted from the actual IPC handler registry. Default `lan.bind = "0.0.0.0"` exposes the LAN server on all interfaces.

These gaps are latent (no `new LanServer` in production today) but are hard blockers before LAN ships.

**Findings:** S1-F2 = S3-F1 (High), S3-F2 (High), S3-F7 (Medium — colocated)
**Composite chains blocked at launch:** C3, C5

### Fix — three parts

**Part 1: Wire gate into `LanServer`**

`packages/gateway/src/ipc/lan-server.ts`, inside `handleEncryptedMessage`, before calling `this.opts.onMessage`:

```typescript
const gateError = checkLanMethodAllowed(msg.method, socket.data.peerMatch);
if (gateError !== null) {
  await this.sendError(socket, msg.id, gateError);
  return;
}
this.opts.onMessage(msg.method, msg.params, socket.data.peerMatch);
```

The gate is now intrinsic to `LanServer`. Correct behavior no longer depends on the caller wiring it correctly. Any future `onMessage` handler gets protection automatically.

**Part 2: Reconcile allowlists**

`packages/gateway/src/ipc/lan-rpc.ts`:

- Remove ghost entries: `workflow.create`, `workflow.update` (handlers replaced by `workflow.save`)
- Add missing mutating methods from S3-F2 enumeration
- Add `"audit.*"` and `"data.*"` namespaces to `FORBIDDEN_OVER_LAN` — exfiltration-class operations must never be accessible to LAN peers regardless of write grant
- `"connector.addMcp"` already covered by G3, confirmed consistent here

**Part 3: Change `lan.bind` default**

`packages/gateway/src/config/nimbus-toml.ts`:
```typescript
bind: "127.0.0.1",  // was "0.0.0.0"
```

Wide-area LAN exposure becomes an explicit opt-in (`[lan] bind = "0.0.0.0"` in `nimbus.toml`). This closes S3-F7 and reduces attack surface for C3 even in isolation.

### Tests

- LAN gate test: construct a `LanServer` with a spy `onMessage`; send a `FORBIDDEN_OVER_LAN` method → assert `onMessage` is NOT called, error response sent.
- LAN gate test: send a `WRITE_METHODS` method from a peer with `writeAllowed: false` → assert `onMessage` is NOT called.
- LAN gate test: send a `WRITE_METHODS` method from a peer with `writeAllowed: true` → assert `onMessage` IS called.
- Allowlist completeness test: enumerate all IPC handler method names from the registry; assert each is either in `WRITE_METHODS` or `FORBIDDEN_OVER_LAN` or explicitly classified as read-only.

---

## G5 — Updater dev-key override + semver re-check

### Problem

1. `public-key.ts` reads `NIMBUS_DEV_UPDATER_PUBLIC_KEY` from `process.env` with no build-time or runtime production guard. An operator who sets this env var in the gateway process (misconfiguration, compromised shell profile) can substitute the Ed25519 public key and approve malicious update payloads. After G1, MCP children no longer inherit this var — but the override remains live in the gateway process itself.

2. `applyUpdate()` skips a semver re-check between manifest fetch and download. A stale or replayed manifest can trigger a downgrade or re-install with a patched binary.

**Findings:** S6-F2 (High)
**Composite chain reduced:** C2 (MCP env read → updater key hijack → supply-chain RCE)

### Fix

**Part 1: Production build gate**

`packages/gateway/src/updater/public-key.ts`:

```typescript
const devOverride = process.env["NIMBUS_DEV_UPDATER_PUBLIC_KEY"];
if (devOverride !== undefined) {
  if (process.env["NODE_ENV"] === "production") {
    throw new Error(
      "NIMBUS_DEV_UPDATER_PUBLIC_KEY is not permitted in production builds. " +
      "Remove the environment variable or use a non-production build.",
    );
  }
  return Buffer.from(devOverride, "base64");
}
```

The CI release workflow sets `NODE_ENV=production` at build time. Dev and test environments continue to work as before. The override is never silently active in shipped binaries.

**Part 2: Semver re-check before download**

`packages/gateway/src/updater/updater.ts`, in `applyUpdate()`, immediately before `downloadAsset()`:

```typescript
if (!semverGreater(this.lastManifest.version, this.opts.currentVersion)) {
  throw new UpdaterError(
    `Manifest version ${this.lastManifest.version} is not newer than ` +
    `current version ${this.opts.currentVersion}; aborting download`,
  );
}
```

Prevents replay attacks and downgrade installs. Legitimate updates already satisfy this check.

### Tests

- Assert `extensionProcessEnv()` strips `NIMBUS_DEV_UPDATER_PUBLIC_KEY` (covered by G1 tests).
- Production gate test: set `NODE_ENV=production` and `NIMBUS_DEV_UPDATER_PUBLIC_KEY` → assert `getPublicKey()` throws.
- Dev gate test: set `NODE_ENV=development` and `NIMBUS_DEV_UPDATER_PUBLIC_KEY` → assert override is accepted.
- Semver test: call `applyUpdate()` with a manifest whose version equals current → assert throws before any `fetch` call.
- Semver test: call `applyUpdate()` with a manifest whose version is lower than current → assert throws before any `fetch` call.

---

## Files changed summary

| File | Groups | Change type |
|---|---|---|
| `packages/gateway/src/connectors/extension-process-env.ts` | G1 | New file |
| `packages/gateway/src/connectors/lazy-mesh.ts` | G1 | Replace all `{ ...process.env }` spreads |
| `packages/gateway/src/extensions/registry.ts` | G1 | Replace extension spawn env |
| `packages/gateway/src/engine/executor.ts` | G2, G3 | Extract `gate()`, add 4 entries to `HITL_REQUIRED_BACKING` |
| `packages/gateway/src/commands/data-delete.ts` | G2 | Remove hardcoded `hitlStatus: "approved"` |
| `packages/gateway/src/ipc/data-rpc.ts` | G2 | Add `toolExecutor` dep, call `gate()` before delete |
| `packages/gateway/src/ipc/connector-rpc-handlers.ts` | G2, G3 | Add `gate()` calls before destructive ops |
| `packages/gateway/src/ipc/lan-rpc.ts` | G3, G4 | Add `connector.addMcp`/`audit.*`/`data.*` to `FORBIDDEN_OVER_LAN`; reconcile `WRITE_METHODS` |
| `packages/gateway/src/ipc/lan-server.ts` | G4 | Wire `checkLanMethodAllowed` into `handleEncryptedMessage` |
| `packages/gateway/src/config/nimbus-toml.ts` | G4 | Change `lan.bind` default to `"127.0.0.1"` |
| `packages/gateway/src/updater/public-key.ts` | G5 | Add production build gate |
| `packages/gateway/src/updater/updater.ts` | G5 | Add semver re-check before download |
| `packages/ui/src-tauri/src/gateway_bridge.rs` | G3 | Remove `extension.install` from `ALLOWED_METHODS` |
| `packages/ui/src-tauri/src/lib.rs` (or new file) | G3 | Add `trigger_extension_install` Tauri command |
| `packages/ui/src/pages/settings/extensions/` (panel — create if absent) | G3 | Replace direct `rpc_call` with Tauri event emission |
| `packages/ui/src-tauri/tauri.conf.json` (`app.security.csp`) | G3 | Add `Content-Security-Policy` header |

---

## Definition of done

- [ ] `bun run typecheck` passes
- [ ] `bun run lint` passes (Biome)
- [ ] `bun run test:coverage:engine` passes (≥85%)
- [ ] New HITL tests for `data.delete`, `connector.remove`, `extension.install`, `connector.addMcp`
- [ ] New LAN gate tests (wired gate + allowlist reconciliation)
- [ ] New updater tests (production gate + semver re-check)
- [ ] `extensionProcessEnv` unit tests
- [ ] `bun run test:coverage:lan` passes (≥80%)
- [ ] `bun run test:coverage:updater` passes (≥80%)
- [ ] PR description maps each commit to its closed finding IDs
