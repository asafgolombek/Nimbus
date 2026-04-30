# Design — Structure / SOLID / duplication audit (B3)

**Branch:** `dev/asafgolombek/structure-audit` (to be created at start of Phase 1)
**Date:** 2026-04-30
**Status:** Draft — pending user review
**Scope:** Fourth of the planned maintenance initiatives (toolchain refresh ✅ · security audit B1 ✅ · perf audit B2 ✅ · **this structure audit B3** · later: B4 bug-hunt + third-party package upgrades).
**Predecessor:** the B2 perf audit (design: [`2026-04-26-perf-audit-design.md`](./2026-04-26-perf-audit-design.md)) — same three-phase shape (design → measurement → fix-PR plans). Per the established B-series convention, this design and any per-subsystem fix plans are retired post-completion; the surviving record will be `docs/structure-audit/results.md` (mirrors `2026-04-25-security-audit-results.md`).

---

## 1. Goal, non-goals, stop rule

**Goal.** Produce a defensible, measured snapshot of structural quality across the five TypeScript workspaces before `v0.1.0`, ship a small set of high-leverage fixes, surface bigger refactor candidates as their own design specs, and install a thin CI defense so the binary-pass-fail rules can never silently regress.

**Driver.** Phase 4 is the final pre-`v0.1.0` phase. The codebase has grown rapidly through Phase 3 (connector mesh), Phase 3.5 (observability), and Phase 4 (LLM / voice / multi-agent). B1 and B2 established that the maintenance-initiative shape works; B3 is the third and last horizontal pass before the public release.

**Non-goals.**

- SRP-style "this file does too much" judgement (bucket E from the brainstorm — explicitly out, deferred to optional follow-up sub-projects).
- Rust deep audit. Existing `security-invariants.test.ts` already covers Invariants I7 (Tauri allowlist) and I8 (CSP); that is enough for `v0.1.0`. Rust deep-audit is reserved for an optional B3-v2 (post-`v0.1.0`).
- Architectural redesigns or new abstractions.
- Cross-phase scope creep into Phase 5 connector additions.
- Any refactor over one engineer-day. Those become their own design specs and are *not* executed under B3.

**Stop rule.** Fix work is hard-capped at **the top 5 findings ranked by `structural_impact_score / engineering_cost_estimate` (both 1–5 ordinal — see § 5), and each finding ≤ 1 engineer-day**. Findings whose estimated cost exceeds 1 engineer-day are auto-deferred and surface as a one-line entry in `docs/structure-audit/deferred-backlog.md` with a `Refactor candidate: <file/area> — needs own design spec` note. The user picks which deferred entries (if any) get promoted into a `2026-??-??-refactor-<name>-design.md` follow-up; B3 itself does not write those specs eagerly.

The cap exists explicitly because structure review is the easiest of the four B-series initiatives to spiral on — every file looks like it could be smaller. The `≤ 1 engineer-day` rule per fix is the structural enforcement of the spiral guard.

---

## 2. Methodology — three phases

Same three-phase shape as B1 and B2: design → measurement → fix-PR plans. Roughly 5–7 working days end-to-end.

### Phase 1 — Tooling setup + baseline (≈ 2 days)

Wire the signal sources and capture the starting numbers. No findings list yet, no ranking yet.

**Deliverables:**

- `sonar-project.properties` (committed) — project key (resolved via `search_my_sonarqube_projects` MCP at start of Phase 1, then committed), source roots `packages/*/src/**`, exclusions `**/*.test.ts`, `**/*-sql.ts`, `packages/ui/dist/**`, `packages/*/dist/**`, generated artifacts. Rule profile starts at default Sonar Way.
- `.dependency-cruiser.cjs` (committed) — D1, D2, D3 rules.
- `.jscpd.json` (committed) — duplication config (50-token / 5-line minimum block; ignores tests, migration SQL, fixtures, vendored code).
- `knip.json` (committed) — workspace-aware dead-code config; entry points `packages/gateway/src/index.ts`, `packages/cli/src/index.ts`, `packages/ui/src/main.tsx`, `packages/sdk/src/index.ts`, the mcp-connector entry points.
- `scripts/structure-audit/*.ts` — five custom scripts (see § 4).
- Five new `audit:*` entries in the root `package.json` (see § 4).
- `docs/structure-audit/baseline.md` — measured starting state for every dimension, with provenance (script name + commit SHA at measurement time). Per-dimension thresholds documented inline. Bucket A and F are binary; B/C/D get numeric thresholds. Threshold intent is "no regression worse than baseline + headroom" — same as B2's threshold formula.
- `docs/structure-audit/sonarqube-rule-tuning.md` — empty placeholder; populated only if Phase 2 rule tuning is needed.

**Reuse, not rebuild.** SonarQube is already wired via MCP. The bucket-F custom rules are the static-time complement of the existing `security-invariants.test.ts` runtime checks — same Invariant text, different enforcement layer. Where an Invariant has a runtime test today, B3 adds the structural sibling; where it doesn't, B3 adds *both* (script and test row) in the same Phase 1 PR.

### Phase 2 — Findings, ranking, CI gate, fix-PR plans (≈ 2–3 days)

The actual audit. Apply thresholds, produce the findings list, rank, write the small fix plans, ship the CI workflow.

**Deliverables:**

- `docs/structure-audit/missed.md` — every threshold violation, ranked by `structural_impact_score / engineering_cost_estimate`, with the **top 5 ≤ 1-day fixes** explicitly named. Each row carries `Confidence: High | Medium | Low` (mirrors B1/B2). Findings exceeding 1 engineer-day are *not* in the top 5 — they go straight to the deferred-backlog with a `Refactor candidate` note.
- `docs/structure-audit/deferred-backlog.md` — misses 6–N and all cost ≥ 3 findings, each with the same `Confidence` field and a one-line "why deferred" reason.
- `docs/structure-audit/jscpd-report.json`, `knip-report.json` — raw tool outputs (committed for provenance, ignored by the linter).
- `.github/workflows/_structure.yml` — fast PR check (≈ 30 s budget). Calls only the binary subset (`audit:boundaries` + `audit:any` + `check-nimbus-invariants` binary rules). Wired into `pr-quality` aggregate. Ubuntu-only on PR; full 3-OS matrix on push to `main`.
- `docs/superpowers/plans/<date>-structure-fixes-*.md` — top-5 fix plans, grouped by subsystem (most fixes will collapse into 1–2 grouped plans; pathological cases get more). One PR per plan.

### Phase 3 — Fix execution (≈ 1–2 days, opens out of B3)

Top-5 fix PRs land. B3 ends when the last top-5 PR merges. The deferred-backlog rows are **not** executed under B3; they're picked up later by user choice via their own design specs.

**Fix execution closes B3.** Same convention as B1: the design + per-subsystem fix plans are retired; `docs/structure-audit/results.md` becomes the surviving record.

---

## 3. Audit dimensions

The audit's surface. 12 dimensions across 5 buckets (A, B, C, D, F). Bucket E (SRP / cohesion judgement) is intentionally absent — deferred per brainstorm. A high D5 (cognitive complexity) score is the operational proxy.

### 3.1 Dimension table

| # | Bucket | Dimension | Source | Miss definition | CI gate? |
|---|---|---|---|---|---|
| D1 | A | Forbidden cross-package imports — CLI/UI never import gateway TS; SDK imports neither core nor UI; mcp-connectors only import `@nimbus-dev/sdk` | `dependency-cruiser` rules | Binary: any violation | ✅ |
| D2 | A | Cyclic imports within a workspace | `dependency-cruiser` (cycle rule) | Binary: any cycle | ✅ |
| D3 | A | PAL leakage — only `platform/index.ts` may import `win32` / `darwin` / `linux`; business logic uses `PlatformServices` | custom `dependency-cruiser` rule | Binary: any direct OS-file import outside `platform/index.ts` and tests | ✅ |
| D4 | B | File LOC (`packages/*/src/**`, excludes `*.test.ts`, generated SQL, fixtures) | small custom script | > 800 LOC, ranked by overshoot | ❌ |
| D5 | B | Function cognitive complexity | SonarQube `cognitive_complexity` per function | > 15 | ❌ |
| D6 | C | Token-level duplication | `jscpd` (50 tokens / 5 lines minimum block) | > 3 % per workspace, **or** any duplicated block ≥ 100 tokens | ❌ |
| D7 | D | Unused exports & orphan files | `knip` | Listed, ranked by file LOC × unused-export count | ❌ |
| D8 | D | `any` / `as any` count in `src/` (excludes `*.test.ts`) | custom script | No increase vs Phase 1 baseline (count locked at measurement time) | ✅ |
| D9 | D | Risky type assertions — `as <T>` outside tests, excluding `as const` / `as unknown` | custom script | Listed, informational only — bucket-D ranking input | ❌ |
| D10 | F | `Bun.spawn` / `child_process.spawn` under `connectors/` not routed through `extensionProcessEnv()` (Invariant I1 structural side) | custom script | Binary | ✅ (also caught by `security-invariants.test.ts` at runtime — the structural check is the static-time complement) |
| D11 | F | Vault-key construction outside `connector-vault.ts` helpers | custom script | Binary | ✅ |
| D12 | F | `db.run()` call sites outside `db/write.ts` (precursor census for the roadmap S5-F4 migration) | custom script | Listed, count vs baseline (not a gate — the migration is its own future project) | ❌ |

### 3.2 Coverage note on bucket F

Several invariants in `CLAUDE.md` already have runtime tests in `security-invariants.test.ts` (I1, I2, I9, I10, …). B3's bucket F is the **structural** complement: enforce the same rules at static time so a regressing PR fails CI before the test even runs, and surface invariants that *don't* yet have a test as findings. The Phase 1 deliverable for D10/D11 includes a test row in `security-invariants.test.ts` for any invariant that lacks one.

### 3.3 Package scope

All five TypeScript workspaces — `packages/gateway`, `packages/cli`, `packages/ui`, `packages/sdk`, `packages/mcp-connectors/*`. Rust (`packages/ui/src-tauri/`) is out of scope; the existing security tests for Invariants I7 and I8 are sufficient pre-`v0.1.0`. Cross-package boundary checks (D1) are meaningful only when all five workspaces are scanned together — a gateway-only audit would miss the entire point.

---

## 4. Tooling stack

Five tools, all install-once dev dependencies, all runnable from the new top-level `audit:*` scripts.

### 4.1 SonarQube (already wired via MCP)

`sonar-project.properties` at the repo root pinning project key, source roots, exclusions, and the rule profile. Rule profile starts at default Sonar Way. Tune in Phase 2 only if signal-to-noise on the first run is unacceptable; record any rule disable in `docs/structure-audit/sonarqube-rule-tuning.md` with a reason.

SonarQube produces D5 (cognitive complexity) and informational signal on D6 (its built-in duplication detector). It is **not** wired into CI — the dashboard is the consumption surface.

### 4.2 `dependency-cruiser` (new dev dep)

Config at `.dependency-cruiser.cjs` with three custom rules covering D1, D2, D3:

- `no-forbidden-package-imports` — encodes the package dependency graph from `CLAUDE.md` "Package Dependency Rules" section.
- `no-circular-imports` — cycle detection across each workspace.
- `pal-isolation` — only `packages/gateway/src/platform/index.ts` (and tests) may import `win32.ts` / `darwin.ts` / `linux.ts`.

Runs in CI via `_structure.yml` and locally via `bun run audit:boundaries`.

### 4.3 `jscpd` (new dev dep)

A pre-existing `pr-quality-duplication` job in `ci.yml` already runs `bunx jscpd` against `packages/` during PRs as a console-only smoke check. B3 promotes jscpd to a configured, persisted-output tool with a committed `.jscpd.json` (50-token / 5-line minimum block; ignores test files, migration SQL, fixtures, vendored code). Phase 1 deliverable replaces the inline `bunx jscpd` invocation in `pr-quality-duplication` with `bun run audit:duplication` so both code paths share one config. Output: per-package duplication % + a list of duplicated blocks, written to `docs/structure-audit/jscpd-report.json`. Provides D6.

### 4.4 `knip` (new dev dep, replaces `ts-prune`)

Config at `knip.json` aware of the workspace structure (each package has its own entry points). Output: list of unused exports + orphan files, written to `docs/structure-audit/knip-report.json`. Provides D7.

Reasoning over `ts-prune`: monorepo-aware, supports Vite / Tauri / Bun entry points, actively maintained.

### 4.5 Custom scripts (`scripts/structure-audit/*.ts`)

- `count-any-usage.ts` — counts `: any`, `as any`, `<any>` casts in `packages/*/src/**` excluding tests. Outputs a baseline count and per-file breakdown. Drives D8.
- `list-risky-assertions.ts` — lists `as <Type>` casts outside tests, excluding `as const` / `as unknown`. Drives D9.
- `check-nimbus-invariants.ts` — single script with one inspection function per F-bucket rule (D10, D11, D12). Each function returns a list of violations. Adding a new invariant = adding a new inspector.
- `measure-file-loc.ts` — list every TS file in `packages/*/src/**` with its LOC, sorted descending. Drives D4.
- `audit-structure.ts` — top-level orchestrator. Runs every script + jscpd + knip + dependency-cruiser, writes a single `docs/structure-audit/run-<timestamp>.json` blob. The Phase 2 `missed.md` is generated from this blob.

### 4.6 New root `package.json` scripts

- `audit:structure` — full pack (orchestrator).
- `audit:boundaries` — fast subset (dependency-cruiser only); CI calls this.
- `audit:duplication` — jscpd only.
- `audit:dead-code` — knip only.
- `audit:any` — count-any-usage only.
- `audit:invariants` — `check-nimbus-invariants.ts --binary-only` (the subset that maps to D10/D11; also called by CI).

### 4.7 No new coverage gate

B3 does **not** add a coverage threshold. The existing per-subsystem coverage gates (engine, vault, etc.) are Phase 3.5 deliverables and stay as-is.

### 4.8 Dependency safety check

Each new dev dep added in Phase 1 must first pass `bun run check-package <name>` (the slopsquatting check shipped alongside this design). The check verifies the package exists on the npm registry, prints maintainer / created / version-count, and warns if the package is younger than 7 days. Rationale: each new entry point we install is a supply-chain attack surface; pre-`v0.1.0` is the right time to make this routine.

---

## 5. Ranking rubric

Mirror of B1/B2. Both axes 1–5 ordinal. Final score: `structural_impact_score / engineering_cost_estimate`.

### 5.1 `structural_impact_score`

Replaces B2's user-felt impact, which doesn't apply to structural findings.

| Score | Meaning |
|---|---|
| 5 | Touches a non-negotiable directly: forbidden cross-package import, `any` in a public API surface (SDK / client), security-invariant wired incorrectly, PAL leakage from business logic |
| 4 | High-churn hot path: file shows up in last-90-day commit count above the 80th percentile **and** violates ≥ 1 dimension; or duplication block ≥ 100 tokens spanning 3+ files |
| 3 | Public API surface of an exported package: any duplication / dead-code / unused-export / size finding inside `packages/sdk` or `packages/client` (external consumers read these) |
| 2 | Internal critical subsystem: engine, vault, IPC, executor, `db/write.ts` — single-dimension violation, normal churn |
| 1 | Internal helper, low traffic, low blast radius — auxiliary scripts, one-off utilities, well-tested leaf modules |

### 5.2 `engineering_cost_estimate`

Identical to B2.

| Score | Meaning |
|---|---|
| 5 | Multi-week (architectural redesign / schema change / new subsystem) |
| 4 | One-week (5+ files, migration, careful testing) |
| 3 | Multi-day (one subsystem, well-bounded, may need new tests) |
| 2 | One-day (single file, narrow change, minimal new tests) |
| 1 | One-hour (config tweak, single line, obvious fix) |

### 5.3 Stop-rule interaction

The 1-engineer-day cap from § 1 means **only cost-1 and cost-2 findings are eligible for the top 5**. Cost ≥ 3 findings, regardless of impact score, route automatically to `deferred-backlog.md` with a `Refactor candidate` note. A cost-5 / impact-5 finding (e.g., the typed-`dbRun` migration already in the roadmap as S5-F4) is *recorded* in B3 but never *fixed* by B3 — that's the design.

### 5.4 Ranking and confidence

Higher `impact / cost` = higher rank. Ties broken by reviewer judgement; ties get a `tie-broken-by` annotation in the row. Top 5 (cost ≤ 2) → grouped by subsystem into 1–2 fix plans. Misses 6–N + all auto-deferred → backlog.

Each finding row in `missed.md` and `deferred-backlog.md` carries `Confidence: High | Medium | Low` (mirrors B1/B2). High = tool-detected with no judgement; Low = qualitative call. The CI gate (D1–D3, D8, D10, D11) only enforces High-confidence rules — judgement-heavy items never gate the build.

---

## 6. CI gate scope (`.github/workflows/_structure.yml`)

### 6.1 Triggers and matrix

Runs on every PR (via `pr-quality` aggregate) and every push to `main`. No nightly run — the gate is fast enough to live on every push.

**Ubuntu-only**, both PR and push. Static dependency-graph checks and grep-based custom rules have zero OS variance — Bun parses the same TypeScript on every OS. This is one of the few places where matching the 3-OS pattern is pure cost without benefit. The platform-equality non-negotiable is a *runtime* property; static analysis is excluded by intent.

### 6.2 Rules in the gate (binary only)

| Check | Source | Failure mode |
|---|---|---|
| D1 — forbidden cross-package imports | `audit:boundaries` (dependency-cruiser) | Job fails; reviewer comment lists the violating import |
| D2 — circular imports within a workspace | `audit:boundaries` (dependency-cruiser cycle rule) | Job fails; comment lists the cycle |
| D3 — PAL leakage | `audit:boundaries` (custom dependency-cruiser rule) | Job fails; comment lists the OS-file import |
| D8 — `any` count not exceeding baseline | `audit:any` against `MAX_ANY_COUNT` env var pinned at Phase 1 baseline | Job fails; comment shows new count vs baseline + diff of new occurrences |
| D10 — `spawn()` not via `extensionProcessEnv()` under `connectors/` | `check-nimbus-invariants.ts --rule spawn` | Job fails; comment names the offending file |
| D11 — Vault-key construction outside helpers | `check-nimbus-invariants.ts --rule vault-key` | Job fails; comment names the offending file |

### 6.3 Rules NOT in the gate

- D4 (file LOC) — measurement only, no threshold; SonarQube dashboard hosts the trend.
- D5 (cognitive complexity) — SonarQube dashboard.
- D6 (duplication %) — measurement only; jscpd report archived as a workflow artifact for trend visibility.
- D7 (unused exports) — knip report archived as a workflow artifact; not a gate. Knip's false-positive rate makes it a poor gate, and aggressive removal of "unused" exports is exactly the kind of churn this audit shouldn't cause.
- D9 (risky type assertions) — informational only.
- D12 (`db.run()` outside `db/write.ts`) — census only; the migration is its own future project (S5-F4 in the roadmap).

### 6.4 Performance budget and ergonomics

≤ 30 seconds total. Dependency-cruiser on the whole monorepo runs in ≈ 5–10 s; the four custom scripts are grep-equivalents and run in < 5 s combined; cold Bun startup ≈ 5 s. Comfortable margin under the budget.

Workflow shape: mirrors `_test-suite.yml` / `_perf.yml`. Single job, `name: structure`, runs `bun install --frozen-lockfile` then `bun run audit:boundaries && bun run audit:any && bun run audit:invariants`. Reusable workflow callable from `pr-quality.yml`. No matrix.

Every failing check writes a `::error::` annotation pointing at the violating file:line so it surfaces in the PR's "Files changed" review pane, not just the workflow log. The custom scripts emit GitHub-actions annotation format when `GITHUB_ACTIONS=true`.

### 6.5 No bypass

The gate covers non-negotiables; there is no `--no-verify` analogue. If a legitimate exception exists, the rule itself gets an explicit allow-list entry in the dependency-cruiser config or the custom script — committed with reasoning, not a per-PR bypass.

---

## 7. Deliverables and follow-up specs

### 7.1 Phase 1 — tooling + baseline

- `sonar-project.properties` (committed) — project key, source roots, exclusions, rule profile.
- `.dependency-cruiser.cjs` (committed) — D1, D2, D3 rules.
- `.jscpd.json` (committed) — duplication config.
- `knip.json` (committed) — workspace-aware dead-code config.
- `scripts/structure-audit/*.ts` — five custom scripts.
- `package.json` — five new `audit:*` scripts (root level + delegated where appropriate).
- `docs/structure-audit/baseline.md` — measured starting state per dimension, with provenance.
- `docs/structure-audit/sonarqube-rule-tuning.md` — empty placeholder; populated only if Phase 2 rule tuning happens.

### 7.2 Phase 2 — audit + CI gate + fix plans

- `docs/structure-audit/missed.md` — every threshold violation, ranked, with `Confidence` field; top 5 ≤ 1-day fixes named explicitly.
- `docs/structure-audit/deferred-backlog.md` — misses 6–N and all cost ≥ 3 findings, with `Refactor candidate: …` notes.
- `docs/structure-audit/jscpd-report.json` and `knip-report.json` — raw tool outputs (committed for provenance, ignored by the linter).
- `.github/workflows/_structure.yml` — fast PR check calling `audit:boundaries` + `audit:any` + `audit:invariants`. Wired into `pr-quality` aggregate alongside `_test-suite.yml`. Ubuntu-only on PR and on push (see § 6.1 — static analysis has zero OS variance, so the 3-OS matrix is excluded by intent).
- `docs/superpowers/plans/<date>-structure-fixes-*.md` — top-5 fix plans, grouped by subsystem; one PR per plan.

### 7.3 Phase 3 — fix execution (out of B3 scope, tracked separately)

- Top-5 fix PRs land. The last merge closes B3.
- `docs/structure-audit/results.md` — written at close, mirrors `2026-04-25-security-audit-results.md`. Records what shipped, what deferred, what's in CI now, link to the deferred-backlog. **The design and per-tier plans are retired post-completion**; the results doc is the surviving record (same convention B1 established).

### 7.4 Documentation cross-references to update

- `CLAUDE.md` — add `audit:structure` and `_structure.yml` rows under Commands; add a one-liner under Security Invariants linking I1/I9/I10's static-time complement to `check-nimbus-invariants.ts`.
- `docs/roadmap.md` — toggle the B3 row in *Audits and follow-up initiatives* to `[x]` at close; reference `docs/structure-audit/results.md`.

### 7.5 Follow-up specs (deferred from B3, picked up later if and when)

1. `2026-??-??-refactor-<name>-design.md` — one per `Refactor candidate` the user chooses to promote. **B3 does not write these eagerly.** The deferred-backlog row contains enough information for the user to triage.
2. `2026-??-??-typed-dbrun-migration-design.md` — already enumerated in the roadmap as S5-F4; D12's enumeration in B3 is the precursor census, not the design.
3. `2026-??-??-bug-hunt-design.md` — **B4**, the next maintenance initiative.
4. `2026-??-??-third-party-package-upgrades-design.md` — npm + cargo upgrades, deferred from the toolchain refresh; the roadmap notes this should land *before* B4 so the audit measures the upgraded baseline.
5. **B3-v2 (post-`v0.1.0`)** — if the v0.1.0 release surfaces structure issues we missed, a tighter pass after the codebase stabilises. Not a Phase 4 deliverable.

---

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Spiral: every file looks improvable | 1-engineer-day cap per fix (§ 1); top-5 cap regardless of cost ratio (§ 5.3) |
| SonarQube default rules produce too much noise | Rule tuning in Phase 2 only, with reasons recorded (§ 4.1); CI gate uses zero SonarQube signal |
| Knip false positives on dynamic imports / Tauri / Vite entry points | Knip is gated to artifact-only (§ 6.3); not a CI failure mode |
| jscpd flags identical migration SQL files | Migration SQL excluded in `.jscpd.json` (§ 4.3) |
| `any` baseline count drifts because new code legitimately needs `unknown`-style escape hatches | The gate locks count at baseline — code that adds `any` *and* removes one elsewhere is allowed; net increase fails (§ 6.2 D8) |
| Custom rule script becomes a maintenance liability | Single script with one function per rule (§ 4.5); each invariant added is a function added, not a new file |
| CI gate flakes due to network or transient install failures | Bun install is `--frozen-lockfile` (now the case post-slopsquatting hardening); the audit scripts make zero network calls |

---

## 9. Open questions resolved during brainstorm

- **Primary signal source** — Hybrid (SonarQube + custom Nimbus-specific rule scripts).
- **Audit dimensions in scope** — A (boundaries), B (size/complexity), C (duplication), D (dead code & API hygiene), F (Nimbus-specific conventions). Bucket E (SRP / cohesion) deferred.
- **Package scope** — All five TS workspaces; Rust out of scope.
- **Stop rule** — Top-5, each ≤ 1 engineer-day; bigger findings auto-deferred to their own design spec.
- **CI gate** — Add `_structure.yml` for binary rules only.
