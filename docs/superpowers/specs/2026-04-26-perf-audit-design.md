# Design — Performance audit (B2)

**Branch:** `dev/asafgolombek/perf-audit`
**Date:** 2026-04-26
**Status:** Approved — ready for implementation plan
**Scope:** Third of the planned maintenance initiatives (toolchain refresh ✅ · security audit B1 ✅ · **this perf audit B2** · later: B3 SOLID/duplication + B4 bug-hunt + third-party packages).
**Predecessor:** the B1 security audit (results: [`2026-04-25-security-audit-results.md`](./2026-04-25-security-audit-results.md)) — same three-phase shape (design → measurement → fix-PR plans). The B1 design / per-tier fix plans were retired post-completion; the results doc is the surviving record.

---

## 1. Goal

Establish a defensible performance baseline for Nimbus on its critical paths before `v0.1.0`. Produce **two artifacts**: a published SLO sheet that supports the "local-first should feel snappier than SaaS" product claim, and a CI smoke layer that catches order-of-magnitude regressions on every push to `main` and every `perf`-labelled PR.

**Driver:** Phase 4 is approaching `v0.1.0`. The SLO sheet is the basis for the public performance claim; the CI smoke layer prevents that claim from rotting. Both are release-prerequisites in the same way the B1 audit was.

**Non-goals.** Micro-benchmarks of internal hot loops; profiler-driven optimisation rabbit holes; cross-arch perf parity (arm64 vs x64 — measured but not threshold-gated for `v0.1.0`); fixing every miss; setting thresholds that survive Phase 5 connector additions; LLM router quality (correctness, hallucination rate — separate eval workstream); multi-day memory-leak soak runs.

**Stop rule.** Fix work is hard-capped at **the top 5 misses** ranked by `user_felt_impact_score / engineering_cost_estimate` (both 1–5 ordinal — see § 3.4 rubric). Misses 6–N land in `docs/perf/deferred-backlog.md` with a one-line "why deferred" note and are picked up by a later **B2-v2 (post-`v0.1.0`, not a Phase 4 deliverable — see § 11)**. The cap exists explicitly because perf review is the easiest of the four B-series initiatives to over-invest in.

## 2. Methodology — threshold-driven measurement, hybrid threshold-setting

Three sequential phases after this design merges.

### Phase 1 — Harness, fixtures, UX SLO table (~2–3 days)

Build the bench harness, the per-surface fixtures, and the published SLO sheet for the surfaces whose targets are derivable upfront from human-factors research and Nimbus's product positioning.

**Deliverables:**
- `packages/gateway/src/perf/` — `bench-harness.ts`, `perf-fixture.ts`, `bench-cli.ts`, `surfaces/bench-<name>.ts` per surface.
- `packages/gateway/src/perf/fixtures/` — synthetic-corpus generator outputs, recorded HTTP traces for sync surfaces, canonical prompt sets for the LLM surface.
- `nimbus bench` CLI wired into `packages/cli/src/commands/`: `nimbus bench [--surface <name>] [--corpus small|medium|large] [--runs N] [--reference|--gha]`. Output is a JSON results blob (machine-readable for CI assertion + history append) plus a human pretty-print.
- `docs/perf/slo-ux.md` — published SLO sheet for the 6 UX surfaces, each row carrying a citation (Nielsen response-time research / RAIL model / explicit Nimbus product claim).
- `docs/perf/history.jsonl` — initialised empty; every `nimbus bench` run appends one structured line.

**Reuse, not rebuild.** The harness records into `db/latency-ring-buffer.ts`-shaped buffers and uses the same percentile math as `db/metrics.ts`. The S2 surface (query p95) literally drives synthetic queries through the existing `engine.askStream` and reads the existing latency buffer — no new measurement code. The telemetry collector's aggregate-counter shape is reused for the S7 memory snapshots. New code is the **driver and fixtures**; the metric capture is existing.

### Phase 2 — Measurement on reference hardware + workload thresholds (~2–3 days)

Run `nimbus bench --all --reference` on the reference machine; populate the workload-surface thresholds from measurement; produce the missed-threshold list and rank fix candidates.

**Deliverables:**
- `docs/perf/baseline.md` — every surface's p50 / p95 / p99 / max sample, plus surface-specific metrics (memory RSS, throughput items/sec, etc.). Each row is sourced from a recorded `history.jsonl` line (provenance, not retyped).
- Workload-surface thresholds inserted into `slo-ux.md` (renamed to `slo.md` once both surface classes are present). **Threshold formula:** `threshold_p95 = max(measured_p95 × 1.20, measured_p95 + absolute_floor)` — i.e., a future run's p95 may exceed the current p95 by up to 20 % (relative) or by an absolute noise floor (whichever is larger), without failing the bench. The intent is "no regression worse than 20 %", not "improve by 20 %".
- `docs/perf/missed.md` — every threshold violation, ranked by `user_felt_impact_score / engineering_cost_estimate`, with the top 5 explicitly named. Each entry carries `Confidence: High | Medium | Low` (mirrors B1 results-doc schema) so retained-Low items are visibly flagged in the deferred backlog rather than silently mixed in.
- `docs/perf/deferred-backlog.md` — misses 6–N, each with a one-line "why deferred" and the same `Confidence` field.
- CI bench job wired in `.github/workflows/_perf.yml`: runs on `ubuntu-latest`, `macos-latest`, `windows-latest`; per-surface GHA thresholds (see § 3 table); multi-run median-of-medians over 5 invocations (see § 4 "Aggregation" subsection); triggers on nightly `main` and on any PR with the `perf` label; posts a PR-comment delta vs. last `main` history entry; fails the build if `(a)` the absolute GHA threshold is exceeded, **or** `(b)` the run delta vs the previous `main` entry exceeds the per-surface noise floor (see § 3 table for per-surface values).

### Phase 3 — Top-5 fix plans (~1–2 days)

For each top-5 miss, write an implementation plan in the same shape as the B1 fix-tier plans (high/medium/low). Most fixes are small enough that the 5 misses collapse into 1–2 grouped plans by subsystem; pathological cases get 5 separate plans.

**Deliverable:** `docs/superpowers/plans/<date>-perf-fixes-tier-N.md` (one or more files), each opening as its own PR.

**Fix execution is out of B2.** B2 ends at the *fix plan* — top-5 plans written and PRs opened. Fix execution is tracked the same way the B1 follow-up PRs (`#112`, `#113`, `806453a`) followed the B1 results doc.

## 3. Scope — surfaces, inputs, thresholds

Eleven surfaces total (the original 10 plus CLI invocation overhead, which is a UX surface that doesn't fit either tier from the brainstorm).

### 3.1 Threshold semantics

For every measurement entry in the SLO sheet, `threshold` is the maximum allowed value for the **specified percentile of a multi-run aggregate** (see § 4 Aggregation). UX surfaces specify which percentile in their row (almost all use **p95**). Workload surfaces are also p95 unless the row explicitly says otherwise (S7 memory uses **p95 of peak RSS across 5 runs**, S9 LLM uses **median of tokens/sec across 5 runs**).

A bench fails when:

- `(a)` the measured aggregate **exceeds the absolute reference or GHA threshold** for its row, **or**
- `(b)` the **delta vs the most recent `main` history entry** exceeds the per-surface noise floor: `delta_pct = (measured − previous) / previous × 100`. A run fails if `delta_pct > max(noise_floor_pct, absolute_noise_floor_ms / previous × 100)` — i.e., the absolute floor protects against false alarms when `previous` is small.

### 3.2 Surface table

| # | Surface | Class | Inputs / preconditions | Metric (aggregate) | Reference threshold | GHA threshold | Noise floor (rel %, abs ms) |
|---|---|---|---|---|---|---|---|
| S1 | Gateway cold start (PAL → IPC ready) | UX | none | p95 of cold-start ms across 5 fresh-process runs | ≤2 000 ms | ≤10 000 ms | 25 %, 200 ms |
| S2-a | Query p95 (`engine.askStream`) — **10 K corpus** | UX | synthetic snapshot tier `small` | p95 ms across 5 runs × 100 queries | ≤30 ms | ≤200 ms | 25 %, 5 ms |
| S2-b | Query p95 — **100 K corpus** | UX | synthetic snapshot tier `medium` | p95 ms across 5 runs × 100 queries | ≤80 ms | ≤500 ms | 25 %, 10 ms |
| S2-c | Query p95 — **1 M corpus** | UX | synthetic snapshot tier `large`, **reference only** (skipped on GHA — corpus generation cost) | p95 ms across 5 runs × 100 queries | ≤300 ms | n/a (reference only) | 25 %, 25 ms |
| S3 | Dashboard first-paint | UX | synthetic snapshot tier `medium`, warm gateway | p95 ms across 5 cold-app launches | ≤1 500 ms | ≤7 500 ms | 25 %, 100 ms |
| S4 | TUI first-paint (`nimbus tui` → first frame) | UX | warm gateway | p95 ms across 5 invocations | ≤500 ms | ≤2 500 ms | 25 %, 50 ms |
| S5 | HITL popup latency | UX | warm gateway, popup window pre-warmed | p95 ms (`consent.request` → renderer paint) across 20 invocations | ≤200 ms | ≤1 000 ms | 25 %, 25 ms |
| S6 | Sync throughput per connector (Drive / Gmail / GitHub) | Workload | recorded HTTP trace via MSW; **fetch-only** (verified — connector grep shows no `node:http`/`axios`/`got`) | items/sec, p50 across 5 replays | TBD Phase 2 (`measured_p50 × 0.8` allowed regression) | per-OS TBD Phase 2 | 25 %, 5 items/sec abs |
| S7-a | Memory RSS — **idle** | Workload | warm gateway, synthetic snapshot `medium`, **Linux only gates** (macOS/Windows informational — see § 3.3) | p95 of `process.memoryUsage().rss` over 60 s sampling | TBD Phase 2 | n/a (Linux GHA only; macOS/Windows informational) | 20 %, 20 MB |
| S7-b | Memory RSS — **heavy sync** | Workload | as S7-a + scripted parallel sync of 3 connectors | p95 RSS over the sync window | TBD Phase 2 | n/a | 20 %, 50 MB |
| S7-c | Memory RSS — **multi-agent** | Workload | as S7-a + 3-sub-agent decomposition; **reference only** (requires loaded LLM, see S9) | p95 RSS during multi-agent run | TBD Phase 2 | n/a (reference only) | 20 %, 50 MB |
| S8 | Embedding generation throughput (MiniLM) | Workload | synthetic text fixtures (50/500/5 000 chars; batch sizes 1/8/32/64) | items/sec by `(length, batch)`; matrix output | TBD Phase 2 | per-OS TBD Phase 2 | 25 %, 5 items/sec |
| S9 | Local LLM round-trip (Ollama, **`llama3.2:3b-instruct-q4_K_M`**, warm-model) | Workload | canonical 3-prompt set; **reference only on Apple Silicon GPU**; GHA-skipped (no GPU, CPU-only meaningless for SLO) | first-token-ms p50 + tokens/sec median across 5 runs per prompt | TBD Phase 2 | n/a (skipped) | 30 %, 50 ms / 2 tps |
| S10 | SQLite write throughput under contention | Workload | scripted concurrent writers (sync + watcher fire + audit append) against fresh DB | writes/sec p50 across 5 runs | TBD Phase 2 | per-OS TBD Phase 2 | 25 %, 100 writes/sec |
| S11-a | CLI invocation overhead — **cold** (`nimbus query`, `nimbus diag`) | UX | fresh process, no warm cache | p95 ms across 5 invocations | ≤300 ms | ≤1 500 ms | 25 %, 50 ms |
| S11-b | CLI invocation overhead — **warm** | UX | second invocation within same shell | p95 ms across 5 invocations | ≤50 ms | ≤250 ms | 25 %, 10 ms |

**The table now has 16 rows** because S2 splits into 3 corpus tiers, S7 splits into 3 load states, S11 splits into cold/warm. The acceptance criteria still talk about "the 6 UX surfaces" and "the 5 workload surfaces" because those are surface *classes*, not individual measurement rows.

### 3.3 Cross-platform comparability constraints

- **S7 memory RSS** uses Linux semantics (physical pages assigned to process). macOS reports differently for shared library pages; Windows working set expands/contracts under system pressure. To keep the SLO defensible, **only Linux GHA gates S7**; macOS and Windows GHA runs record values for informational `history.jsonl` entries but do not fail the build.
- **S9 LLM** is reference-only. GHA Linux/macOS/Windows runners have no GPU; running a 3 B Q4 model on CPU produces numbers, but they're meaningless for the local-first SLO claim. The CI workflow explicitly skips S9.
- **S2-c (1 M corpus)** is reference-only — generating a 1 M-item SQLite fixture on every CI run is too expensive (~minutes per run). See § 3.5 for fixture caching.

### 3.4 Impact / cost rubric for top-5 ranking

`missed.md` ranks misses by `user_felt_impact_score / engineering_cost_estimate` (both 1–5 ordinal). Without a rubric, two reviewers assign different scores. The B1 audit's severity rubric is the precedent.

**`user_felt_impact_score`:**
| Score | Meaning |
|---|---|
| 5 | Every user notices in the first 30 s of using Nimbus (e.g. cold start > 8 s, dashboard first-paint > 5 s, every CLI invocation feels stuck) |
| 4 | Most users notice within their first session (every query feels sluggish; HITL popup latency > 1 s; sync visibly hangs the UI) |
| 3 | Users notice after a week of use (memory creep makes the gateway need restart; nightly sync runs into the morning) |
| 2 | Power users notice (large-corpus query degradation, embedding throughput on bulk reindex) |
| 1 | Only matters at edge cases (1 M-item corpus, 24 h soak, 50-tab TUI use) |

**`engineering_cost_estimate`:**
| Score | Meaning |
|---|---|
| 5 | Multi-week effort (architectural refactor, schema change, new subsystem) |
| 4 | One-week effort (significant code change across 5+ files, migration, careful testing) |
| 3 | Multi-day effort (one subsystem, well-bounded, may need new tests) |
| 2 | One-day effort (single file, narrow change, minimal new tests) |
| 1 | One-hour effort (config tweak, single line, obvious fix) |

**Ranking:** higher `impact / cost` ratio = higher rank. Ties broken by reviewer judgement. Top 5 → fix plans. Misses 6–N → `deferred-backlog.md` with both scores recorded.

### 3.5 Corpus rationale per class

- **No corpus** (S1, S4, S11): the surface measures process-startup or single-frame latency; no indexed data is read.
- **Synthetic SQLite snapshot** (S2, S3, S7): generated by `perf-fixture.ts` with parametrizable size tiers (`small`=10K, `medium`=100K, `large`=1M). **Deterministic from a fixed PRNG seed** so two runs of the same tier produce byte-identical snapshots. **Lazy-cached** under `<paths.tempDir>/nimbus-bench-fixtures/<tier>-<seed>.sqlite` — first invocation generates and caches; subsequent invocations reuse. CI caches the `medium` tier across runs via `actions/cache` keyed on the fixture-generator code hash; the `large` tier is reference-only and never generated in CI. Realistic-shaped but not real — does not catch pathological-shape edge cases (e.g. one user's 50 K-line PR description). Acceptable for B2-v1.
- **Recorded HTTP trace via MSW** (S6): MSW intercepts upstream API calls and replays a fixture-file recording of a representative sync. Removes upstream-API variance; deterministic replay. **Verified pre-implementation:** all three target connectors (Drive / Gmail / GitHub MCPs) use `globalThis.fetch` only — `grep -rn "node:http\|axios\|got\|node-fetch" packages/mcp-connectors/` returns zero hits — so MSW intercepts cleanly.
- **Synthetic text fixtures** (S8): generator produces varied-length input strings (50 / 500 / 5 000 chars) and sweeps batch sizes (1 / 8 / 32 / 64). Output is a 12-cell matrix per run.
- **Canonical 3-prompt set + designated model** (S9): three fixed prompts (short factual, mid-length reasoning, long context-stuffed) measured against `llama3.2:3b-instruct-q4_K_M` (matches the project's existing default in `ollama-provider.ts` plus an explicit quantization for reproducibility). **Warm-model measurement** — first inference after `ollama pull` is excluded; tokens/sec measured from the second inference onward. If the model is not installed on the reference machine, the bench prints `S9 SKIPPED — model not installed: run \`ollama pull llama3.2:3b-instruct-q4_K_M\`` and writes an `incomplete: true` line to `history.jsonl`.
- **Synthetic write workload** (S10): scripted concurrent writes from sync, watcher fire, and audit append paths against a fresh SQLite DB; measures contention behaviour, not raw throughput.

## 4. Reference hardware, CI matrix, and operational discipline

### 4.1 Reference machine

**2020 M1 MacBook Air, 8 GB / 256 GB.** Anchors the published SLO to a machine real users actually own; worst case for "Nimbus runs on your existing laptop"; if the SLO sheet says "p95 < 80 ms on a 2020 M1 Air", that lands on every machine equal-or-better. Project owns or borrows the hardware; SLO measurement runs are manual.

**Caveat row in `slo-ux.md`** (mandatory): "These figures are measured on a 2020 M1 MacBook Air. Performance on x64 / older hardware is measured but not threshold-gated for `v0.1.0`; see GHA matrix results in `history.jsonl` for that baseline." The public SLO must not over-claim.

### 4.2 Reference-run protocol

ms-level laptop measurements are sensitive to power state, background processes, thermal state, and OS sync activity. Two reference runs a week apart can disagree by 2× without a documented protocol. Every `--reference` run records compliance with this checklist into the `history.jsonl` line (operator confirms before the run starts):

1. **AC powered.** Apple Silicon throttles meaningfully on battery under sustained load.
2. **Low Power Mode off.**
3. **Fresh reboot ≥5 min before run.** CPU caches and file caches in a known state.
4. **Activity Monitor pre-flight:** no other Nimbus, Bun, Docker, Xcode, Spotlight indexing, Time Machine, iCloud sync, or Messages activity. Operator records a screenshot stored alongside the `history.jsonl` entry.
5. **Display on**, screensaver disabled. Apple Silicon raises base frequency when display is on.
6. **Run `nimbus bench --all --reference --runs 3`**, report the median per surface (see § 4.5 Aggregation).
7. **macOS version recorded in the run line.**

Failure to record any of (1)–(7) flags the run as `incomplete: true` and excludes it from CI delta comparisons.

### 4.3 GHA matrix smoke layer + cost note

All three runners (`ubuntu-latest`, `macos-latest`, `windows-latest`); per-surface thresholds in § 3.2 (no flat multiplier — empirical noise varies enormously by surface). Bench job runs on:

- Every nightly `main` push (1 invocation).
- Any PR carrying the `perf` label (auto-applied by `.github/labeler.yml` for path globs `packages/gateway/src/{engine,db,embedding,connectors,llm,voice,perf}/**` — see PR-C deliverables).

**CI cost.** GHA macOS minutes bill at ~10× Linux. Per nightly invocation: 13 surfaces actually measured on GHA (S2-c, S7-c, S9 are reference-only), × 5 invocations × 3 OSes = **195 surface-runs**. At an average ~30 s per surface, that's ~98 min/OS, ~294 OS-min total per nightly. macOS contributes the bulk of the cost. **Budget assumption:** the project runs on the OSS-free GHA tier (currently 2 000 Linux-min/mo for public repos with multiplier-adjusted macOS allowance). The nightly schedule + `perf`-labelled PRs are within budget. **Fallback if budget is exhausted:** drop to `ubuntu-only nightly + macos / windows once per week`. PR-C documents this fallback and adds an `if: github.event.schedule == '0 4 * * 0'` gate on the macOS / windows steps when triggered.

**Concurrency control.** `_perf.yml` includes a `concurrency: { group: bench-${{ github.workflow }}-${{ matrix.os }}, cancel-in-progress: false }` block so two `perf`-labelled PRs landing simultaneously don't compete for runner time and skew each other's measurements.

### 4.4 Bench history format and storage

**Storage policy.**
- **Reference-machine runs** commit one line each to `docs/perf/history.jsonl` (git-tracked). Low frequency (manual, weekly at most). Never causes merge conflicts in normal contributor PRs.
- **GHA runs** upload their JSON output as a workflow artifact (retained per GHA defaults: 90 days). They do **not** commit to the git-tracked history.jsonl. Long-term GHA history lives in the existing `gh-pages` branch (see § 4.7 — relationship to existing benchmark workflow) until a future migration.
- This split is mandatory because (a) GHA numbers are an order of magnitude apart from reference numbers and conflating them poisons the regression delta; (b) committing on every CI run would bloat the repo and create constant merge conflicts on `perf` PRs.

**Schema (one JSON object per line):**

```typescript
type HistoryLine = {
  schema_version: 1;
  run_id: string;                      // UUIDv7
  timestamp: string;                   // ISO 8601
  runner: "reference-m1air"            // single canonical reference identifier
        | "gha-ubuntu"
        | "gha-macos"
        | "gha-windows";
  os_version: string;                  // e.g. "macOS 14.4.1" / "ubuntu-24.04.1" / "windows-2022"
  nimbus_git_sha: string;
  bun_version: string;
  surfaces: {
    [surface_id: string]: {            // e.g. "S2-b", "S7-a"
      samples_count: number;
      p50_ms?: number;
      p95_ms?: number;
      p99_ms?: number;
      max_ms?: number;
      throughput_per_sec?: number;     // for S6, S8, S10
      tokens_per_sec?: number;         // for S9
      first_token_ms?: number;         // for S9
      rss_bytes_p95?: number;          // for S7
      raw_samples?: number[];          // optional, for offline analysis
    };
  };
  reference_protocol_compliant?: boolean;  // only set when runner = reference-m1air
  incomplete?: true;                       // run was interrupted, model not installed, or protocol non-compliant
  incomplete_reason?: string;
};
```

**Conflict-resolution policy.** A `perf`-labelled PR that adds a reference-run line and lands while another `perf` PR is also adding one resolves with `git rerere` (additive — both lines kept, sorted by `timestamp`). The append-only invariant means manual conflict resolution is rarely needed.

**Retention.** When `history.jsonl` exceeds 1 000 lines, a follow-up cleanup commit on `main` keeps the most recent 30 reference runs per `nimbus_git_sha` ancestor and archives the rest to `docs/perf/history-archive-<year>.jsonl`. Not a Phase 4 concern; reference runs are weekly at most.

### 4.5 Aggregation: "median of 5 runs" defined precisely

A single `nimbus bench --runs 5` invocation runs each surface 5 times. For each surface:

- The **per-run aggregate** is the surface's natural metric (p95 ms for latency surfaces, items/sec for throughput surfaces, peak RSS for S7).
- The **across-runs aggregate** is the **median of those 5 per-run aggregates** (median-of-medians). This is what's compared to the threshold and to the previous `main` history entry.
- The `samples_count` field in `history.jsonl` records the *total* samples across all 5 runs; the `pXX_ms` fields record the *across-runs median*, not the union of all samples.

This aggregation absorbs both within-run and between-run noise without letting one wild outlier dominate.

### 4.6 PR-comment delta + fail conditions

The CI bench job compares the current run's per-surface across-runs aggregate against the most recent `main` `history.jsonl` entry **for the same `runner`** (a macOS PR run is compared to the most recent macOS `main` run, not to a Linux entry). It posts a PR comment with deltas (`S2-b p95: 72ms → 84ms (+16.7%)`) and fails the build under either condition (a) or (b) listed in § 3.1.

### 4.7 Relationship to the existing benchmark workflow

The repo already has perf infrastructure that pre-dates this spec:

- [`.github/workflows/benchmark.yml`](../../../.github/workflows/benchmark.yml) — runs on every push to `main` on `ubuntu-24.04`; invokes `bun run scripts/capture-benchmarks.ts`; uses `benchmark-action/github-action-benchmark` to push history to a `gh-pages` branch with a 200 % `alert-threshold` and `fail-on-alert: true`.
- [`scripts/capture-benchmarks.ts`](../../../scripts/capture-benchmarks.ts) — measures one surface (structured item-list query) at 10 K rows × 50 runs against an in-memory SQLite database.

This is the **only longitudinal perf data the project currently has** — `gh-pages` history accumulating since the workflow first landed. The B2 bench harness must not orphan it.

**Decision: migration, not replacement.**

- The single surface `capture-benchmarks.ts` measures (structured item-list query at 10 K rows) is **subsumed by S2-a** (`Query p95 — 10 K corpus`) in this spec. PR-B implements the matching `surfaces/bench-query-latency.ts` driver and confirms the new harness produces a measurement that is directly comparable (same SQL builder, same warm in-memory DB) before retiring `capture-benchmarks.ts`.
- **PR-C deliverables include:**
  1. Replace `.github/workflows/benchmark.yml` with `.github/workflows/_perf.yml` (the new workflow; underscore prefix matches the existing `_test-suite.yml` reusable-workflow convention).
  2. Delete `scripts/capture-benchmarks.ts` once S2-a's first three nightly runs on `main` are visibly recorded in `history.jsonl`.
  3. Add a redirect note to `docs/perf/baseline.md` for any reader hitting the old `gh-pages` chart URLs: "*Benchmark history before commit `<sha>` lives at `gh-pages`. Subsequent history is in `docs/perf/history.jsonl` (reference runs) and GHA workflow artifacts (CI runs)."*
- The `gh-pages` branch is **kept**, not deleted — it's the historical archive. The new workflow does not push to it.

PR-C's PR description must explicitly call out this migration so reviewers tracing old chart URLs know where to look.

| Artifact | Path | Phase |
|---|---|---|
| This design | `docs/superpowers/specs/2026-04-26-perf-audit-design.md` | 0 |
| Implementation plan for Phase 1 | `docs/superpowers/plans/2026-04-26-perf-audit-phase-1.md` | 0 (next, via writing-plans) |
| UX SLO sheet | `docs/perf/slo-ux.md` (Phase 1) → `docs/perf/slo.md` (after Phase 2 merges) | 1, 2 |
| Bench harness scaffolding | `packages/gateway/src/perf/` + `packages/gateway/src/perf/fixtures/` | 1 |
| `nimbus bench` CLI | `packages/cli/src/commands/bench.ts` | 1 |
| Bench history (machine-readable) | `docs/perf/history.jsonl` | 1, appended each run |
| CI bench workflow | `.github/workflows/_perf.yml` | 2 |
| Baseline measurements | `docs/perf/baseline.md` | 2 |
| Missed-threshold list + top-5 ranking | `docs/perf/missed.md` | 2 |
| Deferred backlog | `docs/perf/deferred-backlog.md` | 2 |
| Top-5 fix plans | `docs/superpowers/plans/<date>-perf-fixes-*.md` | 3 |

## 6. Acceptance criteria

B2 is complete when **all** of the following hold. Criteria are split into pre-approval (must pass before user sign-off) and post-approval (only run after the user approves the results docs).

### Pre-approval

1. **The bench harness runs end-to-end on the reference M1 Air.** Invocation form is pinned to `bun packages/cli/src/index.ts bench --all --reference --runs 3` (or the equivalent `nimbus bench` if invoked from a built CLI on PATH — both forms produce identical output). The run completes without harness errors and produces a complete `baseline.md`.
2. **All 6 UX surface classes** (S1, S2, S3, S4, S5, S11) **have an upfront target with a citation** (full Nielsen / RAIL / explicit Nimbus-claim citation, not a vague reference) recorded in `slo.md`. Tier-split rows (S2-a/b/c, S11-a/b) each get their own threshold row.
3. **All 5 workload surface classes** (S6, S7, S8, S9, S10) **have a measured-then-set target recorded in `slo.md`** computed via the formula in § 2 Phase 2 deliverables. Tier-split rows (S7-a/b/c) each get their own row.
4. **`missed.md` ranks every miss** by `user_felt_impact_score / engineering_cost_estimate` per the rubric in § 3.4 and **explicitly names the top 5**. Each entry carries a `Confidence: High | Medium | Low` field; retained-Low entries are visibly flagged, not silently mixed in.
5. **The CI bench job runs on all three GHA runners** (`ubuntu-latest`, `macos-latest`, `windows-latest`) with per-surface thresholds (§ 3.2) and per-surface noise floors (§ 3.2 last column). Fails the build under either condition (a) `(a)` the absolute GHA threshold is exceeded, **or** `(b)` the run delta vs the previous `main` `history.jsonl` entry for the same `runner` exceeds the per-surface noise floor. Posts a PR-comment delta against `main` history.
6. **`deferred-backlog.md` contains every miss 6–N** with a one-line "why deferred" reason and a `Confidence: ...` field.
7. **Bidirectional driver-row mapping holds.** Every cited surface row in `slo.md` has a corresponding `packages/gateway/src/perf/surfaces/bench-*.ts` driver, **and** every `surfaces/bench-*.ts` driver maps to a row in `slo.md`. No orphaned drivers, no missing drivers.
8. **Every measured value in `baseline.md` is sourced from a recorded `history.jsonl` line** (provenance, not retyped). Spec self-review on `baseline.md`, `missed.md`, `slo.md` confirms: no placeholders; the migration from `benchmark.yml` / `capture-benchmarks.ts` is complete and the redirect note is in `baseline.md` (see § 4.7).

### Approval gate

9. **The user reviews and approves `slo.md`, `baseline.md`, `missed.md`, and `deferred-backlog.md`.** No fix plans are written or opened until this gate passes.

### Post-approval

10. **The 5 fix plans** (or however many groupings the top 5 collapses into — see § 10 PR strategy) **are written and one PR per plan is opened.** **Fix execution is out of B2** — fix-execution PRs follow as a separate workstream after this audit closes.

## 7. Out of scope

- **Micro-benchmarks of internal hot loops** (e.g. `Set.has` vs `Map.has` here). Done only inside a top-5 fix PR if the fix author needs it.
- **Profiler-driven exploration** (clinic.js, 0x, Bun `--inspect`). Same — only inside a top-5 fix PR.
- **arm64 / x64 perf parity** beyond the GHA matrix runs. Measured but not threshold-gated for `v0.1.0`.
- **Phase 5+ surfaces** (browser/IMAP/finance/CRM connectors). Deferred to a future B2-v2 once those land.
- **LLM router quality** (correctness, hallucination rate, eval scores). That's a separate eval workstream, not perf.
- **SQLite query plan optimisation.** Same — only inside a fix PR.
- **Multi-day memory-leak soak runs.** S7 measures steady state at one point in time; multi-day drift is a separate workstream.
- **Fixing every miss.** Hard cap at top 5 by impact / cost ratio; everything else lands in `deferred-backlog.md`.
- **Re-auditing what existing observability already covers** — `nimbus diag slow-queries`, the `db/latency-ring-buffer.ts` production samples, and the telemetry collector's aggregate counters provide ongoing in-production observability. B2 produces **bench** infrastructure — deterministic, reproducible, threshold-asserted — that complements the production-observability primitives and reuses them for capture.
- **Setting thresholds that survive Phase 5 connector additions.** Phase 5 will add ~25 new connectors; the workload thresholds (S6, S8, S10 in particular) will need to be re-derived. B2-v2 owns that re-derivation.

## 8. Verification & non-negotiables

- **Each `nimbus bench` measurement reads the cited fixture / corpus** and records sample provenance into `history.jsonl`. No "remembered" or hand-typed numbers in `baseline.md` — every value comes from a recorded run.
- **Phase 2 cannot set workload thresholds without a recorded baseline run on reference hardware.** "We think it's about 200 ms" is not acceptable.
- **Cross-platform measurements happen via the GHA matrix only.** The reference SLO claim is M1-Air-specific by construction; do not back-fit reference SLO from Linux/Windows GHA numbers.
- **No fix work during the audit.** The moment Phase 1 or Phase 2 is tempted to "just optimise this while I'm here", that is scope creep — note the finding in `missed.md` and move on. Fix work happens in Phase 3 plans.
- **Critical regressions gate further work.** If Phase 2 surfaces a baseline so far below upfront target that the SLO sheet would be embarrassing (e.g. cold start 30 s vs 2 s target), that fix leapfrogs the top-5 ranking and ships before the rest.
- **Confidence: Low findings are explicitly retained**, not auto-discarded. They become entries in `deferred-backlog.md` with a `confidence: low` flag, not silently dropped.

## 9. Commit structure (for the planning phase)

This spec is committed in one commit on `dev/asafgolombek/perf-audit`. The Phase 1 implementation plan is committed in a second commit. Subsequent commits during Phase 1 / 2 / 3 execution follow the per-PR shape below.

## 10. Branch and PR strategy

Working branch: `dev/asafgolombek/perf-audit` (branched from `main` after the B1 low-tier PR landed).

PR sequence:

### PR-A (Phase 0) — design + Phase 1 plan

This design spec + the Phase 1 implementation plan. PR description summarises the methodology and links to this spec. (Per-iteration review docs were retired during the 2026-04-30 docs cleanup; review feedback now lives in PR-thread comments and the kept results documents.)

### PR-B-1 + PR-B-2 (Phase 1) — split into two PRs

Phase 1 splits into **PR-B-1 (harness scaffolding + one proof driver)** and **PR-B-2 (remaining 15 surface drivers + UX SLO sheet)** — the harness contract is the load-bearing risk and is frozen before driver work fans out. Each PR produces working, testable software independently.

**PR-B-1 deliverables (harness + S2-a proof driver):**

- Harness scaffolding under `packages/gateway/src/perf/` — `bench-harness.ts`, `perf-fixture.ts`, `bench-cli.ts`, `history-line.ts` (schema + JSONL writer), `signal-handler.ts` (SIGTERM/SIGINT → `incomplete: true` line).
- One representative surface driver: `surfaces/bench-query-latency.ts` (S2-a — 10 K corpus, structured query latency). Subsumes `scripts/capture-benchmarks.ts` semantically; the script itself is deleted in PR-C per § 4.7 once S2-a's first three nightly runs land in `history.jsonl`.
- `nimbus bench` CLI registered in `packages/cli/src/commands/bench.ts`. Invocation forms pinned in § 6 criterion 1.
- Empty `docs/perf/history.jsonl` (only the schema-version header line).
- **`test:coverage:perf` script** in `package.json` with ≥80 % threshold for `packages/gateway/src/perf/`; wired into `test:ci`.

**PR-B-2 deliverables (remaining drivers + SLO docs):**

- Remaining 15 surface-driver rows from § 3.2 implemented against the frozen harness API, one file each under `packages/gateway/src/perf/surfaces/`.
- Per-surface fixture files under `packages/gateway/src/perf/fixtures/` (recorded HTTP traces, prompt sets, synthetic-text generator).
- `docs/perf/slo-ux.md` — published SLO sheet for all UX surfaces, **including the "measured on M1 Air; non-M1 hardware not threshold-gated for v0.1.0" caveat row** (§ 4.1).

**Cross-cutting requirements (PR-B-1 owns — PR-B-2 inherits the contract):**

- **SIGTERM / Ctrl-C behaviour** of the bench CLI: any interrupted run writes a single `incomplete: true` line to `history.jsonl` with `incomplete_reason: "interrupted"` and exits non-zero. CI delta comparison ignores incomplete entries.
- **Deferred to PR-B-1 implementation review** (not blocking): streaming progress output of `nimbus bench --all` (per-surface progress rather than buffered final dump). Implementation detail; not spec-load-bearing.
- Both PRs must keep the `test:coverage:perf` gate green (≥80 % lines).

### PR-C (Phase 2) — measurement, workload thresholds, CI workflow, migration

Deliverables:

- `docs/perf/baseline.md`, populated workload thresholds in `docs/perf/slo.md`, `docs/perf/missed.md` with top-5 ranking + `Confidence` field, `docs/perf/deferred-backlog.md`.
- `.github/workflows/_perf.yml` — three-runner matrix; per-surface thresholds; concurrency block (§ 4.3); cost-fallback gate (§ 4.3).
- **Extend `.github/labeler.yml`** so the `perf` label is auto-applied for path globs `packages/gateway/src/{engine,db,embedding,connectors,llm,voice,perf}/**`. Manual contributors do not need to remember the label.
- **Migration of existing benchmark infrastructure** (§ 4.7): replace `.github/workflows/benchmark.yml` with `_perf.yml`; delete `scripts/capture-benchmarks.ts` after S2-a's first three nightly runs land in `history.jsonl`; add the redirect note to `baseline.md`. PR description explicitly calls out the migration.
- **Docs-site integration decision**: PR-C decides whether `slo.md` ships as an Astro page in `packages/docs/` or stays as raw markdown. Either path is acceptable; the decision must be made and documented in the PR description, not silently dropped.

PR-C description summarises the SLO claim ("`v0.1.0` ships with X SLOs measured on a 2020 M1 Air") and links to `baseline.md` + `missed.md`.

### PR-D-1 … PR-D-N (Phase 3) — top-5 fix plans

One PR per fix plan, numbered `PR-D-1`, `PR-D-2`, …, `PR-D-N` where N ≤ 5 (some misses may collapse into a single grouped plan when fixes share files; pathological cases get separate plans). Each PR contains **only the plan document** following the B1 fix-tier-plan template. Fix-execution PRs follow as a separate workstream after this audit closes — tracked the same way the B1 fix-tier PRs (`#112`, `#113`, `806453a`) followed the B1 results doc.

## 11. Follow-up specs

1. `2026-??-??-perf-fixes-*-design.md` — one per top-5 fix that needs a design (most won't; they go straight to a plan).
2. `2026-??-??-structure-audit-design.md` — **B3** (SOLID / duplication / project structure), tracked in the maintenance-initiative sequence alongside this perf audit.
3. `2026-??-??-bug-hunt-design.md` — **B4**.
4. `2026-??-??-third-party-package-upgrades-design.md` — npm + cargo crate upgrades, deferred from the toolchain refresh spec.
5. **B2-v2 (post-`v0.1.0`)** — covers the deferred-backlog items + Phase 5 connector surfaces; uses the harness from B2 (now mature). Not a Phase 4 deliverable.

## 12. Sources

- [B1 security audit results](./2026-04-25-security-audit-results.md) — three-phase shape, PR strategy this spec mirrors, and the consolidated-results-doc shape.
- Nielsen, J. — *Response Times: The 3 Important Limits.* Nielsen Norman Group, originally published 1 January 1993, updated for the web at <https://www.nngroup.com/articles/response-times-3-important-limits/>. Cited in `slo-ux.md` per row using the precise interval (0.1 s perception threshold for S2, S5; 1.0 s flow threshold for S1, S3; 10 s attention upper bound as ceiling check).
- Google — *Measure performance with the RAIL model.* Web Fundamentals, <https://web.dev/articles/rail>. Cross-checks Nielsen for UI-render thresholds: Response (≤100 ms), Animation (≤16 ms / frame), Idle (≤50 ms work units), Load (≤1 s).
- Apple — *About AppKit-based memory reporting on Apple Silicon.* Informs § 3.3 cross-platform comparability constraint for S7 (memory RSS reporting differs across Linux/macOS/Windows).
- MSW — *Mocking Service Worker* (`msw` npm package), <https://mswjs.io/>. Informs § 3.5 (S6 sync throughput). Verified pre-implementation: `grep -rn "node:http\|axios\|got\|node-fetch" packages/mcp-connectors/` returns zero hits, so MSW intercepts cleanly via `globalThis.fetch`.
- [`benchmark-action/github-action-benchmark`](https://github.com/benchmark-action/github-action-benchmark) — the existing workflow's regression-tracking action, kept in `gh-pages` archive per § 4.7.
- [`packages/gateway/src/db/latency-ring-buffer.ts`](../../../packages/gateway/src/db/latency-ring-buffer.ts) — existing production latency-sample primitive; bench harness records into the same shape.
- [`packages/gateway/src/db/metrics.ts`](../../../packages/gateway/src/db/metrics.ts) — existing percentile math; bench harness reuses.
- [`packages/cli/src/commands/diag.ts`](../../../packages/cli/src/commands/diag.ts) — existing `nimbus diag slow-queries` surface; complementary, not replaced.
- [`docs/architecture.md`](../../architecture.md) §Local Database Schema — informs S2 (query) and S10 (SQLite contention) surface design.
- [`.github/workflows/benchmark.yml`](../../../.github/workflows/benchmark.yml) and [`scripts/capture-benchmarks.ts`](../../../scripts/capture-benchmarks.ts) — pre-existing benchmark infrastructure; subsumed by S2-a + retired in PR-C per § 4.7.
