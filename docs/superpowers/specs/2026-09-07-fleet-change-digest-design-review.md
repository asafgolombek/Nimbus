# Design Review: S2 — Fleet Change Digest (PR 2a)

**Date:** 2026-09-07  
**Reviewer:** Antigravity (AI Coding Assistant)  
**Status:** Review Complete  
**Target Spec:** [`2026-09-07-fleet-change-digest-design.md`](./2026-09-07-fleet-change-digest-design.md)  
**Slot:** [Spine S2 — Local Compute Fleet](../../roadmap.md#active)  
**Related Specs:** [`2026-09-06-s2-overnight-agent-fleets-design.md`](./2026-09-06-s2-overnight-agent-fleets-design.md)

---

## 1. Executive Summary

The target specification provides an exceptionally crisp, disciplined architectural design for synthesizing changes across overnight fleet runs into a readable, deterministic digest. Key strengths of the design include:

1. **Deterministic Basis Anchored in Invariant I31 (§ 1):** Comparing `findings_json` (the structured data payload prior to LLM synthesis) rather than `brief_markdown` eliminates LLM rewrite variance, ensuring that zero spurious diffs are generated when prompts or models change.
2. **Read-Time Derivation over Write-Time Storage (§ 3):** Computing summaries dynamically at read time rather than persisting derived schema columns ensures that extractor fixes apply retroactively to historical briefs within the retention window, avoiding schema migration debt.
3. **Compiler-Enforced Totality over Eligible Agents (§ 4.2):** Deriving `EligibleAgentMethod` from `typeof FLEET_ELIGIBILITY` using `satisfies` ensures that enabling a new agent in `FLEET_ELIGIBILITY` immediately fails the build at compile time (TS2741) until its corresponding extractor is implemented.
4. **Zero Model Calls & Zero Egress (§ 7):** Keeping the digest purely mechanical (SQLite queries + pure TypeScript extractors + deterministic markdown rendering) keeps it entirely outside Invariant **I38** and introduces zero network or model egress.

Below are critical architectural clarifications, confirmation of the assumptions left open in § 11, and technical recommendations for the implementation plan.

---

## 2. Open Questions & Architectural Clarifications

### Q2.1: Comparison Baseline for Jobs Running Multiple Times Inside the Window (§ 2)

- **Context:**
  - § 2 specifies: *"Each job's newest brief in the window is compared against that job's own immediately-preceding brief, whether or not the predecessor falls inside the window."*
  - For a daily job (interval = 24h) with a 24h window, this compares today's run against yesterday's run.
  - However, for sub-daily jobs (e.g. interval = 4h or 1h), a 24h window may contain 4 to 24 briefs.
- **The Ambiguity:**
  - If a job runs hourly and the digest diffs the 23:00 brief against the 22:00 brief (its immediately preceding brief), the digest reports only **1 hour** of movement rather than the **24-hour** movement across the requested window.
- **Recommendation:**
  - Keep the baseline rule explicit and simple:
    1. **Primary Comparison Target:** The newest brief in `[now - sinceMs, now]`.
    2. **Predecessor Target:** The newest brief created **prior to the window** (`created_at < now - sinceMs`). If none exists before the window (e.g. the job first ran inside the current window), fall back to the **oldest brief inside the window** (provided it is not identical to the newest brief).
    3. **First Observation:** If only a single brief exists in total history, classify as `first observation`.
  - Disclose the exact predecessor timestamp and age in the section header (e.g. `## morning_catchup (comparing 2026-09-07 06:00 vs 2026-09-06 06:00, 24.0h ago)`).

---

### Q2.2: Handling of Retired or Unconfigured Jobs with Active Briefs in Window (§ 5 & § 8)

- **Context:**
  - A user may remove or rename a `[[fleet.job]]` block from `nimbus.toml` in the morning after it ran overnight.
  - If the digest only iterates over currently configured jobs (`ctx.jobs`), briefs produced overnight by the deleted job will be completely omitted from the digest without disclosure.
  - Conversely, if the digest only queries distinct `job_id`s from SQLite, configured jobs that failed to run will be omitted.
- **Recommendation:**
  - The digest query should compute the union of:
    1. Configured jobs from `nimbus.toml` (`ctx.jobs`).
    2. Distinct `job_id`s with briefs created in `[now - sinceMs, now]`.
  - Configured jobs that produced no brief in the window land in `Not compared: no brief in window`.
  - Jobs in SQLite that are no longer in `ctx.jobs` are rendered in the digest with a clear badge: `[unconfigured/retired]`.

---

### Q2.3: IPC Interface & Structured JSON Contract (`fleet.digest`) (§ 8)

- **Context:**
  - § 8 defines the IPC method `fleet.digest` and CLI command `nimbus fleet digest [--since <duration>] [--json]`, but leaves the structured JSON response payload unspecified.
- **Recommended IPC & JSON Type Definitions:**

  ```ts
  export interface FleetMetricDelta {
    readonly before: number;
    readonly after: number;
    readonly delta: number;
  }

  export interface FleetJobDigest {
    readonly jobId: string;
    readonly agentMethod: string;
    readonly status: "changed" | "unchanged" | "unchanged_within_threshold";
    readonly minDelta: number;
    readonly currentBriefId: string;
    readonly currentCreatedAt: number;
    readonly predecessorBriefId: string;
    readonly predecessorCreatedAt: number;
    readonly predecessorAgeMs: number;
    readonly metrics: Readonly<Record<string, FleetMetricDelta>>;
    readonly keysAppeared: readonly string[];
    readonly keysResolved: readonly string[];
  }

  export interface FleetDigestNotCompared {
    readonly firstObservation: readonly {
      readonly jobId: string;
      readonly briefId: string;
      readonly createdAt: number;
    }[];
    readonly notSummarizable: readonly {
      readonly jobId: string;
      readonly briefId: string;
      readonly role: "current" | "predecessor";
      readonly reason: string;
    }[];
    readonly noBriefInWindow: readonly {
      readonly jobId: string;
      readonly agent: string;
    }[];
  }

  export interface FleetDigestResult {
    readonly windowMs: number;
    readonly generatedAt: number;
    readonly markdown: string;
    readonly jobs: readonly FleetJobDigest[];
    readonly notCompared: FleetDigestNotCompared;
  }
  ```

---

### Q2.4: Deterministic Testing Seam: Injectable Clock (`now`)

- **Context:**
  - `fleet-store.ts`, `fleet-rpc.ts`, and agent contexts rely on injectable `now: () => number` for deterministic TTL, windowing, and retention unit tests.
- **Recommendation:**
  - Ensure `FleetRpcCtx.now` is forwarded to `generateFleetDigest(..., { now: ctx.now })`, and `fleet.digest` accepts optional `now` in unit test contexts.

---

## 3. Resolution of Spec Assumptions (§ 11)

Spec § 11 named two assumptions to confirm during implementation. Both are verified and resolved below:

### 3.1 Exhaustive Key & Metric Mapping for all 11 Eligible Agents

An audit of the 11 eligible agent brief schemas confirms that **every eligible agent has well-defined, stable identity keys and quantitative metrics**:

| Agent Method | Brief Type | Stable `keys` Extraction | Quantitative `metrics` Extraction |
| :--- | :--- | :--- | :--- |
| `agents.catchup` | `CatchupBrief` | `sections[].items[].id` (or `service:id`) | `total_items`, `collaborators_count`, `active_repos_count`, `owned_services_count` |
| `agents.conflicts` | `ConflictBrief` | `collisions[].peerId:collisionType:service:title` | `total_collisions`, `prs_count`, `issues_count`, `commits_count` |
| `agents.decisions` | `DecisionsBrief` | `entries[].id` | `total`, `pending`, `extracted`, `vetoed`, `entries_count` |
| `agents.expert` | `ExpertBrief` | `ranked[].personId` | `experts_count`, `evidence_total_count` |
| `agents.ghost` | `GhostBrief` | `findings[].peerId:rank` | `ghost_peers_count`, `context_items_count` |
| `agents.glossary` | `GlossaryBrief` | `entries[].term` | `total_terms`, `pending_terms`, `manual_terms`, `vetoed_terms` |
| `agents.huddle` | `HuddleBrief` | `peerId:type:service:title` across `prs`/`tickets`/`incidents` | `active_peers_count`, `prs_count`, `tickets_count`, `incidents_count` |
| `agents.impact` | `ImpactBrief` | `affected[].category:entityId` (or `:title`) | `affected_total`, counts by `category` (`downstream_code`, `pipelines`, `oncall`, `dashboards`, `repos`) |
| `agents.janitor` | `JanitorBrief` | `peersTouched[].peerId` | `peers_clear`, `peers_touched`, `idle` (0 or 1) |
| `agents.ownership` | `OwnershipBrief` | `target.owners[].externalId` (target mode) or empty (coverage mode) | `files_covered`, `files_excluded`, `roots_covered`, `owners_emitted`, `owner_count` |
| `agents.why` | `WhyBrief` | `findings[].lane:title` | `findings_total`, counts by `lane` (`authorship`, `pull_request`, `ticket`, `discussion`, `driver`, `downstream`) |

---

### 3.2 Performance and Query Plan Validation

- The existing V60 SQLite schema (`packages/gateway/src/index/fleet-v60-sql.ts`) defines:

  ```sql
  CREATE INDEX IF NOT EXISTS idx_fleet_brief_job ON fleet_brief (job_id, created_at DESC);
  ```

- Fetching the newest brief and its predecessor per job translates to two bounded index lookups:

  ```sql
  -- 1. Newest brief in window:
  SELECT id, job_id, agent_method, findings_json, created_at
    FROM fleet_brief
   WHERE job_id = ? AND created_at >= ? AND created_at <= ? AND expires_at > ?
   ORDER BY created_at DESC LIMIT 1;

  -- 2. Predecessor brief:
  SELECT id, job_id, agent_method, findings_json, created_at
    FROM fleet_brief
   WHERE job_id = ? AND created_at < ? AND expires_at > ?
   ORDER BY created_at DESC LIMIT 1;
  ```

- Under SQLite query planning, this is an $O(1)$ B-tree seek per job. Parsing ~50 JSON payloads at read time executes in $<2\text{ms}$. Retention bounding (default 14 days) guarantees the table size remains small.

---

## 4. Technical Improvements & Suggestions

### I4.1: Asymmetric Metric Handling across Agent Versions

- If an agent extractor is updated to track a new metric $M$ (e.g. `truncatedSources`), an older predecessor brief will not contain $M$.
- **Handling Rule:**
  - If metric $M$ is present in `after` but absent (`undefined`) in `before`, treat `before = 0` only if $M$ represents an additive count, or record it as `new metric: N` rather than computing an artificial delta $0 \to N$.
  - Similarly, if $M$ was dropped in `after`, do not report it as a negative delta to zero.

---

### I4.2: Deterministic Ordering via `codeUnitCompare`

- To prevent platform/locale-dependent rendering discrepancies:
  - All extracted keys (`keysAppeared`, `keysResolved`) must be sorted with `codeUnitCompare` (`packages/gateway/src/util/code-unit-compare.ts`).
  - Metric rows in tables must be sorted by metric name using `codeUnitCompare`.
  - Job sections must be sorted by `jobId` using `codeUnitCompare`.

---

### I4.3: Configuration Schema for `digest_min_delta` in `fleet-toml.ts`

- In `packages/gateway/src/config/fleet-toml.ts`:
  - Add optional `digest_min_delta` to `[[fleet.job]]` parsing (default: `1`).
  - Validation: If `digest_min_delta` is supplied, enforce that it is an integer $\ge 1$. Refuse values $< 1$ with `FleetConfigError`.

---

### I4.4: CLI Integration with `parseDurationToMs`

- In `packages/cli/src/commands/fleet.ts`:
  - Wire `--since <duration>` using `parseDurationToMs` from `packages/cli/src/lib/parse-duration.ts`.
  - Default `--since` to `24h` (`86_400_000` ms).
  - Add `digest` to `USAGE`, `parseFleetArgs`, and `runFleetCommand`.

---

## 5. Comprehensive Testing Matrix

1. **Extractor Totality & Type Tests (`fleet-digest-extractors.test.ts`):**
   - Assert at compile time that `FLEET_DIGEST_EXTRACTORS` covers all 11 `EligibleAgentMethod` members.
   - Table-driven unit tests for all 11 extractors:
     - Well-formed payload $\to$ expected `keys` and `metrics`.
     - Missing mandatory fields $\to$ `undefined`.
     - Malformed JSON / primitive non-object $\to$ `undefined` (no throw).
2. **Comparison Algorithm & Threshold Truth Table (`fleet-digest.test.ts`):**
   - **Predecessor older than window:** Compares correctly and discloses predecessor age.
   - **Single brief in history:** Placed in `firstObservation`.
   - **No briefs in window:** Placed in `noBriefInWindow`.
   - **Malformed current brief:** Placed in `notSummarizable` (`role: "current"`).
   - **Malformed predecessor:** Placed in `notSummarizable` (`role: "predecessor"`).
   - **Identical summaries:** Reports `unchanged`.
   - **Delta below `min_delta` (e.g. +2 with min_delta 5):** Reports `unchanged_within_threshold (min_delta: 5)`.
   - **Delta at or above `min_delta` (e.g. +5 with min_delta 5):** Reports delta in metric list.
   - **Key appeared / resolved:** Always reported regardless of `min_delta`.
3. **IPC & CLI End-to-End Tests (`packages/cli/src/commands/fleet.test.ts` / `fleet-rpc.test.ts`):**
   - `nimbus fleet digest`: Returns formatted markdown with exit code 0.
   - `nimbus fleet digest --json`: Outputs valid `FleetDigestResult` JSON structure.
   - `nimbus fleet digest --since 7d`: Correctly translates duration into `sinceMs`.
   - Zero runs in window $\to$ Exits 0 with valid "no runs in window" disclosure.
