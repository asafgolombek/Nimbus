# Implementation Plan Review: S2 Runtime Tool Generation (PR 1)

**Date:** 2026-09-09  
**Review Target:** [`2026-09-09-s2-runtime-tool-generation-pr1.md`](./2026-09-09-s2-runtime-tool-generation-pr1.md)  
**Status:** Review Complete  

---

## 1. Executive Summary

The **S2 Runtime Tool Generation — PR 1 Implementation Plan** is an exceptionally thorough, disciplined, and test-driven engineering plan. It converts the design specification into 18 well-scoped tasks with clear interfaces, failing test steps, minimal implementations, and strict invariant tracking.

### Key Strengths of the Plan

1. **Disciplined Ordering & Gate Architecture (Tasks 8, 9, 13):**  
   Refusals (kill-switch, org policy, session budget, sandbox confinement probe) are strictly evaluated *before* owner consent, preventing capability probing and rubber-stamp fatigue.
2. **Official SDK Client over `@mastra/mcp` (Task 12):**  
   Choosing `@modelcontextprotocol/sdk`'s `Client` + `StdioClientTransport` avoids monkey-patching `@mastra/mcp`'s private fields, providing first-class support for `client.setRequestHandler(BROKERED_FETCH_METHOD, ...)`.
3. **Fail-Closed Egress Ledgering & SSRF Hardening (Tasks 4, 6):**  
   The broker strictly checks resolved IP addresses against loopback, private subnets, and cloud metadata (`169.254.169.254`) and enforces fail-closed ledgering (aborting the fetch if the audit append fails).
4. **Platform-Tested Sandbox Confinement (Tasks 8, 18):**  
   The PAL probe runner and integration tests assert empty-network sandbox enforcement with positive controls across Windows, macOS, and Linux.

This review identifies **4 critical implementation blockers/bugs** that will cause build/runtime failures during execution, along with **5 high-impact architectural and operational improvements**.

---

## 2. Critical Implementation Blockers & Bugs

### 2.1 Module Resolution & Sandbox Filesystem Denials in Child Tool Process (Tasks 7 & 12)

- **Context:**  
  In **Task 7** (`toolgen-stub.ts`), `emitToolScript` generates a script containing:
  ```ts
  import { Server } from "@modelcontextprotocol/sdk/server/index.js";
  import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
  ```
  In **Task 11** (`toolgen-script-store.ts`), the script is saved to `<configDir>/toolgen/ephemeral/<toolId>/index.ts`.  
  In **Task 7** (`buildGeneratedManifest`), the sandbox manifest grants read access **only** to `scriptDir`:
  ```ts
  permissions: {
    network: [],
    filesystem: {
      read: opts.scriptDir === undefined ? [] : [opts.scriptDir],
      write: [],
    },
  }
  ```
- **The Failure Modes:**
  1. **Node/Bun Module Resolution Failure:** `<configDir>` (e.g. `~/.config/nimbus/` or `C:\Users\user\.nimbus\`) does not contain `node_modules/@modelcontextprotocol/sdk`. When Bun runs `index.ts` from that ephemeral directory, module resolution fails with `Cannot find package '@modelcontextprotocol/sdk'`.
  2. **Windows AppContainer Access Denied (Exit 68):** On Windows, the AppContainer helper writes access control entries (ACEs) *only* for declared `filesystem.read` paths. Because `process.execPath`'s directory (the Bun binary directory) is not in `permissions.filesystem.read`, the sandboxed child process immediately dies on launch with exit code 68 (as documented in `packages/gateway/src/exec/exec-runtimes.ts:50`).
- **Resolution:**
  1. `buildGeneratedManifest` (or `toolgen-gate.ts`) must include the Bun runtime directory in `filesystem.read` via `resolveRuntimeById("bun").requiredReadPaths()` (matching `exec-gate.ts:174`).
  2. For module resolution, resolve the absolute file URLs of the SDK server modules when constructing the template:
     ```ts
     const sdkServerUrl = new URL(import.meta.resolve("@modelcontextprotocol/sdk/server/index.js")).href;
     const sdkStdioUrl = new URL(import.meta.resolve("@modelcontextprotocol/sdk/server/stdio.js")).href;
     ```
     Or pass `NODE_PATH` in `extensionProcessEnv` pointing to the Gateway's `node_modules` and grant that path in `filesystem.read`.

---

### 2.2 Unexported `probePath` in `@nimbus-dev/sdk/testing` (Task 8)

- **Context:**  
  In **Task 8 Step 3** (`packages/gateway/src/toolgen/toolgen-confinement.ts`), line 1523 imports `probePath`:
  ```ts
  import { probePath } from "@nimbus-dev/sdk/testing";
  ```
- **Codebase Reality (`node_modules/@nimbus-dev/sdk/dist/testing/index.d.ts`):**  
  `@nimbus-dev/sdk/testing` exports only:
  - `runSandboxContractTests`
  - `expectNoRejectedDiagnostics`
  - `MockGateway`
  `probePath` is an internal helper in `sandbox-contract.ts` and is **not exported** by the package entry point.
- **Impact:**  
  TypeScript compilation (`bun run typecheck`) and runtime imports will fail with:
  `Module '"@nimbus-dev/sdk/testing"' has no exported member 'probePath'.`
- **Resolution:**  
  In `toolgen-confinement.ts`, resolve the probe script path using `import.meta.resolve`:
  ```ts
  import { fileURLToPath } from "node:url";
  import { dirname, resolve } from "node:path";

  function resolveProbeScript(): string {
    const sdkIndex = fileURLToPath(import.meta.resolve("@nimbus-dev/sdk"));
    // Under src/ (bun test) vs dist/ (published package):
    const probeName = sdkIndex.endsWith(".ts") ? "sandbox-probe.ts" : "sandbox-probe.js";
    return resolve(dirname(sdkIndex), "testing", probeName);
  }
  ```

---

### 2.3 Uncaught DNS Resolution Errors in `ToolgenBroker.handleFetch` (Task 6)

- **Context:**  
  In **Task 6 Step 3** (`packages/gateway/src/toolgen/toolgen-broker.ts`), lines 1207–1213:
  ```ts
  const address = await this.#deps.resolveHost(host);
  if (isForbiddenAddress(address)) {
    return refuse(
      "ERR_TOOLGEN_HOST_NOT_ALLOWED",
      `${host} resolves to a forbidden address (${address})`,
    );
  }
  ```
- **Issue:**  
  If the destination host fails to resolve (e.g. DNS lookup failure, `getaddrinfo ENOTFOUND`, offline network), `this.#deps.resolveHost(host)` will reject. Because this call sits outside a `try...catch` block, the rejection bypasses `refuse()`, meaning **no `blocked` row is appended to `egress_ledger`** and an unformatted runtime exception is thrown.
- **Impact:**  
  Violates the invariant that any outbound fetch attempt past request parsing must produce an `egress_ledger` row (authorized or blocked).
- **Resolution:**  
  Wrap host resolution in a `try...catch` and route failures to `refuse()`:
  ```ts
  let address: string;
  try {
    address = await this.#deps.resolveHost(host);
  } catch (err) {
    return refuse(
      "ERR_TOOLGEN_HOST_NOT_ALLOWED",
      `failed to resolve host ${host}: ${(err as Error).message}`,
    );
  }
  if (isForbiddenAddress(address)) {
    return refuse(
      "ERR_TOOLGEN_HOST_NOT_ALLOWED",
      `${host} resolves to a forbidden address (${address})`,
    );
  }
  ```

---

### 2.4 Missing Invariant I11 (`wrapToolForLlm`) on Generated Tools (Task 14)

- **Context:**  
  In **Task 14** (`toolgen-agent-tools.ts`), `buildGeneratedTools` constructs Mastra tools:
  ```ts
  out[toolId] = createTool({
    id: toolId,
    description: `${description} (runtime-generated, approved this session)`,
    inputSchema: z.object({}).passthrough(),
    execute: async ({ context }) => await invoke(toolId, context as Record<string, unknown>),
  });
  ```
- **Issue:**  
  Every tool exposed to LLM agents across the gateway is wrapped with `wrapToolForLlm` (`engine/tool-output-envelope.ts` / `engine/agent.ts`) to enclose results in `<tool_output service="..." tool="...">` tags. Untrusted data returned by generated tools must be quarantined so that prompt injections inside tool responses are treated as data rather than instructions.
- **Impact:**  
  Generated tool responses would be returned raw, violating Invariant **I11** and opening the agent to prompt injection from external API responses.
- **Resolution:**  
  In `packages/gateway/src/engine/agent.ts`, ensure tools generated by `buildGeneratedTools` pass through `wrapToolForLlm`:
  ```ts
  // In packages/gateway/src/toolgen/toolgen-agent-tools.ts:
  import { wrapToolForLlm } from "../engine/agent.ts"; // or wrapToolOutput from engine/tool-output-envelope.ts
  ```

---

## 3. High-Impact Architectural & Operational Improvements

### 3.1 Hostname Normalization in `createGeneratedTool` (Tasks 13 & 16)

- **Scenario:**  
  A user runs `nimbus tool create --host https://api.gitea.example/v1` or passes `api.gitea.example:443`.
- **Improvement:**  
  Normalize hostnames before creating the artifact:
  ```ts
  export function normalizeHost(raw: string): string {
    const trimmed = raw.trim().toLowerCase();
    const candidate = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
    try {
      return new URL(candidate).hostname;
    } catch {
      return trimmed.split(":")[0]?.split("/")[0] ?? trimmed;
    }
  }
  ```

---

### 3.2 Dynamic Credential Setting & Artifact `credentialHosts` Clarity (Tasks 3, 5, 13)

- **Scenario:**  
  When `nimbus tool create` runs, a new `toolId` is generated. At approval time, no credentials exist yet in Vault, so `credentialHosts` is `[]`. The owner then runs `nimbus tool credential set <toolId> <host>`.
- **Improvement:**  
  Clarify in Task 5 and Task 13 that `toolgen-broker.ts` dynamically queries the Vault via `readToolCredential(toolId, host)` on every outbound fetch. When `nimbus tool credential set` is executed, it can optionally update the in-memory `ToolgenEnvelope` in `ToolgenRegistry` to keep the runtime status inspection accurate.

---

### 3.3 `egress-coverage.test.ts` Wire Format Updates (Tasks 2 & 12)

- **Details:**  
  In `packages/gateway/src/egress/egress-coverage.test.ts`, tests assert exact string equality on `CANONICAL` and `THIS_BINARY_COVERAGE`.
  - In **Task 2**: `CANONICAL` must be updated to append `tool=none`.
  - In **Task 12**: `CANONICAL` must be updated to `tool=per-call`, and `THIS_BINARY_COVERAGE.tool` asserted as `per-call`.
  Explicitly noting this in the step instructions avoids unexpected test failures during step verification.

---

### 3.4 Gateway Graceful Shutdown Cleanup (Tasks 10 & 11)

- **Details:**  
  In `packages/gateway/src/gateway-main.ts`, register a cleanup hook for toolgen during shutdown:
  ```ts
  // On gateway SIGINT / SIGTERM / shutdown:
  await toolgenRegistry.revokeAll();
  await removeAllToolScripts(configDir);
  ```
  This ensures no orphaned Bun child processes or ephemeral files linger after gateway restart.

---

### 3.5 Non-TTY Rejection in `nimbus tool create` (Task 16)

- **Details:**  
  In `packages/cli/src/commands/tool.ts`, explicitly guard `create`:
  ```ts
  if (!process.stdin.isTTY) {
    console.error("error: nimbus tool create requires an interactive TTY for owner approval.");
    console.error("For automated or headless environments, use the LAN-forbidden IPC method toolgen.create.");
    process.exit(TOOL_EXIT_CODES.refused);
  }
  ```

---

## 4. Verification Checklist & Testing Summary

| Test Area | Task | Critical Verification |
|---|---|---|
| **Config Parsing** | Task 1 | Verify `[tool_generation]` defaults off and non-positive numbers are ignored |
| **Egress Ledger** | Task 2, 12 | Verify `tool` coverage class transitions `"none"` -> `"per-call"` in Task 12 |
| **Artifact Canonicalization** | Task 3 | Verify BLAKE3 artifact digest is deterministic regardless of key order |
| **SSRF & Address Guard** | Task 4 | Verify IPv4/IPv6 loopback, RFC 1918, and `169.254.169.254` are rejected |
| **Per-Host Credentials** | Task 5 | Verify credential for host A is never attached to host B |
| **Broker Egress** | Task 6 | Verify fail-closed ledgering (append failure aborts request) |
| **Confinement Probe** | Task 8 | Verify PAL probe runner executes probe under empty-network policy |
| **Consent Broker** | Task 9 | Verify verbatim body broadcast and fail-closed TTL timeout |
| **Registry Isolation** | Task 10, 11 | Verify tools are session-scoped and scripts stored with `0o600` permissions |
| **Gate Order** | Task 13 | Verify all refusals happen *before* calling `requestApproval` |
| **LAN Forbid** | Task 15 | Verify `toolgen` is rejected over LAN as a whole namespace |
| **CLI Band** | Task 16 | Verify exit codes 126 (denied) and 127 (refused) |
| **Static Audit (D29)** | Task 17 | Verify static check scripts detect duplicate literals and non-empty manifests |
| **Positive Control** | Task 18 | Verify raw `fetch()` fails sandboxed and passes unconfined on all 3 OSes |
