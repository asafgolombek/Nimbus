# S2 — Fleet Change Digest (PR 2a of the overnight-fleet row)

> **Status: DESIGNED 2026-09-07, not implemented.** Nothing in this document exists in the code yet.
>
> **Slot:** [Spine S2 — Local Compute Fleet](../../roadmap.md#active), the row *"[NEW] Overnight
> sub-agent fleets on zero-marginal local compute"*, which shipped
> [PR 1](./2026-09-06-s2-overnight-agent-fleets-design.md) on 2026-09-07 and named two things it
> did not ship: **subject enumeration** and **the change/threshold digest**. That predecessor calls
> the remainder "PR 2". This document splits it: **PR 2a is the digest** and is designed here; **PR
> 2b is enumeration** and is sketched in § 9 only far enough to show 2a does not foreclose it.
>
> **Why the digest goes first.** The two halves are not symmetric in dependency. Enumeration
> without a digest is strictly worse than today — sweeping a corpus through `ghost` produces two
> hundred briefs nobody reads, which the roadmap row itself describes as the failure mode. The
> digest is what makes enumeration survivable, and it is independently useful on the config-named
> jobs that ship today. So it lands first, and 2b arrives into a system that can already absorb its
> output.
>
> **Predecessors this document leans on, by name:**
> [S2 — Overnight Sub-Agent Fleets](./2026-09-06-s2-overnight-agent-fleets-design.md) (the
> substrate: `FLEET_ELIGIBILITY`'s total-map shape, V60, I38), and invariant **I31**'s
> renderer-versus-rewrite split, which § 1 applies to a different problem.

---

## 1. The load-bearing decision: what is compared

**The comparison basis is `findings_json`. Never `brief_markdown`.**

`fleet_brief` stores both. The markdown is the *synthesized* brief — on a machine with
`[agents] synthesis` set to `"local"` or `"allow-remote"`, a model rewrote it, and two runs over an
unchanged index produce different prose. Diffing or hashing that column would report "changed" on
essentially every comparison, and the digest would be noise on its first night.

`findings_json` is the deterministic typed brief — the same object the renderer consumes before any
model sees it. It changes when the index changes and not otherwise.

This is the split invariant **I31** already draws for a different purpose. There, the deterministic
render is what the disclosure guarantees are anchored to because a rewrite may paraphrase; here, it
is what the comparison is anchored to for the same underlying reason. Worth stating explicitly
because the mistake is natural: `brief_markdown` is the human-readable column, and reaching for it
is the obvious first move.

**Consequence for the digest's honesty.** The digest reports movement in the *findings*, which is
what the owner cares about, and says nothing about whether the prose changed. If a synthesis
provider changed and every brief now reads differently, the digest correctly reports nothing moved.
That is the right answer and the preamble says so, so a reader is not left inferring it.

---

## 2. The comparison unit is the job, not the run

A digest that diffs run N against run N−1 is wrong the moment PR 2b lands. A cursor sweep means
consecutive runs deliberately cover *different* subjects, so a run-to-run diff would compare a
`ghost` brief about one file against a `ghost` brief about another and report the entire contents
of both as movement.

So the unit is **(job, subject)**, and today — with the owner naming each job's params in config —
the subject is a fixed property of the job, so the unit is effectively the job id. § 3 explains why
that needs no schema to express yet.

**Each job's newest brief in the window is compared against that job's own immediately-preceding
brief, whether or not the predecessor falls inside the window.** Restricting the predecessor to the
window would make any job whose interval exceeds the window read as brand-new on every digest — a
weekly job would be "first ever" seven days running. The predecessor's age is disclosed alongside
the comparison, so a reader can see they are looking at a week's movement rather than a day's.

---

## 3. No schema change in PR 2a

V60 already stores everything the digest needs: `fleet_brief` carries `job_id`, `agent_method`,
`findings_json` and `created_at`, and `idx_fleet_brief_job (job_id, created_at DESC)` is exactly
the index the "newest, and the one before it" query wants.

**Summaries are derived at read time, not stored.** Extractors (§ 4) are pure functions of
`findings_json`, the corpus is retention-bounded (14 days by default), and read-time derivation has
a property write-time storage does not: **a corrected extractor applies to history.** Persisting a
`summary_json` column would freeze every brief's summary at the extractor version that happened to
be running the night it was written, so fixing an extractor would fix only future briefs and the
digest would keep reporting the old number for rows already on disk. That is the shape of defect
this subsystem has already had to correct once.

**Why no speculative `subject_key` column either.** PR 2b needs one, and it would be easy to add it
now "so 2b does not have to migrate". It is not added, because 2b's migration has a *correct*
backfill available rather than a placeholder one: for a config-named job the subject genuinely **is**
the job, so backfilling `subject_key` to `job_id` for pre-2b rows records true history rather than
filling a column with a stand-in. A column added now would be written by 2a with the same value and
buy nothing.

---

## 4. `FLEET_DIGEST_EXTRACTORS`

### 4.1 The type

```ts
interface BriefSummary {
  /** Stable finding identities, sorted. Set semantics: appeared / resolved. */
  readonly keys: readonly string[];
  /** Named counts. Magnitude semantics: moved by N. */
  readonly metrics: Readonly<Record<string, number>>;
}

/** `undefined` when the stored JSON does not match this agent's shape — see § 4.3. */
type FleetDigestExtractor = (findings: unknown) => BriefSummary | undefined;
```

Two axes rather than one, because the two kinds of movement are genuinely different and collapsing
them loses information the digest needs. A finding that appeared is a *set* change and is worth
reporting whatever its size; a count that moved is a *magnitude* change and is the only kind a
threshold can meaningfully apply to (§ 6).

### 4.2 The map is total over the ELIGIBLE agents, and the compiler enforces it

`FLEET_ELIGIBILITY` classifies all fifteen served `agents.*` methods; eleven are `eligible`. Only
those eleven can ever produce a `fleet_brief` row, so writing extractors for the other four is dead
code that has to be maintained and can never be exercised.

The eligible subset is **derived from `FLEET_ELIGIBILITY` rather than restated**, so the two lists
cannot drift:

```ts
type EligibleAgentMethod = {
  [K in AgentMethod]: (typeof FLEET_ELIGIBILITY)[K] extends "eligible" ? K : never;
}[AgentMethod];

export const FLEET_DIGEST_EXTRACTORS = {
  /* … eleven entries … */
} satisfies Readonly<Record<EligibleAgentMethod, FleetDigestExtractor>>;
```

**This requires one change to PR 1 code.** `FLEET_ELIGIBILITY` is currently annotated
`Readonly<Record<AgentMethod, FleetEligibility>>`, and that annotation *widens* every value to the
full `FleetEligibility` union — the conditional type above would then resolve to `never` for every
member and the derived set would be empty. Changing the annotation to a `satisfies` clause preserves
the literal types while keeping the totality check that annotation was there to provide. This is a
type-position change only; the runtime value is untouched.

**Verified before being written down, in both directions.** A standalone probe confirms the derived
subset is exactly the eligible members, that a non-eligible member is not assignable to it (a
`@ts-expect-error` line serving as its own positive control), and — reverting the map's completeness
— that dropping one eligible agent's extractor is a compile error naming that agent:

```text
error TS2741: Property '"agents.ghost"' is missing in type '{ "agents.catchup": … }'
              but required in type 'Record<EligibleAgentMethod, () => number>'.
```

So the coupling is real: **flipping any agent to `"eligible"` in `FLEET_ELIGIBILITY` fails the build
until someone writes its extractor.** That extends the fail-closed shape PR 1 chose for eligibility
one hop further, instead of adding a second hand-maintained list beside it. A partial map with a
generic fallback was considered and rejected for exactly the reason PR 1 rejected an exclusion
`Set`: it fails open, and the failure is silent.

### 4.3 Extractors guard; they do not cast

The parameter is `unknown` because that is what it honestly is: `findings_json` is a TEXT column,
and a row written by an older gateway can legitimately not match today's brief shape. Each extractor
validates the fields it reads and returns `undefined` when they are absent or wrongly typed —
never `as`-casting into the expected shape. This follows the repo's standing rule for external JSON
and non-negotiable 7.

**An unsummarizable brief is disclosed, not dropped.** The digest reports the count and the reason,
because a silent drop under-reports precisely when the schema moved underneath the reader — the
moment the digest is least trustworthy is the moment it would say the least. Malformed JSON on the
row is handled the same way: `JSON.parse` failure yields `undefined`, and never propagates.

---

## 5. What the digest renders

Markdown, in the same house style as the briefs it summarizes.

**A preamble that qualifies everything below it.** It states the window, and states that comparison
runs against each job's own previous brief which may be *older* than that window. This sits above
all counts rather than beside one because it qualifies every count in the document — the same
placement reasoning I31 applies to `negotiate`'s window clause, where a disclosure that governs the
whole brief cannot sit inside one section of it.

**Per job, what moved.** Metrics as `before → after` with the delta; keys that appeared; keys that
resolved. A job whose summary is byte-identical to its predecessor's is reported as unchanged in a
single line rather than omitted — "nothing moved" is an answer, and a job silently missing from the
digest is indistinguishable from a job that never ran.

**A `## Not compared` section, constructed by the renderer.** Three populations, each with its count
and its reason:

- **first observation** — the job has exactly one brief, so there is nothing to compare against;
- **not summarizable** — § 4.3's shape or parse failures, named by job and agent;
- **no brief in window** — the job is configured but produced nothing in the window, which is a
  scheduling fact the digest is the right place to surface.

These are disclosure, so they are built by the renderer from the data rather than assembled by any
caller, and they are present even when empty (as an explicit zero), because a section that vanishes
when it has nothing to say trains a reader to stop looking for it.

---

## 6. The threshold notion

Per-job `digest_min_delta`, an integer defaulting to `1` — that is, report any change.

It bounds **numeric movement only**: a metric whose absolute delta is below it is not reported.
Key-set changes are never suppressed by it, because a finding appearing or resolving is not a
magnitude and a threshold on it would be a category error — "suppress this finding because only one
appeared" is not a thing an owner means.

Deliberately small for a first cut. Per-metric thresholds (`orphaned_files > 5`) are the obvious
next want, and they need a per-metric naming surface in config that neither this slice nor 2b has a
use for yet. `digest_min_delta` is the minimum notion that makes the roadmap row's word "threshold"
true rather than aspirational, and it is forward-compatible with a richer form.

**Bound, stated rather than discovered:** the threshold suppresses a metric from the *report*. It
does not mark the job unchanged — a job whose only movement is below the threshold is reported as
unchanged-within-threshold, naming the threshold, so a reader cannot mistake a suppressed change for
no change.

---

## 7. Egress and invariants: none, and that is a claim being made

**The digest never calls a model.** It reads local SQLite, runs pure extractors, and renders
deterministically.

- **No egress.** No new coverage class, and `THIS_BINARY_COVERAGE` is untouched. A `chatops`-posted
  digest *would* be egress and is covered by the existing appender — PR 1 § 7.3 recorded that
  already — and it is out of scope here precisely so this slice does not also become an egress
  slice.
- **Outside I38 entirely.** I38 governs which provider an unattended run's *synthesis* may reach.
  The digest resolves no provider and spends no budget, so there is no door for it to enter through.
  This is true by construction rather than by check.
- **No new invariant, no new static rule.** Nothing here is a structural defense: there is no
  boundary to confine, because there is no capability to reach.

**An LLM-written digest is an explicit non-goal**, not an oversight. It would pull in I38 (a model
call from an unattended context) and I31 (a rewrite that can drop disclosures) to improve the prose
of a surface whose entire value is that it is mechanically true. If the digest says a metric moved
from 4 to 7, that should be because 4 and 7 are what the briefs said.

---

## 8. Surfaces and files

| Concern | Location |
| --- | --- |
| `BriefSummary`, `FleetDigestExtractor`, the eleven extractors, the derived eligible type | `packages/gateway/src/fleet/fleet-digest-extractors.ts` |
| Comparison + Markdown render | `packages/gateway/src/fleet/fleet-digest.ts` |
| "Newest and its predecessor, per job, in window" reads | `packages/gateway/src/fleet/fleet-store.ts` |
| `fleet.digest` IPC | the existing `fleet` namespace — **LAN-forbidden**, absent from the Tauri allowlist, like every other `fleet.*` method |
| `nimbus fleet digest [--since <duration>]` — **default 24h** | `packages/cli/src/commands/fleet.ts` |
| `digest_min_delta` per job | `packages/gateway/src/config/fleet-toml.ts` |

**The window default is 24 hours**, matching the shape of an overnight fleet: the digest you read at
09:00 covers the night that just ran. `--since` accepts the same duration vocabulary as the existing
`nimbus fleet` subcommands rather than inventing a second one.

**Exit codes** join the vocabulary PR 1 established for `nimbus fleet`. A digest over a window
containing no runs at all is **not** an error — it is a legitimate answer ("the fleet did not run"),
rendered as such and exiting zero. Reserving a non-zero code for "nothing to report" would make a
quiet night indistinguishable from a broken one in any script that checks the status.

`fleet-digest.ts` and `fleet-digest-extractors.ts` are split rather than combined because they have
different reasons to change and very different shapes of test: the extractors are eleven small
table-driven shape functions, the comparison is one algorithm with edge cases. Keeping the eleven
out of the file holding the algorithm keeps both readable.

---

## 9. PR 2b, sketched only to show 2a does not foreclose it

Not designed here. Recorded so the boundary is deliberate:

- **Enumerator map**, the same total-over-eligible shape as § 4.2, returning candidate param objects
  from the index.
- **`subject_key` on `fleet_brief` + a per-job cursor**, in 2b's own migration, backfilled to
  `job_id` for pre-2b rows (§ 3).
- **A hard per-run cap with no default**, refused rather than clamped when exceeded — the posture
  `nimbus media allow-remote --limit` already established for a bounded sweep over private data.
- **`negotiate` stays `deferred`.** Its `FLEET_ELIGIBILITY` comment currently says "revisit in PR 2
  alongside subject enumeration"; 2b rewrites it to a settled reason rather than lifting it.
  Enumeration is *why* it stays deferred: it turns "the owner built one dossier" into "the machine
  builds a dossier on every indexed person, nightly, unattended", which is a different act and one
  no current consent surface covers. Concretely, **no enumerator returns person-shaped subjects**,
  which also keeps `expert` and `ownership` sweeping paths and services rather than people.

**One interaction worth recording now.** Enumeration multiplies subjects per run, which makes
remote-budget exhaustion the *normal* case rather than an edge one. That promotes the per-brief
`fleetRemoteWithheld` disclosure merged in #1462 from a nicety to a load-bearing part of the output:
without it, a night in which most briefs were synthesized locally because the budget ran out is
indistinguishable from a night with no remote provider configured at all.

---

## 10. Testing

Per the repo's testing philosophy — real SQLite, no mocks at the DB layer — and its red-prove
practice: every behavioural change is confirmed by reverting it and watching the covering test fail.

**Extractors.** Table-driven per agent: a well-formed brief yields the expected keys and metrics; a
brief missing a required field yields `undefined`; malformed JSON yields `undefined` and does not
throw. The § 4.2 compile-time coupling is pinned by a test asserting the derived-type behaviour, and
red-proved by removing an entry.

**Comparison.** The cases that actually bite, each with a real `fleet_brief` row behind it:

- predecessor **older than the window** — compared, and its age disclosed;
- **first-ever brief** — lands in `Not compared` as *first observation*, never as "everything is new";
- **unsummarizable predecessor** — the pair is `Not compared`, and the *reason* distinguishes it from
  a first observation;
- **job absent from the window** — reported, not silently omitted;
- **identical summaries** — reported as unchanged;
- **movement below `digest_min_delta`** — reported as unchanged-within-threshold naming the
  threshold, and specifically NOT reported as unchanged.

**A control that can actually fail.** The threshold tests use a default other than the value under
test wherever possible. A test that sets `digest_min_delta` to its own default proves nothing, which
is the exact defect #1462 had to correct in `remote_call_budget = 0 stays legal`.

---

## 11. What this document asserts vs. what it assumes

**Asserted, verified against the code on 2026-09-07:**

- `fleet_brief` stores `findings_json` as the whole typed brief (`AnyBrief`, a fourteen-member
  union), written by `fleet-invoker.ts` from the `briefReady` notification's `findings` field —
  which `emit-brief.ts` populates with the pre-synthesis brief object. So § 1's basis exists.
- `FLEET_ELIGIBILITY` is total over fifteen `AgentMethod`s with eleven `eligible`, and is currently
  annotated in the widening form § 4.2 must change.
- V60 carries `idx_fleet_brief_job (job_id, created_at DESC)`.
- The `satisfies`-derived eligible subset typechecks, rejects a non-eligible member, and fails the
  build on a missing extractor (§ 4.2, probe run and red-proved).

**Assumed, to be confirmed during implementation:**

- That each of the eleven eligible briefs actually contains a field stable enough to serve as a
  finding *key*. Where one does not, that agent's extractor returns metrics only and an empty key
  set — a legitimate outcome, but it must be a stated per-agent finding rather than a silent empty
  list, since an always-empty key set looks identical to "nothing appeared or resolved".
- That the digest's read stays cheap at retention scale. The corpus is bounded by
  `retention_days` (default 14) and re-parsing it per digest is expected to be trivial, but the
  number has not been measured.
