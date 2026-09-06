# Design Review: S2 — Overnight Sub-Agent Fleets on Zero-Marginal Local Compute

**Date:** 2026-09-06  
**Reviewer:** Antigravity (AI Coding Assistant)  
**Status:** Review Complete  
**Target Spec:** [`2026-09-06-s2-overnight-agent-fleets-design.md`](./2026-09-06-s2-overnight-agent-fleets-design.md)  
**Slot:** [Spine S2 — Local Compute Fleet](../../roadmap.md#active)  
**Reserves:** Invariant **I38**, Static Rule **D28**, Schema **V60**, Capability `agent_fleet`, ClientKind `fleet`

---

## 1. Executive Summary

The target specification presents a sound, privacy-first architectural design for scheduling unattended, overnight agent runs on local compute. Key strengths of the design include:

1. **Honest Host Admission (§ 4):** Treating battery and user idle state as structural gates prevents the fleet from draining laptop batteries or introducing input latency during active workstation use. Admitting on `power === "unknown"` ensures headless servers and desktop workstations without batteries are not falsely blocked.
2. **Strict Read-Only Bounds (§ 2):** Explicitly excluding writes, autonomous actions, standing approvals, and LLM-callable execution paths ensures that unattended runs cannot perform unexpected state mutations or violate invariant I33.
3. **Total Eligibility Map (§ 6.1):** Enforcing a total mapping (`FLEET_ELIGIBILITY: Record<AgentMethod, FleetEligibility>`) over `AGENTS_RPC_HANDLERS` rather than an exclusion set ensures that newly added agents fail closed at compile time until explicitly classified.
4. **Attribution & Egress Confinement (I38 / D28, § 7–8):** Confining the `"fleet"` `ClientKind` attribution to `ipc/server/client-kind.ts`, `egress/egress-bearing-kinds.ts`, and `fleet/fleet-invoker.ts` prevents arbitrary callers from masquerading as fleet runs, while keeping the brief generation path strictly zero-egress unless `[fleet] allow_remote` and call budgets are explicitly granted.

Below are resolutions to open questions raised in the spec, critical architectural considerations, and concrete improvements for the PR 1 implementation plan.

---

## 2. Resolutions to Open Questions Stated in Spec

### Q2.1: Mechanism for Pinning Fleet Run Synthesis to Local Providers (§ 8.1)

- **Spec Question:** Whether the local synthesis pin should be a restricted `SynthesisRouter` instance, a per-call task pin, or a reuse of `enforce_air_gap`'s refusal path.
- **Codebase Analysis:**
  - In `packages/gateway/src/agents/_lib/agent-synthesis-runner.ts`, `buildAgentSynthesisRunner` accepts an injectable `router: SynthesisRouter | undefined`.
  - In `packages/gateway/src/agents/_lib/synthesis-llm.ts`, `buildSynthesisRunner` calls `deps.router.resolveForSynthesis(preferLocal: true)` and `deps.router.generateMarkdown(...)`.
  - `LlmRouter.setTaskPin` mutates router state globally across all callers on the gateway, which would introduce race conditions between concurrent interactive calls and background fleet runs.
  - `enforce_air_gap` is a global router configuration flag that refuses remote calls gateway-wide.
- **Resolution & Recommended Pattern:**
  - `fleet/fleet-invoker.ts` should wrap `LlmRegistry.llmRouter` in a scoped `FleetSynthesisRouter` implementing `SynthesisRouter`:

    ```ts
    export interface FleetSynthesisBudgetTracker {
      readonly allowRemote: boolean;
      getRemainingBudget(): number;
      consumeRemoteCall(): boolean;
    }

    export function createFleetSynthesisRouter(
      inner: SynthesisRouter,
      budget: FleetSynthesisBudgetTracker,
    ): SynthesisRouter {
      return {
        async resolveForSynthesis(preferLocal = true): Promise<ResolvedSynthesisProvider | undefined> {
          const resolved = await inner.resolveForSynthesis(preferLocal);
          if (resolved === undefined) return undefined;
          // If remote is resolved but fleet is not permitted to use remote or budget is exhausted:
          if (!resolved.isLocal && (!budget.allowRemote || budget.getRemainingBudget() <= 0)) {
            return undefined;
          }
          return resolved;
        },
        async generateMarkdown(prompt, provider, egressMethod): Promise<string> {
          if (!provider.isLocal) {
            if (!budget.allowRemote || !budget.consumeRemoteCall()) {
              throw new Error("Fleet remote synthesis call budget exhausted or not permitted");
            }
          }
          return inner.generateMarkdown(prompt, provider, egressMethod);
        },
      };
    }
    ```

  - **Benefits:**
    1. Zero mutation of global router state.
    2. Enforces I38 by construction directly at the synthesis invocation seam.
    3. Accurately tracks and decrements remaining run budget across sequential jobs.
    4. Automatically falls back to deterministic brief generation when no local provider exists and remote is not granted.

---

### Q2.2: TOML Parser Support for Inline Tables & `[[fleet.job]]` Schema (§ 10.1)

- **Spec Question:** Whether the hand-rolled TOML parser supports inline tables (`params = { ... }`).
- **Codebase Analysis:**
  - Inspection of `packages/gateway/src/config/toml-primitives.ts` and `packages/gateway/src/config/filesystem-toml.ts` confirms that the parser operates via line-by-line scanning using `splitKeyValue`, `parseString`, `parseIntDec`, and `parseBool`.
  - The parser does **not** support inline tables (e.g. `{ a = 1, b = "two" }`) or multi-line nested structures.
- **Resolution & Configuration Schema:**
  - `[[fleet.job]]` in `config/fleet-toml.ts` must use flat, validated key-value pairs (matching `[[filesystem.roots]]` in `filesystem-toml.ts` and `[metrics.dora.*]` in `service-config-toml.ts`).
  - Example schema:

    ```toml
    [fleet]
    enabled = true
    allow_remote = false
    remote_call_budget = 0
    min_idle_seconds = 900
    require_ac_power = true
    retention_days = 14

    [[fleet.job]]
    name = "morning_catchup"
    agent = "catchup"
    interval_seconds = 86400
    since_ms = 86400000
    service = "github"

    [[fleet.job]]
    name = "weekly_ownership"
    agent = "ownership"
    interval_seconds = 604800
    path = "packages/gateway"
    ```

  - Each agent's accepted flat keys are mapped to their respective RPC parameter types in `fleet/fleet-invoker.ts` before calling `dispatchAgentsRpc`.

---

### Q2.3: Platform Probing Behavior on CI Runners & Headless Hosts (§ 12)

- **Windows:**
  - `GetSystemPowerStatus` (`kernel32.dll`) returns `ACLineStatus = 1` (Online) on standard GitHub Actions Windows runners, or `255` (Unknown).
  - `GetLastInputInfo` (`user32.dll`) returns a valid tick timestamp on desktop/runner sessions.
- **macOS:**
  - `ioreg -c IOHIDSystem` on headless CI instances (such as GitHub Actions macOS runners with no physical display/HID inputs) may return 0 or lack an active `HIDIdleTime` entry.
  - The probe must treat missing or unparseable `HIDIdleTime` as `idleMs: null` and report `source: "power_only"`, rather than throwing or failing admission.
- **Linux:**
  - GitHub Actions Linux virtual machines typically have no `/sys/class/power_supply/` directory (or it is empty), causing the power probe to return `"unknown"`.
  - Headless Linux hosts have no standard user input subsystem (no X11/Wayland event loop), so `idleMs` is always `null`.
  - As § 4.4 specifies, `power === "unknown"` and `idleMs === null` must admit with `source: "power_only"`, ensuring that Linux CI and server deployments function reliably.

---

## 3. Architectural & Security Open Questions

### Q3.1: Asynchronous Dispatch vs. Sequential Job Completion in `fleet-scheduler`

- **Context:**
  - In `packages/gateway/src/agents/_lib/emit-brief.ts`, agent execution is fire-and-forget:

    ```ts
    export async function emitBriefWithSynthesis<B extends AnyBrief>(opts) {
      void (async () => {
        const brief = await opts.buildBrief();
        const { markdown, provenance } = await synthesize(...);
        opts.notify(opts.briefReadyMethod, { sessionId, brief: markdown, findings: brief, synthesis: provenance });
      })().catch(err => {
        opts.notify(opts.briefErrorMethod, { sessionId, error: ... });
      });
      return { sessionId: opts.sessionId };
    }
    ```

  - When `dispatchAgentsRpc` is called, it returns `{ sessionId }` immediately, before the background brief generation and synthesis even begin.
- **The Concurrency & Scheduling Problem:**
  - If `fleet-invoker.ts` simply awaits `dispatchAgentsRpc`, it will resolve in ~1ms while the brief is still being generated asynchronously in the background.
  - If `fleet-scheduler.ts` then proceeds to the next job in its loop, it will launch all configured fleet jobs concurrently rather than sequentially.
  - This would overwhelm local CPU/GPU resources, violate the sequential host-activity re-probing invariant between jobs (§ 4.5), and make yield-at-job-boundary ineffective.
- **Recommendation:**
  - `fleet/fleet-invoker.ts` must return a Promise that listens for the completion notification (`.briefReady` or `.briefError`) matching the specific `sessionId`:

    ```ts
    export async function invokeFleetJob(
      job: FleetJobConfig,
      deps: FleetInvokerDeps,
    ): Promise<FleetJobExecutionResult> {
      return new Promise<FleetJobExecutionResult>((resolve) => {
        const timeoutMs = job.timeoutSeconds ? job.timeoutSeconds * 1000 : DEFAULT_JOB_TIMEOUT_MS;
        const timer = setTimeout(() => {
          resolve({ status: "failed", error: `Job timed out after ${timeoutMs}ms` });
        }, timeoutMs);

        const notify = (method: string, params: unknown) => {
          if (isBriefReady(method, params, expectedSessionId)) {
            clearTimeout(timer);
            resolve({ status: "done", brief: params.brief, findings: params.findings, synthesis: params.synthesis });
          } else if (isBriefError(method, params, expectedSessionId)) {
            clearTimeout(timer);
            resolve({ status: "failed", error: params.error });
          }
        };

        // Dispatch with customized notify sink...
      });
    }
    ```

---

### Q3.2: 32-bit Millisecond Wrap-Around on Windows `GetLastInputInfo`

- **Context:**
  - On Windows, `GetLastInputInfo` populates `LASTINPUTINFO.dwTime`, which is a 32-bit unsigned millisecond integer (`DWORD`).
  - `GetTickCount()` is also a 32-bit millisecond counter that wraps back to zero every 49.7 days of continuous system uptime.
- **The Risk:**
  - If calculated naively with signed arithmetic (`getTickCount() - plii.dwTime`), when `GetTickCount()` wraps, the difference becomes negative or an invalid huge number, permanently preventing host admission or causing false idle triggers.
- **Recommendation:**
  - Compute elapsed idle milliseconds using unsigned 32-bit modulo arithmetic:

    ```ts
    const idleMs = ((getTickCount() - lastInputInfo.dwTime) >>> 0);
    ```

---

### Q3.3: Linux Power Supply Discovery Multi-Adapter Naming

- **Context:**
  - Spec § 4.3 lists `/sys/class/power_supply/AC*/online`.
  - On different Linux distributions and hardware configurations, mains AC adapters are frequently named `/sys/class/power_supply/ADP1`, `/sys/class/power_supply/ACAD`, `/sys/class/power_supply/Mains`, or similar.
  - Furthermore, laptops may have multiple battery entries (`BAT0`, `BAT1`).
- **Recommendation:**
  - The Linux power probe should scan all `/sys/class/power_supply/*` entries:
    1. If any entry with `type` == `Battery` has `status` == `Discharging`, classify as `"battery"`.
    2. If any entry with `type` in `["Mains", "Mains Power", "AC"]` has `online` == `1`, classify as `"ac"`.
    3. If no battery is discharging and AC online is 1 (or no battery exists), classify as `"ac"`.
    4. Otherwise, if the directory is missing or unreadable, fall back to `"unknown"`.

---

### Q3.4: Laptop Sleep/Wake Timer Resumption Bursts

- **Context:**
  - When a laptop lid is closed or the OS enters sleep/hibernation, timers freeze.
  - If a job was scheduled for 03:00 and the user opens their laptop at 08:30, the timer fires immediately upon waking while the user is actively typing and on battery power.
- **Recommendation:**
  - `FleetScheduler` must always invoke `HostActivity.probe()` immediately upon waking from a sleep timer **before** starting any overdue job batch.
  - If the host is on battery or the user is active, overdue jobs are deferred to the next idle window rather than executed immediately.

---

### Q3.5: V60 Database Schema & Retention Policy Integration (§ 9)

- **Context:**
  - Spec § 9 specifies three new SQLite tables: `fleet_job_state`, `fleet_run`, and `fleet_brief`.
  - Org policy (`packages/gateway/src/policy/types.ts`) includes `retention.minDays` (enforced via invariant I22).
- **Schema DDL Specification:**

  ```sql
  -- V60 Fleet Tables

  CREATE TABLE IF NOT EXISTS fleet_job_state (
    job_id                TEXT PRIMARY KEY,
    agent_method          TEXT NOT NULL,
    last_attempt_at       INTEGER,
    last_success_at       INTEGER,
    consecutive_failures  INTEGER NOT NULL DEFAULT 0,
    backoff_until         INTEGER,
    last_error            TEXT
  ) WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS fleet_run (
    id                    TEXT PRIMARY KEY,
    started_at            INTEGER NOT NULL,
    ended_at              INTEGER,
    host_power            TEXT NOT NULL CHECK(host_power IN ('ac', 'battery', 'unknown')),
    host_idle_ms          INTEGER,
    host_source           TEXT NOT NULL CHECK(host_source IN ('measured', 'power_only')),
    outcome               TEXT NOT NULL CHECK(outcome IN ('completed', 'yielded', 'deferred', 'failed')),
    jobs_attempted        INTEGER NOT NULL DEFAULT 0,
    jobs_completed        INTEGER NOT NULL DEFAULT 0,
    remote_calls_made     INTEGER NOT NULL DEFAULT 0,
    remote_call_budget    INTEGER NOT NULL DEFAULT 0,
    error                 TEXT
  ) WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS fleet_brief (
    id                    TEXT PRIMARY KEY,
    run_id                TEXT NOT NULL,
    job_id                TEXT NOT NULL,
    agent_method          TEXT NOT NULL,
    brief_markdown        TEXT,
    findings_json         TEXT NOT NULL,
    synthesis_json        TEXT,
    created_at            INTEGER NOT NULL,
    expires_at            INTEGER NOT NULL,
    FOREIGN KEY(run_id) REFERENCES fleet_run(id) ON DELETE CASCADE
  ) WITHOUT ROWID;

  CREATE INDEX IF NOT EXISTS idx_fleet_brief_run_id ON fleet_brief(run_id);
  CREATE INDEX IF NOT EXISTS idx_fleet_brief_job_id ON fleet_brief(job_id);
  CREATE INDEX IF NOT EXISTS idx_fleet_brief_created ON fleet_brief(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_fleet_brief_expires ON fleet_brief(expires_at);
  CREATE INDEX IF NOT EXISTS idx_fleet_run_started ON fleet_run(started_at DESC);
  ```

- **Retention & Pruning Integration:**
  - Brief TTL pruning must compute effective retention days as:

    ```ts
    const effectiveRetentionDays = Math.max(
      config.retentionDays ?? 14,
      enforcedPolicy.retention.minDays ?? 0,
    );
    ```

  - Pruning should execute at gateway startup and immediately following each completed fleet run.

---

## 4. Technical Improvements & Suggestions

### I4.1: Wiring `[embedding] pause_on_battery` (§ 4.1)

- In `packages/gateway/src/platform/assemble.ts`, inject `hostActivity: HostActivity` into the embedding runtime deps (`createEmbeddingRuntime` / `LocalIndex`).
- In the embedding background backfill loop, check `if (config.pauseOnBattery && (await hostActivity.probe()).power === "battery")` and pause chunk processing until AC power returns, fulfilling the dead-key fix promised in § 4.1.

---

### I4.2: Job-Level Failure Isolation & Exponential Backoff

- If a specific agent brief fails (e.g. invalid repository path or database corruption), the failure must be recorded in `fleet_job_state` with incremental backoff (e.g. 1h -> 2h -> 4h up to 24h).
- The scheduler must continue to the next scheduled job in the run rather than aborting the entire fleet run.

---

### I4.3: CLI Subcommand Surface & Formatting (§ 10.2)

- Specify the CLI interface for `nimbus fleet`:
  - `nimbus fleet status [--json]`: Displays scheduler state, current power/idle probe, last run status, next scheduled job, and remote budget.
  - `nimbus fleet list [--json]`: Lists configured jobs, interval, last run time, and health.
  - `nimbus fleet briefs [--limit 10] [--agent <name>] [--json]`: Lists recent briefs.
  - `nimbus fleet show <brief-id>`: Prints the markdown brief to stdout.
  - `nimbus fleet run <job-id> [--force]`: Manually triggers a specific job; `--force` bypasses the host admission idle/power check for testing.

---

## 5. Testing & Security Invariants Verification

1. **Invariant I38 Enforcement Test (`security-invariants.test.ts`):**
   - Assert that when `[fleet] allow_remote = false`, a fleet run invoking an agent with synthesis mode enabled produces **0** `model`-class ledger rows and resolves strictly to local providers.
   - Assert that when `[fleet] allow_remote = true` with `remote_call_budget = 1`, exactly 1 remote call is permitted, and subsequent calls within the same run fall back to local or deterministic rendering, with budget exhaustion recorded in the brief's synthesis provenance.
2. **Static Rule D28 Enforcement (`check-nimbus-invariants.ts`):**
   - Add static audit rule verifying that the `"fleet"` string literal as a `ClientKind` appears **only** in:
     - `packages/gateway/src/ipc/server/client-kind.ts`
     - `packages/gateway/src/egress/egress-bearing-kinds.ts`
     - `packages/gateway/src/fleet/fleet-invoker.ts`
3. **Totality Tests for `FLEET_ELIGIBILITY`:**
   - Assert at compile time and in unit tests that `keyof typeof AGENTS_RPC_HANDLERS` matches `keyof typeof FLEET_ELIGIBILITY`.
4. **Host Admission Mocking Matrix:**
   - Test truth table against mock `HostActivity`:
     - `power: "battery", idle: 1200s, require_ac: true` -> **Refused** (outcome: `deferred`)
     - `power: "battery", idle: 1200s, require_ac: false` -> **Admitted**
     - `power: "ac", idle: 300s, min_idle: 900s` -> **Refused** (outcome: `deferred`)
     - `power: "ac", idle: 1200s, min_idle: 900s` -> **Admitted**
     - `power: "unknown", idle: null` -> **Admitted** (source: `power_only`)
     - Mid-run user return -> **Yielded at job boundary** (outcome: `yielded`, unattempted count accurate).
