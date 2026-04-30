# Perf Audit (B2) — PR-C-2b (reference-run data + populate baselines) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After the operator dispatches a reference run on the registered M1 Air and the resulting bot-PR merges to `main`, populate every workload-row threshold in `SLO_THRESHOLDS`, regenerate `slo.md`, fill in `docs/perf/baseline.md` from the new `history.jsonl` line, compute the threshold-miss list against the published spec § 3.2 budgets, and write `docs/perf/missed.md` (top-5 + full-list) plus `docs/perf/deferred-backlog.md` (misses 6–N).

**Architecture:** Pure data + prose PR. No production code changes. Read one specific JSON line from `docs/perf/history.jsonl` (the line whose `runner == "reference-m1air"` with the highest `timestamp`), use those numbers as the source-of-truth for every `refMax` / baseline cell, derive `ghaMax` for workload rows from a configurable multiplier with a fallback to recent `_perf.yml` GHA artifacts, then compute misses against spec § 3.2 reference budgets and rank the top-5 by the § 3.4 Impact / Cost rubric.

**Tech Stack:** Bun v1.2+ / TypeScript 6.x strict, `jq`, `gh` CLI. No new devDependencies; no new test files (existing `bun run test:coverage:perf` ≥80% line gate covers `slo-thresholds.ts`).

**Predecessor:** PR-C-2a (merged on `main` via `cd663f2` + earlier perf commits) — landed `_perf-reference.yml`, the cost-fallback gate in `_perf.yml`, the `--protocol-confirmed` flag, and the doc skeletons. PR-C-2b is the data-and-prose half.

**Spec source:** [`docs/superpowers/specs/2026-04-29-perf-audit-pr-c-2a-design.md`](../specs/2026-04-29-perf-audit-pr-c-2a-design.md) § 2 (PR boundary). Parent perf-audit spec [`2026-04-26-perf-audit-design.md`](../specs/2026-04-26-perf-audit-design.md) §§ 3.2 (surface table + budgets), 3.4 (Impact / Cost rubric), 4.2 (reference protocol), 4.4 (history schema), 4.5 (aggregation).

**Out of scope:**
- Top-5 fix plans (PR-D-1 … PR-D-N — each fix is its own PR after PR-C-2b merges).
- Astro page for `slo.md` (deferred per PR-C-2a D-Z).
- Real Ollama-driven S9 + Tauri-renderer instrumentation for S3 / S5 (hypothetical PR-B-2b-3).
- **Gating throughput / tokens-per-sec surfaces (S6-*, S8-*, S9, S10) on the absolute `ghaMax`.** The current `threshold-comparator.ts` (line 100, `measured > threshold`) and its delta check (line 112, one-sided positive `deltaPct`) treat every metric as ceiling-only. That works for latency / RSS / `first_token_ms` but inverts the semantics for floor metrics (higher throughput = better). Setting numeric `ghaMax` + `gated: true` on a throughput row right now would cause every CI run to fail with `absolute-fail (measured > threshold)` whenever observed throughput exceeds the floor — backwards. PR-C-2b therefore sets `refMax` only for floor-metric workload surfaces and leaves `ghaMax: "tbd-c2"`, `gated: false` until a follow-up (call it PR-C-2c) teaches the comparator about metric direction. Ceiling-metric workload surfaces (S7-*) gate normally in this PR.

---

## Preconditions (operator action — must complete before Task 1)

These are not code tasks; they are gates that must be green before any task in this plan starts. The first two are operator-only actions documented in [`docs/perf/reference-runner-setup.md`](../../perf/reference-runner-setup.md).

- [ ] **P1: M1 Air runner registered** with the `reference-m1air` label per the runbook. Verify:

  ```bash
  gh api /repos/asafgolombek/Nimbus/actions/runners \
    --jq '.runners[] | select(.labels[].name == "reference-m1air") | {name, status, labels: [.labels[].name]}'
  ```

  Expected: at least one runner with `status: "online"` whose labels include `reference-m1air`, `macOS`, `ARM64`, `self-hosted`.

- [ ] **P2: `_perf-reference.yml` dispatched and the resulting bot PR merged to `main`.** From the GitHub Actions UI or:

  ```bash
  gh workflow run _perf-reference.yml -f protocol_attested=true -f notes="<context>"
  ```

  The workflow opens a `perf`-labelled bot PR adding exactly one line to `docs/perf/history.jsonl`. Spot-check the new line for sanity (compare against any prior reference line if present), then merge. Watch the run with `gh run watch` from the dispatcher.

- [ ] **P3: Confirm `main` has the new line and it is not `incomplete`.** From a fresh checkout of `main`:

  ```bash
  cd C:/gitrepo/Nimbus
  git checkout main && git pull origin main --quiet
  tail -n 1 docs/perf/history.jsonl | jq -e '.runner == "reference-m1air"
    and .reference_protocol_compliant == true
    and (.incomplete // false) == false
    and (.surfaces | keys | length) >= 14'
  ```

  Expected: exit 0. If the line carries `incomplete: true` (reference-protocol breach, S9 model missing, Activity Monitor not pre-flighted, etc.), STOP — do not proceed. Re-dispatch P2 after fixing the gap. PR-C-2b's correctness depends on the reference line being authoritative.

If any of P1–P3 are unmet, do not start Task 1.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `packages/gateway/src/perf/slo-thresholds.ts` | Modify | Workload-row `refMax` from reference line; `ghaMax` from observed GHA artifacts × multiplier; flip `gated: false` → `gated: true` for rows now carrying concrete thresholds |
| `docs/perf/slo.md` | Regenerate (do not hand-edit) | Output of `bun scripts/regen-slo.ts` against the updated `SLO_THRESHOLDS` |
| `docs/perf/baseline.md` | Modify | Fill in TBD cells from the new history line; record `run_id` for provenance |
| `docs/perf/missed.md` | Modify | Top-5 ranked by Impact / Cost (§ 3.4 rubric); full-list section; Confidence column |
| `docs/perf/deferred-backlog.md` | Modify | Misses 6–N; Confidence column; "why deferred" annotation per row |

**Total:** 0 created, 5 modified.

---

## Execution order

Tasks are sequential. Critical dependencies:

- **T1** (extract reference values) feeds T2, T4, T5 — must run first.
- **T2** (update `SLO_THRESHOLDS`) determines whether `regen-slo:check` will pass in T3 and T7.
- **T3** (regenerate `slo.md`) depends on T2.
- **T4** (`baseline.md`) is independent of T2/T3 but uses T1's extracted values.
- **T5** (`missed.md` top-5) depends on T1 — misses are computed against spec § 3.2 budgets, not against the post-Task-2 `refMax`.
- **T6** (`missed.md` full-list + `deferred-backlog.md`) depends on T5.
- **T7** verification, **T8** opens PR — terminal.

---

## Task 1 — Extract reference values

**Files:** none (read-only working notebook).

This task does not write code. It produces a "reference data sheet" you carry through Tasks 2–6 so every later step writes the same numbers from the same source.

- [ ] **Step 1.1: Locate the new reference line**

```bash
cd C:/gitrepo/Nimbus
git checkout main && git pull origin main --quiet
LINE=$(tail -n 1 docs/perf/history.jsonl)
echo "$LINE" | jq -r '.runner + " " + .timestamp + " " + .nimbus_git_sha[0:7] + " (run_id: " + .run_id + ")"'
```

Expected: prints `reference-m1air <ISO timestamp> <sha7> (run_id: <UUIDv7>)`. Confirm the timestamp matches when P2 was dispatched.

- [ ] **Step 1.2: Save the run_id and per-surface aggregates to a local notebook**

```bash
echo "$LINE" | jq '{
  run_id,
  timestamp,
  nimbus_git_sha,
  os_version,
  bun_version,
  reference_protocol_compliant,
  surfaces: (.surfaces | to_entries | map({ (.key): {p50_ms, p95_ms, p99_ms, max_ms, throughput_per_sec, tokens_per_sec, first_token_ms, rss_bytes_p95, samples_count, stub_reason} }) | add)
}' > /tmp/perf-c-2b-ref.json
cat /tmp/perf-c-2b-ref.json | head -50
```

Keep `/tmp/perf-c-2b-ref.json` open in a second editor pane while doing Tasks 2–6. Every `refMax` / baseline / missed-list value comes from this file. Do not hand-retype values from the GitHub UI — use `jq` to extract.

- [ ] **Step 1.3: Categorize each surface**

Each registered surface falls into one of three buckets:

```bash
for s in S1 S2-a S2-b S2-c S3 S4 S5 \
         S6-drive S6-gmail S6-github \
         S7-a S7-b S7-c \
         S8-l50-b1 S8-l50-b8 S8-l50-b32 S8-l50-b64 \
         S8-l500-b1 S8-l500-b8 S8-l500-b32 S8-l500-b64 \
         S8-l5000-b1 S8-l5000-b8 S8-l5000-b32 S8-l5000-b64 \
         S9 S10 S11-a S11-b; do
  jq --arg k "$s" -r '
    .surfaces[$k] as $row |
    if $row == null then "\($k): MISSING"
    elif $row.stub_reason then "\($k): STUB (\($row.stub_reason))"
    else "\($k): MEASURED samples=\($row.samples_count) p95=\($row.p95_ms // "—") tput=\($row.throughput_per_sec // "—") rss=\($row.rss_bytes_p95 // "—") tps=\($row.tokens_per_sec // "—")"
    end' /tmp/perf-c-2b-ref.json
done > /tmp/perf-c-2b-categories.txt
cat /tmp/perf-c-2b-categories.txt
```

Three categories the executor must distinguish:

- **MEASURED** (most workload rows): `samples_count > 0`, the natural metric is a finite number, no `stub_reason`. Flow into Task 2 with both `refMax` and `ghaMax`.
- **STUB** (S3, S5 if Tauri-renderer instrumentation is still deferred to PR-B-2b-3): `stub_reason` is set. Leave the row's `ghaMax` and `gated` unchanged in Task 2; record a one-line code comment naming the deferring spec.
- **REFERENCE-ONLY** (S2-c, S7-c, S9 if measured): `samples_count > 0` but the row is `ghaMax: "skipped"` in the current `SLO_THRESHOLDS`. Set `refMax` only; do not touch `ghaMax`.

If any surface is `MISSING` (the reference run did not measure it at all but the row exists in `SLO_THRESHOLDS`), STOP — that's a harness bug or a registration gap, not a PR-C-2b decision. File an issue and re-dispatch P2.

- [ ] **Step 1.4: Snapshot the UX-surface spec § 3.2 budgets in the notebook**

The miss computation in Task 5 compares measured-vs-budget. **Only UX surfaces have spec § 3.2 budgets** — workload surfaces (S6, S7-*, S8, S9, S10) are recorded in the spec as `TBD Phase 2`, which is exactly what PR-C-2b is now setting. By definition, the reference run cannot "miss" a budget that didn't exist before this PR — so workload surfaces produce no missed-list entries. Capture only the UX budgets:

```bash
cat > /tmp/perf-c-2b-budgets.txt <<'EOF'
# Spec § 3.2 reference budgets — UX surfaces only.
# For these surfaces, observed > budget = miss (all are ceiling metrics).
S1       p95_ms <= 2000      # gateway cold start
S2-a     p95_ms <= 30        # query, 10K corpus (warm in-memory)
S2-b     p95_ms <= 80        # query, 100K corpus
S2-c     p95_ms <= 300       # query, 1M corpus (reference-only)
S3       p95_ms <= 1500      # dashboard first paint
S4       p95_ms <= 500       # TUI first paint
S5       p95_ms <= 200       # HITL popup latency
S11-a    p95_ms <= 300       # CLI invocation, cold
S11-b    p95_ms <= 50        # CLI invocation, warm

# Workload surfaces (S6-*, S7-*, S8-*, S9, S10) have no pre-PR-C-2b
# budget — Task 2 establishes the budget from this very reference run.
# These surfaces cannot generate a missed-list entry for PR-C-2b.
EOF
cat /tmp/perf-c-2b-budgets.txt
```

This file drives Task 5. The set of candidate-miss surfaces is exactly the 9 UX rows above.

---

## Task 2 — Update `SLO_THRESHOLDS` workload rows

**Files:**
- Modify: `packages/gateway/src/perf/slo-thresholds.ts`

Each workload row currently has `refMax: undefined`, `ghaMax: "tbd-c2"`, `gated: false`. Replace with concrete values per the rules below. UX rows (S1, S2-a, S2-b, S2-c, S3, S4, S5, S11-a, S11-b) already have concrete thresholds — do not change them in this task.

- [ ] **Step 2.1: Re-confirm the comparator's current limitation**

The comparator (`packages/gateway/src/perf/threshold-comparator.ts:100`) treats every metric's `ghaMax` as a ceiling (`measured > threshold` = fail) and only flags positive deltas (line 112, `deltaPct > effectiveFloorPct`). That is correct for ceiling metrics (`p95_ms`, `p50_ms`, `rss_bytes_p95`, `first_token_ms`) and incorrect for floor metrics (`throughput_per_sec`, `tokens_per_sec`). PR-C-2b ships within this constraint:

- **Ceiling-metric workload surfaces** (S7-a, S7-b, S7-c): full Pattern A (set `refMax` + numeric `ghaMax` + `gated: true`).
- **Floor-metric workload surfaces** (S6-*, S8-*, S9, S10): Pattern E only (set `refMax`, leave `ghaMax: "tbd-c2"`, leave `gated: false`). A follow-up PR teaches the comparator about metric direction and flips these to gated.

If you find that the comparator has been updated to handle floor metrics by the time you execute this plan (i.e. the line-100 check is metric-direction aware), upgrade the floor-metric workload surfaces from Pattern E to Pattern A:

```bash
grep -A 5 "absolute-fail" packages/gateway/src/perf/threshold-comparator.ts | head -10
```

If the matching block has metric-direction handling (e.g. an `isFloorMetric` helper used to pick the comparison operator), proceed with Pattern A for throughput rows. Otherwise, stay on Pattern E.

- [ ] **Step 2.2: Pull the most-recent 3 successful `_perf.yml` artifacts on `main` for derived `ghaMax`**

```bash
mkdir -p /tmp/perf-c-2b-gha
gh run list --workflow=_perf.yml --branch=main --status=success --limit 3 --json databaseId,headSha > /tmp/perf-c-2b-gha/runs.json
cat /tmp/perf-c-2b-gha/runs.json
# For each run, download per-OS artifacts:
jq -r '.[] | "\(.databaseId) \(.headSha)"' /tmp/perf-c-2b-gha/runs.json | while read RUN_ID SHA; do
  for OS in ubuntu macos windows; do
    gh run download "$RUN_ID" --name "perf-gha-${OS}-${SHA}" --dir "/tmp/perf-c-2b-gha/${RUN_ID}-${OS}" 2>/dev/null || \
      echo "skip ${RUN_ID}/${OS} (artifact missing)"
  done
done
ls /tmp/perf-c-2b-gha/
```

Expected: at least 3 directories named `<runid>-ubuntu`, `<runid>-macos`, `<runid>-windows` populated. If fewer than 3 successful artifacts exist for a given OS, **flag it** — Step 2.3's fallback path applies.

- [ ] **Step 2.3: Compute `ghaMax` per ceiling-metric workload surface**

Only ceiling-metric workload surfaces — **S7-a and S7-b** — get `ghaMax` derived in this PR. (S7-c is reference-only; floor-metric surfaces stay `tbd-c2` per Step 2.1.)

For each, across the 3 (or fewer) Linux artifacts (S7 carries `linuxOnlyGate: true`), pick the **maximum observed** value, then apply a variance-aware multiplier:

```bash
# Pull S7-a values from the 3 most recent ubuntu artifacts:
for d in /tmp/perf-c-2b-gha/*-ubuntu; do
  [ -d "$d" ] || continue
  jq -r --arg d "$d" '.surfaces["S7-a"].rss_bytes_p95 | "\($d) S7-a rss_p95=\(.)"' "$d/run-history.jsonl" 2>/dev/null
done | sort
# Same for S7-b.
```

Choose the multiplier:
- Compute `cv = stddev(observations) / mean(observations)`.
- If `cv ≤ 0.2` (low variance): `ghaMax = round_up(max_observed × 1.5)`.
- If `0.2 < cv ≤ 0.4` (moderate variance): `ghaMax = round_up(max_observed × 2.0)`.
- If `cv > 0.4` (high variance): `ghaMax = round_up(max_observed × 3.0)`. Also note the row in the PR description so reviewers know this surface needs more nightly data before tightening.

**Fallback when fewer than 3 artifacts exist for that surface/runner combo:** use `reference value × 7`. Justification: S11-b's empirical refMax→ghaMax was 50 ms → 600 ms = 12× anchored on an actual Windows worst case; 7× is the conservative middle ground when no observations exist. The delta-floor noise check (line 112, default 25 %) still catches genuine regressions even if the absolute threshold is loose.

Record one chosen value per ceiling-metric workload row in `/tmp/perf-c-2b-gha-thresholds.txt`. Format:

```
S7-a   max_observed=345MiB   cv=0.07   multiplier=1.5x   ghaMax_chosen=520MiB
S7-b   max_observed=...      cv=...    multiplier=...    ghaMax_chosen=...
```

(Substitute real numbers from your artifact pulls. S7-c skipped — reference-only.)

- [ ] **Step 2.4: Apply the changes to `slo-thresholds.ts`**

Open `packages/gateway/src/perf/slo-thresholds.ts`. For each workload row, apply the matching pattern below.

**Pattern A — ceiling-metric workload surface (S7-a, S7-b):**

Replace this block:

```typescript
{
  surfaceId: "S7-a",
  metric: "rss_bytes_p95",
  ghaMax: "tbd-c2",
  gated: false,
  noiseFloorPct: 20,
  noiseFloorAbs: 20 * 1024 * 1024,
  noiseFloorAbsUnit: "bytes",
  linuxOnlyGate: true,
},
```

With (substitute actual numbers from `/tmp/perf-c-2b-ref.json` and `/tmp/perf-c-2b-gha-thresholds.txt`):

```typescript
{
  surfaceId: "S7-a",
  metric: "rss_bytes_p95",
  refMax: <reference rss_bytes_p95 from /tmp/perf-c-2b-ref.json>,
  ghaMax: <chosen value from /tmp/perf-c-2b-gha-thresholds.txt>,
  gated: true,
  noiseFloorPct: 20,
  noiseFloorAbs: 20 * 1024 * 1024,
  noiseFloorAbsUnit: "bytes",
  linuxOnlyGate: true,
},
```

**Pattern E — floor-metric workload surface (S6-*, S8-*, S10):**

Set `refMax` only; leave `ghaMax: "tbd-c2"` and `gated: false`. Add a one-line code comment naming the follow-up that lifts the limitation:

```typescript
{
  surfaceId: "S6-drive",
  metric: "throughput_per_sec",
  refMax: <reference value from /tmp/perf-c-2b-ref.json>,
  // ghaMax + gated deferred: threshold-comparator.ts treats ghaMax as a
  // ceiling for every metric; floor-metric gating awaits PR-C-2c
  // (metric-direction handling in compareOne).
  ghaMax: "tbd-c2",
  gated: false,
  noiseFloorPct: 25,
  noiseFloorAbs: 5,
  noiseFloorAbsUnit: "items_per_sec",
},
```

**Pattern B — surface reference-only on GHA (S2-c, S7-c):**

Ceiling metrics only — set `refMax` from the reference line; keep `ghaMax: "skipped"`; flip `gated` to `true`. Example:

```typescript
{
  surfaceId: "S2-c",
  metric: "p95_ms",
  refMax: <reference p95 from /tmp/perf-c-2b-ref.json — was 300 in the spec § 3.2 budget>,
  ghaMax: "skipped",
  gated: true,
  noiseFloorPct: 25,
  noiseFloorAbs: 25,
  noiseFloorAbsUnit: "ms",
},
```

**Pattern B' — S9 (floor metric, reference-only on GHA):**

S9 is a floor metric (`tokens_per_sec`) that's `ghaMax: "skipped"`. The comparator's absolute check never fires for S9 on GHA. The delta check (one-sided positive) still wouldn't catch a tokens/sec drop, but reference-vs-reference comparisons fire on a separate path (`_perf-reference.yml` → committed history line, not workflow artifact). Set `refMax`; keep `ghaMax: "skipped"`; leave `gated: false` — for symmetry with the other floor-metric rows whose gating is also deferred to PR-C-2c. Example:

```typescript
{
  surfaceId: "S9",
  metric: "tokens_per_sec",
  refMax: <reference tokens_per_sec from /tmp/perf-c-2b-ref.json>,
  // gated deferred — same reason as Pattern E.
  ghaMax: "skipped",
  gated: false,
  noiseFloorPct: 30,
  noiseFloorAbs: 2,
  noiseFloorAbsUnit: "tps",
},
```

**Pattern C — surface stubbed (S3, S5 if instrumentation is still deferred):**

Leave `gated`, `ghaMax`, and `refMax` exactly as they currently are. Add a one-line code comment recording the deferring spec so the row is clearly intentional and not a TODO leak:

```typescript
{
  surfaceId: "S3",
  metric: "p95_ms",
  refMax: 1_500,
  ghaMax: 7_500,
  gated: true,
  // Tauri renderer instrumentation deferred to PR-B-2b-3; surface stubs out via stub_reason.
  noiseFloorPct: 25,
  noiseFloorAbs: 100,
  noiseFloorAbsUnit: "ms",
},
```

**Pattern D — S8 cell builder (all 12 cells, floor metric, gating deferred):**

S8 cells are throughput floors — same comparator limitation applies (Pattern E rationale). Update `buildS8Cells()` to carry `refMax` per cell, but keep `ghaMax: "tbd-c2"` and `gated: false`.

Generate the `S8_REF` object literal directly from `/tmp/perf-c-2b-ref.json` to avoid hand-transcription of 12 numbers:

```bash
jq -r '
  .surfaces
  | to_entries
  | map(select(.key | startswith("S8-")))
  | sort_by(.key)
  | "const S8_REF: Record<BenchSurfaceId, { refMax: number }> = {\n"
    + (map("  \"\(.key)\": { refMax: \(.value.throughput_per_sec) },") | join("\n"))
    + "\n};"
' /tmp/perf-c-2b-ref.json
```

Expected output (substitute when you run; numbers are real from the reference line):

```typescript
const S8_REF: Record<BenchSurfaceId, { refMax: number }> = {
  "S8-l50-b1":    { refMax: <…> },
  "S8-l50-b8":    { refMax: <…> },
  /* ...12 lines... */
  "S8-l5000-b64": { refMax: <…> },
};
```

Paste that directly into `slo-thresholds.ts` above `buildS8Cells`. Then replace the function body:

```typescript
function buildS8Cells(): readonly SloThreshold[] {
  const out: SloThreshold[] = [];
  for (const length of S8_LENGTHS) {
    for (const batch of S8_BATCHES) {
      const id = `S8-l${length}-b${batch}` as BenchSurfaceId;
      out.push({
        surfaceId: id,
        metric: "throughput_per_sec",
        refMax: S8_REF[id].refMax,
        // ghaMax + gated deferred — same reason as Pattern E.
        ghaMax: "tbd-c2",
        gated: false,
        noiseFloorPct: 25,
        noiseFloorAbs: 5,
        noiseFloorAbsUnit: "items_per_sec",
      });
    }
  }
  return out;
}
```

- [ ] **Step 2.5: Run typecheck**

```bash
bun run typecheck
```

Expected: exit 0. The `SLO_THRESHOLDS` const is `readonly SloThreshold[]`; type errors here mean a malformed row.

- [ ] **Step 2.6: Run the slo-thresholds unit test**

```bash
bun test packages/gateway/src/perf/slo-thresholds.test.ts
```

Expected: existing tests pass. The test validates schema invariants (e.g. every registered surface has a row), not specific values.

- [ ] **Step 2.7: Commit**

```bash
git add packages/gateway/src/perf/slo-thresholds.ts
RUN_ID=$(jq -r '.run_id' /tmp/perf-c-2b-ref.json)
SHA7=$(jq -r '.nimbus_git_sha' /tmp/perf-c-2b-ref.json | cut -c1-7)
git commit -m "$(cat <<EOF
feat(perf): populate workload-row refMax/ghaMax from M1 Air reference run

Reference run ${RUN_ID} (sha ${SHA7}) measured every workload surface on
the registered M1 Air per spec § 4.2 protocol. refMax values are taken
directly from the new history.jsonl line; ghaMax values derive from the
most recent three _perf.yml artifacts on main (worst-observed × 1.5 for
ceiling metrics, worst-observed × 0.66 for throughput floors), with a
reference × 7 / × 0.14 fallback for surfaces with fewer than 3 artifacts.
All workload rows now carry gated: true. Reference-only rows (S2-c, S7-c,
S9) get refMax but keep ghaMax: "skipped".

Spec: docs/superpowers/specs/2026-04-29-perf-audit-pr-c-2a-design.md § 2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — Regenerate `slo.md`

**Files:**
- Modify: `docs/perf/slo.md` (generated; do not hand-edit)

- [ ] **Step 3.1: Regenerate**

```bash
bun scripts/regen-slo.ts
```

Expected: prints `regen-slo: wrote docs/perf/slo.md`.

- [ ] **Step 3.2: Run the drift check**

```bash
bun run regen-slo:check
```

Expected: exit 0. (If it fails: you hand-edited `slo.md`; revert your edits and re-run Step 3.1.)

- [ ] **Step 3.3: Sanity-check the diff**

```bash
git diff docs/perf/slo.md | head -120
```

Expected: every workload row that was previously `tbd-c2` now shows a concrete number; reference-only rows show `skipped`; UX rows are byte-identical to before.

- [ ] **Step 3.4: Commit**

```bash
git add docs/perf/slo.md
git commit -m "$(cat <<'EOF'
docs(perf): regenerate slo.md from PR-C-2b workload thresholds

Output of bun scripts/regen-slo.ts after Task 2. Hand-edits would be
caught by regen-slo:check on the next CI run.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — Populate `docs/perf/baseline.md`

**Files:**
- Modify: `docs/perf/baseline.md`

- [ ] **Step 4.1: Compute the per-surface baseline cells**

For each surface row in the table, derive `p50` / `p95` / `p99` / `max` / `run_id` from `/tmp/perf-c-2b-ref.json`:

```bash
RUN_ID=$(jq -r '.run_id' /tmp/perf-c-2b-ref.json)
TIMESTAMP=$(jq -r '.timestamp' /tmp/perf-c-2b-ref.json)
SHA=$(jq -r '.nimbus_git_sha' /tmp/perf-c-2b-ref.json)
echo "run_id (use in every row, abbreviate to first 8 chars in the table): ${RUN_ID:0:8}…"
echo "timestamp: $TIMESTAMP"
echo "sha7: ${SHA:0:7}"

# Latency-metric surfaces (S1, S2-*, S3, S4, S5, S11-*):
for s in S1 S2-a S2-b S2-c S3 S4 S5 S11-a S11-b; do
  jq --arg k "$s" -r '.surfaces[$k] | "\($k) | \(.p50_ms // "—") | \(.p95_ms // "—") | \(.p99_ms // "—") | \(.max_ms // "—")"' /tmp/perf-c-2b-ref.json
done

# Throughput surfaces (S6-*, S8-*, S10):
for s in S6-drive S6-gmail S6-github S10 \
         S8-l50-b1 S8-l50-b8 S8-l50-b32 S8-l50-b64 \
         S8-l500-b1 S8-l500-b8 S8-l500-b32 S8-l500-b64 \
         S8-l5000-b1 S8-l5000-b8 S8-l5000-b32 S8-l5000-b64; do
  jq --arg k "$s" -r '.surfaces[$k] | "\($k) | items/sec: \(.throughput_per_sec // "—") | samples: \(.samples_count)"' /tmp/perf-c-2b-ref.json
done

# RSS surfaces (S7-*):
for s in S7-a S7-b S7-c; do
  jq --arg k "$s" -r '.surfaces[$k] | "\($k) | rss_p95_bytes: \(.rss_bytes_p95 // "—") | samples: \(.samples_count)"' /tmp/perf-c-2b-ref.json
done

# S9:
jq -r '.surfaces["S9"] | "S9 | tokens/sec: \(.tokens_per_sec // "—") | first_token_ms: \(.first_token_ms // "—")"' /tmp/perf-c-2b-ref.json
```

- [ ] **Step 4.2: Replace the provenance paragraph**

Open `docs/perf/baseline.md`. Replace the `_TBD — populated by PR-C-2 reference run. …_` paragraph (currently line 12) with the literal:

```markdown
Sourced from `docs/perf/history.jsonl` line `run_id: <RUN_ID>` (M1 Air reference run, `<TIMESTAMP>`, sha `<SHA7>`). Each surface's metric matches `slo.md`. Cells with `—` indicate the surface was stubbed or its natural metric is not applicable (see § 4.4 schema for `stub_reason`).
```

Substitute `<RUN_ID>`, `<TIMESTAMP>`, `<SHA7>` with the values from Step 4.1.

- [ ] **Step 4.3: Replace each TBD row**

The current table has rows for `S1, S2-a, S2-b, S2-c, S3, S4, S5, S6, S7-a, S7-b, S7-c, S8, S9, S10, S11-a, S11-b`. The header is `Surface | Metric | p50 | p95 | p99 | max | run_id`.

For latency rows, fill `p50` / `p95` / `p99` / `max` from Step 4.1. The `run_id` column is the abbreviated `${RUN_ID:0:8}…` form — long enough to identify, short enough to render.

For S6, S8, S10 (throughput), the `Metric` column already says `sync items/sec` / `embedding items/sec (12 cells)` / `SQLite writes/sec`. The `p50`/`p95`/`p99`/`max` columns do not apply — replace each with `—` and put the throughput value in a new italic line under the table:

```markdown
S6, S8, S10 throughput values (single per-surface or per-cell numbers, not percentile distributions): see `docs/perf/slo.md` table for the full S8 12-cell matrix.
```

For S7 rows (RSS), fill the `p95` column with the `rss_bytes_p95` value (humanized to MiB if useful) and put `—` in the other percentile columns.

For S9, fill the `Metric` column with `tokens/sec / first_token_ms` and put both values in the `p95` column comma-separated; other percentiles `—`.

- [ ] **Step 4.4: Replace the `## What lands in PR-C-2` section**

Replace the entire `## What lands in PR-C-2` section (currently the closing § of the file) with:

```markdown
## Provenance

All cells above derive from a single `run_id` (recorded in the `run_id` column). Reference runs are append-only; the next reference run will create a new `history.jsonl` line and a follow-up commit on `main` updates the cells if a regression is detected.

For long-term GHA history (Ubuntu / macOS / Windows) see workflow artifacts on the [Performance Benchmarks workflow](https://github.com/asafgolombek/Nimbus/actions/workflows/_perf.yml) — 90-day retention.
```

- [ ] **Step 4.5: Commit**

```bash
git add docs/perf/baseline.md
git commit -m "$(cat <<EOF
docs(perf): populate baseline.md from M1 Air reference run

Cells sourced from docs/perf/history.jsonl line run_id ${RUN_ID:0:8}…
(sha ${SHA:0:7}); provenance recorded per spec § 4.4 (no retyping).
Replaces the TBD skeleton from PR-C-1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — Compute and rank misses; populate `docs/perf/missed.md` top-5

**Files:**
- Modify: `docs/perf/missed.md`

A "miss" is any surface where the M1 Air reference value violates the spec § 3.2 reference budget — the *original* budget the SLO was anchored to, not the post-Task-2 `refMax` (which **is** the measured value). Only UX surfaces have a pre-existing § 3.2 budget; workload surfaces produce no miss entries (see Task 1 Step 1.4). Compare measured against the budgets in `/tmp/perf-c-2b-budgets.txt`.

- [ ] **Step 5.1: Build the miss list mechanically**

Iterate the 9 UX-surface rows in `/tmp/perf-c-2b-budgets.txt`. All are ceiling metrics (`p95_ms`); a miss is `observed_p95 > budget`. Compute `breach_ratio = observed_p95 / budget` (so `1.0` = at limit, `>1.0` = miss).

Save the raw miss list as `/tmp/perf-c-2b-misses.json`. Format suggestion (hand-curate; the math is small enough that scripting overhead exceeds value):

```json
[
  {
    "surface_id": "S5",
    "metric": "p95_ms",
    "budget": 200,
    "observed_p50": 145,
    "observed_p95": 235,
    "breach_ratio": 1.175
  },
  ...
]
```

If no miss exists, the top-5 table in Step 5.3 will be all "no-miss" rows, and Task 6 turns into a one-liner. That's a legitimate outcome — record it and continue.

- [ ] **Step 5.2: Score Impact and Cost per the § 3.4 rubric**

For each miss, assign:

- `impact` (1–5) per the `user_felt_impact_score` table in spec § 3.4. Anchors: 5 = every user notices in 30 s (cold start > 8 s, every CLI invocation feels stuck); 4 = most users notice in their first session (HITL popup > 1 s); 3 = users notice after a week (memory creep, nightly sync into the morning); 2 = power users notice (large-corpus query degradation); 1 = edge cases (1 M-item corpus, 24 h soak).
- `cost` (1–5) per the `engineering_cost_estimate` table in spec § 3.4. Anchors: 5 = multi-week (architectural refactor, schema change); 4 = one week (significant code change across 5+ files, migration); 3 = multi-day (one subsystem, well-bounded); 2 = one day (single file, narrow change); 1 = one hour (config tweak, single line).
- `confidence` (`High` / `Medium` / `Low`):
  - `High` if `samples_count ≥ 100` for the surface AND the breach is structural (well outside the noise floor).
  - `Medium` if `30 ≤ samples_count < 100` OR the breach is within 10 % of the noise floor.
  - `Low` if `samples_count < 30` OR the breach is intermittent / on a flaky surface.
- `proposed_fix` (one phrase): point at the suspected hot path or the suspected root cause. Examples: `"drop redundant JSON.parse in connector-vault.ts:read"`, `"prewarm sqlite-vec extension at gateway boot"`, `"batch DPAPI calls in vault sync"`. Do not propose a *plan* — just the suspected lever. The actual fix is a future PR-D-N.

Sort by `impact / cost` descending. Top 5 → Step 5.3. Misses 6–N → Task 6.

- [ ] **Step 5.3: Apply the top-5 to `missed.md`**

Open `docs/perf/missed.md`. Replace the TBD-row skeleton table under `## Top 5` with:

```markdown
| Rank | Surface | Threshold violated | Observed (p50 / p95) | Impact (1–5) | Cost (1–5) | Impact / Cost | Confidence | Proposed fix |
|---|---|---|---|---|---|---|---|---|
| 1 | <surface_id> | <metric> ≤ <budget> | <p50> / <p95> | <impact> | <cost> | <impact/cost> | <confidence> | <fix-phrase> |
| 2 | <surface_id> | <metric> ≤ <budget> | <p50> / <p95> | <impact> | <cost> | <impact/cost> | <confidence> | <fix-phrase> |
| 3 | <surface_id> | <metric> ≤ <budget> | <p50> / <p95> | <impact> | <cost> | <impact/cost> | <confidence> | <fix-phrase> |
| 4 | <surface_id> | <metric> ≤ <budget> | <p50> / <p95> | <impact> | <cost> | <impact/cost> | <confidence> | <fix-phrase> |
| 5 | <surface_id> | <metric> ≤ <budget> | <p50> / <p95> | <impact> | <cost> | <impact/cost> | <confidence> | <fix-phrase> |
```

Edge cases:

- **Fewer than 5 total misses.** Fill the remaining rank rows with `— | _(no further misses)_ | — | — | — | — | — | — | —` so the 5-row shape is preserved.
- **Zero misses.** Replace the entire `## Top 5` section with: `_The reference run met every spec § 3.2 budget. No misses; PR-D-N fix plans not required for v0.1.0._`. Skip Step 5.4 — go to Step 5.5.

- [ ] **Step 5.4: Commit (top-5 only)**

```bash
git add docs/perf/missed.md
git commit -m "$(cat <<EOF
docs(perf): populate missed.md top-5 from M1 Air reference run

Misses computed from docs/perf/history.jsonl line run_id ${RUN_ID:0:8}…
against spec § 3.2 reference budgets. Ranked by user_felt_impact_score
/ engineering_cost_estimate per spec § 3.4. Confidence column mirrors
B1's results.md schema. Top-5 → fix plans (PR-D-1 … PR-D-N); misses
6-N → next commit (deferred-backlog.md + missed.md full-list).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5.5 (zero-miss alternative): Commit the no-miss outcome**

If Step 5.3 took the zero-miss branch:

```bash
git add docs/perf/missed.md
git commit -m "$(cat <<EOF
docs(perf): record no-miss outcome from M1 Air reference run

Reference run run_id ${RUN_ID:0:8}… (sha ${SHA:0:7}) met every spec
§ 3.2 budget. PR-D-N fix plans not required for v0.1.0.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Skip Task 6 entirely — go to Task 7.

---

## Task 6 — Populate full-list and `deferred-backlog.md`

**Files:**
- Modify: `docs/perf/missed.md`
- Modify: `docs/perf/deferred-backlog.md`

(Skip this task entirely if Step 5.5 was taken — no misses to defer.)

- [ ] **Step 6.1: Apply the full-list section in `missed.md`**

Replace the `_TBD — populated by PR-C-2b. Misses 6–N also recorded in [`deferred-backlog.md`]…_` paragraph under `## All misses (full list)` with a markdown table containing **every** miss (top-5 from Task 5 + all others), same columns as the top-5 table, sorted by Impact / Cost descending. Do not skip the top-5 — the section is "all misses" by definition.

If there are exactly 5 misses (no overflow into deferred backlog), write under the section header instead:

```markdown
All misses fit in the Top 5 above; nothing rolls over to `deferred-backlog.md`.
```

- [ ] **Step 6.2: Apply `deferred-backlog.md`**

Open `docs/perf/deferred-backlog.md`. Replace the placeholder row with one row per miss ranked 6–N:

```markdown
| Surface | Threshold violated | Observed (p50 / p95) | Impact (1–5) | Cost (1–5) | Impact / Cost | Confidence | Why deferred |
|---|---|---|---|---|---|---|---|
| <surface_id> | <metric> ≤ <budget> | <p50> / <p95> | <impact> | <cost> | <impact/cost> | <confidence> | <one-line reason — typically "Impact / Cost ratio outside top 5"> |
```

If there are fewer than 6 total misses (so nothing to defer), keep the table header but write under it:

```markdown
| _No misses deferred — all misses fit in `missed.md` Top 5._ | | | | | | | |
```

- [ ] **Step 6.3: Cross-link sanity check**

Both files should reference each other consistently:

```bash
grep -n "deferred-backlog\|missed.md" docs/perf/missed.md docs/perf/deferred-backlog.md
```

Expected: each file links to the other; no broken anchors. If `grep` returns nothing for one direction, fix the link before commit.

- [ ] **Step 6.4: Commit**

```bash
git add docs/perf/missed.md docs/perf/deferred-backlog.md
git commit -m "$(cat <<EOF
docs(perf): populate missed.md full-list + deferred-backlog.md

Misses 6-N from the M1 Air reference run rolled into deferred-backlog.md
per spec § 11 (B2-v2, post-v0.1.0). The full-list section in missed.md
mirrors the same data for cross-reference. Confidence column mirrors B1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7 — Verification

**Files:** none (verification-only).

- [ ] **Step 7.1: Typecheck**

```bash
bun run typecheck
```

Expected: exit 0.

- [ ] **Step 7.2: Lint (Biome)**

```bash
bun run lint
```

Expected: exit 0.

- [ ] **Step 7.3: Perf coverage gate**

```bash
bun run test:coverage:perf
```

Expected: exit 0; ≥ 80 % line coverage on `packages/gateway/src/perf/`.

- [ ] **Step 7.4: regen-slo drift check**

```bash
bun run regen-slo:check
```

Expected: exit 0. (If it fails, return to Task 3 — `slo.md` was hand-edited.)

- [ ] **Step 7.5: Full CI-parity test suite**

Per the project memory note "Run CI-parity tests before every PR push":

```bash
bun run test:ci
```

Expected: exit 0. (May take 5–10 min depending on machine.)

- [ ] **Step 7.6: Confirm only the expected files changed**

```bash
git log --name-status main..HEAD | grep -E "^[AMD]" | sort -u
```

Expected exactly:

```
M       docs/perf/baseline.md
M       docs/perf/deferred-backlog.md
M       docs/perf/missed.md
M       docs/perf/slo.md
M       packages/gateway/src/perf/slo-thresholds.ts
```

If anything is unexpectedly added or missing, investigate before opening the PR. If `Task 5.5` (no-miss path) was taken, `deferred-backlog.md` should still appear because Task 6 was skipped — the Task 5.5 commit only touches `missed.md`, so `deferred-backlog.md` will not appear here. Adjust the expectation to:

```
M       docs/perf/baseline.md
M       docs/perf/missed.md
M       docs/perf/slo.md
M       packages/gateway/src/perf/slo-thresholds.ts
```

---

## Task 8 — Open PR

**Files:** none.

- [ ] **Step 8.1: Push the branch**

```bash
git push -u origin HEAD
```

- [ ] **Step 8.2: Open the PR**

```bash
RUN_ID=$(jq -r '.run_id' /tmp/perf-c-2b-ref.json)
TIMESTAMP=$(jq -r '.timestamp' /tmp/perf-c-2b-ref.json)
SHA=$(jq -r '.nimbus_git_sha' /tmp/perf-c-2b-ref.json)
gh pr create --title "perf: PR-C-2b — populate workload thresholds + baselines from M1 Air reference run" --body "$(cat <<EOF
## Summary

Closes the PR-C-2 deliverable. PR-C-2a landed the infrastructure (workflow, cost-fallback gate, \`--protocol-confirmed\` flag, doc skeletons, \`capture-benchmarks.ts\` deletion). This PR populates the data and prose from one M1 Air reference run.

Spec: [\`docs/superpowers/specs/2026-04-29-perf-audit-pr-c-2a-design.md\`](docs/superpowers/specs/2026-04-29-perf-audit-pr-c-2a-design.md) § 2 (PR boundary). Plan: [\`docs/superpowers/plans/2026-04-30-perf-audit-pr-c-2b.md\`](docs/superpowers/plans/2026-04-30-perf-audit-pr-c-2b.md).

## Source

All numbers below derive from one \`history.jsonl\` line:

- **run_id:** \`${RUN_ID}\`
- **timestamp:** \`${TIMESTAMP}\`
- **sha:** \`${SHA:0:7}\`
- **runner:** \`reference-m1air\` (2020 M1 Air, 8 GB / 256 GB)

Provenance per spec § 4.4 — no retyping.

## Deliverables

- \`SLO_THRESHOLDS\` workload rows now carry concrete \`refMax\` (from the reference line) and \`ghaMax\` (from observed \`_perf.yml\` artifacts × 1.5 / × 0.66 multiplier as appropriate). All workload rows are now \`gated: true\`.
- \`slo.md\` regenerated; CI's \`regen-slo:check\` passes.
- \`baseline.md\` populated; every cell sourced from one \`run_id\`.
- \`missed.md\` top-5 ranked by Impact / Cost (§ 3.4 rubric); full-list table with all misses; Confidence column mirrors B1.
- \`deferred-backlog.md\` rows 6–N with "Why deferred" annotations.

## Top-5 misses preview

<!-- Copy the top-5 markdown table from missed.md into here for reviewer convenience. If zero misses, write "Reference run met every spec § 3.2 budget — no misses." -->

## Out of scope (follow-up PRs)

- Top-5 fix plans (PR-D-1 … PR-D-N) — each fix is its own PR with its own plan once this lands.
- Astro page for \`slo.md\` — deferred per PR-C-2a D-Z; revisit when \`packages/docs/\` grows a Reference / SLO category.
- Real Ollama-driven S9 + Tauri-renderer instrumentation for S3 / S5 — hypothetical PR-B-2b-3.

## Test plan

- [ ] \`bun run test:coverage:perf\` exits 0.
- [ ] \`bun run regen-slo:check\` exits 0 (no \`slo.md\` drift).
- [ ] \`bun run typecheck\` exits 0.
- [ ] \`bun run lint\` exits 0.
- [ ] \`bun run test:ci\` exits 0.
- [ ] \`_perf.yml\` triggers on this PR (the \`perf\` label is auto-applied by \`labeler.yml\` for changes under \`packages/gateway/src/perf/\*\*\`); the per-OS comparator delta-checks against the previous main artifact and posts a comment. Expectation: workload-row deltas now record AND gate; UX-row deltas unchanged.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 8.3: Confirm the `perf` label is applied**

```bash
gh pr view --json labels -q '.labels[].name'
```

Expected: includes `perf`. If not:

```bash
gh pr edit --add-label perf
```

- [ ] **Step 8.4: Watch CI**

```bash
gh pr checks --watch
```

Expected: all checks pass. The bench job runs all three OSes (matrix unaffected by the cost-fallback gate because this is a `perf`-labelled PR, not a schedule trigger). **Workload-row deltas now gate** — if any of them fails, that's a real regression to investigate. Do not paper over it by relaxing thresholds in this same PR; instead, open a follow-up issue and revert just the relaxed row.

---

## Acceptance criteria for PR-C-2b

When this PR merges:

1. `SLO_THRESHOLDS` workload rows carry `refMax` for every measured surface. Ceiling-metric workload rows (S7-a, S7-b) additionally carry numeric `ghaMax` + `gated: true`. Floor-metric workload rows (S6-*, S8-*, S9, S10) keep `ghaMax: "tbd-c2"` (or `"skipped"` for S9 / S2-c / S7-c) and `gated: false`, with a code comment naming PR-C-2c as the follow-up — see "Out of scope" header for rationale.
2. `slo.md` matches `slo-thresholds.ts` byte-for-byte (`regen-slo:check` passes).
3. `baseline.md` cells all derive from one `run_id`; no TBD entries remain; the `## What lands in PR-C-2` section has been replaced with `## Provenance`.
4. `missed.md` top-5 has 5 rows ranked by Impact / Cost (or the explicit zero-miss prose if no misses exist); the full-list section enumerates all misses; Confidence column populated per row.
5. `deferred-backlog.md` populated with misses 6–N (or explicitly marked empty with "all misses fit in top-5").
6. `bun run regen-slo:check`, `bun run typecheck`, `bun run lint`, `bun run test:coverage:perf`, and `bun run test:ci` all pass.
7. `_perf.yml` runs on the PR with workload-row gates active and the comparator delta comment includes them.
8. The PR description records the source `run_id`, `timestamp`, and `sha`.

---

## Review feedback log

Plan reviewed by external AI tool (`docs/superpowers/plans/2026-04-30-perf-audit-pr-c-2b-review.md`, 2026-04-30). Each item verified against the actual code per the project memory note "verify external AI-review claims".

| Reviewer item | Verdict | Verification |
|---|---|---|
| #1 — Multiplier aggressiveness; consider variance-aware multiplier | **Applied** | Updated Task 2.3 to compute `cv = stddev / mean` over the 3 artifacts and pick 1.5× / 2.0× / 3.0× by variance band. Also flags high-variance rows in the PR description so reviewers know they need more nightly data. |
| #2 — Manual-edit risk for S8's 12 cells; suggest a generator | **Applied** | Updated Pattern D to include a `jq` one-liner that prints the `S8_REF` literal directly from `/tmp/perf-c-2b-ref.json`. Reduces transcription error risk to zero for the per-cell `refMax` numbers. |
| #3 — Bi-directional metrics? | **Dismissed** | Verified: every metric in `SloThreshold["metric"]` (`p95_ms`, `p50_ms`, `throughput_per_sec`, `rss_bytes_p95`, `tokens_per_sec`, `first_token_ms`) is monotonic. No bi-directional metrics exist or are planned. **However**, the comparator does NOT correctly handle floor metrics (it treats every `ghaMax` as a ceiling — `threshold-comparator.ts:100`). PR-C-2b ships within this constraint by deferring floor-metric gating; see new "Out of scope" bullet and Pattern E. The reviewer's question prompted the deeper check. |
| #4 — Stub baselines for S3 / S5 if data looks valid | **Dismissed** | Verified: `S3_STUB_REASON` and `S5_STUB_REASON` are constants in `bench-dashboard-first-paint.ts` / `bench-hitl-popup.ts`; the drivers always return `[]` and `bench-cli` records `stub_reason`. Any data field on those rows in the reference run line will be missing or stub-tagged. Task 1.3 already distinguishes MEASURED (real driver, no `stub_reason`) from STUB (`stub_reason` set) — Pattern A applies if real, Pattern C if stubbed. The plan handles both correctly already; nothing to change. |
| #5 — Miss computation scope (UX-only) | **Confirmed** | Already aligned with spec § 3.2 (workload surfaces are `TBD Phase 2` — no pre-PR-C-2b budget exists to miss). No change. |
| #6 — Provenance abbreviation | **Confirmed** | Plan already preserves the full `run_id` in commit messages, PR body, and `history.jsonl`; only the markdown table cell uses the `${RUN_ID:0:8}…` form. No change. |
| OQ1 — 7× fallback safety; cost-fallback gate relevance | **Dismissed** | The cost-fallback gate (`_perf.yml`, PR-C-2a) governs whether macOS / Windows runners RUN the bench on weekday nights — unrelated to threshold setting. The 7× fallback is intentionally conservative for the rare zero-artifact case; the noise-floor delta check (default 25 %) still catches genuine regressions even if the absolute threshold is loose. Documented inline at the fallback paragraph in Step 2.3. |
| OQ2 — Mock Ollama path for S9? | **Dismissed** | Spec § 3.5 mandates "warm-model measurement" against the real `llama3.2:3b-instruct-q4_K_M` on the M1 Air; mocking would defeat the purpose. If the model is not installed, the bench writes `incomplete: true` and Precondition P3 stops the plan. Documented in P3 already. |

## Self-review notes

- **Spec coverage.** Each PR-C-2a § 2 row marked "PR-C-2b" maps to one task: workload thresholds → T2; `baseline.md` → T4; missed ranking → T5; deferred backlog → T6.
- **§ 3.4 rubric applied.** T5 Step 5.2 instantiates the rubric verbatim with anchors copied from the parent spec.
- **§ 4.4 provenance.** T4 records `run_id` per cell rather than retyping; same for T5 / T6 (every cell tagged with the same `run_id`).
- **No spec drift.** `slo-thresholds.ts` is the SSoT; `slo.md` is regenerated. `regen-slo:check` enforces this in T7.
- **Out-of-scope guard.** Top-5 fix plans are explicitly out of scope (header, Task 8 PR body, Acceptance criteria § 8) so reviewers don't expect code-fix commits.
- **Zero-miss path.** Step 5.3 + 5.5 + Task 7.6 handle the all-passes outcome explicitly so the executor doesn't have to improvise.
