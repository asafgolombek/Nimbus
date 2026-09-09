# Design Review: S2 — Runtime Tool Generation

**Date:** 2026-09-09  
**Reviewer:** Antigravity (AI Coding Assistant)  
**Status:** Review Complete  
**Target Spec:** [`2026-09-09-s2-runtime-tool-generation-design.md`](./2026-09-09-s2-runtime-tool-generation-design.md)  
**Slot:** [Spine S2 — Local Compute Fleet](../../roadmap.md#active)  
**Reserves:** Invariant **I39**, Static Rule **D29**, Egress Coverage Class **`tool`**, Capability `tool_generation`, Config `[tool_generation]`

---

## 1. Executive Summary

The target specification provides an exceptionally well-conceived and rigorous architectural design for runtime tool generation. It directly addresses the highest-threat attack vector in the system: **an LLM drafting executable code while holding untrusted, indexed connector data in its context**.

### Key Architectural Strengths

1. **Defense Independent of Model Cooperation (§ 1, § 4.3):**  
   The design fundamentally rejects prompt-level constraints or model honor-systems. The manifest is Nimbus-constructed with `permissions.network: []` by construction, forcing the child process into an offline sandbox on all three operating systems (Linux netns `--unshare-net`, macOS `(deny default)`, Windows AppContainer without `internetClient`).
2. **Brokered Egress as Platform Equalizer (§ 3, § 4):**  
   Recognizing that Windows AppContainer network filtering is all-or-nothing (preventing per-host enforcement at the OS level), the design strips network access entirely and routes all HTTP requests through a gateway broker (`toolgen-broker.ts`) over bidirectional stdio. This eliminates OS capability asymmetry and provides 100% reliable per-host egress enforcement across Windows, macOS, and Linux.
3. **Strict Credential Isolation (§ 6.3):**  
   Generated tools never receive raw credentials. The Gateway broker resolves destination hosts, matches approved `{host -> vault key}` bindings, and attaches credentials during outbound fetch. Existing connector secrets are never inherited (mirroring I37).
4. **Verbatim Approval & Fail-Closed Gate (§ 5, § 11):**  
   The human owner approves the verbatim canonical artifact (`GeneratedToolArtifact`), never a summary or digest. All environmental and policy refusals are evaluated before prompting the owner, preventing capability probing.
5. **Egress Ledger Completeness (§ 6, I29):**  
   Adding the `tool` coverage class to `COVERAGE_CLASSES` with `per-call` granularity and fail-closed pre-request ledgering closes what would otherwise be a silent exfiltration blind spot.

Below are critical implementation resolutions, protocol specifications, edge-case hardening, and architectural improvements required for PR 1–3.

---

## 2. Critical Implementation Blockers & Resolutions

### 2.1 The `runSandboxContractTests` POSIX Trap (Unsandboxed `__defaultRunProbe`)

- **Context in Spec (§ 7, § 13):**  
  The spec notes that `runSandboxContractTests(manifestPath)` from `@nimbus-dev/sdk/testing` will be called in Step 6 to verify manifest confinement.
- **Codebase Analysis (`node_modules/@nimbus-dev/sdk/src/testing/sandbox-contract.ts`):**  
  Inspection of the SDK implementation reveals:

  ```ts
  // In @nimbus-dev/sdk/src/testing/sandbox-contract.ts:
  export function __defaultRunProbe(probe: string, arg: string, binary: string): ProbeResult {
    // Spawns process.execPath DIRECTLY without any sandbox wrapping!
    const result = spawnSync(process.execPath, [binary, `--probe=${probe}`, `--arg=${arg}`], {
      encoding: "utf8",
    });
    return { status: result.status ?? -1, stderr: result.stderr ?? "", stdout: result.stdout ?? "" };
  }

  ```

  When `permissions.network` is `[]`, `runSandboxContractTests` skips network probes and runs **only** the `fs-denied` probe.  
  In `sandbox-probe.ts`, the `fs-denied` probe attempts `readFile("/etc/passwd", "utf8")` (on POSIX) or `SAM` (on Windows).  
  Because `/etc/passwd` is world-readable on Linux and macOS, an **unconfined** child process will read it successfully and exit with status `2` (`SANDBOX_PROBE_EXIT.unexpected`).  
  `runSandboxContractTests` will then throw:

```text

  Error: fs-denied probe should have returned EACCES (exit 10); got exit 2.

  ```

- **Consequence:**  
  Calling `runSandboxContractTests(manifestPath)` without options in `toolgen-gate.ts` will **fail 100% of the time on Linux and macOS**, permanently blocking every tool generation request before consent.
- **Resolution & Required Wiring:**  
  `toolgen-gate.ts` must pass a custom `runProbe` via `opts.runProbe` that executes the probe binary using `deps.runner` (the platform `SandboxRunner`) configured with the policy derived from the generated manifest:

  ```ts

  // toolgen/toolgen-gate.ts
  import { runSandboxContractTests, type ProbeRunner, probePath } from "@nimbus-dev/sdk/testing";
  import { policyFromManifest } from "../platform/sandbox/sandbox-policy.ts";

  export async function verifyToolConfinement(
    manifestPath: string,
    manifest: ExtensionManifest,
    runner: SandboxRunner,
    cwd: string,
  ): Promise<void> {
    const policy = policyFromManifest(manifest);
    
    const runProbe: ProbeRunner = (probe, arg) => {
      const probeScript = probePath();
      // Execute the probe inside the actual PAL SandboxRunner under the empty-net policy:
      const res = runner.spawnSync(
        process.execPath,
        [probeScript, `--probe=${probe}`, `--arg=${arg}`],
        { policy, cwd },
      );
      return {
        status: res.exitCode,
        stdout: res.stdout,
        stderr: res.stderr,
      };
    };

    await runSandboxContractTests(manifestPath, { runProbe });
  }

  ```

---

### 2.2 `@mastra/mcp` Private Client vs. Direct `@modelcontextprotocol/sdk` Integration

- **Context in Spec (§ 13):**  
  The spec identifies as its single largest PR 1 implementation risk whether custom MCP methods survive the `@mastra/mcp` client transport.
- **Codebase Analysis (`packages/gateway/node_modules/@mastra/mcp/dist/client/client.d.ts`):**  
  `InternalMastraMCPClient` in `@mastra/mcp` stores the underlying SDK client as a private field (`private client: Client`) and exposes only a fixed set of high-level event handlers (`setElicitationRequestHandler`, `setResourceUpdatedNotificationHandler`, etc.). It **does not expose a public API to register custom server-to-client JSON-RPC request handlers**.
- **Resolution & Recommended Pattern:**  
  `toolgen/toolgen-broker.ts` and `toolgen/toolgen-registry.ts` should not attempt to monkey-patch or force `@mastra/mcp` to handle custom JSON-RPC callbacks. Instead, **generated tools should be managed directly using `@modelcontextprotocol/sdk` (`Client` + `StdioClientTransport`)**:

  ```ts

  // toolgen/toolgen-client.ts
  import { Client } from "@modelcontextprotocol/sdk/client/index.js";
  import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
  import { wrapServerSpec } from "../connectors/lazy-mesh/wrap-server-spec.ts";

  export async function spawnGeneratedToolClient(
    artifact: GeneratedToolArtifact,
    broker: ToolgenBroker,
    cwd: string,
  ): Promise<{ client: Client; transport: StdioClientTransport }> {
    const serverSpec = wrapServerSpec(
      {
        command: "bun",
        args: ["run", artifact.scriptPath],
        env: extensionProcessEnv({}),
      },
      artifact.manifest,
      cwd,
    );

    const transport = new StdioClientTransport({
      command: serverSpec.command,
      args: serverSpec.args,
      env: serverSpec.env as Record<string, string>,
      stderr: "pipe",
    });

    const client = new Client(
      { name: `nimbus-toolgen-${artifact.toolId}`, version: "1.0.0" },
      { capabilities: {} },
    );

    // First-class custom request handler registration on official SDK:
    client.setRequestHandler(BrokeredFetchSchema, async (req) => {
      return broker.handleFetch(artifact.toolId, req.params);
    });

    await client.connect(transport);
    return { client, transport };
  }

  ```

  When registering into Mastra's agent in `engine/agent.ts`, the Gateway simply queries `client.listTools()` and wraps each returned tool using `createTool` from `@mastra/core/tools` plus `wrapToolForLlm` (I11). This is clean, robust, and completely eliminates the PR 1 spike risk.

---

## 3. Protocol Specifications & Architectural Hardening

### 3.1 Brokered Egress Protocol (`nimbusFetch`) & SSRF Mitigation

To prevent ambiguity between `toolgen-stub.ts` (the client library emitted in the skeleton) and `toolgen-broker.ts` (the Gateway handler), the protocol schema must be formally defined:

```ts

// toolgen/toolgen-types.ts
import { z } from "zod";

export const BROKERED_FETCH_METHOD = "nimbus/fetch" as const;

export const BrokeredFetchRequestSchema = z.object({
  url: z.string().url(),
  method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"]).default("GET"),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
});

export type BrokeredFetchRequest = z.infer<typeof BrokeredFetchRequestSchema>;

export interface BrokeredFetchResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

```

#### Gateway Broker Security Validations (`toolgen-broker.ts`)

1. **Protocol & Host Extraction:**  
   Parse target URL with `new URL(req.url)`. Must enforce `url.protocol === "https:"` (or `"http:"` only if explicitly opted in; reject `file:`, `data:`, `gopher:`, `javascript:`).
2. **SSRF & Loopback Blacklist (Fail-Closed):**  
   Even if an owner accidentally approves `localhost` or `127.0.0.1`, the broker must refuse loopback, RFC 1918 private subnets (unless local development mode is explicitly enabled), and cloud metadata IP (`169.254.169.254`). A sandboxed tool must never reach Gateway IPC (`127.0.0.1:9099`) or internal services.
3. **Approved Host Matching:**  
   Compare `url.hostname.toLowerCase()` strictly against `approvedHosts` in the tool envelope.
4. **Header Stripping:**  
   Strip incoming `Authorization` or `Proxy-Authorization` headers supplied by the generated tool. The broker attaches authorized credentials; the tool is never permitted to set arbitrary auth headers.

---

### 3.2 Tool Script Storage & AppContainer Invocation Architecture

- **The Problem:**  
  On Windows, passing large scripts inline via `bun -e "<code>"` can exceed the `CreateProcessW` command-line length limit (32,767 characters), causing truncation or launch failures (as documented in `exec-gate.ts:159`).
- **Resolution:**  
  1. For each approved tool, `toolgen-gate.ts` writes the verbatim approved code body to an ephemeral file located in a dedicated gateway directory:  
     `<configDir>/toolgen/ephemeral/<toolId>/index.ts`
  2. The file is written with strict file permissions (`0o600` POSIX / ACL owner-only Windows).
  3. The sandbox policy (`buildToolgenSandboxPolicy`) grants read-only access **strictly** to that generated tool directory and the Bun runtime binaries.
  4. On session revocation or Gateway shutdown, the ephemeral directory is cleaned up.

---

### 3.3 Session Scoping, Multi-Turn Lifetime, and Tools Epoch Bumping

- **Session Definition:**  
  In Nimbus, an ephemeral tool is scoped to an active agent `sessionId`.
- **Dynamic Tool Registration in Agent Runtime:**  
  When a tool is created via `toolgen.create` or `propose_tool`, `ToolgenRegistry` updates its session map.  
  To make new tools visible to subsequent turns of the agent:
  - Inject `toolgenRegistry: ToolgenRegistry` into `AgentDeps` (`packages/gateway/src/engine/agent.ts`).
  - In `buildAgentTools`, call `buildGeneratedTools(sessionId, deps.toolgenRegistry)`:

    ```ts

    // In packages/gateway/src/engine/agent.ts
    ...(deps.toolgenRegistry !== undefined
      ? buildGeneratedTools(sessionId, deps.toolgenRegistry)
      : {}),

    ```

  - When no live session holds generated tools, `buildGeneratedTools` returns `{}` (reproducing the `buildComputerUseTools` zero-tool guarantee).
- **Process Crash / Disconnect Handling:**  
  If the child MCP process crashes or exits, `ToolgenRegistry` detects the `close` event and either attempts a single clean restart or marks the tool status as `terminated`, returning an informative error on subsequent LLM invocations.

---

### 3.4 Request Budgeting, Timeout Aborts, and Response OOM Defenses

To enforce the configuration parameters specified in § 9:

1. **`max_requests_per_tool` (Default 50):**  
   Tracked atomically in `toolgen-broker.ts` per `toolId`. If request count exceeds `max_requests_per_tool`:
   - Broker appends an egress ledger row with `result_status='blocked'`.
   - Broker throws `ToolgenBudgetExhaustedError`, returning an MCP error to the tool process.
2. **`request_timeout_ms` (Default 10,000ms):**  
   Enforced via `AbortController` linked to `setTimeout`. Passed directly to `globalThis.fetch(url, { signal })`.
3. **Response Body OOM Protection (`MAX_BROKERED_RESPONSE_BYTES = 5 * 1024 * 1024`):**  
   If an external endpoint returns a massive payload (e.g. streaming a 1 GB file), the broker must read the stream with a chunk-size accumulator and abort if the response exceeds 5 MiB, returning an error rather than crashing the Gateway with OOM.

---

### 3.5 Credential Storage Schema & Multi-Scheme Injection

- **Vault Key Layout:** `toolgen.<toolId>.<hostSlug>`
- **Credential Payload Format:**  
  Store a JSON envelope in the Vault to support Bearer tokens, API Keys, and Custom Headers:

  ```ts

  export type ToolCredentialBinding =
    | { readonly type: "bearer"; readonly token: string }
    | { readonly type: "header"; readonly headerName: string; readonly value: string }
    | { readonly type: "basic"; readonly username: string; readonly password: string };

  ```

- **Broker Injection Logic:**  
  Before executing `fetch`, `toolgen-broker.ts` queries `toolgen-credentials.ts` for the target host's binding and applies the header:
  - `"bearer"` -> `headers["Authorization"] = "Bearer " + binding.token`
  - `"header"` -> `headers[binding.headerName] = binding.value`
  - `"basic"` -> `headers["Authorization"] = "Basic " + btoa(binding.username + ":" + binding.password)`

---

### 3.6 PR 3 Local Tool Signing Architecture & Invariant I16 Integration

Spec § 10 raises the question of how persistent tools in PR 3 interact with Invariant **I16** (which requires Ed25519 signature verification at install and startup for publisher extensions).

- **Architecture for Local Tool Signing:**
  1. The Gateway generates a local tool-signing keypair stored in Vault:
     - `toolgen.signing.pubkey` (Base64)
     - `toolgen.signing.privkey` (Base64)
  2. When the user executes `nimbus tool save <toolId>`:
     - The canonical artifact bytes (`GeneratedToolArtifact`) are hashed with BLAKE3.
     - The digest is signed with `toolgen.signing.privkey` via `@noble/curves/ed25519`.
     - The tool is saved into `<configDir>/extensions/local.<toolId>/` with manifest, script, and signature `nimbus.sig`.
  3. On Gateway startup, `verifyExtensions` recognizes `local.*` extensions and verifies them against `toolgen.signing.pubkey`. If the file is modified on disk by malware or another process, the signature verification fails and the extension is refused fail-closed.
  4. This satisfies I16 completely without requiring third-party publisher infrastructure.

---

## 4. Technical Improvements & Suggestions

### 4.1 CLI Subcommand Interface & Human-Facing Formatting

Specify the exact CLI subcommands for `packages/cli/src/commands/tool.ts`:

- `nimbus tool create [--file <path>] [--description <text>] [--hosts <h1,h2>]`:  
  Initiates tool generation. Launches interactive TTY prompt showing full drafted code, manifest, and host bindings for owner approval.
- `nimbus tool list [--session <id>] [--json]`:  
  Lists active in-memory generated tools, session IDs, approved hosts, and request counts.
- `nimbus tool revoke <tool-id>`:  
  Immediately terminates the tool's sandboxed process and drops it from `ToolgenRegistry`.
- `nimbus tool credential set <tool-id> <host> [--bearer <token> | --header <name> <value>]`:  
  Securely writes host credential to Vault under `toolgen.<toolId>.<hostSlug>`.

---

### 4.2 Error Codes for `toolgen-gate.ts`

Standardize error codes for pre-consent and post-approval failures:

| Error Code | Trigger Condition |
|---|---|
| `ERR_TOOLGEN_DISABLED` | `[tool_generation] enabled = false` |
| `ERR_TOOLGEN_POLICY_DISABLED` | `EnforcedPolicy.capabilitiesDisabled` contains `tool_generation` |
| `ERR_TOOLGEN_AGENT_INITIATED_REFUSED` | Agent-initiated proposal while `allow_agent_initiated = false` |
| `ERR_TOOLGEN_SESSION_BUDGET_EXCEEDED` | Exceeded `max_tools_per_session` |
| `ERR_TOOLGEN_SANDBOX_DEGRADED` | `runner.canConfine(emptyPolicy)` returns non-null error |
| `ERR_TOOLGEN_CONTRACT_TEST_FAILED` | Sandbox contract test failed confinement assertion |
| `ERR_TOOLGEN_HOST_NOT_ALLOWED` | Requested host not in `[tool_generation] allowed_hosts` (PR 2) |
| `ERR_TOOLGEN_INVALID_MANIFEST` | Manifest schema validation failed |

---

### 4.3 Egress Coverage Vector & `prove` Label Mirroring

1. **`packages/gateway/src/egress/egress-coverage.ts`:**

   ```ts

   export const COVERAGE_CLASSES = [
     "browser",
     "chatops",
     "http",
     "mcp",
     "model",
     "peer",
     "session",
     "sync",
     "task",
     "tool", // 10th member, alphabetically sorted at end
   ] as const;

   ```

   Raise `THIS_BINARY_COVERAGE.tool` from `"none"` to `"per-call"`.

2. **`packages/cli/src/commands/prove.ts`:**
   Add display label to `COVERAGE_CLASS_LABELS`:

   ```ts

   tool: "outbound requests made by sandboxed runtime-generated tools",

   ```

---

## 5. Security Invariants (I39) & Static Audit (D29) Verification Plan

### 5.1 Invariant I39 Runtime Test Matrix (`security-invariants.test.ts`)

1. **Positive Control for Raw `fetch()` Rejection:**  
   Execute a generated tool that attempts a raw `globalThis.fetch()` to an approved host.  
   - Positive control: Same fetch succeeds in an unconfined process.  
   - Sandboxed execution: Must fail at the OS level (exit non-zero / network unreachable) on Windows, macOS, and Linux.
2. **Brokered Fetch to Unapproved Host:**  
   A generated tool calling `nimbusFetch("https://unapproved.com")` must be rejected by `toolgen-broker.ts` and record a `blocked` row in `egress_ledger`.
3. **Fail-Closed Egress Ledgering:**  
   Simulate a database error on `egress_ledger` append. The broker must immediately abort the outbound fetch and return an error to the tool.
4. **Credential Confinement:**  
   Ensure a tool approved for `host-a.com` and `host-b.com` never attaches `host-a`'s credentials to a request destined for `host-b.com`.
5. **Pre-Consent Refusal Assertions:**  
   For each refusal condition (`ERR_TOOLGEN_DISABLED`, `ERR_TOOLGEN_POLICY_DISABLED`, degraded sandbox, failing contract test), assert that `requestApproval` was **never called**.

---

### 5.2 Static Rule D29 Implementation (`check-nimbus-invariants.ts`)

Add three static check functions in `scripts/structure-audit/check-nimbus-invariants.ts`:

1. **`checkBrokeredFetchLiteralConfinement` (D29a):**  
   Assert that `"nimbus/fetch"` appears only in:
   - `packages/gateway/src/toolgen/toolgen-stub.ts`
   - `packages/gateway/src/toolgen/toolgen-broker.ts`
   - `packages/gateway/src/toolgen/toolgen-types.ts`
2. **`checkGeneratedManifestConfinement` (D29b):**  
   Assert that the generated manifest factory lives only in `toolgen-stub.ts` and contains `permissions: { network: [], ... }` with no variables or overrides.
3. **`checkToolgenVaultKeyConfinement` (D29c):**  
   Assert that `toolgen.` Vault prefix construction is confined exclusively to `packages/gateway/src/toolgen/toolgen-credentials.ts`.
