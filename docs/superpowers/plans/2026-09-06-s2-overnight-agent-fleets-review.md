# Implementation Plan Review: Overnight Sub-Agent Fleets (S2, PR 1)

**Date:** 2026-09-06  
**Review Target:** [`2026-09-06-s2-overnight-agent-fleets.md`](./2026-09-06-s2-overnight-agent-fleets.md)  
**Status:** Review Complete  

---

## 1. Executive Summary

The **Overnight Sub-Agent Fleets (S2, PR 1)** implementation plan is exceptionally well-structured, disciplined, and rigorous:

1. **Strict Seam Isolation:** By routing all agent executions through `dispatchAgentsRpc` under the derived `ClientKind: "fleet"` (Task 4, 6) and decorating `SynthesisRouter` (Task 5), the plan strictly enforces invariants I29 and I38 without violating static rule D22(d).
2. **Honest Platform Probing (Task 1):** The PAL abstraction (`HostActivity`) with per-platform backends and clear degradation to `source: "power_only"` ensures cross-platform equality across Windows, macOS, and Linux without faking unmeasurable signals.
3. **Robust Test-Driven Sequence:** Every task is structured with explicit failing test cases, red-to-green verification, and strict type checking.

This review identifies **4 critical implementation bugs / blockers** that must be addressed before executing the plan, along with **5 high-impact architectural and operational improvements**.

---

## 2. Critical Implementation Blockers & Bugs

### 2.1 Missing Job Due / Interval Check in `FleetScheduler.runOnce` (Task 7)

* **Context:** In **Task 3**, `NimbusFleetJobToml` defines `intervalSeconds: number` (e.g. `86400` for daily, `604800` for weekly). In **Task 2**, `FleetJobState` tracks `lastSuccessAt: number | null` and `lastAttemptAt: number | null`.
* **Issue:** In **Task 7 Step 5** ([lines 2350–2386](./2026-09-06-s2-overnight-agent-fleets.md)), `FleetScheduler.runOnce` loops over `this.deps.jobs` and only checks whether `backoffUntil` is active:

  ```ts
  const state = this.deps.store.loadJobState(job.name);
  if (state?.backoffUntil != null && state.backoffUntil > this.deps.now()) continue;

  attempted += 1;
  const outcome = await this.deps.invoke(job);
  ```

  `FleetScheduler` **never checks `job.intervalSeconds` against `state.lastSuccessAt`**.
* **Impact:** Because `FleetScheduler.start()` ticks every 60 seconds (`TICK_MS = 60_000`), the scheduler will execute **every configured job every 60 seconds** indefinitely whenever the host is idle, running daily jobs 60 times an hour and generating dozens of duplicate briefs overnight.
* **Fix:** Add a helper `isJobDue` and filter candidate jobs in `runOnce`:

  ```ts
  function isJobDue(job: NimbusFleetJobToml, state: FleetJobState | undefined, now: number): boolean {
    if (state?.backoffUntil != null && state.backoffUntil > now) return false;
    if (state?.lastSuccessAt == null) return true; // never ran successfully
    return (now - state.lastSuccessAt) >= job.intervalSeconds * 1000;
  }
  ```

  In `FleetScheduler.runOnce`:

  ```ts
  for (const job of candidateJobs) {
    const state = this.deps.store.loadJobState(job.name);
    if (opts?.force !== true && !isJobDue(job, state, this.deps.now())) {
      continue;
    }
    // ...
  }
  ```

---

### 2.2 Missing Concurrency / Re-entrancy Guard in `FleetScheduler` (Task 7)

* **Context:** In **Task 7 Step 5**, `FleetScheduler.start()` sets up a recurring 60-second timer:

  ```ts
  this.timer = setInterval(() => void this.runOnce().catch(() => undefined), TICK_MS);
  ```

* **Issue:** An overnight fleet run that sequentially generates multiple agent briefs (e.g. cold `ownership` + `impact` with synthesis) can easily take 2–5 minutes. If a run takes longer than 60 seconds, the next timer tick triggers a second concurrent `runOnce()` execution.
* **Impact:** Multiple fleet runs will execute concurrently, opening multiple `fleet_run` records, interleaving SQLite writes, competing for the same `GpuArbiter` / local LLM, and defeating the sequential single-job execution model.
* **Fix:** Add an `inFlight` re-entrancy lock to `FleetScheduler`:

  ```ts
  export class FleetScheduler {
    private inFlight = false;
    // ...

    async runOnce(opts?: { force?: boolean; jobName?: string }): Promise<FleetRunSummary> {
      if (this.inFlight) {
        return { runId: null, outcome: "deferred", jobsAttempted: 0, jobsCompleted: 0, jobsUnattempted: this.deps.jobs.length };
      }
      this.inFlight = true;
      try {
        // execute runOnce...
      } finally {
        this.inFlight = false;
      }
    }
  }
  ```

---

### 2.3 Memory & Performance Hazard in `FleetStore.getBrief` (Task 2)

* **Context:** In **Task 2 Step 5** ([line 880](./2026-09-06-s2-overnight-agent-fleets.md)):

  ```ts
  getBrief(id: string): FleetBriefRow | undefined {
    return this.listBriefs({ limit: 1_000 }).find((b) => b.id === id);
  }
  ```

* **Issue:** `getBrief(id)` fetches up to 1,000 full brief rows (including `brief_markdown`, `findings_json`, and `synthesis_json` which can each be 10–100 KB) into V8 memory and scans with `.find()`, instead of querying SQLite by primary key.
* **Impact:**
  1. Massive memory allocation on `nimbus fleet show <id>`.
  2. If the database holds more than 1,000 briefs over a multi-month retention window, `getBrief` returns `undefined` for valid historical briefs.
* **Fix:** Implement `getBrief` with a direct parameterized point query:

  ```ts
  getBrief(id: string): FleetBriefRow | undefined {
    const row = this.db
      .query(
        `SELECT id, run_id, job_id, agent_method, brief_markdown, findings_json,
                synthesis_json, created_at
           FROM fleet_brief WHERE id = ?`,
      )
      .get(id) as {
        id: string;
        run_id: string;
        job_id: string;
        agent_method: string;
        brief_markdown: string | null;
        findings_json: string;
        synthesis_json: string | null;
        created_at: number;
      } | null;

    if (row === null) return undefined;
    return {
      id: row.id,
      runId: row.run_id,
      jobId: row.job_id,
      agentMethod: row.agent_method,
      briefMarkdown: row.brief_markdown,
      findingsJson: row.findings_json,
      synthesisJson: row.synthesis_json,
      createdAt: row.created_at,
    };
  }
  ```

---

### 2.4 Targeted Job Execution Support in `FleetScheduler.runOnce` for `nimbus fleet run <job>` (Task 7 & 9)

* **Context:** In **Task 9**, `nimbus fleet run morning_catchup` sends `fleet.runNow` with `{ job: "morning_catchup", force: true }`.
* **Issue:** In **Task 7 Step 5**, `runOnce(opts?: { force?: boolean })` iterates over all jobs in `this.deps.jobs`.
* **Impact:** Running `nimbus fleet run morning_catchup` executes **every** configured fleet job in sequence, rather than only the targeted job.
* **Fix:** Update `runOnce` options in `FleetScheduler` to accept `jobName?: string`:

  ```ts
  async runOnce(opts?: { force?: boolean; jobName?: string }): Promise<FleetRunSummary> {
    // ...
    const jobsToRun = opts?.jobName !== undefined
      ? this.deps.jobs.filter((j) => j.name === opts.jobName)
      : this.deps.jobs;

    if (opts?.jobName !== undefined && jobsToRun.length === 0) {
      throw new Error(`no such fleet job: ${opts.jobName}`);
    }
    // Iterate over jobsToRun...
  }
  ```

---

## 3. Architectural & Operational Improvements

### 3.1 Profile-Aware TOML Resolution in `loadNimbusFleetFromConfigDir` (Task 3)

* **Context:** In Task 3 Step 4 ([line 1184](./2026-09-06-s2-overnight-agent-fleets.md)), `loadNimbusFleetFromConfigDir` hardcodes:

  ```ts
  const path = join(configDir, "nimbus.toml");
  ```

* **Issue:** When running under an active profile (e.g. `NIMBUS_PROFILE=work`), `resolveNimbusTomlForProfile(configDir)` resolves `nimbus.work.toml`. Hardcoding `nimbus.toml` ignores profile-specific `[fleet]` configurations.
* **Fix:** Use `resolveNimbusTomlForProfile`:

  ```ts
  import { resolveNimbusTomlForProfile } from "./nimbus-toml.ts";

  export function loadNimbusFleetFromConfigDir(configDir: string) {
    const tomlPath = resolveNimbusTomlForProfile(configDir);
    if (!existsSync(tomlPath)) return { config: DEFAULT_FLEET_CONFIG, jobs: [] };
    const raw = readFileSync(tomlPath, "utf8");
    return { config: parseNimbusTomlFleet(raw), jobs: parseNimbusTomlFleetJobs(raw) };
  }
  ```

---

### 3.2 Sidecar Disposal Registration in `assemble.ts` (Task 8)

* **Context:** In Task 8 Step 4 ([lines 2476–2496](./2026-09-06-s2-overnight-agent-fleets.md)), `fleetScheduler` is constructed and started via `fleetScheduler?.start()`.
* **Issue:** `assemble.ts` maintains `sidecarStops: Array<() => void>` which are executed during `disposeSidecars()` (gateway teardown). The fleet scheduler timer is not registered into `sidecarStops`.
* **Fix:** Register the stop callback when `fleetScheduler` is started:

  ```ts
  if (fleetScheduler !== undefined) {
    fleetScheduler.start();
    sidecarStops.push(() => fleetScheduler.stop());
  }
  ```

---

### 3.3 Win32 FFI Handle Caching in `win32.ts` (Task 1)

* **Context:** In Task 1 Step 7 ([lines 362–368](./2026-09-06-s2-overnight-agent-fleets.md)), `createWin32HostActivity().probe` calls `dlopen("kernel32.dll", ...)` and `dlopen("user32.dll", ...)` on every probe invocation.
* **Improvement:** Call `dlopen` once inside `createWin32HostActivity()` scope to avoid re-allocating FFI bindings and symbol tables on every 60-second probe tick:

  ```ts
  export function createWin32HostActivity(): HostActivity {
    let k32: ReturnType<typeof dlopen> | undefined;
    let u32: ReturnType<typeof dlopen> | undefined;

    try {
      k32 = dlopen("kernel32.dll", {
        GetSystemPowerStatus: { args: [FFIType.ptr], returns: FFIType.i32 },
        GetTickCount: { args: [], returns: FFIType.u32 },
      });
      u32 = dlopen("user32.dll", {
        GetLastInputInfo: { args: [FFIType.ptr], returns: FFIType.i32 },
      });
    } catch {
      return { probe: async () => UNKNOWN_PROBE };
    }

    const sps = new Uint8Array(16);
    const lii = new Uint32Array(2);
    lii[0] = 8;

    return {
      probe: async (): Promise<HostActivityProbe> => {
        try {
          const power =
            k32!.symbols.GetSystemPowerStatus(ptr(sps)) === 0
              ? "unknown"
              : powerFromAcLineStatus(sps[0] ?? 255);

          let idleMs: number | null = null;
          if (u32!.symbols.GetLastInputInfo(ptr(lii)) !== 0) {
            idleMs = idleMsFromTicks(k32!.symbols.GetTickCount(), lii[1] ?? 0);
          }
          return { power, idleMs, source: idleMs === null ? "power_only" : "measured" };
        } catch {
          return UNKNOWN_PROBE;
        }
      },
    };
  }
  ```

---

### 3.4 Handling Default `interval_seconds` vs Silent Job Dropping (Task 3)

* **Context:** In Task 3 Step 4 ([lines 1148–1150](./2026-09-06-s2-overnight-agent-fleets.md)), `flush()` drops a job if `intervalSeconds` is undefined:

  ```ts
  if (name === undefined || agent === undefined || intervalSeconds === undefined) return;
  ```

* **Improvement:** Rather than silently discarding a job if a user writes `name = "x"` and `agent = "catchup"` without `interval_seconds`, default `intervalSeconds` to `86400` (24 hours):

  ```ts
  const effectiveInterval = intervalSeconds ?? 86400;
  if (name === undefined || agent === undefined) return;
  jobs.push({ name, agent, intervalSeconds: effectiveInterval, params });
  ```

---

### 3.5 Cascading Prune for Stale `fleet_run` Rows (Task 2 & 8)

* **Context:** In Task 2, `pruneBriefs(now)` deletes rows from `fleet_brief WHERE expires_at <= ?`.
* **Improvement:** `fleet_run` rows will accumulate indefinitely if only `fleet_brief` is pruned. Also prune completed/failed `fleet_run` rows older than the retention threshold:

  ```ts
  pruneRuns(olderThanMs: number): number {
    const before = (this.db.query(`SELECT COUNT(*) AS n FROM fleet_run`).get() as { n: number }).n;
    dbRun(this.db, `DELETE FROM fleet_run WHERE started_at <= ?`, [olderThanMs]);
    const after = (this.db.query(`SELECT COUNT(*) AS n FROM fleet_run`).get() as { n: number }).n;
    return before - after;
  }
  ```

  Because `fleet_brief.run_id REFERENCES fleet_run(id) ON DELETE CASCADE`, pruning `fleet_run` automatically cleans up associated briefs.

---

## 4. Security & Invariant Coverage of the PLAN

**Read this section as what it was: a pre-implementation review of the plan document, written on
2026-09-06 against `2026-09-06-s2-overnight-agent-fleets.md` before any code existed.** It was
originally written as a `[x] Verified …` checklist, which read — wrongly — as verification of a
running system. Nothing here was ever executed against shipped code; each row asserts only that
the plan *specified* the defense named. The authoritative statements about the shipped code are
the enforcement tests in `packages/gateway/src/security-invariants.test.ts`, the static rules in
`scripts/structure-audit/check-nimbus-invariants.ts`, and the I38 row in `CLAUDE.md` — including
its stated bound, that the two I38 doors are proved at the wrapper and the invoker is proved to
use the wrapper, but the composed path is not exercised end to end.

One row was also factually wrong and is corrected below.

* **I38 local pinning & zero egress** — the plan specifies `wrapFleetSynthesisRouter` decorating
  both `resolveForSynthesis` and `generateMarkdown`, fail-closed when `allow_remote` is `false` or
  the run's remaining budget is `0`. Shipped as specified (`fleet/fleet-synthesis-router.ts`).
* **D28 attribution confinement** — the plan specifies a `fleet` `ClientKind` assignment-shape
  allow-list in `check-nimbus-invariants.ts`. Shipped, but **not with the regex quoted in the
  original row**: that pattern was widened during implementation beyond object-literal syntax
  (commit `30cba83f`). Read the rule, not this document.
* **LAN exposure protection** — the plan specifies adding the `fleet` namespace to
  `FORBIDDEN_OVER_LAN` in `ipc/lan-rpc.ts`. Shipped as specified.
* **Monotonic policy tightening (I22)** — the plan specifies `agent_fleet` in
  `EnforcedPolicy.capabilitiesDisabled` halting the scheduler before any hardware probe. Shipped
  as specified; `agent_fleet` is the sixth `AI_V2_CAPABILITIES` member.
* **Dead-key cleanup — CORRECTED.** The original row claimed `[embedding] pause_on_battery` is
  wired to `HostActivity.probe()` **in `create-embedding-runtime.ts`**. It is not, and never was:
  that file contains zero `probe()` calls — it only threads the flag through as a field. The probe
  lives in `embedding/backfill-gate.ts` (`createBatteryBackfillGate`, the sole `probe()` caller),
  which is constructed at two sites: `platform/assemble.ts` for the in-process pipeline and
  `embedding/embedding-worker.ts` for the default worker leg. The correction matters beyond the
  filename: the key now *changes behaviour* — a laptop on battery stops backfilling embeddings
  (`unknown` power still proceeds) — so it is documented for users in
  [`docs/cli-reference.md`](../../cli-reference.md), not only here.

---

## 5. Summary of Recommended Plan Edits

1. **Task 7 Step 5 (`fleet-scheduler.ts`):** Add `isJobDue` logic and `inFlight` re-entrancy lock in `FleetScheduler.runOnce`.
2. **Task 7 Step 5 & Task 9 (`fleet-scheduler.ts` / `fleet-rpc.ts`):** Support `opts?.jobName` in `runOnce` for targeted manual execution.
3. **Task 2 Step 5 (`fleet-store.ts`):** Replace in-memory scan in `getBrief` with parameterized `SELECT ... WHERE id = ?`.
4. **Task 3 Step 4 (`fleet-toml.ts`):** Use `resolveNimbusTomlForProfile` and default `intervalSeconds = 86400`.
5. **Task 8 Step 4 (`assemble.ts`):** Register `fleetScheduler.stop()` into `sidecarStops`.
