# Perf audit (B2) — Design Spec Review

**Date:** 2026-04-26
**Reviewer:** Claude Code
**Target spec:** [`2026-04-26-perf-audit-design.md`](./2026-04-26-perf-audit-design.md)

This review is intended to be handed straight to Claude as input for a spec revision. Each item is written to be self-contained: what's wrong / unclear, why it matters, and a concrete fix or question to answer in the spec. Items are grouped by severity:

- **Section 1 — Blockers** must be resolved before the spec can be marked "Approved — ready for implementation plan".
- **Section 2 — Open questions** need an answer in-spec; some may turn into blockers once answered.
- **Section 3 — Suggested improvements** would meaningfully raise the spec's quality but are not strictly required.
- **Section 4 — Minor observations** are nits / wording / cross-references.

---

## 1. Blockers

### 1.1 The workload-threshold formula is mathematically backwards

§ 2 Phase 2 and § 3 say:

> Workload-surface thresholds inserted into `slo-ux.md` (renamed to `slo.md` once both surface classes are present), set at `measured_p50 × 0.8` (require 20 % headroom for future regressions).

A threshold "set at `measured_p50 × 0.8`" is **below the median of the current measurement**. Any normal future run, by definition, has ~50 % of its samples above the median — so any normal run will exceed the threshold and fail the bench. "Headroom for regressions" implies the threshold should sit **above** the current measurement, not below.

Likely the spec means one of:

- `measured_p95 × 1.2` — set the threshold 20 % above current p95 (allows a 20 % regression before failing).
- `measured_p50 × 1.25` — same idea, anchored on p50.
- `measured_p99 × 1.5` — looser, but better matches "noise floor" intent.

Pick one explicitly. Also clarify **which percentile of a future run** is compared against the threshold (p95 ≤ threshold? p99 ≤ threshold? max?). Right now § 3 mixes "p95 ≤ 80 ms reference at 100 K" (UX surfaces use p95) with "set at `measured_p50 × 0.8`" (workload surfaces seemingly use p50) without saying so.

**Fix:** Replace the formula in § 2 Phase 2 with the corrected one, and add a one-line "Threshold semantics" subsection under § 3 stating exactly which percentile of a run is compared against the threshold for each class.

---

### 1.2 The existing `benchmark.yml` workflow + `capture-benchmarks.ts` are not acknowledged

The repo already has:

- `.github/workflows/benchmark.yml` — runs on every push to `main`, ubuntu-24.04, uses `benchmark-action/github-action-benchmark` to push history to a `gh-pages` branch, with a 200 % `alert-threshold` and `fail-on-alert: true`.
- `scripts/capture-benchmarks.ts` — measures one surface (structured item query) at 10 K rows × 50 runs against an in-memory SQLite.

The spec proposes building parallel infrastructure (`packages/gateway/src/perf/`, `nimbus bench` CLI, `.github/workflows/_perf.yml`, `docs/perf/history.jsonl`) without any reference to the existing system. Possible relationships:

- **Replacement.** The existing workflow + script are deleted in PR-B / PR-C.
- **Coexistence.** They measure different things and run in parallel.
- **Migration.** The existing single-surface measurement becomes one of the new harness's surfaces, and `gh-pages` history is migrated into / superseded by `history.jsonl`.

This is not "minor cleanup" — `gh-pages` history has been accumulating and represents the only longitudinal perf data the project currently has. The spec must answer: kept, replaced, or migrated? If replaced, the deletion + rationale belong in PR-C with explicit notes for any reader looking at the old `gh-pages` chart URLs.

**Fix:** Add a § 4.5 (or new § 5) "Relationship to existing benchmark workflow" that names `benchmark.yml` and `scripts/capture-benchmarks.ts` and decides their fate. PR-C's description should include the migration rationale.

---

### 1.3 `history.jsonl` schema and reference-vs-GHA distinguishability are undefined

§ 4 says:

> Each `nimbus bench` run appends one structured line to `docs/perf/history.jsonl` (git-tracked). The CI bench job compares against the most recent entry on `main` and posts a PR comment with deltas […].

But:

1. The schema of a line is never defined (which fields, units, version key).
2. The CI bench job runs on three OS runners. Each writes its own line. So "the most recent entry on `main`" is ambiguous — is it the most recent ubuntu? the most recent macos? a tuple?
3. Reference-machine runs (manual, on the M1 Air) and GHA runs both append. If they use the same file, their numbers are an order of magnitude apart and a naive "most recent" comparison is meaningless.
4. A git-tracked JSONL file that grows on every PR will (a) bloat the repo, and (b) cause merge conflicts on every `perf`-labelled PR that lands.

**Questions to answer in-spec:**

- Schema definition (TypeScript type or JSON schema literally written in § 4).
- A `runner: "reference" | "gha-ubuntu" | "gha-macos" | "gha-windows"` discriminator on every entry.
- Which entries are committed to git vs which live in CI artifacts only. (Strong recommendation: only **reference-machine** runs commit to git; GHA history lives in artifacts or a separate `gh-pages`-style branch.)
- Conflict-resolution policy when two `perf` PRs both append.
- Retention / compaction strategy when the file passes some size threshold.

**Fix:** Replace the one-line mention with a § 4.5 "Bench history format and storage" subsection.

---

### 1.4 Acceptance criteria 7 vs 9 are sequentially inconsistent

§ 6 Acceptance criteria:

> **7.** The 5 fix plans (or however many groupings the top 5 collapses into) are written and one PR per plan is opened. **Fix execution is out of B2.**
>
> **9.** The user reviews and approves the results docs before the fix plans are opened as PRs.

These are listed as parallel completion criteria, but criterion 9 must happen *before* criterion 7. Either:

- Reorder so 9 precedes 7, and reword 7 as "After user approval (criterion 9), the 5 fix plans are written and one PR per plan is opened."
- Or split into pre-approval criteria (1–6, 8) and a post-approval criterion (7).

**Fix:** Re-sequence § 6 so the dependency is explicit.

---

### 1.5 The `bun run nimbus bench` invocation in acceptance criterion #1 is wrong

§ 6 criterion 1:

> `bun run nimbus bench --all --reference` runs end-to-end on the reference M1 Air without harness errors and produces a complete `baseline.md`.

`bun run` runs scripts defined in `package.json`. There is no `nimbus` entry there, and arguments after a script name go to the script (not as a sub-command structure). The actual invocation depends on how the CLI is wired:

- If `nimbus` is on PATH after a build: `nimbus bench --all --reference`.
- If invoked from the source tree: `bun packages/cli/src/index.ts bench --all --reference`.
- If wrapped in a `package.json` script: `bun run bench -- --all --reference`.

Check what § 3's `nimbus bench` CLI registration in `packages/cli/src/commands/` produces and update the criterion to match. Otherwise the criterion is unverifiable as written.

**Fix:** Use the exact command form and document it once in § 2 Phase 1's "Deliverables" list, then reference it from § 6.

---

### 1.6 S2 has three corpus tiers but only one threshold

§ 3 row S2:

> Corpus strategy: synthetic SQLite snapshot (10 K / 100 K / 1 M item tiers)
> Threshold method: Upfront — Nielsen 100 ms perception → p95 ≤80 ms reference at 100 K, ≤400 ms GHA

What is the threshold for the 10 K tier? For the 1 M tier? It is implausible that the same `≤80 ms` p95 holds across two orders of magnitude of corpus size. Without per-tier thresholds, the bench either:

- Only measures 100 K and the other tiers are decorative, **or**
- Measures all three but only the 100 K result gates the build.

Either way, this is under-specified and will trip the implementer.

**Fix:** Either drop the unused tiers, or define `(tier, p95-reference, p95-gha)` per tier. The same issue applies to S3 (which mentions "synthetic snapshot" without specifying tier) and S7 (memory RSS at "idle / heavy sync / multi-agent" — three discrete states, but only one row in the table).

---

## 2. Open questions

These need an answer in the spec; some may escalate to blockers depending on the answer.

### 2.1 Reference-machine measurement protocol

§ 4 names the M1 Air as the SLO anchor but says nothing about how a "reference run" is conducted. ms-level measurements on a laptop are sensitive to:

- AC power vs battery (Apple Silicon throttles meaningfully on battery, especially under sustained load).
- Low Power Mode on/off.
- Spotlight indexing in flight, Time Machine, iCloud sync, Messages app, Notification Center activity.
- Whether the laptop just woke from sleep (CPU caches cold, file caches cold).
- macOS version and current security/perf patches.
- Display sleep state (Apple Silicon raises base frequency when display is on).
- Concurrent Bun / Xcode / Docker processes.

Without a documented protocol, two reference runs a week apart can disagree by 2× even with no code changes — and the SLO sheet that anchors the public claim sits on top of those numbers.

**Suggestion:** Add a § 4.x "Reference-run protocol" with a minimal checklist: AC powered, Low Power Mode off, fresh reboot ≥5 min before run, Activity Monitor screenshot pre-run showing no other Nimbus / Bun / Docker processes, run `--all` 3 times and report the median per surface. Same kind of protocol that human-factors research labs use.

### 2.2 GHA runner cost and queue time

The spec specifies the bench job runs on `ubuntu-latest`, `macos-latest`, `windows-latest`, multi-run median over 5 invocations, on every nightly + every `perf`-labelled PR. macOS GHA runners are billed at ~10× the Linux rate and have substantially longer queue times. For the 11 surfaces, 5 invocations each, three OSes:

- 11 × 5 × 3 = 165 measurement runs per CI invocation.
- If each surface averages, say, 30 s, that's ~80 min on macOS alone, and macOS minutes are 10× billed.

Is this within the project's CI budget? The B1 audit was free (read-only static analysis); B2 has a real cost dimension that deserves a one-paragraph note.

**Suggestion:** Add a § 4.x "CI cost" subsection that names the per-run budget (in minutes × multiplier), states whether the project owns paid GHA minutes or runs entirely in the OSS-free tier, and identifies a fallback if the budget is exhausted (e.g., "drop to ubuntu-only nightly + macos / windows once per week"). Also relevant: at 200 % regression alert + `fail-on-alert: true`, a single noisy macOS runner can red-light `main`.

### 2.3 The 5× threshold relaxation factor is asserted, not justified

§ 4: "thresholds *relaxed by 5×* relative to the reference SLO". Why 5×? Why not 3×? Why not 10×? Why uniform across surfaces?

GHA runner noise varies enormously by surface:

- CPU-bound deterministic work (S2 query latency on warm SQLite) is typically within 1.5–2× of reference on a clean Linux runner.
- IO-heavy work on macOS-latest can be 5–10× variable.
- Network-mocked sync (S6, MSW intercepted) should be very stable.
- LLM tokens/sec (S9) on GHA without a GPU is **not 5× slower** — it's hundreds of times slower or impossible. The 5× rule fails entirely.

A flat multiplier is the simplest design but probably wrong. Either:

- Defend "5× is the empirical noise ceiling we measured for the surfaces that *can* run on GHA, and S9 is opt-out on GHA" (and say so in the table).
- Or make it per-surface and fill in the column in § 3.

**Suggestion:** Add a `Reference threshold` and `GHA threshold` column to the § 3 table and fill in both per-surface, marking GHA as "n/a" where the surface can't credibly run on GHA at all (S9 LLM is the obvious candidate; possibly S7 memory under multi-agent load).

### 2.4 LLM surface (S9) needs a designated model and a fallback

S9 is "Local LLM round-trip (Ollama + llama.cpp; first-token + tokens/sec)" measured against "canonical 3-prompt set". Open questions:

- **Which model?** Llama 3.1 8B? Phi-3 mini? Qwen 2.5 7B? Whatever the user has installed locally? The bench result is uninterpretable without naming the model and quantization.
- **What if the model isn't installed on the reference machine?** Auto-pull during bench? Hard-fail? Skip with a "model not installed" note in `baseline.md`?
- **GHA path?** GHA Linux runners have no GPU and ~16 GB RAM. Running a 7 B Q4 model on CPU will produce numbers, but they're meaningless for the SLO claim. Best to mark S9 as `gha: skipped` and only assert against the reference machine.
- **Cold-start vs warm-model.** First inference after `ollama run` includes weight load; subsequent inferences don't. The spec doesn't say which is measured.

**Suggestion:** Pick one canonical model + quantization (e.g., `llama3.2:3b-instruct-q4_K_M`) and say so in S9's row. Specify warm-model measurement (first inference excluded). Mark GHA as opt-out for S9.

### 2.5 Memory RSS (S7) cross-platform comparability

`process.memoryUsage().rss` returns:

- Linux: physical pages assigned to the process. Stable, comparable across runs.
- macOS: similar, but reports differently for shared library pages and may exceed actual physical use.
- Windows: working set, which expands and contracts with system memory pressure.

A flat "S7 RSS p95" comparison across the three GHA OSes will show > 30 % variance for reasons that have nothing to do with Nimbus.

**Suggestion:** Either (a) measure RSS on Linux only and use it as the SLO, with macOS / Windows as "informational, not gated", or (b) use a derived metric (peak heap size from V8, V8 external memory, or a Bun-specific accounting if exposed) that is more comparable. Document the choice.

### 2.6 MSW + Bun viability

§ 3 specifies `msw` for S6 (sync throughput per connector). Open question: do all of Drive / Gmail / GitHub MCP connector flows go through `globalThis.fetch` (MSW intercepts), or do any use `node:http` / SDK-vendored HTTP clients (MSW does not intercept by default)?

If any connector uses a non-`fetch` transport, the recorded-trace fixture won't replay through MSW and the bench result will be either flaky or always-zero.

**Suggestion:** Add a one-line sentence to S6's row: "Verified pre-implementation: all three target connectors use `fetch` and are MSW-interceptable." If any aren't, name the alternative interception strategy (`undici` mock agent, http.Server fixture, etc.) before locking § 3.

### 2.7 1 M-item synthetic corpus storage strategy

S2 / S3 / S7 mention a 1 M-item synthetic SQLite snapshot. Generating 1 M items per CI run is meaningfully expensive (minutes per run); checking a 1 M-row SQLite file into git is also a no-go for repo size. Open question:

- Generated lazily on first bench invocation and cached under `~/.cache/nimbus-bench/` (or `paths.cacheDir`)?
- Pre-generated on a schedule and uploaded as a release artifact / GHA cache key?
- Computed deterministically from a seed in < 30 s?

**Suggestion:** Settle this in § 3's "Corpus rationale per class" subsection. The fixture-generation cost shows up in CI bills.

### 2.8 Per-surface noise floor not initialized

§ 4 says "delta over a per-surface 'noise floor' (default 25 %, configurable per surface) fails the bench job." A 25 % floor for S5 (HITL popup latency, ~150 ms reference) is 37 ms — usable. For S9 (LLM tokens/sec), 25 % is too tight; for S2 query latency in the 80 ms range, 25 % is also probably too tight given GHA Linux noise. Configurability is mentioned but no floors are set.

**Suggestion:** Add a `noise_floor_pct` column (or a separate § 4 sub-table) with an initialized value per surface. Default to 25 % only where empirically validated.

### 2.9 The `perf` PR-label gate has no enforcement story

§ 4: "triggers […] on any PR with the `perf` label". Who applies the label? If a contributor changes `engine/agent.ts` (genuinely perf-relevant) and forgets the label, the bench doesn't run, the regression lands, and `main`'s nightly is the first signal. Is that acceptable, or should the label be auto-applied via path filters in `.github/labeler.yml`?

The repo already has a `labeler.yml` workflow — extending it to auto-apply `perf` for paths under `engine/`, `db/`, `embedding/`, `connectors/`, `llm/`, `voice/` is cheap.

**Suggestion:** Add to PR-C: extend `.github/labeler.yml` (or equivalent) so the `perf` label is applied automatically for the perf-relevant path globs. Document this in § 4.

### 2.10 No pre-assigned `user_felt_impact` / `engineering_cost_estimate` rubric

§ 1: "Fix work is hard-capped at the top 5 misses ranked by `user_felt_impact_score / engineering_cost_estimate` (both 1–5 ordinal)."

Without a definition or rubric, two reviewers will assign different scores. B1's severity rubric (§ 5 in that spec) is a useful precedent — it gives concrete examples per level. B2 needs the equivalent rubric for both axes.

**Suggestion:** Add a § 2.5 (or a sub-table in § 2 Phase 2) "Impact / cost rubric" with examples per ordinal level. E.g., `impact = 5`: "every user notices in the first 30 s of using Nimbus"; `impact = 1`: "only matters at edge cases (1 M items, 24 h soak)". Same for cost.

### 2.11 Multi-agent load test (S7) interaction with WS5 model state

S7 measures memory under "idle / heavy sync / multi-agent". The "multi-agent" state requires a sub-agent coordinator session, which requires an LLM. This couples S7 to S9's "which model?" question (§ 2.4) and to whether the bench can pull a model on demand. Worth resolving alongside § 2.4.

---

## 3. Suggested improvements

### 3.1 Add an absolute floor to the noise-delta check

§ 4: "delta […] (default 25 %, configurable per surface) fails the bench job."

% deltas misbehave near zero. If a future optimization brings S5 from 150 ms to 4 ms, a subsequent run at 6 ms is +50 % (would fail) but is in absolute terms within sub-frame noise. Use `max(absolute_floor_ms, relative_floor_pct × baseline)` instead of just relative.

### 3.2 Stream `nimbus bench --all` output

11 surfaces × multiple runs is a multi-minute operation. If the CLI buffers and prints at the end, it looks hung. Stream per-surface progress with surface name, run index, sample latency. Also makes Ctrl-C semantics tractable (you know which surface was in flight).

### 3.3 Define Ctrl-C / SIGTERM behaviour for partial bench runs

If `nimbus bench --all` is interrupted mid-run, what happens to `history.jsonl`? Do partial results write a half-line? Are aborted runs marked with an `incomplete: true` flag and excluded from CI delta comparison? Cheap to specify, expensive to retrofit.

### 3.4 Add a `concurrency` block to `_perf.yml`

GHA's `concurrency: { group: bench-${{ runner.os }}, cancel-in-progress: false }` ensures two `perf`-labelled PRs landing simultaneously don't compete for runner time and skew each other's measurements. Particularly important since the spec already accepts that runners have noise.

### 3.5 Cite Nielsen with an actual paper title in `slo-ux.md`

The spec lists `Nielsen (1993, updated 2014) — Response Times: The 3 Important Limits` as a source. The published SLO sheet (`slo-ux.md`) is the public-facing artifact for the perf claim — its citations should be precise enough to survive scrutiny. Use the full citation per row, not a vague "Nielsen response-time research".

### 3.6 Define the `Confidence: Low` schema in `missed.md`

§ 8 says "Confidence: Low findings are explicitly retained". B1 had a `Confidence` field per finding; B2's `missed.md` schema doesn't currently mention one. Add it explicitly (`Confidence: High | Medium | Low`) so retained-Low items are visibly flagged rather than silently mixed in.

### 3.7 Run CI-parity tests before pushing PR-B and PR-C

The user's standing rule (saved in memory) is "Run `bun run test:ci` before pushing any PR". The bench harness in PR-B touches `packages/gateway/src/perf/`, which is a new package directory — adding a coverage gate for it (mirroring `test:coverage:db` etc.) and wiring it into `test:ci` belongs in PR-B, not as an afterthought.

**Suggestion:** Add to PR-B's deliverable list: "`test:coverage:perf` script + threshold (≥80 %); add to `test:ci` in `package.json`."

### 3.8 Reconcile the SLO claim with the M1 Air's representativeness

The spec acknowledges "arm64 / x64 perf parity beyond the GHA matrix runs" is out of scope. But the public claim "local-first should feel snappier than SaaS" lands on machines that are *not* M1 Airs — including 4–5-year-old Windows / Linux laptops with slower SSDs and less RAM. A claim derived from the fastest mid-2020 ultra-portable may not generalize.

This is not a blocker — the spec correctly defers it. But the public SLO sheet should carry a caveat row: "These figures are measured on a 2020 M1 MacBook Air. Performance on x64 / older hardware is measured but not threshold-gated for `v0.1.0`; see GHA matrix results for that baseline." Otherwise the sheet over-claims.

### 3.9 Acceptance criterion 8 says "every cited surface has a corresponding `surfaces/bench-*.ts` driver" — also enumerate the inverse

Criterion 8 catches missing drivers. It doesn't catch the inverse: an orphaned driver under `packages/gateway/src/perf/surfaces/` that no surface row in `slo.md` references. Add: "and every `surfaces/bench-*.ts` driver maps to a row in `slo.md`."

### 3.10 Note docs-site integration for the SLO sheet

The repo has an Astro docs site at `packages/docs/`. The SLO sheet at `docs/perf/slo.md` is a public artifact. Decide whether it ships as an Astro page or stays in raw markdown. If shipped, the docs build needs to know about it — easy to forget after PR-C lands.

---

## 4. Minor observations

### 4.1 § 1 "Stop rule" mentions "B2-v2" but B2-v2's scope is fuzzy

§ 1 says misses 6–N are picked up "by a later B2-v2"; § 11 says B2-v2 "covers the deferred-backlog items + Phase 5 connector surfaces; uses the harness from B2 (now mature). Not a Phase 4 deliverable." Fine, but the "Not a Phase 4 deliverable" line should also appear in § 1 so the stop rule isn't misread as deferring fixes by a few weeks rather than a few quarters.

### 4.2 § 3 row S4 says "no corpus" but also "warm gateway"

A warm gateway is a kind of fixture. It isn't a *data* corpus, but it is preconditions. Either group it under the corpus column or add a "Preconditions" column. Same applies to S5 ("minimal" corpus, but the meaning of "minimal" — empty index? or single-item index? — isn't given).

### 4.3 § 4 "multi-run median over 5 invocations" — define "median of what"

Median of p95s? p95 of the union of all samples across 5 runs? Median of per-run mean? They produce different numbers. State the aggregation explicitly.

### 4.4 § 6 criterion 5: "fails the build if any surface exceeds its GHA threshold or moves >25 % beyond the noise floor"

These are two separate fail conditions but the wording suggests they're the same thing. Restate as "(a) the absolute GHA threshold is exceeded, **or** (b) the run delta vs the previous `main` entry exceeds the per-surface noise-floor `noise_floor_pct`."

### 4.5 § 10 PR-D wording is ambiguous

"PR-D … PR-D+N (Phase 3): one PR per top-5 fix plan (1–5 PRs depending on grouping). Each PR contains only the plan document; fix-execution PRs follow as a separate workstream after this audit closes."

If groupings collapse 5 misses into 2 plans, are the PRs `PR-D` and `PR-E`, or `PR-D-1` and `PR-D-2`? Cosmetic but worth picking one.

### 4.6 § 12 sources cite `docs/architecture.md` §Local Database Schema but don't pin a version

`architecture.md` is a living document. If the schema section is renamed in a later refactor, the source link becomes stale. Either pin a commit SHA or use a stable anchor.

---

## 5. Things the spec gets right (worth keeping)

To balance the review: these aspects are well-designed and shouldn't be re-litigated.

- **The hybrid threshold-setting model** (UX surfaces upfront, workload surfaces measure-then-set) is the right call. Insisting on upfront thresholds for sync throughput would be guesswork.
- **The hard cap of top-5 fixes** with a deferred-backlog file is a strong forcing function against the well-known "perf review eats the quarter" failure mode. § 1 explicitly names this as the rationale, which is unusually disciplined.
- **Reusing `latency-ring-buffer.ts` and `db/metrics.ts` percentile math** instead of building parallel measurement code is exactly right — it also means the bench numbers are directly comparable to in-production observability.
- **Phase split (harness → measure → plans, with fix execution out of scope)** mirrors B1's three-phase shape, which already worked. Consistency across audits lets reviewers re-use mental models.
- **Anchoring the public SLO to a real, owned-by-real-users machine (2020 M1 Air)** rather than a hypothetical "modern laptop" is honest and defensible.
- **Critical-regressions-leapfrog clause** (§ 8) prevents the 5-fix cap from blocking a glaring problem.
- **The reference-vs-CI distinction with relaxed GHA thresholds** is correct in principle (even if the multiplier needs § 2.3 work).

---

## 6. Summary

| Section | Count |
|---|---|
| Blockers | 6 |
| Open questions | 11 |
| Improvements | 10 |
| Minor / nits | 6 |

**Recommended next step:** Resolve § 1 (blockers) before merging the spec. Resolve § 2 (open questions) before merging PR-B (the harness). § 3 + § 4 can land incrementally during PR-B / PR-C without blocking.

The spec is structurally strong — the methodology, hard cap, and reuse of existing primitives are the right design. The blockers are mostly precision-of-wording and one math error (§ 1.1), not foundational issues.
