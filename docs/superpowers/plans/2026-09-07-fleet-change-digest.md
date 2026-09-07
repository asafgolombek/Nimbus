# Fleet Change Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `nimbus fleet digest` — a local, deterministic Markdown report of what moved between each fleet job's newest brief and its predecessor.

**Architecture:** A per-agent extractor map reduces each stored `findings_json` (the deterministic typed brief, never the synthesized Markdown) to a `BriefSummary` of identity keys plus named counts. A comparison step diffs two summaries into a `FleetJobDigest`; a renderer turns those into Markdown. Everything derives at read time from the V60 tables — no migration, no model call, no egress.

**Tech Stack:** Bun v1.2+, TypeScript strict, `bun:sqlite`, Biome, `bun test`.

**Spec:** [`docs/superpowers/specs/2026-09-07-fleet-change-digest-design.md`](../specs/2026-09-07-fleet-change-digest-design.md) — read it before Task 1. Its § 4.4 (identity-only keys) decides every extractor in Tasks 2–4, and its § 2.1 (predecessor selection) decides Task 8.

## Global Constraints

- **No `any`.** External data is `unknown` and is narrowed by a guard, never an `as` cast. TypeScript strict mode is non-negotiable.
- **Branch, never `main`.** Work happens on `dev/asaf/fleet-change-digest` (already created). Verify with `git rev-parse --abbrev-ref HEAD` before the first commit.
- **`bun run preflight:fast` before any push.** Full `bun run preflight` before opening the PR.
- **Red-prove every behavioural change.** A test that has never been observed failing is not evidence. Each task's "verify it fails" step is mandatory, not decorative.
- **The PR title is the commit.** Squash merge discards local commit messages; the conventional-commit type must be in the PR title.
- **Cross-platform paths** via `path.join()` / `os.tmpdir()` — never a hardcoded separator.
- **Deterministic ordering** uses `codeUnitCompare` from `packages/gateway/src/util/code-unit-compare.ts`, never `localeCompare`.
- **No new invariant, no new egress class, no schema migration.** If a task seems to need one, stop — that is a signal the design was misread.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/gateway/src/fleet/fleet-digest-types.ts` | **Create.** `BriefSummary`, `FleetDigestExtractor`, `FleetMetricDelta`, `FleetJobDigest`, `FleetDigestResult`, `EligibleAgentMethod`. Types only — no logic, so both the extractor file and the comparison file can import it without a cycle. |
| `packages/gateway/src/fleet/fleet-digest-extractors.ts` | **Create.** The eleven extractors and the total map. |
| `packages/gateway/src/fleet/fleet-digest.ts` | **Create.** Pair selection, comparison, and the Markdown renderer. |
| `packages/gateway/src/fleet/fleet-store.ts` | **Modify.** Two read methods: the (current, predecessor) pair per job, and the distinct job ids with briefs in a window. |
| `packages/gateway/src/ipc/agents-rpc.ts` | **Modify.** One type-position change: `FLEET_ELIGIBILITY`'s annotation becomes a `satisfies` clause. |
| `packages/gateway/src/ipc/fleet-rpc.ts` | **Modify.** `fleet.digest` handler + `HANDLERS` entry. |
| `packages/gateway/src/config/fleet-toml.ts` | **Modify.** `digest_min_delta` on `[[fleet.job]]`, and its `JOB_RESERVED` entry. |
| `packages/cli/src/commands/fleet.ts` | **Modify.** The `digest` subcommand, `--since`, usage text. |
| `docs/cli-reference.md` | **Modify.** Document the subcommand and the config key. |

---

### Task 1: Type foundation and the compiler-enforced eligible set

Nothing else compiles without this. It also carries the one change to PR 1 code.

**Files:**

- Create: `packages/gateway/src/fleet/fleet-digest-types.ts`
- Modify: `packages/gateway/src/ipc/agents-rpc.ts:1124`
- Test: `packages/gateway/src/fleet/fleet-digest-types.test.ts`

**Interfaces:**

- Consumes: `AgentMethod` and `FLEET_ELIGIBILITY` from `ipc/agents-rpc.ts`.
- Produces: `BriefSummary`, `FleetDigestExtractor`, `EligibleAgentMethod`, `FleetMetricDelta`, `FleetJobDigest`, `FleetDigestNotCompared`, `FleetDigestResult`.

- [ ] **Step 1: Write the failing test**

Create `packages/gateway/src/fleet/fleet-digest-types.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { FLEET_ELIGIBILITY } from "../ipc/agents-rpc.ts";
import type { EligibleAgentMethod } from "./fleet-digest-types.ts";

describe("EligibleAgentMethod is derived, not restated", () => {
  test("an eligible method is assignable and an excluded one is not", () => {
    const ok: EligibleAgentMethod = "agents.ghost";
    // @ts-expect-error preflight is excluded_side_effects, so it must not be assignable.
    const bad: EligibleAgentMethod = "agents.preflight";
    expect(ok).toBe("agents.ghost");
    expect(bad).toBe("agents.preflight");
  });

  test("the derived set matches FLEET_ELIGIBILITY at runtime too", () => {
    const eligible = Object.entries(FLEET_ELIGIBILITY)
      .filter(([, v]) => v === "eligible")
      .map(([k]) => k);
    expect(eligible).toHaveLength(11);
    expect(eligible).toContain("agents.ghost");
    expect(eligible).not.toContain("agents.negotiate");
  });
});
```

The `@ts-expect-error` is the load-bearing assertion: it fails the build if `agents.preflight` ever becomes assignable, which is what a widened type would cause.

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test packages/gateway/src/fleet/fleet-digest-types.test.ts`
Expected: FAIL — `Cannot find module './fleet-digest-types.ts'`.

- [ ] **Step 3: Change `FLEET_ELIGIBILITY` to `satisfies`**

In `packages/gateway/src/ipc/agents-rpc.ts`, the declaration at line 1124 currently reads
`export const FLEET_ELIGIBILITY: Readonly<Record<AgentMethod, FleetEligibility>> = Object.freeze({`.
Change **only** the type position — leave every entry and every comment exactly as it is:

```ts
export const FLEET_ELIGIBILITY = Object.freeze({
  // … all fifteen entries unchanged …
}) satisfies Readonly<Record<AgentMethod, FleetEligibility>>;
```

Add to the existing doc comment above it:

```ts
 * `satisfies`, NOT an annotation. An annotation widens every value to `FleetEligibility`, which
 * would make `fleet/fleet-digest-types.ts`'s `EligibleAgentMethod` resolve to `never` for every
 * member and silently produce an EMPTY extractor map — a fail-open with no error to notice. The
 * `satisfies` clause keeps the same totality check while preserving the literals that derivation
 * needs.
```

- [ ] **Step 4: Write `fleet-digest-types.ts`**

```ts
import type { AgentMethod, FLEET_ELIGIBILITY } from "../ipc/agents-rpc.ts";

/**
 * The agents a fleet brief can actually come from, DERIVED from `FLEET_ELIGIBILITY` rather than
 * restated beside it. Flipping an agent to `"eligible"` makes `FLEET_DIGEST_EXTRACTORS` fail to
 * compile until its extractor exists (spec § 4.2).
 */
export type EligibleAgentMethod = {
  [K in AgentMethod]: (typeof FLEET_ELIGIBILITY)[K] extends "eligible" ? K : never;
}[AgentMethod];

/**
 * A brief reduced to what can be compared across runs.
 *
 * Two axes, never one: `keys` are identities (appeared / resolved) and `metrics` are magnitudes
 * (moved by N). Only magnitudes can be threshold-suppressed, which is why a BOOLEAN belongs in
 * `keys` — as a metric it would be silently swallowed by `digest_min_delta >= 2` (spec § 4.1).
 */
export interface BriefSummary {
  readonly keys: readonly string[];
  readonly metrics: Readonly<Record<string, number>>;
}

/** `undefined` when the stored JSON does not match this agent's shape (spec § 4.3). */
export type FleetDigestExtractor = (findings: unknown) => BriefSummary | undefined;

/** `null` on a side means the metric was ABSENT there — never coerced to 0 (spec § 6.1). */
export interface FleetMetricDelta {
  readonly before: number | null;
  readonly after: number | null;
  readonly delta: number | null;
}

export interface FleetJobDigest {
  readonly jobId: string;
  readonly agentMethod: string;
  /** False = the job produced briefs but is no longer in config (spec § 5.1). */
  readonly configured: boolean;
  readonly status: "changed" | "unchanged" | "unchanged_within_threshold";
  readonly minDelta: number;
  readonly currentBriefId: string;
  readonly currentCreatedAt: number;
  readonly predecessorBriefId: string;
  readonly predecessorCreatedAt: number;
  /** current − predecessor. NOT the window: § 2.1 lets these differ per job. */
  readonly comparisonSpanMs: number;
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
  readonly noBriefInWindow: readonly { readonly jobId: string; readonly agent: string }[];
}

export interface FleetDigestResult {
  readonly windowMs: number;
  readonly generatedAt: number;
  readonly markdown: string;
  readonly jobs: readonly FleetJobDigest[];
  readonly notCompared: FleetDigestNotCompared;
}
```

- [ ] **Step 5: Run the test and the typecheck**

Run: `bun test packages/gateway/src/fleet/fleet-digest-types.test.ts && bun run typecheck`
Expected: PASS, and typecheck clean.

- [ ] **Step 6: Red-prove the derivation**

Temporarily revert `satisfies` back to the annotation form. Run `bun run typecheck`.
Expected: the `@ts-expect-error` in the test now reports **"Unused '@ts-expect-error' directive"** — because with a widened type `EligibleAgentMethod` is `never`, nothing is assignable, and the error the directive expected is a different one. Restore `satisfies` and confirm typecheck is clean again.

- [ ] **Step 7: Commit**

```bash
git add packages/gateway/src/fleet/fleet-digest-types.ts packages/gateway/src/fleet/fleet-digest-types.test.ts packages/gateway/src/ipc/agents-rpc.ts
git commit -m "feat(fleet): derive the eligible-agent set from FLEET_ELIGIBILITY"
```

---

### Task 2: Extractors — the four SDK-guarded briefs with simple identity

**Files:**

- Create: `packages/gateway/src/fleet/fleet-digest-extractors.ts`
- Test: `packages/gateway/src/fleet/fleet-digest-extractors.test.ts`

**Interfaces:**

- Consumes: `BriefSummary`, `FleetDigestExtractor` (Task 1); `isCatchupBrief`, `isExpertBrief`, `isGhostBrief`, `isJanitorBrief` from `../agents/_lib/findings.ts`.
- Produces: `FLEET_DIGEST_EXTRACTORS` (partial in this task, completed in Task 4) and `summarizeBrief(agentMethod: string, findingsJson: string): BriefSummary | undefined`.

**Shapes you need** (verified against `@nimbus-dev/sdk`):

- `CatchupBrief`: `{ involvement: { ownedServices, activeRepos, incidentServices, collaboratorPersonIds: string[] }, sections: { serviceId, totalItemsInWindow, items: { itemId, … }[] }[] }`
- `ExpertBrief`: `{ ranked: { personId, evidence: Evidence[], confidence: "high"|"medium"|"low" }[] }`
- `GhostBrief`: `{ findings: { peerId, rank: "high"|"medium"|"low"|"none", context: FederatedItemLite[] }[] }`
- `JanitorBrief`: `{ idle: boolean, proposalSuppressed: boolean, peersClear: number, peersTouched: { peerId }[] }`

- [ ] **Step 1: Write the failing tests**

Create `packages/gateway/src/fleet/fleet-digest-extractors.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { summarizeBrief } from "./fleet-digest-extractors.ts";

const base = { agentVersion: 1, generatedAt: 0, latencyMs: 0, gaps: [] };

describe("ghost extractor keys on IDENTITY only", () => {
  test("a rank change does NOT change the key", () => {
    const mk = (rank: string) =>
      JSON.stringify({
        ...base,
        kind: "ghost",
        query: { file: "a.ts" },
        startEntityId: null,
        findings: [{ peerId: "p1", expert: null, rank, context: [], suggestedContact: "" }],
      });
    const before = summarizeBrief("agents.ghost", mk("medium"));
    const after = summarizeBrief("agents.ghost", mk("high"));
    expect(before?.keys).toEqual(["p1"]);
    expect(after?.keys).toEqual(["p1"]);
    expect(before?.metrics["rank_medium"]).toBe(1);
    expect(after?.metrics["rank_high"]).toBe(1);
  });
});

describe("janitor encodes booleans as KEYS, not metrics", () => {
  test("idle true adds the key; idle false omits it", () => {
    const mk = (idle: boolean) =>
      JSON.stringify({
        ...base,
        kind: "janitor",
        query: { resourceRef: "r", idleDays: 30 },
        idle,
        proposalSuppressed: false,
        cleanupAction: null,
        peersClear: 2,
        peersTouched: [{ peerId: "p1", who: null, lastSeenDaysAgo: 3 }],
      });
    expect(summarizeBrief("agents.janitor", mk(true))?.keys).toEqual(["idle", "peer:p1"]);
    expect(summarizeBrief("agents.janitor", mk(false))?.keys).toEqual(["peer:p1"]);
    expect(summarizeBrief("agents.janitor", mk(true))?.metrics["idle"]).toBeUndefined();
  });
});

describe("catchup and expert", () => {
  test("catchup keys on service:item and counts involvement", () => {
    const json = JSON.stringify({
      ...base,
      kind: "catchup",
      query: { sinceMs: 0 },
      selfPersonId: null,
      involvement: {
        ownedServices: ["s1"],
        activeRepos: ["r1", "r2"],
        incidentServices: [],
        collaboratorPersonIds: ["p1"],
      },
      sections: [
        {
          serviceId: "github",
          totalItemsInWindow: 5,
          items: [{ itemId: "i1", title: "t", modifiedAt: 0, relevanceScore: 1, relevanceReasons: [] }],
        },
      ],
    });
    const s = summarizeBrief("agents.catchup", json);
    expect(s?.keys).toEqual(["github:i1"]);
    expect(s?.metrics).toMatchObject({ items_total: 1, sections: 1, active_repos: 2, collaborators: 1 });
  });

  test("expert keys on personId and counts confidence bands", () => {
    const json = JSON.stringify({
      ...base,
      kind: "expert",
      query: { topicOrFile: "auth" },
      ranked: [
        { personId: "p2", displayName: "B", evidence: [], score: 1, confidence: "high" },
        { personId: "p1", displayName: "A", evidence: [{}, {}], score: 2, confidence: "low" },
      ],
    });
    const s = summarizeBrief("agents.expert", json);
    expect(s?.keys).toEqual(["p1", "p2"]); // sorted by codeUnitCompare
    expect(s?.metrics).toMatchObject({ experts: 2, evidence_total: 2, confidence_high: 1, confidence_low: 1 });
  });
});

describe("malformed input never throws", () => {
  test.each([
    ["not json at all", "{{{"],
    ["json of the wrong shape", JSON.stringify({ kind: "ghost" })],
    ["a bare primitive", JSON.stringify(7)],
    ["null", JSON.stringify(null)],
  ])("%s yields undefined", (_label, json) => {
    expect(summarizeBrief("agents.ghost", json)).toBeUndefined();
  });

  test("an unknown agent method yields undefined without parsing", () => {
    expect(summarizeBrief("agents.nope", "{}")).toBeUndefined();
    expect(summarizeBrief("constructor", "{}")).toBeUndefined();
  });
});
```

The `"constructor"` case is not padding: the method string comes from a database column, so a
prototype-chain lookup would resolve it to a function. Task 4's `Object.hasOwn` guard is what makes
this pass.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/gateway/src/fleet/fleet-digest-extractors.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the four extractors and the dispatcher**

Create `packages/gateway/src/fleet/fleet-digest-extractors.ts`:

```ts
import {
  isCatchupBrief,
  isExpertBrief,
  isGhostBrief,
  isJanitorBrief,
} from "../agents/_lib/findings.ts";
import { codeUnitCompare } from "../util/code-unit-compare.ts";
import type { BriefSummary, FleetDigestExtractor } from "./fleet-digest-types.ts";

/** Sorted once, here, so no caller has to remember to (spec § 8.1). */
function summary(keys: readonly string[], metrics: Record<string, number>): BriefSummary {
  return { keys: [...keys].sort(codeUnitCompare), metrics: Object.freeze({ ...metrics }) };
}

/** Counts occurrences of `band` values under `prefix_<band>` keys. */
function bandCounts(prefix: string, bands: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of bands) out[`${prefix}_${b}`] = (out[`${prefix}_${b}`] ?? 0) + 1;
  return out;
}

const ghost: FleetDigestExtractor = (f) => {
  if (!isGhostBrief(f)) return undefined;
  return summary(
    f.findings.map((x) => x.peerId),
    {
      ghost_peers: f.findings.length,
      context_items: f.findings.reduce((n, x) => n + x.context.length, 0),
      ...bandCounts("rank", f.findings.map((x) => x.rank)),
    },
  );
};

const janitor: FleetDigestExtractor = (f) => {
  if (!isJanitorBrief(f)) return undefined;
  const keys = f.peersTouched.map((p) => `peer:${p.peerId}`);
  // Booleans are KEYS: as metrics they are suppressed by any digest_min_delta >= 2 (spec § 4.1).
  if (f.idle) keys.push("idle");
  if (f.proposalSuppressed) keys.push("proposal_suppressed");
  return summary(keys, { peers_clear: f.peersClear, peers_touched: f.peersTouched.length });
};

const catchup: FleetDigestExtractor = (f) => {
  if (!isCatchupBrief(f)) return undefined;
  const keys = f.sections.flatMap((s) => s.items.map((i) => `${s.serviceId}:${i.itemId}`));
  return summary(keys, {
    items_total: keys.length,
    sections: f.sections.length,
    owned_services: f.involvement.ownedServices.length,
    active_repos: f.involvement.activeRepos.length,
    incident_services: f.involvement.incidentServices.length,
    collaborators: f.involvement.collaboratorPersonIds.length,
  });
};

const expert: FleetDigestExtractor = (f) => {
  if (!isExpertBrief(f)) return undefined;
  return summary(
    f.ranked.map((r) => r.personId),
    {
      experts: f.ranked.length,
      evidence_total: f.ranked.reduce((n, r) => n + r.evidence.length, 0),
      ...bandCounts("confidence", f.ranked.map((r) => r.confidence)),
    },
  );
};

/** Completed in Tasks 3 and 4; typed as a partial record until then. */
const PARTIAL: Partial<Record<string, FleetDigestExtractor>> = {
  "agents.catchup": catchup,
  "agents.expert": expert,
  "agents.ghost": ghost,
  "agents.janitor": janitor,
};

/**
 * Parse-then-extract. `JSON.parse` failure and shape mismatch are the SAME outcome (`undefined`)
 * because the caller's response to both is identical: disclose the brief as not summarizable
 * rather than drop it (spec § 4.3).
 */
export function summarizeBrief(agentMethod: string, findingsJson: string): BriefSummary | undefined {
  const extract = PARTIAL[agentMethod];
  if (extract === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(findingsJson);
  } catch {
    return undefined;
  }
  return extract(parsed);
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test packages/gateway/src/fleet/fleet-digest-extractors.test.ts`
Expected: PASS.

- [ ] **Step 5: Red-prove the ghost key rule**

Change `ghost`'s key expression to `` `${x.peerId}:${x.rank}` ``. Re-run.
Expected: the "a rank change does NOT change the key" test FAILS, showing `["p1:medium"]` against `["p1"]`. Revert.

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/fleet/fleet-digest-extractors.ts packages/gateway/src/fleet/fleet-digest-extractors.test.ts
git commit -m "feat(fleet): add digest extractors for catchup, expert, ghost, janitor"
```

---

### Task 3: Extractors — the four SDK-guarded briefs with composite keys

These have no identity field, so their keys are composites including a mutable title. That is the stated bound of spec § 4.4, and the test records it rather than pretending otherwise.

**Files:**

- Modify: `packages/gateway/src/fleet/fleet-digest-extractors.ts`
- Test: `packages/gateway/src/fleet/fleet-digest-extractors.test.ts`

**Interfaces:**

- Consumes: `isConflictBrief`, `isHuddleBrief`, `isImpactBrief`, `isWhyBrief` from `../agents/_lib/findings.ts`.
- Produces: four more entries in `PARTIAL`.

**Shapes:**

- `ConflictBrief`: `{ collisions: { peerId, service, collisionType: "open_pr"|"assigned_ticket"|"recent_commit"|"open_branch", title }[] }`
- `HuddleBrief`: `{ contributions: { peerId, prs, tickets, incidents: { title, service, … }[] }[] }` — `FederatedItemLite` has **no id**.
- `ImpactBrief`: `{ affected: { category, affectedItemId, … }[] }` — the field is `affectedItemId`, not `entityId`.
- `WhyBrief`: `{ findings: { lane, title, entityId: string | null }[] }` — `entityId` is nullable, so the key is `lane:title`.

- [ ] **Step 1: Write the failing tests**

Append to `fleet-digest-extractors.test.ts`:

```ts
describe("impact keys on the stable affectedItemId", () => {
  test("category and id compose the key; per-category counts are metrics", () => {
    const json = JSON.stringify({
      ...base,
      kind: "impact",
      query: { fileOrPrUrl: "a.ts" },
      startEntityId: null,
      affected: [
        { category: "service", affectedItemId: "svc1", affectedTitle: "T", serviceId: "s", hops: 1, pathSummary: "" },
        { category: "dashboard", affectedItemId: "d1", affectedTitle: "D", serviceId: "s", hops: 2, pathSummary: "" },
      ],
    });
    const s = summarizeBrief("agents.impact", json);
    expect(s?.keys).toEqual(["dashboard:d1", "service:svc1"]);
    expect(s?.metrics).toMatchObject({ affected_total: 2, category_service: 1, category_dashboard: 1 });
  });
});

describe("why keys on lane:title deliberately", () => {
  test("a null entityId does not affect the key", () => {
    const json = JSON.stringify({
      ...base,
      kind: "why",
      query: { ref: "a.ts", line: null },
      subject: null,
      findings: [
        { lane: "authorship", title: "Alice wrote it", detail: "", url: null, occurredAt: null, entityId: null },
        { lane: "ticket", title: "NIM-1", detail: "", url: null, occurredAt: null, entityId: "e1" },
      ],
    });
    const s = summarizeBrief("agents.why", json);
    expect(s?.keys).toEqual(["authorship:Alice wrote it", "ticket:NIM-1"]);
    expect(s?.metrics).toMatchObject({ findings_total: 2, lane_authorship: 1, lane_ticket: 1 });
  });

  test("STATED BOUND: retitling reads as one resolved plus one appeared", () => {
    const mk = (title: string) =>
      JSON.stringify({
        ...base,
        kind: "why",
        query: { ref: "a.ts", line: null },
        subject: null,
        findings: [{ lane: "ticket", title, detail: "", url: null, occurredAt: null, entityId: "e1" }],
      });
    expect(summarizeBrief("agents.why", mk("NIM-1"))?.keys).toEqual(["ticket:NIM-1"]);
    expect(summarizeBrief("agents.why", mk("NIM-1 renamed"))?.keys).toEqual(["ticket:NIM-1 renamed"]);
  });
});

describe("conflicts and huddle", () => {
  test("conflicts compose peer, type, service and title", () => {
    const json = JSON.stringify({
      ...base,
      kind: "conflict",
      query: { file: "a.ts" },
      startEntityId: null,
      collisions: [
        { peerId: "p1", who: null, service: "github", collisionType: "open_pr", title: "PR 1", snippet: "", modifiedAt: 0 },
      ],
    });
    const s = summarizeBrief("agents.conflicts", json);
    expect(s?.keys).toEqual(["p1:open_pr:github:PR 1"]);
    expect(s?.metrics).toMatchObject({ collisions_total: 1, type_open_pr: 1 });
  });

  test("huddle keys each contributed item under its peer", () => {
    const item = { title: "X", snippet: "", service: "github", modifiedAt: 0 };
    const json = JSON.stringify({
      ...base,
      kind: "huddle",
      query: { sinceMs: 0 },
      contributions: [{ peerId: "p1", who: null, prs: [item], tickets: [], incidents: [] }],
    });
    const s = summarizeBrief("agents.huddle", json);
    expect(s?.keys).toEqual(["p1:pr:github:X"]);
    expect(s?.metrics).toMatchObject({ peers: 1, prs: 1, tickets: 0, incidents: 0 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/gateway/src/fleet/fleet-digest-extractors.test.ts`
Expected: FAIL — four new tests fail; `summarizeBrief` returns `undefined` for methods not in `PARTIAL`.

- [ ] **Step 3: Implement**

Add to `fleet-digest-extractors.ts` (and add the four guards to the import from `../agents/_lib/findings.ts`):

```ts
const conflicts: FleetDigestExtractor = (f) => {
  if (!isConflictBrief(f)) return undefined;
  return summary(
    f.collisions.map((c) => `${c.peerId}:${c.collisionType}:${c.service}:${c.title}`),
    {
      collisions_total: f.collisions.length,
      ...bandCounts("type", f.collisions.map((c) => c.collisionType)),
    },
  );
};

const huddle: FleetDigestExtractor = (f) => {
  if (!isHuddleBrief(f)) return undefined;
  // FederatedItemLite carries no id, so the key composes the fields that identify WHICH item.
  // Retitling therefore reads as a resolve plus an appear — the stated bound of spec § 4.4.
  const keys: string[] = [];
  let prs = 0;
  let tickets = 0;
  let incidents = 0;
  for (const c of f.contributions) {
    for (const [kind, items] of [
      ["pr", c.prs],
      ["ticket", c.tickets],
      ["incident", c.incidents],
    ] as const) {
      for (const i of items) keys.push(`${c.peerId}:${kind}:${i.service}:${i.title}`);
    }
    prs += c.prs.length;
    tickets += c.tickets.length;
    incidents += c.incidents.length;
  }
  return summary(keys, { peers: f.contributions.length, prs, tickets, incidents });
};

const impact: FleetDigestExtractor = (f) => {
  if (!isImpactBrief(f)) return undefined;
  return summary(
    f.affected.map((a) => `${a.category}:${a.affectedItemId}`),
    {
      affected_total: f.affected.length,
      ...bandCounts("category", f.affected.map((a) => a.category)),
    },
  );
};

const why: FleetDigestExtractor = (f) => {
  if (!isWhyBrief(f)) return undefined;
  // `lane:title`, NOT `entityId`: that field is `string | null`, so a key built on it changes the
  // moment an id arrives — the same phantom churn with an extra failure mode (spec § 4.4).
  return summary(
    f.findings.map((x) => `${x.lane}:${x.title}`),
    {
      findings_total: f.findings.length,
      ...bandCounts("lane", f.findings.map((x) => x.lane)),
    },
  );
};
```

Extend `PARTIAL` with `"agents.conflicts": conflicts`, `"agents.huddle": huddle`, `"agents.impact": impact`, `"agents.why": why`.

- [ ] **Step 4: Run the tests**

Run: `bun test packages/gateway/src/fleet/fleet-digest-extractors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/fleet/fleet-digest-extractors.ts packages/gateway/src/fleet/fleet-digest-extractors.test.ts
git commit -m "feat(fleet): add digest extractors for conflicts, huddle, impact, why"
```

---

### Task 4: Extractors — the three gateway-local briefs, and closing the total map

`glossary`, `decisions` and `ownership` have **no SDK guard**, so each hand-rolls a narrow structural check covering only the fields it reads. This task also replaces `PARTIAL` with the compiler-checked total map.

**Files:**

- Modify: `packages/gateway/src/fleet/fleet-digest-extractors.ts`
- Test: `packages/gateway/src/fleet/fleet-digest-extractors.test.ts`

**Interfaces:**

- Produces: `export const FLEET_DIGEST_EXTRACTORS` satisfying `Readonly<Record<EligibleAgentMethod, FleetDigestExtractor>>`.

**Shapes:**

- `GlossaryBrief`: `{ entries: { term }[], stats: { total, pending, vetoed, manual } }`
- `DecisionsBrief`: `{ entries: { id }[], stats: { total, pending, extracted, vetoed, truncatedSources } }`
- `OwnershipBrief`: `{ target: { owners: { externalId }[] } | null, coverage: { rootsTotal, rootsCovered, filesCovered, filesExcluded, servicesBound, ownersEmitted, entitiesReaped } }`

- [ ] **Step 1: Write the failing tests**

Append:

```ts
describe("gateway-local briefs", () => {
  test("glossary keys on term and lifts stats to metrics", () => {
    const json = JSON.stringify({
      ...base,
      kind: "glossary",
      query: { term: null, limit: 20 },
      mode: "list",
      entries: [{ term: "vault" }, { term: "brief" }],
      matchedVia: null,
      suggestions: [],
      stats: { total: 9, pending: 2, vetoed: 1, manual: 3, lastPassAt: null },
    });
    const s = summarizeBrief("agents.glossary", json);
    expect(s?.keys).toEqual(["brief", "vault"]);
    expect(s?.metrics).toMatchObject({ total: 9, pending: 2, vetoed: 1, manual: 3, entries_listed: 2 });
  });

  test("ownership keys on owner externalId and is EMPTY in coverage mode", () => {
    const coverage = {
      lastPassAt: null, lastDurationMs: 0, rootsTotal: 2, rootsCovered: 1, rootsWithRemote: 1,
      filesCovered: 40, filesExcluded: 3, servicesBound: 1, ownersEmitted: 5, entitiesReaped: 0,
    };
    const withTarget = JSON.stringify({
      ...base, kind: "ownership", query: { path: "src", service: null, itemUrl: null },
      target: { kind: "directory", displayPath: "src", owners: [{ externalId: "git:a@b.c", label: "A", share: 1, resolved: true }], ownerCount: 1, ownersAboveFloor: 1, truncated: false },
      parentDirectory: null, service: null, coverage,
    });
    const summaryMode = JSON.stringify({
      ...base, kind: "ownership", query: { path: null, service: null, itemUrl: null },
      target: null, parentDirectory: null, service: null, coverage,
    });
    expect(summarizeBrief("agents.ownership", withTarget)?.keys).toEqual(["git:a@b.c"]);
    expect(summarizeBrief("agents.ownership", summaryMode)?.keys).toEqual([]);
    expect(summarizeBrief("agents.ownership", summaryMode)?.metrics).toMatchObject({
      files_covered: 40, files_excluded: 3, roots_covered: 1, owners_emitted: 5,
    });
  });

  test("decisions keys on entry id", () => {
    const json = JSON.stringify({
      ...base, kind: "decisions",
      query: { sinceMs: 0, service: null, minConfidence: 0, explain: false },
      entries: [{ id: "d1" }],
      stats: { total: 4, pending: 1, extracted: 3, vetoed: 0, lastPassAt: null, truncatedSources: 2 },
    });
    const s = summarizeBrief("agents.decisions", json);
    expect(s?.keys).toEqual(["d1"]);
    expect(s?.metrics).toMatchObject({ total: 4, pending: 1, extracted: 3, truncated_sources: 2 });
  });

  test("a glossary brief missing stats yields undefined, not a throw", () => {
    const json = JSON.stringify({ ...base, kind: "glossary", entries: [] });
    expect(summarizeBrief("agents.glossary", json)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/gateway/src/fleet/fleet-digest-extractors.test.ts`
Expected: FAIL on the four new tests.

- [ ] **Step 3: Implement the guards, the extractors, and the total map**

```ts
import type { EligibleAgentMethod } from "./fleet-digest-types.ts";

function rec(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function numAt(o: Record<string, unknown>, k: string): number | undefined {
  const v = o[k];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Every listed key must be a finite number, else `undefined`. Narrow BY DESIGN: a full-shape
 *  validator for a type that already typechecks elsewhere is a second definition free to drift. */
function numbers(o: Record<string, unknown>, keys: readonly string[]): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  for (const k of keys) {
    const n = numAt(o, k);
    if (n === undefined) return undefined;
    out[k] = n;
  }
  return out;
}

function stringsAt(v: unknown, field: string): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const e of v) {
    const o = rec(e);
    const s = o?.[field];
    if (typeof s !== "string") return undefined;
    out.push(s);
  }
  return out;
}

const glossary: FleetDigestExtractor = (f) => {
  const o = rec(f);
  if (o === undefined || o["kind"] !== "glossary") return undefined;
  const terms = stringsAt(o["entries"], "term");
  const stats = rec(o["stats"]);
  if (terms === undefined || stats === undefined) return undefined;
  const n = numbers(stats, ["total", "pending", "vetoed", "manual"]);
  if (n === undefined) return undefined;
  return summary(terms, { ...n, entries_listed: terms.length });
};

const decisions: FleetDigestExtractor = (f) => {
  const o = rec(f);
  if (o === undefined || o["kind"] !== "decisions") return undefined;
  const ids = stringsAt(o["entries"], "id");
  const stats = rec(o["stats"]);
  if (ids === undefined || stats === undefined) return undefined;
  const n = numbers(stats, ["total", "pending", "extracted", "vetoed", "truncatedSources"]);
  if (n === undefined) return undefined;
  return summary(ids, {
    total: n["total"] as number,
    pending: n["pending"] as number,
    extracted: n["extracted"] as number,
    vetoed: n["vetoed"] as number,
    truncated_sources: n["truncatedSources"] as number,
    entries_listed: ids.length,
  });
};

const ownership: FleetDigestExtractor = (f) => {
  const o = rec(f);
  if (o === undefined || o["kind"] !== "ownership") return undefined;
  const coverage = rec(o["coverage"]);
  if (coverage === undefined) return undefined;
  const n = numbers(coverage, [
    "rootsTotal", "rootsCovered", "filesCovered", "filesExcluded",
    "servicesBound", "ownersEmitted", "entitiesReaped",
  ]);
  if (n === undefined) return undefined;
  // `target` is legitimately null in coverage mode — an EMPTY key set, not a failure.
  const target = rec(o["target"]);
  const owners = target === undefined ? [] : stringsAt(target["owners"], "externalId");
  if (owners === undefined) return undefined;
  return summary(owners, {
    roots_total: n["rootsTotal"] as number,
    roots_covered: n["rootsCovered"] as number,
    files_covered: n["filesCovered"] as number,
    files_excluded: n["filesExcluded"] as number,
    services_bound: n["servicesBound"] as number,
    owners_emitted: n["ownersEmitted"] as number,
    entities_reaped: n["entitiesReaped"] as number,
  });
};

/**
 * TOTAL over `EligibleAgentMethod`. Flipping an agent to `"eligible"` in `FLEET_ELIGIBILITY`
 * fails THIS declaration to compile until its extractor is written (spec § 4.2).
 */
export const FLEET_DIGEST_EXTRACTORS = {
  "agents.catchup": catchup,
  "agents.conflicts": conflicts,
  "agents.decisions": decisions,
  "agents.expert": expert,
  "agents.ghost": ghost,
  "agents.glossary": glossary,
  "agents.huddle": huddle,
  "agents.impact": impact,
  "agents.janitor": janitor,
  "agents.ownership": ownership,
  "agents.why": why,
} satisfies Readonly<Record<EligibleAgentMethod, FleetDigestExtractor>>;
```

Delete `PARTIAL` and change `summarizeBrief`'s lookup to use `Object.hasOwn(FLEET_DIGEST_EXTRACTORS, agentMethod)` before indexing — `hasOwn`, never `in`, because `agentMethod` comes from a database column and `in` would resolve `"constructor"` against the prototype. This mirrors `resolveFleetAgentMethod`'s existing reasoning in `agents-rpc.ts`.

- [ ] **Step 4: Run the tests and typecheck**

Run: `bun test packages/gateway/src/fleet/fleet-digest-extractors.test.ts && bun run typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Red-prove the totality coupling**

Delete the `"agents.why"` line from `FLEET_DIGEST_EXTRACTORS`. Run `bun run typecheck`.
Expected: `error TS2741: Property '"agents.why"' is missing …`. Restore it.

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/fleet/fleet-digest-extractors.ts packages/gateway/src/fleet/fleet-digest-extractors.test.ts
git commit -m "feat(fleet): complete the digest extractor map over all eleven eligible agents"
```

---

### Task 5: Store reads — the comparison pair and the window's job ids

**Files:**

- Modify: `packages/gateway/src/fleet/fleet-store.ts`
- Test: `packages/gateway/src/fleet/fleet-store.test.ts`

**Interfaces:**

- Produces:
  - `briefPairForJob(q: { jobId: string; windowStartMs: number; now: number }): { current: FleetBriefRow | undefined; predecessor: FleetBriefRow | undefined }`
  - `jobIdsWithBriefsInWindow(q: { windowStartMs: number; now: number }): string[]`

- [ ] **Step 1: Write the failing test**

Append to `packages/gateway/src/fleet/fleet-store.test.ts` (follow the file's existing helper for opening a real temp-dir database and inserting briefs — do not mock):

```ts
describe("briefPairForJob implements spec § 2.1", () => {
  test("prefers the newest brief BEFORE the window over an in-window one", () => {
    // Window is [1000, now]. Briefs at 500, 1100, 1200 — an hourly-job shape.
    insertBrief({ jobId: "j", createdAt: 500 });
    insertBrief({ jobId: "j", createdAt: 1100 });
    insertBrief({ jobId: "j", createdAt: 1200 });
    const pair = store.briefPairForJob({ jobId: "j", windowStartMs: 1000, now: 9999 });
    expect(pair.current?.createdAt).toBe(1200);
    expect(pair.predecessor?.createdAt).toBe(500); // NOT 1100
  });

  test("falls back to the oldest in-window brief when nothing precedes the window", () => {
    insertBrief({ jobId: "j", createdAt: 1100 });
    insertBrief({ jobId: "j", createdAt: 1200 });
    const pair = store.briefPairForJob({ jobId: "j", windowStartMs: 1000, now: 9999 });
    expect(pair.current?.createdAt).toBe(1200);
    expect(pair.predecessor?.createdAt).toBe(1100);
  });

  test("a lone brief has no predecessor", () => {
    insertBrief({ jobId: "j", createdAt: 1100 });
    const pair = store.briefPairForJob({ jobId: "j", windowStartMs: 1000, now: 9999 });
    expect(pair.current?.createdAt).toBe(1100);
    expect(pair.predecessor).toBeUndefined();
  });

  test("expired briefs are invisible to both halves", () => {
    insertBrief({ jobId: "j", createdAt: 500, expiresAt: 600 });
    insertBrief({ jobId: "j", createdAt: 1200 });
    const pair = store.briefPairForJob({ jobId: "j", windowStartMs: 1000, now: 9999 });
    expect(pair.predecessor).toBeUndefined();
  });
});

describe("jobIdsWithBriefsInWindow", () => {
  test("returns distinct ids inside the window only, sorted", () => {
    insertBrief({ jobId: "b", createdAt: 1100 });
    insertBrief({ jobId: "a", createdAt: 1100 });
    insertBrief({ jobId: "a", createdAt: 1200 });
    insertBrief({ jobId: "old", createdAt: 500 });
    expect(store.jobIdsWithBriefsInWindow({ windowStartMs: 1000, now: 9999 })).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/gateway/src/fleet/fleet-store.test.ts`
Expected: FAIL — `store.briefPairForJob is not a function`.

- [ ] **Step 3: Implement**

Add to `FleetStore`. First the private helper the three new `SELECT`s share, so the column list is
written once — `listBriefs` and `getBrief` already restate it twice, and adding three more copies is
how a column gets added to four of five places:

```ts
  private static readonly BRIEF_COLS =
    `SELECT id, run_id, job_id, agent_method, brief_markdown, findings_json,
            synthesis_json, created_at FROM fleet_brief `;

  /** One row or none, for a `WHERE …` fragment appended to the shared column list. */
  private queryOne(whereAndOrder: string, params: readonly (string | number)[]): FleetBriefRow | undefined {
    const row = this.db.query(FleetStore.BRIEF_COLS + whereAndOrder).get(...params) as
      | {
          id: string;
          run_id: string;
          job_id: string;
          agent_method: string;
          brief_markdown: string | null;
          findings_json: string;
          synthesis_json: string | null;
          created_at: number;
        }
      | null;
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

Then the two public reads:

```ts
  /**
   * The pair spec § 2.1 compares: the job's newest brief inside the window, and the newest brief
   * BEFORE the window — falling back to the oldest brief inside it when nothing precedes.
   *
   * "Newest before the window" rather than "immediately preceding" is what makes the digest report
   * the WINDOW's movement: for a job running hourly against a 24h window the naive rule compares
   * 23:00 against 22:00 and reports one hour under a heading that says twenty-four. It also keeps
   * a weekly job's predecessor a week old, since the query is not bounded below.
   *
   * `expires_at > now` on every arm, for the same reason `listBriefs` carries it: retention that a
   * read surface ignores is not retention.
   */
  briefPairForJob(q: { jobId: string; windowStartMs: number; now: number }): {
    current: FleetBriefRow | undefined;
    predecessor: FleetBriefRow | undefined;
  } {
    const current = this.queryOne(
      `WHERE job_id = ? AND created_at >= ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1`,
      [q.jobId, q.windowStartMs, q.now],
    );
    if (current === undefined) return { current: undefined, predecessor: undefined };
    const before = this.queryOne(
      `WHERE job_id = ? AND created_at < ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1`,
      [q.jobId, q.windowStartMs, q.now],
    );
    if (before !== undefined) return { current, predecessor: before };
    const oldestInWindow = this.queryOne(
      `WHERE job_id = ? AND created_at >= ? AND created_at < ? AND expires_at > ?
       ORDER BY created_at ASC LIMIT 1`,
      [q.jobId, q.windowStartMs, current.createdAt, q.now],
    );
    return { current, predecessor: oldestInWindow };
  }

  /** Distinct job ids with a live brief inside the window — half of the digest's job union. */
  jobIdsWithBriefsInWindow(q: { windowStartMs: number; now: number }): string[] {
    const rows = this.db
      .query(
        `SELECT DISTINCT job_id FROM fleet_brief
          WHERE created_at >= ? AND expires_at > ? ORDER BY job_id ASC`,
      )
      .all(q.windowStartMs, q.now) as ReadonlyArray<{ job_id: string }>;
    return rows.map((r) => r.job_id);
  }
```

Note the third query bounds on `created_at < current.createdAt`, not `<=`, so a job with exactly one in-window brief cannot select itself as its own predecessor.

- [ ] **Step 4: Run the tests**

Run: `bun test packages/gateway/src/fleet/fleet-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Red-prove the § 2.1 rule**

Reorder `briefPairForJob` to try the in-window fallback first. Re-run.
Expected: "prefers the newest brief BEFORE the window" FAILS with `1100` against `500`. Revert.

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/fleet/fleet-store.ts packages/gateway/src/fleet/fleet-store.test.ts
git commit -m "feat(fleet): add the digest comparison-pair and window job-id reads"
```

---

### Task 6: Config — `digest_min_delta`, and the reserved-key trap

**Files:**

- Modify: `packages/gateway/src/config/fleet-toml.ts`
- Test: `packages/gateway/src/config/fleet-toml.test.ts`

**Interfaces:**

- Produces: `NimbusFleetJobToml.digestMinDelta: number` (default `1`).

**The trap this task exists to avoid:** `parseNimbusTomlFleetJobs` sweeps every key that is not in
`JOB_RESERVED` into `cur.params`, and `params` is handed straight to `dispatchAgentsRpc` as the
agent's arguments. Add `digest_min_delta` without adding it to `JOB_RESERVED` and it silently
becomes an agent parameter named `digestMinDelta`, sent to `agents.ghost` on every run.

- [ ] **Step 1: Write the failing test**

```ts
describe("[[fleet.job]] digest_min_delta", () => {
  const job = (extra: string) =>
    `[[fleet.job]]\nname = "j"\nagent = "ghost"\ninterval_seconds = 3600\n${extra}\n`;

  test("defaults to 1", () => {
    expect(parseNimbusTomlFleetJobs(job(""))[0]?.digestMinDelta).toBe(1);
  });

  test("is read, and does NOT leak into agent params", () => {
    const j = parseNimbusTomlFleetJobs(job("digest_min_delta = 5"))[0];
    expect(j?.digestMinDelta).toBe(5);
    expect(j?.params).toEqual({}); // the trap: it must not appear here
  });

  test("refuses below 1", () => {
    expect(() => parseNimbusTomlFleetJobs(job("digest_min_delta = 0"))).toThrow(FleetConfigError);
    expect(() => parseNimbusTomlFleetJobs(job("digest_min_delta = -2"))).toThrow(FleetConfigError);
  });

  test("a genuine agent param still reaches params", () => {
    expect(parseNimbusTomlFleetJobs(job('file = "src/a.ts"'))[0]?.params).toEqual({ file: "src/a.ts" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/gateway/src/config/fleet-toml.test.ts`
Expected: FAIL — `digestMinDelta` is `undefined` and the param leak test shows `{ digestMinDelta: 5 }`.

- [ ] **Step 3: Implement**

Add `readonly digestMinDelta: number;` to `NimbusFleetJobToml`. Add `"digest_min_delta"` to
`JOB_RESERVED`. Add the field to the `cur` accumulator, and in the key loop, before the
`!JOB_RESERVED.has(kv.key)` arm:

```ts
    } else if (kv.key === "digest_min_delta") {
      const n = parseIntDec(kv.valRaw);
      if (n !== undefined) {
        // Refused below 1, and NOT for `retention_days`' reason. A zero admits every metric whose
        // absolute delta is >= 0 — that is, every metric, including ones that did not move — so it
        // turns the threshold inside out and reports MORE than no threshold at all. There is no
        // reading of it that means what someone writing it would intend.
        if (n < 1) {
          throw new FleetConfigError(
            `[[fleet.job]] digest_min_delta must be >= 1 (got ${String(n)}); a zero would report ` +
              `every metric, including unchanged ones`,
          );
        }
        cur.digestMinDelta = n;
      }
    } else if (!JOB_RESERVED.has(kv.key)) {
```

In `flush`, default it: `jobs.push({ name, agent, intervalSeconds, params, digestMinDelta: digestMinDelta ?? 1 });`

- [ ] **Step 4: Run the tests**

Run: `bun test packages/gateway/src/config/fleet-toml.test.ts && bun run typecheck`
Expected: PASS. Typecheck may flag other construction sites of `NimbusFleetJobToml` in tests — fix them by adding `digestMinDelta: 1`.

- [ ] **Step 5: Red-prove the reserved-key trap**

Remove `"digest_min_delta"` from `JOB_RESERVED`. Re-run.
Expected: "does NOT leak into agent params" FAILS with `{ digestMinDelta: 5 }`. Restore.

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/config/fleet-toml.ts packages/gateway/src/config/fleet-toml.test.ts
git commit -m "feat(fleet): add per-job digest_min_delta, reserved so it cannot reach an agent"
```

---

### Task 7: Comparison — two summaries into one `FleetJobDigest`

Pure function, no I/O. This is where the threshold and the one-sided-metric rule live.

**Files:**

- Create: `packages/gateway/src/fleet/fleet-digest.ts`
- Test: `packages/gateway/src/fleet/fleet-digest.test.ts`

**Interfaces:**

- Produces: `compareSummaries(before: BriefSummary, after: BriefSummary, minDelta: number): { status; metrics; keysAppeared; keysResolved }` — the fields of `FleetJobDigest` that come from the diff, with the identity fields supplied by the caller in Task 8.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { compareSummaries } from "./fleet-digest.ts";

const s = (keys: string[], metrics: Record<string, number>) => ({ keys, metrics });

describe("compareSummaries", () => {
  test("identical summaries are unchanged", () => {
    const r = compareSummaries(s(["a"], { n: 1 }), s(["a"], { n: 1 }), 1);
    expect(r.status).toBe("unchanged");
    expect(r.keysAppeared).toEqual([]);
    expect(r.metrics).toEqual({});
  });

  test("keys appearing and resolving are both reported, sorted", () => {
    const r = compareSummaries(s(["a", "b"], {}), s(["b", "c"], {}), 1);
    expect(r.keysAppeared).toEqual(["c"]);
    expect(r.keysResolved).toEqual(["a"]);
    expect(r.status).toBe("changed");
  });

  test("a metric moving below minDelta is suppressed and the status says so", () => {
    const r = compareSummaries(s([], { n: 10 }), s([], { n: 12 }), 5);
    expect(r.metrics).toEqual({});
    expect(r.status).toBe("unchanged_within_threshold");
  });

  test("a metric at exactly minDelta reports", () => {
    const r = compareSummaries(s([], { n: 10 }), s([], { n: 15 }), 5);
    expect(r.metrics["n"]).toEqual({ before: 10, after: 15, delta: 5 });
    expect(r.status).toBe("changed");
  });

  test("a key change is NEVER suppressed by the threshold", () => {
    const r = compareSummaries(s(["a"], { n: 10 }), s(["a", "b"], { n: 11 }), 99);
    expect(r.keysAppeared).toEqual(["b"]);
    expect(r.status).toBe("changed");
  });

  test("a metric present on one side only is not synthesized into 0 -> N", () => {
    const added = compareSummaries(s([], {}), s([], { n: 7 }), 1);
    expect(added.metrics["n"]).toEqual({ before: null, after: 7, delta: null });
    const dropped = compareSummaries(s([], { n: 7 }), s([], {}), 1);
    expect(dropped.metrics["n"]).toEqual({ before: 7, after: null, delta: null });
  });

  test("a one-sided metric is reported regardless of minDelta", () => {
    const r = compareSummaries(s([], {}), s([], { n: 1 }), 1000);
    expect(r.metrics["n"]).toBeDefined();
    expect(r.status).toBe("changed");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/gateway/src/fleet/fleet-digest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { codeUnitCompare } from "../util/code-unit-compare.ts";
import type { BriefSummary, FleetJobDigest, FleetMetricDelta } from "./fleet-digest-types.ts";

type Compared = Pick<FleetJobDigest, "status" | "metrics" | "keysAppeared" | "keysResolved">;

export function compareSummaries(
  before: BriefSummary,
  after: BriefSummary,
  minDelta: number,
): Compared {
  const b = new Set(before.keys);
  const a = new Set(after.keys);
  const keysAppeared = [...a].filter((k) => !b.has(k)).sort(codeUnitCompare);
  const keysResolved = [...b].filter((k) => !a.has(k)).sort(codeUnitCompare);

  const metrics: Record<string, FleetMetricDelta> = {};
  let suppressed = false;
  const names = [...new Set([...Object.keys(before.metrics), ...Object.keys(after.metrics)])].sort(
    codeUnitCompare,
  );
  for (const name of names) {
    const bv = before.metrics[name];
    const av = after.metrics[name];
    if (bv === undefined || av === undefined) {
      // Present on one side only: an extractor gained or lost a field. Reporting `0 -> N` would
      // assert movement of exactly the current value, indistinguishable from a real jump from
      // zero, and would fire on every job the first night after any extractor changed (§ 6.1).
      metrics[name] = { before: bv ?? null, after: av ?? null, delta: null };
      continue;
    }
    const delta = av - bv;
    if (delta === 0) continue;
    if (Math.abs(delta) < minDelta) {
      suppressed = true;
      continue;
    }
    metrics[name] = { before: bv, after: av, delta };
  }

  const changed =
    keysAppeared.length > 0 || keysResolved.length > 0 || Object.keys(metrics).length > 0;
  return {
    // A suppressed metric must not read as "nothing happened": the status names the threshold's
    // involvement so a reader cannot mistake a hidden change for no change.
    status: changed ? "changed" : suppressed ? "unchanged_within_threshold" : "unchanged",
    metrics: Object.freeze(metrics),
    keysAppeared,
    keysResolved,
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test packages/gateway/src/fleet/fleet-digest.test.ts`
Expected: PASS.

- [ ] **Step 5: Red-prove the one-sided rule**

Replace the one-sided branch with `const delta = (av ?? 0) - (bv ?? 0);` falling through.
Expected: "not synthesized into 0 -> N" FAILS with `{ before: 0, after: 7, delta: 7 }`. Revert.

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/fleet/fleet-digest.ts packages/gateway/src/fleet/fleet-digest.test.ts
git commit -m "feat(fleet): compare two brief summaries into a job digest"
```

---

### Task 8: Assembly — the job union, pair selection, and the not-compared populations

**Files:**

- Modify: `packages/gateway/src/fleet/fleet-digest.ts`
- Test: `packages/gateway/src/fleet/fleet-digest.test.ts`

**Interfaces:**

- Consumes: `briefPairForJob`, `jobIdsWithBriefsInWindow` (Task 5); `summarizeBrief` (Task 4); `compareSummaries` (Task 7).
- Produces: `buildFleetDigest(deps: { store: FleetStore; jobs: readonly NimbusFleetJobToml[]; windowMs: number; now: number }): Omit<FleetDigestResult, "markdown">`

- [ ] **Step 1: Write the failing test**

```ts
describe("buildFleetDigest assembles the job union", () => {
  test("a configured job with no brief in window lands in noBriefInWindow", () => {
    const r = buildFleetDigest({ store, jobs: [job("j1", "ghost")], windowMs: 1000, now: 5000 });
    expect(r.notCompared.noBriefInWindow).toEqual([{ jobId: "j1", agent: "ghost" }]);
    expect(r.jobs).toEqual([]);
  });

  test("a job with briefs but no config is reported with configured:false", () => {
    insertBrief({ jobId: "retired", agentMethod: "agents.ghost", createdAt: 4000, findings: ghostFindings(["p1"]) });
    insertBrief({ jobId: "retired", agentMethod: "agents.ghost", createdAt: 4500, findings: ghostFindings(["p1", "p2"]) });
    const r = buildFleetDigest({ store, jobs: [], windowMs: 1000, now: 5000 });
    expect(r.jobs).toHaveLength(1);
    expect(r.jobs[0]?.configured).toBe(false);
    expect(r.jobs[0]?.keysAppeared).toEqual(["p2"]);
  });

  test("a single brief lands in firstObservation, not as all-new", () => {
    insertBrief({ jobId: "j1", agentMethod: "agents.ghost", createdAt: 4500, findings: ghostFindings(["p1"]) });
    const r = buildFleetDigest({ store, jobs: [job("j1", "ghost")], windowMs: 1000, now: 5000 });
    expect(r.jobs).toEqual([]);
    expect(r.notCompared.firstObservation[0]?.jobId).toBe("j1");
  });

  test("an unreadable brief is disclosed with its ROLE, not dropped", () => {
    insertBrief({ jobId: "j1", agentMethod: "agents.ghost", createdAt: 4000, findingsJson: "{{{" });
    insertBrief({ jobId: "j1", agentMethod: "agents.ghost", createdAt: 4500, findings: ghostFindings(["p1"]) });
    const r = buildFleetDigest({ store, jobs: [job("j1", "ghost")], windowMs: 1000, now: 5000 });
    expect(r.notCompared.notSummarizable[0]).toMatchObject({ jobId: "j1", role: "predecessor" });
  });

  test("SPEC § 1: differing markdown with identical findings is UNCHANGED", () => {
    // The whole basis of the design. A synthesized brief differs run to run on an unchanged index,
    // so if this ever reports "changed" the comparison has drifted onto brief_markdown.
    const findings = ghostFindings(["p1"]);
    insertBrief({ jobId: "j1", agentMethod: "agents.ghost", createdAt: 4000, findings, markdown: "# One phrasing" });
    insertBrief({ jobId: "j1", agentMethod: "agents.ghost", createdAt: 4500, findings, markdown: "# Totally different prose" });
    const r = buildFleetDigest({ store, jobs: [job("j1", "ghost")], windowMs: 1000, now: 5000 });
    expect(r.jobs[0]?.status).toBe("unchanged");
  });

  test("comparisonSpanMs is the pair's span, not the window", () => {
    insertBrief({ jobId: "j1", agentMethod: "agents.ghost", createdAt: 1000, findings: ghostFindings([]) });
    insertBrief({ jobId: "j1", agentMethod: "agents.ghost", createdAt: 4500, findings: ghostFindings(["p1"]) });
    const r = buildFleetDigest({ store, jobs: [job("j1", "ghost")], windowMs: 1000, now: 5000 });
    expect(r.jobs[0]?.comparisonSpanMs).toBe(3500);
    expect(r.windowMs).toBe(1000);
  });
});
```

Write the `job()`, `insertBrief()` and `ghostFindings()` helpers at the top of the file against a real temp-dir database, following `fleet-store.test.ts`'s existing setup.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/gateway/src/fleet/fleet-digest.test.ts`
Expected: FAIL — `buildFleetDigest` is not exported.

- [ ] **Step 3: Implement**

```ts
export function buildFleetDigest(deps: {
  store: FleetStore;
  jobs: readonly NimbusFleetJobToml[];
  windowMs: number;
  now: number;
}): Omit<FleetDigestResult, "markdown"> {
  const windowStartMs = deps.now - deps.windowMs;
  const configured = new Map(deps.jobs.map((j) => [j.name, j]));
  // The UNION, not either half (spec § 5.1). Config alone drops overnight work when a job block is
  // deleted in the morning; briefs alone drop the "configured but never ran" fact.
  const ids = [
    ...new Set([...configured.keys(), ...deps.store.jobIdsWithBriefsInWindow({ windowStartMs, now: deps.now })]),
  ].sort(codeUnitCompare);

  const jobs: FleetJobDigest[] = [];
  const firstObservation: { jobId: string; briefId: string; createdAt: number }[] = [];
  const notSummarizable: { jobId: string; briefId: string; role: "current" | "predecessor"; reason: string }[] = [];
  const noBriefInWindow: { jobId: string; agent: string }[] = [];

  for (const jobId of ids) {
    const cfg = configured.get(jobId);
    const { current, predecessor } = deps.store.briefPairForJob({ jobId, windowStartMs, now: deps.now });
    if (current === undefined) {
      noBriefInWindow.push({ jobId, agent: cfg?.agent ?? "unknown" });
      continue;
    }
    if (predecessor === undefined) {
      firstObservation.push({ jobId, briefId: current.id, createdAt: current.createdAt });
      continue;
    }
    const after = summarizeBrief(current.agentMethod, current.findingsJson);
    const before = summarizeBrief(predecessor.agentMethod, predecessor.findingsJson);
    if (after === undefined || before === undefined) {
      // Both sides are reported when both fail: a reader responds differently to a broken NEW
      // brief than to a broken OLD one, so the role is part of the disclosure.
      if (after === undefined) {
        notSummarizable.push({ jobId, briefId: current.id, role: "current", reason: `unreadable ${current.agentMethod} brief` });
      }
      if (before === undefined) {
        notSummarizable.push({ jobId, briefId: predecessor.id, role: "predecessor", reason: `unreadable ${predecessor.agentMethod} brief` });
      }
      continue;
    }
    const minDelta = cfg?.digestMinDelta ?? 1;
    jobs.push({
      jobId,
      agentMethod: current.agentMethod,
      configured: cfg !== undefined,
      minDelta,
      currentBriefId: current.id,
      currentCreatedAt: current.createdAt,
      predecessorBriefId: predecessor.id,
      predecessorCreatedAt: predecessor.createdAt,
      comparisonSpanMs: current.createdAt - predecessor.createdAt,
      ...compareSummaries(before, after, minDelta),
    });
  }

  return {
    windowMs: deps.windowMs,
    generatedAt: deps.now,
    jobs,
    notCompared: { firstObservation, notSummarizable, noBriefInWindow },
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test packages/gateway/src/fleet/fleet-digest.test.ts`
Expected: PASS.

- [ ] **Step 5: Red-prove the union**

Change `ids` to `[...configured.keys()].sort(codeUnitCompare)`. Re-run.
Expected: "a job with briefs but no config" FAILS with an empty `jobs` array. Revert.

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/fleet/fleet-digest.ts packages/gateway/src/fleet/fleet-digest.test.ts
git commit -m "feat(fleet): assemble the digest over the union of configured and observed jobs"
```

---

### Task 9: The Markdown renderer

**Files:**

- Modify: `packages/gateway/src/fleet/fleet-digest.ts`
- Test: `packages/gateway/src/fleet/fleet-digest.test.ts`

**Interfaces:**

- Produces: `renderFleetDigest(d: Omit<FleetDigestResult, "markdown">): string`. **Changes Task 8's signature:** `buildFleetDigest` now returns the full `FleetDigestResult`, markdown included, which is what Task 10 consumes.

- [ ] **Step 1: Write the failing test**

```ts
describe("renderFleetDigest", () => {
  const empty = { firstObservation: [], notSummarizable: [], noBriefInWindow: [] };

  test("the preamble states the window AND that predecessors may predate it", () => {
    const md = renderFleetDigest({ windowMs: 86_400_000, generatedAt: 0, jobs: [], notCompared: empty });
    expect(md).toContain("24h");
    expect(md).toMatch(/may be older than/i);
  });

  test("every Not compared subsection is present even when empty", () => {
    const md = renderFleetDigest({ windowMs: 1000, generatedAt: 0, jobs: [], notCompared: empty });
    expect(md).toContain("## Not compared");
    expect(md).toContain("First observation: 0");
    expect(md).toContain("Not summarizable: 0");
    expect(md).toContain("No brief in window: 0");
  });

  test("an unchanged job gets a line, never silent omission", () => {
    const md = renderFleetDigest({
      windowMs: 1000, generatedAt: 0, notCompared: empty,
      jobs: [{ jobId: "j1", agentMethod: "agents.ghost", configured: true, status: "unchanged", minDelta: 1,
        currentBriefId: "c", currentCreatedAt: 0, predecessorBriefId: "p", predecessorCreatedAt: 0,
        comparisonSpanMs: 0, metrics: {}, keysAppeared: [], keysResolved: [] }],
    });
    expect(md).toContain("j1");
    expect(md).toMatch(/unchanged/i);
  });

  test("an unconfigured job is marked", () => {
    const md = renderFleetDigest({
      windowMs: 1000, generatedAt: 0, notCompared: empty,
      jobs: [{ jobId: "retired", agentMethod: "agents.ghost", configured: false, status: "unchanged", minDelta: 1,
        currentBriefId: "c", currentCreatedAt: 0, predecessorBriefId: "p", predecessorCreatedAt: 0,
        comparisonSpanMs: 0, metrics: {}, keysAppeared: [], keysResolved: [] }],
    });
    expect(md).toContain("[unconfigured]");
  });

  test("a suppressed change names the threshold", () => {
    const md = renderFleetDigest({
      windowMs: 1000, generatedAt: 0, notCompared: empty,
      jobs: [{ jobId: "j1", agentMethod: "agents.ghost", configured: true, status: "unchanged_within_threshold",
        minDelta: 5, currentBriefId: "c", currentCreatedAt: 0, predecessorBriefId: "p", predecessorCreatedAt: 0,
        comparisonSpanMs: 0, metrics: {}, keysAppeared: [], keysResolved: [] }],
    });
    expect(md).toContain("5");
    expect(md).toMatch(/threshold/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/gateway/src/fleet/fleet-digest.test.ts`
Expected: FAIL — `renderFleetDigest` is not exported.

- [ ] **Step 3: Implement**

```ts
function hours(ms: number): string {
  const h = ms / 3_600_000;
  return h >= 24 ? `${(h / 24).toFixed(1)}d` : `${h.toFixed(1)}h`;
}

function cell(v: number | null): string {
  return v === null ? "—" : String(v);
}

function metricRow(name: string, d: FleetMetricDelta): string {
  // A one-sided metric names WHY it is one-sided rather than showing a delta it does not have.
  const note =
    d.before === null ? " (new metric)" : d.after === null ? " (no longer reported)" : "";
  return `| ${name}${note} | ${cell(d.before)} | ${cell(d.after)} | ${cell(d.delta)} |`;
}

export function renderFleetDigest(d: Omit<FleetDigestResult, "markdown">): string {
  const out: string[] = ["# Fleet digest", ""];
  // The preamble qualifies EVERY count below it, so it sits above all of them rather than beside
  // one — the placement I31 requires of `negotiate`'s window clause, for the same reason.
  out.push(
    `Window: the last ${hours(d.windowMs)}. Each job is compared against its own previous brief, ` +
      `which may be older than the window above; the comparison span is given per job.`,
    "",
  );

  for (const j of d.jobs) {
    out.push(`## ${j.jobId}${j.configured ? "" : " [unconfigured]"}`, "");
    const status =
      j.status === "unchanged_within_threshold"
        ? `unchanged within threshold (digest_min_delta = ${String(j.minDelta)})`
        : j.status;
    out.push(`${j.agentMethod} · compared over ${hours(j.comparisonSpanMs)} · ${status}`, "");

    const names = Object.keys(j.metrics);
    if (names.length > 0) {
      out.push("| metric | before | after | delta |", "| --- | --- | --- | --- |");
      for (const n of names) out.push(metricRow(n, j.metrics[n] as FleetMetricDelta));
      out.push("");
    }
    if (j.keysAppeared.length > 0) {
      out.push(`Appeared (${String(j.keysAppeared.length)}):`, ...j.keysAppeared.map((k) => `- ${k}`), "");
    }
    if (j.keysResolved.length > 0) {
      out.push(`Resolved (${String(j.keysResolved.length)}):`, ...j.keysResolved.map((k) => `- ${k}`), "");
    }
  }

  // All three subsections are ALWAYS written, including as an explicit zero: a section that
  // vanishes when it has nothing to say trains a reader to stop looking for it.
  const nc = d.notCompared;
  out.push("## Not compared", "");
  out.push(`First observation: ${String(nc.firstObservation.length)}`);
  for (const e of nc.firstObservation) out.push(`- ${e.jobId} — one brief so far, nothing to compare`);
  out.push(`Not summarizable: ${String(nc.notSummarizable.length)}`);
  for (const e of nc.notSummarizable) out.push(`- ${e.jobId} (${e.role}) — ${e.reason}`);
  out.push(`No brief in window: ${String(nc.noBriefInWindow.length)}`);
  for (const e of nc.noBriefInWindow) out.push(`- ${e.jobId} (${e.agent}) — configured, produced nothing`);
  out.push("");

  return out.join("\n");
}
```

Then change `buildFleetDigest`'s return type from `Omit<FleetDigestResult, "markdown">` to
`FleetDigestResult`, and its final statement to build the markdown from the very object it returns:

```ts
  const result = {
    windowMs: deps.windowMs,
    generatedAt: deps.now,
    jobs,
    notCompared: { firstObservation, notSummarizable, noBriefInWindow },
  };
  // One computation, two shapes. Rendering from `result` rather than from the locals is what makes
  // it impossible for `--json` and the printed digest to disagree about what moved.
  return { ...result, markdown: renderFleetDigest(result) };
```

- [ ] **Step 4: Run the tests**

Run: `bun test packages/gateway/src/fleet/ && bun run lint`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/fleet/fleet-digest.ts packages/gateway/src/fleet/fleet-digest.test.ts
git commit -m "feat(fleet): render the change digest as markdown"
```

---

### Task 10: IPC — `fleet.digest`

**Files:**

- Modify: `packages/gateway/src/ipc/fleet-rpc.ts`
- Test: `packages/gateway/src/ipc/fleet-rpc.test.ts`, `packages/gateway/src/ipc/lan-rpc.test.ts`

**Interfaces:**

- Consumes: `buildFleetDigest` (Task 8), `FleetRpcCtx` (existing — `store`, `jobs`, `now` are all already on it).
- Produces: the `fleet.digest` method.

- [ ] **Step 1: Write the failing test**

```ts
describe("fleet.digest", () => {
  test("returns a digest over the requested window", async () => {
    const res = await dispatchFleetRpc("fleet.digest", { windowMs: 86_400_000 }, ctx(NOW));
    expect(res.hit).toBe(true);
    expect(res.result).toMatchObject({ windowMs: 86_400_000, generatedAt: NOW });
    expect(typeof (res.result as { markdown: string }).markdown).toBe("string");
  });

  test("defaults the window to 24h when omitted", async () => {
    const res = await dispatchFleetRpc("fleet.digest", {}, ctx(NOW));
    expect((res.result as { windowMs: number }).windowMs).toBe(86_400_000);
  });

  test("rejects a non-integer or negative windowMs", async () => {
    await expect(dispatchFleetRpc("fleet.digest", { windowMs: -1 }, ctx(NOW))).rejects.toThrow(FleetRpcError);
  });

  test("fails cleanly when the store is absent", async () => {
    await expect(
      dispatchFleetRpc("fleet.digest", {}, { ...ctx(NOW), store: undefined }),
    ).rejects.toThrow(FleetRpcError);
  });
});
```

And in `lan-rpc.test.ts`, add `fleet.digest` to whatever existing assertion proves the `fleet`
namespace is LAN-forbidden. **No production change is needed for that** — `lan-rpc.ts:56` denies
the whole `"fleet"` prefix, so the new method inherits the denial. The test exists to prove the
inheritance rather than to assume it.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/gateway/src/ipc/fleet-rpc.test.ts`
Expected: FAIL — `res.hit` is `false` (method miss).

- [ ] **Step 3: Implement**

```ts
const DEFAULT_DIGEST_WINDOW_MS = 24 * 60 * 60 * 1000;

function handleDigest(params: unknown, ctx: FleetRpcCtx): FleetDigestResult {
  const store = ctx.store;
  if (store === undefined) {
    throw new FleetRpcError(-32603, "fleet: no brief store available");
  }
  const windowMs = optInt(params, "windowMs") ?? DEFAULT_DIGEST_WINDOW_MS;
  return buildFleetDigest({
    store,
    jobs: ctx.jobs ?? [],
    windowMs,
    now: ctx.now(),
  });
}
```

Add `"fleet.digest": handleDigest,` to `HANDLERS`. `optInt` already rejects non-integers and
negatives with `-32602`, so no new validation is written.

- [ ] **Step 4: Run the tests**

Run: `bun test packages/gateway/src/ipc/fleet-rpc.test.ts packages/gateway/src/ipc/lan-rpc.test.ts`
Expected: PASS.

- [ ] **Step 5: Confirm the Tauri allowlist is untouched**

Run: `grep -rn "fleet" packages/ui/src-tauri/src/gateway_bridge.rs`
Expected: no matches. The `fleet` namespace is absent from `ALLOWED_METHODS` and must stay that way
(I7) — if this prints anything, stop and re-read the spec.

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/ipc/fleet-rpc.ts packages/gateway/src/ipc/fleet-rpc.test.ts packages/gateway/src/ipc/lan-rpc.test.ts
git commit -m "feat(fleet): expose fleet.digest over local IPC"
```

---

### Task 11: CLI — `nimbus fleet digest`, and the docs

**Files:**

- Modify: `packages/cli/src/commands/fleet.ts`
- Modify: `docs/cli-reference.md`
- Test: `packages/cli/src/commands/fleet.test.ts`

**Interfaces:**

- Consumes: `fleet.digest` (Task 10), `parseDurationToMs` from `packages/cli/src/lib/parse-duration.ts`.

- [ ] **Step 1: Write the failing test**

```ts
describe("nimbus fleet digest", () => {
  test("parses --since into windowMs", () => {
    const p = parseFleetArgs(["digest", "--since", "7d"]);
    expect(p).toMatchObject({ sub: "digest", windowMs: 7 * 86_400_000 });
  });

  test("defaults to 24h", () => {
    expect(parseFleetArgs(["digest"])).toMatchObject({ windowMs: 86_400_000 });
  });

  test("rejects an unparseable duration", () => {
    expect(parseFleetArgs(["digest", "--since", "banana"])).toBeUndefined();
  });

  test("prints the markdown and exits 0", async () => {
    const code = await runFleetCommand({ sub: "digest", windowMs: 1000, json: false }, deps);
    expect(code).toBe(0);
    expect(sink.out).toHaveBeenCalledWith(expect.stringContaining("Fleet digest"));
  });

  test("--json emits the structured result", async () => {
    const code = await runFleetCommand({ sub: "digest", windowMs: 1000, json: true }, deps);
    expect(code).toBe(0);
    expect(JSON.parse(sink.lastOut())).toMatchObject({ windowMs: 1000 });
  });

  test("an empty window is NOT an error", async () => {
    // A quiet night and a broken fleet must not look the same to a script.
    const code = await runFleetCommand({ sub: "digest", windowMs: 1000, json: false }, emptyDeps);
    expect(code).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/cli/src/commands/fleet.test.ts`
Expected: FAIL — `parseFleetArgs` returns `undefined` for an unknown subcommand.

- [ ] **Step 3: Implement**

Update `USAGE`'s first line to `nimbus fleet <status|list|briefs|show|run|digest> [options]` and add
beneath the existing option lines:

```text
  digest [--since <duration>]   what moved since the window began (default 24h)
```

Add the `digest` arm to the `ParsedFleetArgs` union (`{ sub: "digest"; windowMs: number; json: boolean }`)
and to `parseFleetArgs`:

```ts
    case "digest": {
      const i = rest.indexOf("--since");
      if (i === -1) return { sub: "digest", windowMs: 86_400_000, json };
      const raw = rest[i + 1];
      if (raw === undefined) return undefined;
      let windowMs: number;
      try {
        windowMs = parseDurationToMs(raw);
      } catch {
        // Returning undefined routes to the existing print-USAGE-and-exit-1 path rather than
        // inventing a second failure vocabulary for this one subcommand.
        return undefined;
      }
      if (!Number.isInteger(windowMs) || windowMs <= 0) return undefined;
      return { sub: "digest", windowMs, json };
    }
```

And to `runFleetCommand`:

```ts
      case "digest": {
        const res = await deps.client.request("fleet.digest", { windowMs: parsed.windowMs });
        const r = res as FleetDigestResult;
        deps.sink.out(parsed.json ? JSON.stringify(r, null, 2) : r.markdown);
        // Zero even when nothing was compared: a quiet night and a broken fleet must not look the
        // same to a script that checks the exit status.
        return 0;
      }
```

- [ ] **Step 4: Run the tests**

Run: `bun test packages/cli/src/commands/fleet.test.ts`
Expected: PASS.

- [ ] **Step 5: Document**

In `docs/cli-reference.md`, add `nimbus fleet digest` beside the other five subcommands, and add
`digest_min_delta` to the `[[fleet.job]]` keys in the Configuration File section, stating the
default of `1` and that values below `1` are refused.

- [ ] **Step 6: Full preflight**

Run: `bun run preflight`
Expected: PASS. If `audit:doc-refs` or `audit:status-drift` complains, fix the cited doc rather than
the audit.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/commands/fleet.ts packages/cli/src/commands/fleet.test.ts docs/cli-reference.md
git commit -m "feat(fleet): add the nimbus fleet digest subcommand"
```

---

## Post-implementation

- [ ] **Close the spec's one remaining open assumption by measuring it.** Spec § 11 records that the
      digest's read cost is *estimated*, not benchmarked. Seed a database at realistic retention
      scale (say 20 jobs × 14 days of hourly briefs ≈ 6,700 rows), time `buildFleetDigest`, and put
      the real number in the spec — replacing the estimate rather than sitting beside it. If it is
      slow, the fix is a narrower `SELECT` that omits `brief_markdown`, which the comparison never
      reads and which can be tens of KB per row.

- [ ] Update `docs/CHANGELOG.md` with the digest entry.
- [ ] Update the spec's status block from "DESIGNED, not implemented" to what shipped, and correct
      anything the implementation falsified. Do this in the same PR — a spec that says it is not
      implemented after it is implemented is the drift this repo has had to correct before.

- [ ] Update `docs/roadmap.md` § Active: the overnight-fleet row moves from "PR 1 of 2" to
      "PR 1 of 3, PR 2a shipped", naming what 2b still owes (subject enumeration, the cursor,
      the per-run cap).

- [ ] `CLAUDE.md` and `GEMINI.md` mirror each other — if either mentions the fleet's digest gap,
      both must change together.

- [ ] Open the PR with a conventional-commit **title** (`feat(fleet): …`), since the squash commit
      is built from the title and body, not from the local commits above.
