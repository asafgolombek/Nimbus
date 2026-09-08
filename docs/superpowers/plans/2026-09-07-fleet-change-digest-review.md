# Plan Review: Fleet Change Digest Implementation Plan

**Date:** 2026-09-07  
**Reviewer:** Antigravity (AI Coding Assistant)  
**Status:** Review Complete  
**Target Plan:** [`2026-09-07-fleet-change-digest.md`](./2026-09-07-fleet-change-digest.md)  
**Target Spec:** [`docs/superpowers/specs/2026-09-07-fleet-change-digest-design.md`](../specs/2026-09-07-fleet-change-digest-design.md)  
**Slot:** [Spine S2 — Local Compute Fleet](../../roadmap.md#active) (PR 2a of the overnight-fleet row)

---

## 1. Executive Summary

The target implementation plan is comprehensive, rigorous, and disciplined. It breaks down the change-digest feature into 11 discrete, test-driven tasks with explicit red-proof steps, compiler-enforced totality guards, and zero-egress guarantees.

Key architectural strengths of the plan include:

1. **Ironclad Totality Derivation (Task 1 & 4):** Using `satisfies` on `FLEET_ELIGIBILITY` to derive `EligibleAgentMethod` guarantees that adding or enabling any agent in the future will immediately fail the build at compile time (TS2741) until its corresponding extractor is written.
2. **Deterministic Basis (Tasks 2–4 & 7):** Diffs are anchored in deterministic `findings_json` rather than volatile synthesized Markdown, completely eliminating spurious diffs from LLM rewrites.
3. **Robust Baseline Window Selection (Task 5):** Implementing the predecessor search (preferring newest before window, falling back to oldest in window) correctly reports the requested window's movement for hourly and sub-daily jobs.
4. **Reserved-Key Protection (Task 6):** Explicitly placing `digest_min_delta` into `JOB_RESERVED` prevents config options from leaking into agent RPC invocation payloads.

During review, **three implementation discrepancies and two edge-case refinements** were identified that should be corrected in the plan before execution.

---

## 2. Critical Discrepancies & Implementation Blockers

### Issue 2.1: Formatting Discrepancy in Task 9 (Render Test vs. Implementation)

- **The Bug:**
  - In Task 9, `hours(ms)` is defined as:

    ```ts
    function hours(ms: number): string {
      const h = ms / 3_600_000;
      return h >= 24 ? `${(h / 24).toFixed(1)}d` : `${h.toFixed(1)}h`;
    }
    ```

  - For `windowMs = 86_400_000` (24h), `h = 24`. Because `h >= 24`, `hours(86_400_000)` returns `"1.0d"`.
  - However, the unit test in Task 9 Step 1 explicitly asserts:

    ```ts
    const md = renderFleetDigest({ windowMs: 86_400_000, generatedAt: 0, jobs: [], notCompared: empty });
    expect(md).toContain("24h"); // <--- FAILS: string in output is "1.0d"
    ```

  - Executing Task 9 Step 4 will fail on this test.
- **Recommended Fix in Task 9:**
  - Either format round hour values under 48h as hours, or adjust the formatter to format exact days/hours cleanly:

    ```ts
    function formatDuration(ms: number): string {
      const h = ms / 3_600_000;
      if (h % 24 === 0 && h >= 24) return `${String(h / 24)}d`;
      if (h >= 48) return `${(h / 24).toFixed(1)}d`;
      if (Number.isInteger(h)) return `${String(h)}h`;
      return `${h.toFixed(1)}h`;
    }
    ```

  - If formatting `86_400_000` as `"24h"`, update `hours()` accordingly:

    ```ts
    function hours(ms: number): string {
      const h = ms / 3_600_000;
      if (h < 24 || h === 24) return `${Math.round(h)}h`;
      return `${(h / 24).toFixed(1)}d`;
    }
    ```

---

### Issue 2.2: CLI Signature Discrepancy in Task 11 (`runFleetCommand` & `FleetIpc`)

- **The Bug:**
  - In `packages/cli/src/commands/fleet.ts`, the existing production signature is:

    ```ts
    export interface FleetIpc {
      call(method: string, params?: unknown): Promise<unknown>;
    }

    export async function runFleetCommand(
      client: FleetIpc,
      cmd: ParsedFleetArgs,
      sink: OutcomeSink = defaultSink,
    ): Promise<number>;
    ```

  - In Task 11 Step 3, the plan's snippet writes:

    ```ts
    case "digest": {
      const res = await deps.client.request("fleet.digest", { windowMs: parsed.windowMs });
      const r = res as FleetDigestResult;
      deps.sink.out(parsed.json ? JSON.stringify(r, null, 2) : r.markdown);
      return 0;
    }
    ```

  - And Task 11 Step 1 writes:

    ```ts
    const code = await runFleetCommand({ sub: "digest", windowMs: 1000, json: false }, deps);
    ```

  - `deps.client.request` and `deps.sink` do not exist inside `runFleetCommand` (`client.call` and `sink.out` are the parameters).
- **Recommended Fix in Task 11:**
  - Update `packages/cli/src/commands/fleet.ts` handler to match the existing convention:

    ```ts
    case "digest": {
      const r = (await client.call("fleet.digest", { windowMs: cmd.windowMs })) as FleetDigestResult;
      if (cmd.json) {
        sink.out(`${JSON.stringify(r, null, 2)}\n`);
      } else {
        sink.out(`${r.markdown}\n`);
      }
      return FLEET_EXIT_CODES.ok;
    }
    ```

  - Update the unit test in `packages/cli/src/commands/fleet.test.ts` to use `sinkSpy()` and `runFleetCommand(client, cmd, sink)` matching lines 70–90 of `fleet.test.ts`:

    ```ts
    test("nimbus fleet digest calls fleet.digest and renders output", async () => {
      let seenParams: unknown;
      const client: FleetIpc = {
        call: async (method, params) => {
          seenParams = params;
          return {
            windowMs: 86_400_000,
            generatedAt: 0,
            markdown: "# Fleet digest\n",
            jobs: [],
            notCompared: { firstObservation: [], notSummarizable: [], noBriefInWindow: [] },
          };
        },
      };
      const { out, sink } = sinkSpy();
      const code = await runFleetCommand(client, { sub: "digest", windowMs: 86_400_000, json: false }, sink);
      expect(code).toBe(FLEET_EXIT_CODES.ok);
      expect(seenParams).toEqual({ windowMs: 86_400_000 });
      expect(out.join("")).toContain("# Fleet digest");
    });
    ```

---

### Issue 2.3: Zero / Non-Positive Window Validation in `fleet-rpc.ts` (Task 10)

- **The Bug:**
  - `optInt(params, "windowMs")` returns `0` when `windowMs: 0` is passed because `0` is a non-negative integer.
  - In `handleDigest`:

    ```ts
    const windowMs = optInt(params, "windowMs") ?? DEFAULT_DIGEST_WINDOW_MS;
    ```

  - If a caller passes `{ windowMs: 0 }`, `windowMs` resolves to `0` (since `0 !== undefined`), setting `windowStartMs = now`, which evaluates to an empty window.
- **Recommended Fix in Task 10:**
  - Explicitly guard that `windowMs > 0`:

    ```ts
    function handleDigest(params: unknown, ctx: FleetRpcCtx): FleetDigestResult {
      const store = ctx.store;
      if (store === undefined) {
        throw new FleetRpcError(-32603, "fleet: no brief store available");
      }
      const rawWindow = optInt(params, "windowMs");
      if (rawWindow !== undefined && rawWindow <= 0) {
        throw new FleetRpcError(-32602, "fleet: windowMs must be a positive integer");
      }
      const windowMs = rawWindow ?? DEFAULT_DIGEST_WINDOW_MS;
      return buildFleetDigest({
        store,
        jobs: ctx.jobs ?? [],
        windowMs,
        now: ctx.now(),
      });
    }
    ```

---

## 3. Architectural Observations & Edge Cases

### Observation 3.1: Handling Agent Method Mutation on a Reconfigured Job (Task 8)

- **Scenario:**
  - An owner has job `nightly_check` configured with `agent = "catchup"`.
  - Today, the owner edits `nimbus.toml` and changes `nightly_check` to `agent = "ghost"`.
  - When `buildFleetDigest` runs, `current` is a `ghost` brief, while `predecessor` is a `catchup` brief.
- **Behavior:**
  - If both `summarizeBrief("agents.ghost", current)` and `summarizeBrief("agents.catchup", predecessor)` succeed, `compareSummaries` will attempt to diff a ghost brief against a catchup brief, resulting in 100% asymmetric metric churn.
- **Recommendation:**
  - In `buildFleetDigest`, check if `current.agentMethod !== predecessor.agentMethod`:

    ```ts
    if (current.agentMethod !== predecessor.agentMethod) {
      notSummarizable.push({
        jobId,
        briefId: predecessor.id,
        role: "predecessor",
        reason: `agent changed from ${predecessor.agentMethod} to ${current.agentMethod}`,
      });
      continue;
    }
    ```

  - This avoids comparing incompatible schemas across agent reconfigurations and provides clear, actionable disclosure in `## Not compared`.

---

### Observation 3.2: Upper-Bound Constraint on `created_at` in `briefPairForJob` (Task 5)

- **Scenario:**
  - In Task 5:

    ```sql
    WHERE job_id = ? AND created_at >= ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1
    ```

  - If database rows exist with clock skew (or in unit tests with simulated timestamps where `created_at > now`), a query without an upper bound on `created_at <= now` could select a future brief as `current`.
- **Recommendation:**
  - Include `AND created_at <= ?` with `q.now` bound:

    ```sql
    WHERE job_id = ? AND created_at >= ? AND created_at <= ? AND expires_at > ?
    ORDER BY created_at DESC LIMIT 1
    ```

  - This guarantees that time-traveling future rows do not corrupt window calculations.

---

## 4. Verification of Extractor Shapes & Totality

All 11 extractors in Tasks 2–4 were cross-checked against the gateway's live brief generators and `@nimbus-dev/sdk`:

| Task | Agent Method | Finding Key Extraction | Quantitative Metrics Extracted |
| :--- | :--- | :--- | :--- |
| **Task 2** | `agents.catchup` | `${service}:${itemId}` | `items_total`, `sections`, `owned_services`, `active_repos`, `incident_services`, `collaborators` |
| **Task 2** | `agents.expert` | `personId` | `experts`, `evidence_total`, `confidence_high`, `confidence_medium`, `confidence_low` |
| **Task 2** | `agents.ghost` | `peerId` | `ghost_peers`, `context_items`, `rank_high`, `rank_medium`, `rank_low` |
| **Task 2** | `agents.janitor` | `peer:${peerId}`, `"idle"`, `"proposal_suppressed"` | `peers_clear`, `peers_touched` |
| **Task 3** | `agents.conflicts` | `${peerId}:${collisionType}:${service}:${title}` | `collisions_total`, `type_open_pr`, `type_assigned_ticket`, `type_recent_commit` |
| **Task 3** | `agents.huddle` | `${peerId}:${kind}:${service}:${title}` | `peers`, `prs`, `tickets`, `incidents` |
| **Task 3** | `agents.impact` | `${category}:${affectedItemId}` | `affected_total`, `category_service`, `category_downstream_repo`, `category_pipeline`, `category_dashboard`, `category_oncall_rotation` |
| **Task 3** | `agents.why` | `${lane}:${title}` | `findings_total`, `lane_authorship`, `lane_pull_request`, `lane_ticket`, `lane_discussion`, `lane_driver`, `lane_downstream` |
| **Task 4** | `agents.glossary` | `term` | `total`, `pending`, `vetoed`, `manual`, `entries_listed` |
| **Task 4** | `agents.decisions` | `id` | `total`, `pending`, `extracted`, `vetoed`, `truncated_sources`, `entries_listed` |
| **Task 4** | `agents.ownership` | `owner.externalId` (target mode) or empty (coverage mode) | `roots_total`, `roots_covered`, `files_covered`, `files_excluded`, `services_bound`, `owners_emitted`, `entities_reaped` |

All key selections are deterministic, identity-anchored, and correctly sorted via `codeUnitCompare`.

---

## 5. Summary Checklist for Implementation

Before beginning execution with subagents, update the plan with:

- [x] Correct Task 9 Step 1 test assertion / `hours` formatting logic (Issue 2.1).
- [x] Align Task 11 `runFleetCommand` code and unit test with `FleetIpc`'s `client.call` and `sinkSpy` (Issue 2.2).
- [x] Add positive `windowMs > 0` validation in `fleet-rpc.ts` (Issue 2.3).
- [x] Add guard against mismatched `agentMethod`s on reconfigured jobs in `buildFleetDigest` (Observation 3.1).
- [x] Add upper-bound `created_at <= now` in `briefPairForJob` SQL queries (Observation 3.2).
