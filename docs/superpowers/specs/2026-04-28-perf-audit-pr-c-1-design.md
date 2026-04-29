# Perf Audit — PR-C-1 (CI workflow + doc skeletons) Design

**Date:** 2026-04-28
**Parent spec:** [`2026-04-26-perf-audit-design.md`](./2026-04-26-perf-audit-design.md) — defines the surface table, threshold semantics, reference-hardware protocol, and PR sequence (PR-A → PR-B-1 → PR-B-2a → PR-B-2b-1 → PR-B-2b-2 → **PR-C** → PR-D-N). Read it first; this doc fills in PR-C's architectural decisions.
**Predecessor plan:** [`2026-04-28-perf-audit-cluster-c-2.md`](../plans/2026-04-28-perf-audit-cluster-c-2.md) (PR-B-2b-2, merged via PR #125) — closed Phase 1 by landing the S8/S9/S10 drivers + `worker-bench` + supporting infra. Every surface row in parent spec § 3.2 now has a registered driver.

## 1. Goal

Land the CI bench workflow (`.github/workflows/_perf.yml`), the renamed/expanded SLO sheet (`docs/perf/slo.md`), the migration redirect for the legacy `gh-pages` benchmark history (`docs/perf/baseline.md` skeleton), and the supporting TypeScript modules that make the workflow's threshold gating + PR-comment delta type-safe and unit-testable. Workload-surface threshold values stay TBD until PR-C-2 measures on the reference M1 Air.

After this PR merges:
- Every `perf`-labelled PR posts a per-surface delta comment vs. the most recent same-runner main artifact.
- UX surfaces (S1–S5, S11-a/b) gate the build on absolute thresholds and on delta-vs-previous-main per spec § 3.1.
- Workload surfaces (S6, S7, S8, S9, S10) are recorded but not gated — they activate in PR-C-2 once thresholds are populated.
- The legacy `benchmark.yml` workflow is retired; the `gh-pages` chart branch is preserved as historical archive.

## 2. PR boundary

Spec § 2 Phase 2 lists six deliverables (baseline.md, slo.md, missed.md, deferred-backlog.md, _perf.yml, retire benchmark.yml). PR-C-1 ships the four that don't depend on reference-machine measurements; PR-C-2 ships the two that do.

| Deliverable | PR-C-1 | PR-C-2 |
|---|---|---|
| `_perf.yml` workflow | ✅ full implementation | — |
| Retire `benchmark.yml` | ✅ same-PR delete (D-C) | — |
| `docs/perf/slo.md` | ✅ rename + UX rows from spec + workload-row scaffolding (TBD values) | populates workload thresholds from ref-run |
| `docs/perf/baseline.md` | ✅ `gh-pages` redirect note + TBD measurements table | populates measurement table from ref-run |
| `docs/perf/missed.md` | — | ✅ created from threshold violations |
| `docs/perf/deferred-backlog.md` | — | ✅ misses 6–N |
| Reference run on M1 Air | — | ✅ maintainer-only |
| `scripts/capture-benchmarks.ts` deletion | — (deferred per spec § 4.7 step 2) | likely C-2 follow-up once 3 nightly main artifacts exist |

The split is dictated by which deliverables depend on physical hardware Claude Code does not have access to. Everything in PR-C-1 is reviewable and shippable without the reference machine; PR-C-2 is "fill in the numbers and rank misses".

## 3. Architecture

```
                 _perf.yml (workflow)
                          │
                          ▼
   ┌───────────────────────────────────────────────┐
   │  matrix: ubuntu-24.04 / macos-14 / windows-2022│
   │                                                │
   │  step: nimbus bench --all --gha                │
   │     ├─→ writes /tmp/run-history.jsonl          │
   │     └─→ uploads as artifact                    │
   │         "perf-{os}-{sha}" (90-day retention)    │
   │                                                │
   │  step: bun packages/gateway/src/perf/bench-ci.ts │
   │     ├─→ gh run download (latest main artifact) │
   │     ├─→ compareAgainstHistory()                 │
   │     ├─→ formatPrComment()                       │
   │     ├─→ gh pr comment (or skip on push/sched)  │
   │     └─→ exit 1 on UX absolute-fail/delta-fail  │
   └───────────────────────────────────────────────┘

   packages/gateway/src/perf/   (new modules)
     ├── slo-thresholds.ts        single source of truth — UX rows from spec § 3.2
     ├── threshold-comparator.ts  compareAgainstHistory(current, previous, slo, runner)
     ├── pr-comment-formatter.ts  spec § 4.6 markdown table + first-run case
     └── bench-ci.ts              CLI orchestrator

   docs/perf/   (renamed/added)
     ├── slo.md                  ← rename of slo-ux.md + workload-row scaffolding
     └── baseline.md             ← gh-pages redirect + TBD measurements section

   scripts/
     └── regen-slo.ts            ← regenerates slo.md table from slo-thresholds.ts;
                                   --check mode used by CI to detect drift
```

Three boundaries:

- **Workflow ↔ TS.** `_perf.yml` only invokes `nimbus bench` and `bun bench-ci.ts`; never embeds gating or formatting logic in YAML.
- **TS ↔ slo.md.** `slo-thresholds.ts` is the source of truth. `regen-slo.ts` regenerates `slo.md`'s tables from the const; PR-quality CI runs `regen-slo.ts --check` to fail on drift.
- **GHA artifact ↔ TS.** `bench-ci.ts` consumes the artifact JSON via the existing `HistoryLine` type (`packages/gateway/src/perf/history-line.ts`, landed in PR-B-2a). No re-shaping; the artifact is the same JSON the harness already writes.

## 4. `_perf.yml` workflow

```yaml
name: Performance Benchmarks
on:
  push:
    branches: [main]                    # writes baseline artifact for PRs to diff against
  pull_request:
    types: [opened, synchronize, reopened, labeled]
  schedule:
    - cron: "0 4 * * *"                 # nightly at 04:00 UTC

permissions:
  contents: read
  pull-requests: write                  # for gh pr comment in bench-ci.ts

concurrency:
  group: bench-${{ github.workflow }}-${{ matrix.os }}
  cancel-in-progress: false             # spec § 4.3 — do not skew measurements

jobs:
  detect-trigger:
    runs-on: ubuntu-24.04
    outputs:
      run: ${{ steps.gate.outputs.run }}
    steps:
      - id: gate
        run: |
          # push to main / scheduled → run.
          # pull_request → run only if labels include `perf`.
          # ...

  benchmark:
    needs: detect-trigger
    if: needs.detect-trigger.outputs.run == 'true'
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-24.04, macos-14, windows-2022]
    runs-on: ${{ matrix.os }}
    timeout-minutes: 45
    steps:
      - uses: step-security/harden-runner@<pinned>
        with: { egress-policy: audit }
      - uses: actions/checkout@<pinned>
      - uses: ./.github/actions/setup-nimbus-ci
      - run: bun packages/gateway/src/perf/bench-runner.ts \
                --all --gha --runs 5 \
                --corpus small \
                --history /tmp/run-history.jsonl \
                --fixture-cache "${{ runner.temp }}/perf-fixtures"
      - uses: actions/upload-artifact@<pinned>
        with:
          name: perf-${{ matrix.os }}-${{ github.sha }}
          path: /tmp/run-history.jsonl
          retention-days: 90
      - run: bun packages/gateway/src/perf/bench-ci.ts \
                --current /tmp/run-history.jsonl \
                --runner gha-${{ matrix.os }}
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Trigger gate.** The `detect-trigger` job resolves three trigger types to one boolean:

- `push` to `main` → always run (writes the per-OS baseline artifact subsequent PRs diff against).
- `schedule` (nightly cron) → always run.
- `pull_request` → run only when labels include `perf`. PRs without the label do not pay matrix cost. (Spec § 4.3.)

**Cost discipline.** Spec § 4.3 documents an "ubuntu-only nightly + macos / windows once per week" fallback gated on `if: github.event.schedule == '0 4 * * 0'`. **PR-C-1 documents this fallback in a comment block in `_perf.yml` but does not pre-wire the `if:` condition.** Current usage (~290 OS-min per nightly + per labelled PR) is well within the OSS-free GHA tier; pre-wiring inverts the default in a way that's easy to forget about. We flip when (and only if) we hit the cap.

**Labeler integration.** Add to existing `.github/labeler.yml`:

```yaml
perf:
  - changed-files:
    - any-glob-to-any-file:
      - "packages/gateway/src/engine/**"
      - "packages/gateway/src/db/**"
      - "packages/gateway/src/embedding/**"
      - "packages/gateway/src/connectors/**"
      - "packages/gateway/src/llm/**"
      - "packages/gateway/src/voice/**"
      - "packages/gateway/src/perf/**"
```

Globs from spec § 4.3 verbatim.

## 5. TypeScript modules

Four new modules under `packages/gateway/src/perf/`. Interfaces only here; behavior is mechanical and follows the spec.

### 5.1 `slo-thresholds.ts`

```typescript
export interface SloThreshold {
  surfaceId: BenchSurfaceId;
  metric:
    | "p95_ms"
    | "p50_ms"
    | "throughput_per_sec"
    | "rss_bytes_p95"
    | "tokens_per_sec"
    | "first_token_ms";
  refMax?: number;                            // reference threshold (M1 Air); undefined if reference-only/skipped
  ghaMax: number | "tbd-c2" | "skipped";      // absolute GHA threshold; tbd-c2 = workload row pending ref-run; skipped = S2-c, S7-c, S9
  noiseFloorPct: number;                      // delta-fail threshold, %
  noiseFloorAbs: number;                      // delta-fail floor, absolute (units match metric)
  noiseFloorAbsUnit: "ms" | "items_per_sec" | "bytes" | "tps";
  linuxOnlyGate?: true;                       // S7-a/b/c per spec § 3.3
}

export const SLO_THRESHOLDS: readonly SloThreshold[];
```

Row count: ~27 — 15 non-S8 surfaces (S1, S2-a/b/c, S3, S4, S5, S6-drive/gmail/github, S7-a/b/c, S9, S10, S11-a/b) plus the 12 S8 cross-product cells (`S8-l{50|500|5000}-b{1|8|32|64}`, expanded in PR-B-2b-2 per its plan D-4). UX rows populated from spec § 3.2 verbatim; workload rows (S6, S7, S8 cells, S9, S10) have `ghaMax: "tbd-c2"`. The const is the SSoT — `slo.md` is regenerated from it; CI verifies they match.

### 5.2 `threshold-comparator.ts`

```typescript
export type ComparisonStatus =
  | { kind: "pass" }
  | { kind: "absolute-fail"; measured: number; threshold: number }
  | { kind: "delta-fail"; previous: number; current: number; deltaPct: number; floorPct: number }
  | { kind: "skipped"; reason: "tbd-c2" | "linux-only-gate" | "reference-only" | "stub" }
  | { kind: "no-baseline"; current: number };  // first run on main, no prior artifact

export interface SurfaceComparison {
  surfaceId: BenchSurfaceId;
  metric: SloThreshold["metric"];
  status: ComparisonStatus;
}

export function compareAgainstHistory(
  current: HistoryLine,
  previous: HistoryLine | null,                 // null → first-run case
  slo: readonly SloThreshold[],
  runner: RunnerKind,
): SurfaceComparison[];

export function isFailingComparison(c: SurfaceComparison): boolean;
// True only for absolute-fail + delta-fail. C-1 gates UX rows;
// workload rows resolve to skipped because their ghaMax is "tbd-c2".
```

Pure function — no I/O. The same comparator C-2 will reuse for `missed.md` ranking.

### 5.3 `pr-comment-formatter.ts`

```typescript
export function formatPrComment(
  comparisons: SurfaceComparison[],
  current: HistoryLine,
  previous: HistoryLine | null,
): string;
// Emits the spec § 4.6 markdown table + a header line.
// Renders a "First run on this runner; no delta available yet."
// notice when `previous` is null.
```

Output shape per spec § 4.6:

```
### Performance benchmarks — gha-ubuntu-24.04

> Compared against main artifact `<sha>` (<timestamp>).

| Surface | Metric | Previous | Current | Δ | Status |
|---|---|---|---|---|---|
| S1  | p95 ms       |  82.3 |  86.7 | +5.3% | ✅ pass        |
| S2-a| p95 ms       |  12.1 |  14.4 | +19.0%| ⚠️ delta-fail (floor 25%) |
| S6-drive | items/sec | 142  | 148   | +4.2% | ⏭ skipped (tbd-c2) |
| S3  | p95 ms       |  —    | —     | —     | ⏭ stub (renderer instrumentation pending) |
…
```

### 5.4 `bench-ci.ts`

CLI orchestrator. Composes the pipeline:

1. Parse args: `--current <path>`, `--runner gha-{os}`.
2. Read current run from `<path>` (one `HistoryLine`).
3. Resolve previous: `gh run download --branch main --workflow _perf.yml --name perf-${runner}-* --limit 1` → JSON. Returns `null` if no prior artifact (first run, retention expired, or new OS).
4. `compareAgainstHistory(current, previous, SLO_THRESHOLDS, runner)`.
5. If `GITHUB_EVENT_NAME == "pull_request"`: `formatPrComment` → write to `$GITHUB_STEP_SUMMARY` and post via `gh pr comment`. On push/schedule, skip the comment (no PR to post on) but still write the step summary.
6. If any UX comparison returns `absolute-fail` or `delta-fail`: `process.exit(1)` (fails the build per spec § 3.1).

**Retry policy.** `gh run download` flakes are retried 3× with 5 s backoff. Persistent failure logs a warning and proceeds as if first-run; the artifact upload step that ran before us is still preserved for the next run to diff against. We never fail the bench because diff plumbing failed.

## 6. `slo.md` and `baseline.md` skeletons

### 6.1 `docs/perf/slo.md` (rename of `slo-ux.md`)

Structure:

1. **Header.** Updated wording: "UX **and workload** SLOs for Nimbus, used by `_perf.yml` for absolute-threshold and delta-vs-previous-main gating."
2. **Caveat row** (mandatory per spec § 4.1) — preserved verbatim from `slo-ux.md`.
3. **UX surfaces table** — verbatim from `slo-ux.md` (no value changes). Per-row Nielsen / RAIL / Nimbus-claim citations preserved.
4. **Workload surfaces table** — new, 11 rows: S6-{drive,gmail,github}, S7-{a,b,c}, S8 (12-cell cross-product collapsed to one parameterized row + a footnote enumerating cells), S9, S10. Threshold cells say `TBD — Phase 2 reference run (PR-C-2)`. Citations cite spec § 3.2.
5. **Generated-doc footer.** "This file is generated from `packages/gateway/src/perf/slo-thresholds.ts`. Run `bun scripts/regen-slo.ts` after changing thresholds. CI verifies they match via `bun scripts/regen-slo.ts --check`."

**`slo-ux.md` deletion.** Internal-only references; clean delete is fine. The one source-code reference (a comment in `packages/cli/src/tui/App.tsx:133`) is updated in the same diff to point at `slo.md`.

### 6.2 `docs/perf/baseline.md` (new — template)

Top-level redirect note (load-bearing — this is the spec § 4.7 migration commitment for `gh-pages` bookmarks):

```
> **Migration note (PR-C-1, <date>):** Benchmark history before commit
> `<merge-sha>` lives at the [`gh-pages` branch](https://github.com/asafgolombek/Nimbus/tree/gh-pages).
> Subsequent history is split:
> - **Reference-machine runs** (M1 Air) → committed to `docs/perf/history.jsonl`
> - **GHA runs** (Ubuntu / macOS / Windows) → workflow artifacts on
>   the [Performance Benchmarks workflow](https://github.com/asafgolombek/Nimbus/actions/workflows/_perf.yml)
>   (90-day retention)
```

Followed by `## Reference baseline (M1 Air)` with a TBD measurements table (16 rows, p50 / p95 / p99 / max / run_id columns, all cells `TBD — populated by PR-C-2 reference run`). No analysis prose in C-1.

## 7. Migration

- **`benchmark.yml` retirement.** Same-PR delete in C-1 (D-C).
- **`gh-pages` branch.** Kept untouched; historical chart remains accessible.
- **`scripts/capture-benchmarks.ts`.** Stays in C-1. Spec § 4.7 step 2 conditions its deletion on "S2-a's first three nightly runs on main are visibly recorded in `history.jsonl`". That condition can't be satisfied in C-1 — `history.jsonl` is only written by reference runs (per § 4.4), not by GHA runs. Deletion deferred; C-1 PR description includes a one-liner pointing at the criterion. Likely lands as a C-2 follow-up.
- **PR description.** Explicitly calls out the migration so reviewers tracing old chart URLs find the new path (spec § 4.7 final paragraph).

## 8. Edge cases

| Case | Behavior |
|---|---|
| First run on main, no prior artifact | `gh run download` returns nothing → `previous: null` → comparator emits `kind: "no-baseline"` for every surface. Comment is "First run on this runner; no delta available yet." Build passes. |
| Different runner (PR macOS run, no main macOS yet) | Comparator filters by `runner` field; same as first-run handling above. |
| Surface present in current but not previous | No delta computed; absolute check still applies. |
| Surface removed in this PR | Comment notes "S2-x: removed in this PR." Informational; doesn't fail. |
| Stub or skipped surface (`samples_count: 0`) | Comparator emits `kind: "skipped"`; formatter renders `S3 — stub (...)`. Doesn't fail. |
| `gh run download` flake | Retry 3× with 5s backoff. On persistent failure, log warning and proceed as if first-run. Don't fail the bench because the diff plumbing failed. |
| Two `perf` PRs land on main concurrently | `concurrency` block (`cancel-in-progress: false`) serializes the matrix per OS. Second PR's bench-ci sees the first PR's artifact as `previous`. Spec § 4.3. |
| Threshold drift between `slo.md` and `slo-thresholds.ts` | CI guard (`bun scripts/regen-slo.ts --check`) catches drift in PR-quality before `_perf.yml` runs. |
| GHA artifact older than 90-day retention | `gh run download` returns 404; treated as first-run. |

## 9. Testing strategy

| Module | Test type | Coverage approach |
|---|---|---|
| `slo-thresholds.ts` | Schema validation | One assertion per row matches spec § 3.2; snapshot test fails on accidental edits |
| `threshold-comparator.ts` | Pure-logic unit tests | All 5 `ComparisonStatus` kinds, all 9 edge cases above, both `runner` filter paths |
| `pr-comment-formatter.ts` | Snapshot tests | One snapshot per status kind + first-run + all-pass + mixed |
| `bench-ci.ts` | Integration test (mocked `gh` CLI + filesystem) | Full pipeline against fixture artifact pairs; asserts exit code + emitted comment body |
| `regen-slo.ts` | Integration | `--check` round-trip against committed `slo.md` |
| `_perf.yml` | None at unit level | YAML parse-validated by `bunx js-yaml`. First real CI run is the integration test. |

The `bun run test:coverage:perf` gate (≥80% lines, established in PR-B-2a) extends to cover the new files automatically.

## 10. Acceptance criteria for PR-C-1

When this PR merges:

1. `.github/workflows/_perf.yml` exists; triggered by push-to-main, nightly cron `0 4 * * *`, and `perf`-labelled PRs.
2. `.github/workflows/benchmark.yml` is deleted; `gh-pages` branch is untouched.
3. `.github/labeler.yml` includes the `perf` label rule with the spec § 4.3 path globs.
4. `docs/perf/slo.md` exists with UX threshold values from spec § 3.2 + workload-row scaffolding (`TBD (Phase 2)`).
5. `docs/perf/slo-ux.md` is deleted; the comment in `packages/cli/src/tui/App.tsx:133` is updated.
6. `docs/perf/baseline.md` exists with the `gh-pages` redirect note + TBD measurements table.
7. `packages/gateway/src/perf/slo-thresholds.ts`, `threshold-comparator.ts`, `pr-comment-formatter.ts`, `bench-ci.ts` exist with passing tests.
8. `scripts/regen-slo.ts` exists and `--check` exits 0 against committed `slo.md`.
9. `bun run test:coverage:perf` exits 0 with the four new files included.
10. The first PR-quality run on this branch posts a non-empty PR-comment delta body (or "no baseline yet" notice on the first run).

## 11. Out of scope

- Reference run on M1 Air, populated thresholds, `missed.md`, `deferred-backlog.md` → PR-C-2.
- `scripts/capture-benchmarks.ts` deletion → spec § 4.7 step 2 follow-up after S2-a comparability is observable.
- Real Ollama-driven S9 + real Tauri-renderer instrumentation for S3/S5 → hypothetical PR-B-2b-3.
- CI cost-fallback wiring (`if: github.event.schedule == '0 4 * * 0'` macOS/Windows weekly gate) → documented in C-1 but not pre-wired; flip when budget-pressured.
- Long-term `history.jsonl` retention (1000-line cap, archive split) → spec § 4.4, not a Phase 2 concern.

## 12. Decisions log

| ID | Decision | Source |
|---|---|---|
| D-A | Split spec § 2 Phase 2 into PR-C-1 (CI + skeletons, no ref-run) and PR-C-2 (ref-run + populate). | Brainstorming Q1 |
| D-B | C-1 gates UX rows on absolute + delta thresholds; workload rows record-only until C-2. | Brainstorming Q2 |
| D-C | Same-PR cutover: delete `benchmark.yml` in C-1 alongside adding `_perf.yml`. `gh-pages` kept; redirect note in `baseline.md`. | Brainstorming Q3 |
| D-D | Full PR-comment delta in C-1. Graceful first-run case ("no baseline yet"). Comparator code is reusable for C-2's `missed.md` ranking. | Brainstorming Q4 |
| D-E | C-1 doc footprint = `slo.md` + `baseline.md` skeleton. `missed.md` / `deferred-backlog.md` deferred to C-2 (no consumer until ref-run). | Brainstorming Q5 |
| D-F | Comparator + formatter + CLI live in TS modules under `packages/gateway/src/perf/`. `_perf.yml` is a thin shell. Matches existing `scripts/run-tests.ts` pattern. | Brainstorming Q6 |
| D-G | `slo-thresholds.ts` is the SSoT; `slo.md` is regenerated from it. CI guard prevents drift. | Section 3 design |
| D-H | Cost-fallback `if: github.event.schedule == '0 4 * * 0'` is documented in C-1 but not pre-wired. | Section 4 |
| D-I | `scripts/capture-benchmarks.ts` stays in C-1; deletion deferred per spec § 4.7 step 2. | Section 7 |
| D-J | `slo-ux.md` deleted cleanly (no redirect stub); `App.tsx:133` comment updated. | Section 6.1 |

---

*Spec written by Claude Opus 4.7 — 2026-04-28.*
