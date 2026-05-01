# Structure Audit (B3) — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land all Phase 2 deliverables of the B3 structure audit — the ranked `missed.md` and `deferred-backlog.md` (with top-5 fix candidates explicitly named, all cost-≥3 findings auto-deferred per spec § 5.3), the `.github/workflows/_structure.yml` CI gate (Ubuntu-only, ≤30 s), one to two top-5 fix plan documents under `docs/superpowers/plans/`, the committed jscpd / file-loc / risky-assertions reports for provenance, and the design-spec doc cross-references in `CLAUDE.md` / `GEMINI.md`. **Phase 3 (executing the top-5 fixes) is out of scope** — those land as separate PRs after this plan merges.

**Architecture:** Phase 2 is data-driven assembly. The Phase 1 outputs (`baseline.md`, `any-baseline.json`, `db-run-census.json`, `churn-90d.json`, plus the regenerable `jscpd-report.json` / `knip-report.json` / `file-loc.json` / `risky-assertions.json`) are the inputs. We triage each dimension's findings per § 5 of the design spec, apply the `structural_impact_score / engineering_cost_estimate` rubric (cost-≥3 → auto-defer), pick the top 5 (cost-≤2) and group them into 1–2 subsystem-scoped fix plans. The CI gate workflow file is committed but NOT yet wired into `pr-quality.yml` because it currently fails (5 D10 + 56 D11 from Phase 1) — the LAST top-5 fix PR (Phase 3) wires it in, satisfying spec § 7.2.

**Tech Stack:** Bun 1.2+ / TypeScript 6.x strict, the seven existing audit scripts, the three external tools (dependency-cruiser, jscpd, knip) installed in Phase 1. New: a single GitHub Actions YAML file at `.github/workflows/_structure.yml`. No new dev dependencies, no runtime code changes in any `packages/*` workspace.

**Spec:** `docs/superpowers/specs/2026-04-30-structure-audit-design.md` (§ 7.2)

**Branch:** `dev/asafgolombek/structure-audit-phase-2` (already created off `main` at the merge of PR #135).

---

## File Structure

**New files (created during Phase 2):**

| Path | Purpose |
|---|---|
| `docs/structure-audit/missed.md` | Ranked findings table; top-5 (cost-≤2) explicitly named; per-row `Confidence: High/Medium/Low` |
| `docs/structure-audit/deferred-backlog.md` | Misses 6–N + all cost-≥3 findings; one-line "why deferred" + `Refactor candidate: …` notes |
| `docs/structure-audit/jscpd-report.json` | jscpd raw output committed for provenance (see § 7.2) |
| `docs/structure-audit/file-loc.json` | D4 raw LOC sorted desc — committed for Phase 2 reproducibility |
| `docs/structure-audit/risky-assertions.json` | D9 list of `as <Type>` casts — committed as the "type-safety debt" reference |
| `.github/workflows/_structure.yml` | CI gate workflow; reusable, callable from `pr-quality.yml` after Phase 3 fixes land |
| `docs/superpowers/plans/2026-05-01-structure-fixes-d10-sync-connector-spawn.md` | Top-5 fix plan #1 — the 5 D10 violations |
| `docs/superpowers/plans/2026-05-01-structure-fixes-<group2>.md` | Top-5 fix plan #2 — only if triage produces ≥1 cost-≤2 finding outside D10 |

**Modified files:**

| Path | Change |
|---|---|
| `CLAUDE.md` | Add `_structure.yml` row under Commands (already has `audit:*` row); add I1/I9/I10 cross-reference under Security Invariants per § 7.4 |
| `GEMINI.md` | Mirror of CLAUDE.md changes |
| `docs/structure-audit/baseline.md` | Optionally append a "Phase 2 update" section if any baseline number changed during regeneration |

**Out of scope for Phase 2** (per spec § 7.3):
- The actual top-5 fix code (lands as separate PRs, one per fix plan).
- Wiring `_structure.yml` into `pr-quality.yml` (last fix PR does this).
- `docs/structure-audit/results.md` (written at B3 close, after Phase 3).
- SonarCloud rule tuning beyond the placeholder update (Task 12 Step 6 below records the Phase 2 outcome; rule disables only happen if D5 dashboard signal is unacceptable).

**Phase 3 parallelism:** The top-5 fix PRs are designed to run in parallel — each plan is scoped to one subsystem and one dimension. The only ordering constraint is that the LAST PR to land must wire `_structure.yml` into `pr-quality.yml` (after `audit:invariants` exits 0). Each fix plan's "Final verification" step checks for this condition. Multiple agents/developers can work the plans concurrently.

---

## Task 1: Branch sanity check + regenerate fresh reports

**Files:**
- Create: `docs/structure-audit/file-loc.json` (regenerated)
- Create: `docs/structure-audit/jscpd-report.json` (regenerated)
- Create: `docs/structure-audit/knip-report.json` (regenerated; was committed in Phase 1 Task 14, refresh)
- Create: `docs/structure-audit/risky-assertions.json` (regenerated)

- [ ] **Step 1: Confirm branch state**

```bash
git rev-parse --abbrev-ref HEAD
# Expected: dev/asafgolombek/structure-audit-phase-2

git log --oneline main..HEAD
# Expected: empty (this branch has no commits yet beyond main)

git status
# Expected: clean working tree (or only the plan file you're reading from)
```

If the branch isn't right, stop and ask.

- [ ] **Step 2: Regenerate the four report files**

```bash
bun run scripts/structure-audit/measure-file-loc.ts
bun run scripts/structure-audit/list-risky-assertions.ts
bunx jscpd packages
bunx knip --reporter json > docs/structure-audit/knip-report.json
```

Expected: each command writes its output under `docs/structure-audit/`. jscpd and knip exit non-zero (above their threshold / unused exports found) — that's expected.

- [ ] **Step 3: Verify the numbers match `baseline.md`**

```bash
bun -e 'const r = await Bun.file("docs/structure-audit/file-loc.json").json(); console.log("D4 >800:", r.filter(e => e.loc > 800).length, "top:", r[0].file, r[0].loc);'
# Expected: D4 >800: 6 top: packages/gateway/src/connectors/lazy-mesh.ts 1401

bun -e 'const r = await Bun.file("docs/structure-audit/risky-assertions.json").json(); console.log("D9 count:", r.length);'
# Expected: D9 count: 399

bun -e 'const r = await Bun.file("docs/structure-audit/jscpd-report.json").json(); console.log("D6 pct:", r.statistics.total.percentage);'
# Expected: D6 pct: 3.62 (or close — small drift OK)

bun -e 'const r = await Bun.file("docs/structure-audit/knip-report.json").json(); console.log("D7 files:", r.issues.length);'
# Expected: D7 files: 234 (or close — small drift OK)
```

Any divergence > 10 % from `baseline.md` is a **stop-and-investigate** signal — something landed in `main` between Phase 1 close and now that materially changed the surface area.

- [ ] **Step 4: Re-confirm D8 / D10 / D11 / D12 counts (cheap)**

```bash
bun run audit:any | head -1
# Expected: Total `any` count: 2

bun run audit:invariants 2>&1 | grep -c "D10 spawn" || true
# Expected: 5

bun run audit:invariants 2>&1 | grep -c "D11 vault-key" || true
# Expected: 56

bun -e 'const r = await Bun.file("docs/structure-audit/db-run-census.json").json(); console.log("D12:", r.length);'
# Expected: D12: 94
```

Any divergence here for D10/D11 is a real change in non-negotiable I1 violations — note it but don't stop. The plan adapts in Task 2/3 below.

- [ ] **Step 5: Do NOT commit yet**

The four regenerated reports are committed in Task 8 once `missed.md` and `deferred-backlog.md` reference their numbers. Leaving them untracked for now keeps Task 8's diff coherent.

---

## Task 2: Triage D10 — sync-connector spawn invariants

**Files:**
- Read-only: `packages/gateway/src/connectors/{aws,azure,gcp,kubernetes,filesystem-v2}-sync.ts`
- Output: notes captured in scratch (used by Task 7's `missed.md` row + Task 12's fix plan)

This task produces no committed file; it writes the per-finding metadata that Task 7 and Task 12 consume.

- [ ] **Step 1: Confirm the 5 violations**

```bash
bun run scripts/structure-audit/check-nimbus-invariants.ts --rule spawn 2>&1 | grep "D10 spawn"
```

Expected output: 5 lines in the form `::error file=<path>,line=<n>::D10 spawn not via extensionProcessEnv: <snippet>`.

If you get fewer than 5, the situation has changed since Phase 1 close — re-run the check with `--rule spawn` only and inspect carefully. Update Task 7's `missed.md` row to match the actual count.

- [ ] **Step 2: For each violation, classify cost + impact**

For each of the 5 files (`aws-sync.ts`, `azure-sync.ts`, `gcp-sync.ts`, `kubernetes-sync.ts`, `filesystem-v2-sync.ts`):

1. Read the violating line + 5 lines of context.
2. Identify the local env-builder pattern. Most are of the form `{ ...process.env, AWS_*: ... }` or similar.
3. Determine whether the fix is one of:
   - **(a) Replace `{ ...process.env, X: y }` with `{ ...extensionProcessEnv(), X: y }`** — cost-1, no behavior change beyond filtering ambient env. Confirm `extensionProcessEnv` is importable from the file's location (it lives in `packages/gateway/src/connectors/extension-process-env.ts` per Phase 1's I1 wiring). If not, the import path is the same as `lazy-mesh.ts` uses — copy it.
   - **(b) The connector spawns a CLI that REQUIRES specific ambient env vars** (e.g., `KUBECONFIG`, `AWS_PROFILE`) that are intentionally inherited. In this case, route through `extensionProcessEnv()` PLUS preserve the specific opt-in keys via an explicit pass-through list.
4. Record per-file: `{ file, line, fix-shape: "(a)" | "(b)" }`.

- [ ] **Step 3: Score each finding**

Per spec § 5.1 / § 5.2:

- All 5 D10 violations: **impact 5** (touches I1 non-negotiable, security invariant wired wrong)
- All 5: **cost 1** (one-line edit, existing helper available, well-defined fix shape)
- Score: 5 / 1 = **5.0** — top of top-5.
- Confidence: **High** (tool-detected, no judgement).

- [ ] **Step 4: Confirm grouping**

All 5 violations are in `packages/gateway/src/connectors/*` — same subsystem. Group as a single fix plan in Task 12: `2026-05-01-structure-fixes-d10-sync-connector-spawn.md`.

---

## Task 3: Triage D11 — vault-key construction sites

**Files:**
- Read-only: full output of `bun run audit:invariants --rule vault-key`
- Read-only: `packages/gateway/src/connectors/connector-vault.ts` (the existing centralization helper)
- Read-only: `packages/gateway/src/connectors/connector-secrets-manifest.ts` (canonical key list)

This task produces no committed file; it produces the per-finding metadata used by Task 7 / Task 8 / (optionally) Task 13.

- [ ] **Step 1: Capture the full D11 list**

```bash
bun run scripts/structure-audit/check-nimbus-invariants.ts --rule vault-key 2>&1 | grep "D11 vault-key" > /tmp/d11.txt
wc -l /tmp/d11.txt
# Expected: ~56 (matches Phase 1 baseline)
```

- [ ] **Step 1b: Pre-pass — per-directory tally (triage assistant)**

Group D11 sites by their immediate parent directory before bucketing. A directory with 8+ sites is almost always Bucket C (centralization candidate, cost ≥ 3); a directory with 1–2 sites is usually Bucket A or B.

```bash
awk -F'file=|,line' '/D11 vault-key/ { print $2 }' /tmp/d11.txt | sed 's|/[^/]*$||' | sort | uniq -c | sort -rn
```

Expected output: per-directory counts, e.g. `12 packages/gateway/src/connectors`, `8 packages/gateway/src/ipc`, etc. Use this tally to seed the Bucket-C list (top-2-3 directories), then drop into Bucket A/B for the long tail. Saves the executor from inspecting all 56 sites individually.

- [ ] **Step 2: Bucket each site into one of three categories**

Read each line of `/tmp/d11.txt`. The line contains `file=<path>,line=<n>::D11 vault-key constructed outside allow-list: <snippet>`. For each site, decide its category:

- **Bucket A — false positive (test/log/redact context).** The string-literal match is in:
  - A log-redaction key list (e.g., `gateway-log-file.ts` `REDACT_KEY_PATTERNS`)
  - A doc-comment example
  - A test fixture (note: `iterateSourceFiles` already excludes `.test.ts`, but a non-test file with literal example strings can still match)
  
  **Fix shape (preferred):** add a per-line opt-out comment immediately before the false-positive line — e.g., `// audit-ignore-next-line D11-vault-key (log redaction key, not a real vault key)` — and teach `check-nimbus-invariants.ts` to honour it (one-line addition: `if (lines[i - 1]?.includes("audit-ignore-next-line D11-vault-key")) continue;`). This is more surgical than regex changes: the suppression is co-located with the false positive, future regex tightening doesn't re-flag it, and a `grep audit-ignore-next-line` enumerates every suppression for review.
  
  **Fix shape (fallback):** if a single file has many FPs from the same pattern, add the file path to a `D11_FP_FILE_ALLOWLIST` constant in the script. Less surgical than per-line comments — risks silently suppressing a real finding if one is later added to the same file — so prefer per-line comments unless the count is overwhelming.
  
  Cost 1 (one script change + per-line comment additions, retest). Goes to **fix plan #2 candidate**.

  **DO NOT widen the regex** to match fewer things based on heuristic context (e.g., "skip if line contains `redact`"). That couples the audit to its callers' wording and silently suppresses real violations whose lines happen to contain the trigger word.

- **Bucket B — production vault-key construction not in helper.** The site is a real `vault.get()` / `vault.set()` call that constructs the key inline.
  - Fix shape: add the file path to the D11 allow-list constant (`VAULT_KEY_ALLOW_LIST` in `check-nimbus-invariants.ts`) AND/OR refactor the call site to use `perServiceOAuthVaultKey()` / `writePerServiceOAuthKey()` from `connector-vault.ts`.
  - Cost depends:
    - If the file is one site → **cost 1** (allow-list expand) or **cost 2** (refactor + small test).
    - If the file is N sites or touches public surfaces → **cost ≥ 3** (route to deferred-backlog with `Refactor candidate: centralize vault-key construction in <subsystem>` note).

- **Bucket C — auto-defer (cost ≥ 3).** The site is in a hot path file (e.g., `lazy-mesh.ts`, `connector-rpc-handlers.ts`) with multiple call sites needing coordinated refactor. Goes straight to `deferred-backlog.md` with `Refactor candidate: route <subsystem> vault keys through connector-vault helpers` note.

- [ ] **Step 3: Tally**

Produce a summary `{ bucketA: <N>, bucketB: <N>, bucketC: <N> }`. Save these counts for Task 7's `missed.md` row.

- [ ] **Step 4: Cap at top-5 eligibility**

If Bucket A produces a clear cost-1 fix (regex tweak to skip log-redaction contexts) — that's a top-5 candidate, score 5/1 = 5.0 (impact 5: touches I1 non-negotiable structural defense). Add it to Task 13's potential fix plan.

If Bucket B produces ≥1 simple per-file cost-1 (allow-list expand), it's a top-5 candidate IF it doesn't displace a higher-scored finding.

If Buckets B/C produce only cost-≥3 sites — `deferred-backlog.md` rows. Each row: `Refactor candidate: <subsystem> vault-key centralization (impact <N>, cost ≥3)`.

- [ ] **Step 5: Document the bucketing**

Create a temp file `/tmp/d11-buckets.txt` with three sections (A / B / C), each section listing the file paths in that bucket. This is the input to Task 7's `missed.md` and Task 13's fix plan if D11 produces a top-5 finding.

---

## Task 4: Triage D6 — duplication blocks ≥100 tokens spanning 3+ files

**Files:**
- Read-only: `docs/structure-audit/jscpd-report.json` (regenerated in Task 1)
- Output: notes for Task 7

Per spec § 5.1 row "impact 4": "duplication block ≥ 100 tokens spanning 3+ files" automatically scores impact-4. We need to enumerate any such blocks; each is a top-5 candidate IF the dedup is cost-≤2.

- [ ] **Step 1: Filter jscpd report for ≥100-token blocks across 3+ files**

```bash
bun -e '
const r = await Bun.file("docs/structure-audit/jscpd-report.json").json();
const dups = r.duplicates ?? [];
// jscpd duplicates are pairs; group by content-hash to find N-way clones.
const byHash = new Map();
for (const d of dups) {
  const h = d.firstFile?.content ?? d.format + "_" + d.tokens;
  if (!byHash.has(h)) byHash.set(h, new Set());
  byHash.get(h).add(d.firstFile?.name);
  byHash.get(h).add(d.secondFile?.name);
}
const candidates = [];
for (const [h, files] of byHash.entries()) {
  if (files.size >= 3) candidates.push({ files: [...files], approxTokens: dups.find(d => (d.firstFile?.content ?? d.format + "_" + d.tokens) === h).tokens });
}
candidates.sort((a, b) => b.approxTokens - a.approxTokens);
for (const c of candidates.slice(0, 10)) console.log(c.approxTokens, c.files.join(", "));
'
```

(jscpd's JSON shape varies by version; if the bun-eval fails, read the file with the `Read` tool and adapt the filter logic. Goal: list any duplication block ≥100 tokens that appears in 3 or more distinct files.)

- [ ] **Step 2: For each candidate, classify cost**

For each ≥100-token / ≥3-file block:

1. Read the block content (jscpd's `firstFile.content` or by jumping to the line range in the source).
2. Decide if extracting a shared helper is:
   - **Cost 1** (under an hour: pure-function extraction into a shared module, no new types)
   - **Cost 2** (one-day: shared helper + 2–3 callers, minimal new tests)
   - **Cost ≥ 3** (refactor coupled to subsystem internals, needs new tests/types/migration) — auto-defer.

- [ ] **Step 3: Score**

For each cost-≤2 candidate:
- impact = 4 (the spec rule fires regardless of file location)
- cost = 1 or 2 (your assessment)
- score = 4 / 1 = 4.0 or 4 / 2 = 2.0 — top-5 eligible.
- Confidence: Medium (tool-detected but extraction shape requires judgement).

- [ ] **Step 4: Document**

Save the candidate list (file paths + approx token count + cost estimate) for Task 7. If 0 candidates, that's the result — D6 contributes nothing to top-5; the global 3.62 % goes into `missed.md` as a measurement-only row pointing at the workflow artifact.

---

## Task 5: Triage D7 — unused exports / orphan files

**Files:**
- Read-only: `docs/structure-audit/knip-report.json`
- Output: notes for Task 7

The knip-report has 234 files-with-findings and 400 raw findings post-Task-14 cleanup. Most are deferred (long-tail dead code). We're looking for:
- Orphan barrel `index.ts` files in non-public subsystems (Phase 1 surfaced 8: `gateway/src/{auth,extensions,index,perf,sync}/index.ts`, etc.)
- Clearly-dead helpers (single-export module, no callers, no tests)

- [ ] **Step 1: Pull the orphan-files list**

```bash
bun -e '
const r = await Bun.file("docs/structure-audit/knip-report.json").json();
const orphans = (r.issues ?? []).filter(i => Array.isArray(i.files) && i.files.length > 0).map(i => i.file);
console.log("orphan files:", orphans.length);
for (const f of orphans) console.log(" ", f);
'
```

(knip v6 emits `files: [{ name }]` for orphan modules. Adapt the filter shape if needed — read the JSON directly.)

- [ ] **Step 2: For each orphan, classify**

For each file:
1. **`packages/sdk/`, `packages/client/`, public surfaces** → impact 3 (public API), but knip should already have them as entries (Phase 1 corrigendum dca5c41 added the subpaths). If knip still flags one, likely a config gap; route to `deferred-backlog.md` as `Tune knip entry: <path>` (cost 1, low-priority).
2. **`packages/gateway/src/<subsystem>/index.ts` barrel** → impact 1 (internal helper), cost 1 (delete + remove import) if there are no consumers OR cost 2 if there are 1-3 consumers needing updates. Top-5 eligible if Bucket-A D11 didn't take a slot.
3. **Random one-off helper file** → check git blame / log; if untouched in >180 days and zero callers, cost-1 deletion. Otherwise leave for backlog.

- [ ] **Step 3: Pull the unused-exports-only list (not whole-file orphans)**

```bash
bun -e '
const r = await Bun.file("docs/structure-audit/knip-report.json").json();
const expHits = (r.issues ?? []).filter(i => Array.isArray(i.exports) && i.exports.length > 0);
console.log("files with unused exports:", expHits.length);
console.log("total unused exports:", expHits.reduce((s, i) => s + i.exports.length, 0));
'
```

- [ ] **Step 4: Bulk-bucket the unused-exports**

Don't enumerate 77 individually. Bucket by package:
- `gateway/src/perf/**` — likely "tooling-incomplete", auto-defer (`Refactor candidate: prune perf module barrel`).
- `ui/src/ipc/types.ts` and store slices — over-exported types; auto-defer (`Refactor candidate: prune UI ipc/store type re-exports`).
- Other — case-by-case.

- [ ] **Step 5: Score and select**

Each fix candidate gets:
- impact: 1 (helper) – 3 (public)
- cost: 1 (delete) – 2 (delete + caller updates)
- score: typically 1.0–3.0 → potentially eligible for top-5 if D10's 5 + any D6/D11 don't fill all slots.
- Confidence: Medium (knip false-positive risk).

Save the candidate list for Task 7.

---

## Task 6: Triage D4 — large files (auto-defer all)

**Files:**
- Read-only: `docs/structure-audit/file-loc.json`
- Output: notes for Task 8

Per spec § 5.2: refactoring an 800+ LOC file is multi-day (cost ≥ 3) by definition. **All 6 D4 violations auto-defer** to `deferred-backlog.md` with a `Refactor candidate: split <file>` note.

- [ ] **Step 1: List the 6 files**

```bash
bun -e '
const r = await Bun.file("docs/structure-audit/file-loc.json").json();
for (const e of r.filter(x => x.loc > 800)) console.log(e.loc, e.file);
'
```

Expected (from Phase 1 baseline):
- 1401 packages/gateway/src/connectors/lazy-mesh.ts
- 1239 packages/gateway/src/ipc/server.ts
- 1238 packages/cli/src/commands/connector.ts
- 1103 packages/gateway/src/ipc/connector-rpc-handlers.ts
- 987 packages/gateway/src/index/local-index.ts
- 886 packages/gateway/src/auth/pkce.ts

- [ ] **Step 2: For each, write a one-line refactor-candidate note for `deferred-backlog.md`**

Format:
- `lazy-mesh.ts (1401 LOC, p80 churn): Refactor candidate: split MCP-spawn-config from server-record state — own design spec.`
- `ipc/server.ts (1239 LOC, p80 churn=56): Refactor candidate: extract per-namespace handler registries — own design spec.`
- `cli/commands/connector.ts (1238 LOC): Refactor candidate: split per-subcommand modules under cli/commands/connector/ — own design spec.`
- `connector-rpc-handlers.ts (1103 LOC): Refactor candidate: split by namespace (ipc.connector.*) — own design spec.`
- `local-index.ts (987 LOC): Refactor candidate: extract write/read/migration concerns — own design spec.`
- `auth/pkce.ts (886 LOC): Refactor candidate: split by OAuth flow (Google/Microsoft/...) — own design spec.`

These notes are the deferred-backlog rows. No code change.

---

## Task 7: Write `docs/structure-audit/missed.md`

**Files:**
- Create: `docs/structure-audit/missed.md`

- [ ] **Step 1: Capture the current commit SHA for provenance**

```bash
git rev-parse HEAD
# Note the output for the "Generated at commit" header in missed.md.
```

(SHA at this point should be `f464f0e` — the merge commit of PR #135 — or whatever main is now.)

- [ ] **Step 2: Write the file with the structure below**

Create `docs/structure-audit/missed.md` with EXACTLY this template, substituting the bracketed values from Tasks 2–6:

```markdown
# B3 Structure Audit — Phase 2 Missed (ranked findings)

**Generated at commit:** `<SHA>`
**Date:** 2026-05-01
**Phase 2 of:** [`docs/superpowers/specs/2026-04-30-structure-audit-design.md`](../superpowers/specs/2026-04-30-structure-audit-design.md)
**Baseline reference:** [`docs/structure-audit/baseline.md`](./baseline.md)

This file ranks every threshold violation surfaced by the Phase 1 audit
infrastructure. Findings with `engineering_cost_estimate ≤ 2` are eligible
for the top 5 (per spec § 5.3); cost-≥3 findings auto-route to
[`deferred-backlog.md`](./deferred-backlog.md) with a `Refactor candidate`
note. The CI gate (`_structure.yml`) enforces only the High-confidence
binary rules (D1/D2/D3/D8/D10/D11) — judgement-heavy items do not gate.

## Top 5 fixes (cost ≤ 2)

Grouped into <N> fix plans:

1. **D10 — sync-connector spawn invariants (5 sites)**
   - Files: `aws-sync.ts:<N>`, `azure-sync.ts:<N>`, `gcp-sync.ts:<N>`, `kubernetes-sync.ts:<N>`, `filesystem-v2-sync.ts:<N>`
   - Impact: 5 (I1 non-negotiable wired wrong) · Cost: 1 each (one-line edit using existing `extensionProcessEnv()` helper) · Score: **5.0**
   - Confidence: High
   - Fix plan: [`docs/superpowers/plans/2026-05-01-structure-fixes-d10-sync-connector-spawn.md`](../superpowers/plans/2026-05-01-structure-fixes-d10-sync-connector-spawn.md)

<insert any additional top-5 entries from D11/D6/D7 triage here>

## Per-dimension findings (full list)

| # | Dim | Finding | Files | Impact | Cost | Score | Confidence | Disposition |
|---|---|---|---|---|---|---|---|---|
| 1 | D10 | spawn() not via extensionProcessEnv() | aws-sync.ts:<N>; azure-sync.ts:<N>; gcp-sync.ts:<N>; kubernetes-sync.ts:<N>; filesystem-v2-sync.ts:<N> | 5 | 1 | 5.0 | High | **Top 5 (plan #1)** |
| 2 | D11 | vault-key constructed outside allow-list | <bucket A: N FP sites; bucket B: N real sites; bucket C: N defer-sites> | 5 | <varies> | <varies> | Medium | <Top-5 if Bucket A regex-tweak qualifies; rest deferred> |
| 3 | D4 | Files > 800 raw LOC | lazy-mesh.ts (1401); ipc/server.ts (1239); cli/commands/connector.ts (1238); connector-rpc-handlers.ts (1103); local-index.ts (987); auth/pkce.ts (886) | 4 | 4 | 1.0 | High | Deferred — all cost≥3 |
| 4 | D6 | Duplication % per workspace | <enumerate any ≥100-token / ≥3-file blocks; the 3.62% global is a workflow-artifact measurement> | <2-4> | <varies> | <varies> | Medium | <Top-5 if any cost-≤2; else deferred> |
| 5 | D7 | Unused exports / orphan files | <234 files / 400 raw findings; orphan barrels enumerated in Task 5; bulk perf/ui buckets deferred> | <1-3> | <1-2> | <varies> | Medium | <Top-5 if any cost-≤2; else deferred> |
| 6 | D9 | Risky `as <Type>` casts | 399 sites; informational only | n/a | n/a | n/a | Low | Deferred — single backlog row "Type-safety debt" |
| 7 | D12 | db.run() outside db/write.ts | 94 sites — see [`db-run-census.json`](./db-run-census.json) | n/a | n/a | n/a | Low | Deferred — `Refactor candidate: typed dbRun migration` (S5-F4 in roadmap) |

## Pass-through dimensions (no findings)

- **D1** — forbidden cross-package imports: 0 violations.
- **D2** — circular imports within a workspace: 0 violations.
- **D3** — PAL leakage: 0 violations.
- **D8** — `any` count: 2 (locked baseline; CI gate enforces no regression).

## Pending dimensions

- **D5** — cognitive complexity > 15: pending; populated when Phase 2's first SonarCloud analysis run produces a clean cognitive-complexity dashboard. The current SonarCloud project (`asafgolombek_Nimbus`) has finding-level analysis already; the dashboard view is the source of truth.

## Provenance

- Phase 1 baseline: `docs/structure-audit/baseline.md` @ `a3f327be871c810ff7c86690bb059fa381d85a6e`
- Reports re-generated at: `<SHA>` (this commit)
- Audit scripts: `scripts/structure-audit/*.ts` @ `<SHA>`
- CI gate file: `.github/workflows/_structure.yml` @ `<SHA>`
```

- [ ] **Step 3: Substitute every `<…>` placeholder**

Use the data captured in Tasks 2–6:

- `<SHA>` → output of Step 1.
- D10 line numbers: from Task 2's per-file capture.
- D11 buckets: from Task 3's `/tmp/d11-buckets.txt`.
- D6 candidate enumeration: from Task 4's bun-eval.
- D7 buckets: from Task 5.

The committed `missed.md` MUST contain NO `<…>` placeholders. Verify with:

```bash
grep -n '<[A-Z_a-z]\+>' docs/structure-audit/missed.md
# Expected: empty.
```

- [ ] **Step 4: Decide top-5 grouping**

If Tasks 3/4/5 produced 0 cost-≤2 candidates outside D10 → `missed.md`'s "Top 5 fixes" section names ONLY the D10 group. The grouping is "1 fix plan, 5 files." Skip Task 13.

If Tasks 3/4/5 produced ≥1 cost-≤2 candidate → name it as the second top-5 entry. Cap at 5 total findings across all entries (per § 1's stop rule). The grouping is "2 fix plans" — Task 13 writes the second.

If the second group has multiple cross-subsystem findings, group by subsystem; one fix plan per subsystem.

- [ ] **Step 5: Smoke-validate the markdown**

Open `missed.md` in a markdown previewer (or `bunx markdown-toc` if available) and visually scan:
- Header has SHA / Date / spec link
- Top-5 section has at least 1 entry
- Per-dimension table is complete (rows D10, D11, D4, D6, D7, D9, D12 all present)
- "Pass-through" mentions D1, D2, D3, D8
- "Pending" mentions D5
- No `<…>` placeholders.

- [ ] **Step 6: Commit (alone — `deferred-backlog.md` is Task 8's commit)**

```bash
git add docs/structure-audit/missed.md
git commit -m "$(cat <<'EOF'
docs(structure-audit): add Phase 2 missed.md (ranked findings)

Ranks every dimension with findings (D4/D6/D7/D9/D10/D11/D12) per
the impact/cost rubric in design spec § 5. Names the top-5 fix
candidates explicitly; cost-≥3 findings auto-route to the
deferred-backlog (Task 8 of this plan).

D1/D2/D3/D8 pass clean (0 violations / locked baseline). D5 pending
the first SonarCloud cognitive-complexity dashboard.

Refs: docs/superpowers/specs/2026-04-30-structure-audit-design.md § 5, § 7.2
EOF
)"
```

---

## Task 8: Write `docs/structure-audit/deferred-backlog.md`

**Files:**
- Create: `docs/structure-audit/deferred-backlog.md`

- [ ] **Step 1: Aggregate every cost-≥3 finding plus misses 6–N**

Pull together:
- All 6 D4 large-file `Refactor candidate: split <file>` notes from Task 6.
- All Bucket-C D11 sites from Task 3 (cost-≥3 vault-key centralization candidates).
- All D6 candidates with cost ≥3 from Task 4.
- D9 single row "Type-safety debt" pointing at `risky-assertions.json`.
- D12 single row pointing at `db-run-census.json` and the S5-F4 roadmap entry.
- The bulk D7 buckets from Task 5 Step 4 (gateway/perf/**, ui/ipc/store, etc.).

- [ ] **Step 2: Write the file**

Create `docs/structure-audit/deferred-backlog.md`:

```markdown
# B3 Structure Audit — Phase 2 Deferred Backlog

**Generated at commit:** `<SHA>`
**Date:** 2026-05-01
**Companion:** [`missed.md`](./missed.md) (ranked findings; top-5 fix plans)

This file collects every audit finding that did NOT make the top-5 cut —
either because its `engineering_cost_estimate` is ≥ 3 (auto-deferred per
spec § 5.3) or because it was lower-priority than the 5 chosen fixes. Each
entry carries a `Confidence` field (mirrors B1/B2) and a one-line "why
deferred" reason.

The user picks which deferred entries (if any) get promoted into a
`2026-??-??-refactor-<name>-design.md` follow-up; B3 itself does not write
those specs eagerly.

## D4 — large files (split candidates)

All cost ≥ 3 (multi-day refactor each). Each row is a single `Refactor
candidate` requiring its own design spec.

| File | LOC | Churn (90d) | Why deferred | Confidence |
|---|---|---|---|---|
| `packages/gateway/src/connectors/lazy-mesh.ts` | 1401 | <churn> | Refactor candidate: split MCP-spawn-config from server-record state — own design spec | High |
| `packages/gateway/src/ipc/server.ts` | 1239 | 56 | Refactor candidate: extract per-namespace handler registries — own design spec | High |
| `packages/cli/src/commands/connector.ts` | 1238 | <churn> | Refactor candidate: split per-subcommand modules under `cli/commands/connector/` — own design spec | High |
| `packages/gateway/src/ipc/connector-rpc-handlers.ts` | 1103 | <churn> | Refactor candidate: split by namespace (`ipc.connector.*`) — own design spec | High |
| `packages/gateway/src/index/local-index.ts` | 987 | 45 | Refactor candidate: extract write/read/migration concerns — own design spec | High |
| `packages/gateway/src/auth/pkce.ts` | 886 | <churn> | Refactor candidate: split by OAuth flow (Google/Microsoft/...) — own design spec | High |

## D11 — vault-key centralization (Bucket C)

Sites in hot-path files where the fix shape is "route through `connector-vault.ts` helpers" requiring multi-file coordinated change. Cost ≥ 3.

| File / region | Site count | Why deferred | Confidence |
|---|---|---|---|
| <enumerate from Task 3 Bucket C> | <N> | Refactor candidate: route <subsystem> vault keys through connector-vault helpers | Medium |

## D6 — duplication blocks (cost-≥3 candidates)

| Block | Files | Tokens | Why deferred | Confidence |
|---|---|---|---|---|
| <enumerate from Task 4 — only blocks where extraction is cost ≥ 3> | <N files> | <N> | Refactor candidate: extract <shape>; needs <reason it's >2 days> | Medium |

(If Task 4 produced no cost-≥3 candidates, drop this section.)

## D7 — unused exports / orphan files (long tail)

Bulk buckets — each is a multi-file cleanup project worth its own focus session, not gated.

| Bucket | Approx count | Why deferred | Confidence |
|---|---|---|---|
| `packages/gateway/src/perf/**` unused exports | <N> | Refactor candidate: prune perf module barrel after the bench harness stabilises | Medium |
| `packages/ui/src/{ipc/types,store/slices/*}` over-exported types | <N> | Refactor candidate: tighten UI ipc/store public surface | Medium |
| Other | <N> | One-off dead code; clean up opportunistically when touching the file | Low |

## D9 — risky type assertions

Single rolled-up entry. The script's output is the long list.

| Description | Sites | Why deferred | Confidence |
|---|---|---|---|
| Type-safety debt: `as <Type>` casts outside tests, excluding `as const` / `as unknown` | 399 | Refactor candidate: type-safety hardening is its own sub-project — would need a heuristic ranking (e.g., `as unknown as T` worse than `as BaseType`) the B3 spec deliberately avoids (§ 3.3 D9). | Low |

## D12 — `db.run()` outside `db/write.ts`

Single rolled-up entry. The 94 sites are the precursor census for the
typed-`dbRun` migration already on the roadmap as **S5-F4**. B3 does
not execute the migration; the census drives the future design spec.

| Description | Sites | Why deferred | Confidence |
|---|---|---|---|
| Untyped `db.run()` calls outside the central wrapper | 94 — see [`db-run-census.json`](./db-run-census.json) | Refactor candidate: S5-F4 typed dbRun migration (existing roadmap row) | High |

## D7 / D11 misses 6–N (long-tail, low priority)

Single-export modules, single-call-site allow-list expansions, etc. Not worth a fix plan; clean up opportunistically.

| Source | Count | Why deferred | Confidence |
|---|---|---|---|
| <enumerate from Task 3 Bucket A/B residue + Task 5> | <N> | Low impact, cost-1 each but no aggregation benefit | Low |
```

- [ ] **Step 3: Fill in every `<…>` placeholder**

Substitute counts and file paths from Tasks 2-6.

```bash
grep -n '<[A-Z_a-z]\+>' docs/structure-audit/deferred-backlog.md
# Expected: empty.
```

- [ ] **Step 4: Commit `deferred-backlog.md` + the regenerated provenance reports**

The four regenerated reports from Task 1 are committed alongside `deferred-backlog.md` because they're the data `missed.md` and `deferred-backlog.md` reference:

```bash
git add docs/structure-audit/deferred-backlog.md docs/structure-audit/jscpd-report.json docs/structure-audit/file-loc.json docs/structure-audit/risky-assertions.json
# knip-report.json was already committed in Phase 1 Task 14 — only stage if it was modified materially:
if ! git diff --quiet docs/structure-audit/knip-report.json 2>/dev/null; then
  git add docs/structure-audit/knip-report.json
fi
git commit -m "$(cat <<'EOF'
docs(structure-audit): add deferred-backlog.md + commit provenance reports

deferred-backlog.md collects every cost-≥3 finding (auto-deferred per
spec § 5.3) and the long tail beyond top-5: D4 large-file refactor
candidates, Bucket-C D11 centralization candidates, D7 bulk buckets,
D9 type-safety-debt, D12 typed-dbRun migration precursor.

Also commits the regenerated jscpd-report.json, file-loc.json, and
risky-assertions.json for Phase 2 reproducibility (per spec § 7.2).

Refs: docs/superpowers/specs/2026-04-30-structure-audit-design.md § 5.3, § 7.2
EOF
)"
```

---

## Task 9: Write the CI gate workflow `.github/workflows/_structure.yml`

**Files:**
- Create: `.github/workflows/_structure.yml`

The gate is committed but NOT yet wired into `pr-quality.yml` — it would currently fail (5 D10 + 56 D11). Phase 3's last fix PR adds the wiring.

- [ ] **Step 1: Read sibling reusable workflows for the project's house style**

Read `.github/workflows/_test-suite.yml` (and `_perf.yml` if present) to confirm:
- Reusable-workflow shape (`on: workflow_call`)
- `bun install --frozen-lockfile` invocation pattern
- The runner image (`ubuntu-24.04`)
- The `bun-version` and how Bun is set up
- Step-level annotation conventions (`::error::` etc.)

Don't copy lock-step — match style only.

- [ ] **Step 2: Write the workflow**

Create `.github/workflows/_structure.yml`:

```yaml
name: Structure audit

on:
  workflow_call:
    inputs:
      ref:
        description: "Git ref to check out"
        required: false
        type: string
        default: ""

permissions:
  contents: read

jobs:
  structure:
    name: structure
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          ref: ${{ inputs.ref }}

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies (frozen)
        run: bun install --frozen-lockfile

      - name: D1/D2/D3 — boundaries (dependency-cruiser)
        run: bun run audit:boundaries

      - name: D8 — any-count (manual ratchet)
        run: bun scripts/structure-audit/count-any-usage.ts --check

      - name: D10/D11 — Nimbus invariants (binary)
        run: bun run audit:invariants
```

- [ ] **Step 3: Smoke-test locally**

Run each step the workflow runs:

```bash
bun install --frozen-lockfile
echo "exit=$?"
# Expected: 0 (lockfile is in sync)

bun run audit:boundaries
echo "exit=$?"
# Expected: 0 (D1/D2/D3 clean)

bun scripts/structure-audit/count-any-usage.ts --check
echo "exit=$?"
# Expected: 0 (count=2 matches baseline)

bun run audit:invariants
echo "exit=$?"
# Expected: 1 (current state — 5 D10 + 56 D11). DOCUMENT this; the workflow file is shipped knowing it won't pass on main until Phase 3 fixes land.
```

- [ ] **Step 4: Confirm the workflow is NOT wired into pr-quality.yml yet**

```bash
grep -n "_structure\.yml\|structure:" .github/workflows/pr-quality.yml || echo "not wired (expected)"
```

If it IS wired (someone touched `pr-quality.yml` since Phase 1 close), STOP and report — that means a wiring-PR happened out-of-band; this plan needs adjustment.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/_structure.yml
git commit -m "$(cat <<'EOF'
ci(structure-audit): add reusable _structure.yml workflow

Fast PR check (≤30 s budget) calling the binary subset of audit:*:
audit:boundaries (D1/D2/D3) + count-any-usage --check (D8) +
audit:invariants (D10/D11). Ubuntu-only — static analysis has zero
OS variance; the platform-equality non-negotiable is a runtime
property (spec § 6.1).

NOT YET wired into pr-quality.yml because the current main has 5 D10
+ 56 D11 violations (Phase 2 missed.md, top-5 fix candidates). The
LAST top-5 fix PR (Phase 3) wires this workflow into pr-quality.yml
once D10/D11 are clean.

Refs: docs/superpowers/specs/2026-04-30-structure-audit-design.md § 6, § 7.2
EOF
)"
```

---

## Task 10: Write top-5 fix plan #1 — D10 sync-connector spawn

**Files:**
- Create: `docs/superpowers/plans/2026-05-01-structure-fixes-d10-sync-connector-spawn.md`

This is a **plan document for Phase 3**, not Phase 2 execution. The plan describes the work; the actual fix PR is opened off `main` after this Phase 2 plan merges.

- [ ] **Step 1: Write the plan**

Create the file with this content (substituting line numbers from Task 2's per-file capture):

```markdown
# Structure-Audit Top-5 Fix #1 — D10 Sync-Connector Spawn Invariants

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to land this fix as a single PR off `main`.

**Goal:** Fix all 5 D10 violations surfaced by the Phase 1/2 audit. Each violation is a `Bun.spawn(...)` call under `packages/gateway/src/connectors/` that constructs the child process's environment from `{ ...process.env, ... }` instead of routing through `extensionProcessEnv()` — a regression of security invariant **I1** (`docs/SECURITY-INVARIANTS.md`).

**Architecture:** Each of the 5 connectors has a small per-file env-builder pattern. The fix is one of two shapes per file (Bucket A / B in the Phase 2 missed.md). Most are Bucket A: replace `{ ...process.env, X: y }` with `{ ...extensionProcessEnv(), X: y }`. Where the connector requires specific opt-in inheritance (e.g., `KUBECONFIG`), preserve those keys via an explicit pass-through.

**Tech Stack:** Existing `extensionProcessEnv()` helper at `packages/gateway/src/connectors/extension-process-env.ts`; existing connector patterns in `lazy-mesh.ts` for reference. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-30-structure-audit-design.md` § 6.2 (D10 gate); `CLAUDE.md` Security Invariants table I1.

**Branch:** `dev/asafgolombek/structure-fixes-d10-sync-connector-spawn` (off `main`).

---

## Task 1: Setup

- [ ] **Step 1: Create the branch**

```bash
git checkout main
git pull origin main --quiet
git checkout -b dev/asafgolombek/structure-fixes-d10-sync-connector-spawn
```

- [ ] **Step 2: Verify the violation set hasn't changed**

```bash
bun run audit:invariants 2>&1 | grep "D10 spawn"
```

Expected: 5 lines matching the same files as the Phase 2 missed.md row (`aws-sync.ts`, `azure-sync.ts`, `gcp-sync.ts`, `kubernetes-sync.ts`, `filesystem-v2-sync.ts`).

If any file's violation has moved, fixed, or new violations appeared, STOP and update missed.md before proceeding.

---

## Task 2-6: Fix each connector (TDD, one file at a time)

For each of the 5 files, follow this pattern:

**Files (per task):**
- Modify: `packages/gateway/src/connectors/<name>-sync.ts:<line>`
- Verify: existing test for the connector (run before/after; must stay green)

- [ ] **Step 1: Read the violating spawn block (the line + 5 lines context)**

Use the `Read` tool. Identify the env-construction pattern.

- [ ] **Step 2: Run audit:invariants to confirm the violation**

```bash
bun run scripts/structure-audit/check-nimbus-invariants.ts --rule spawn 2>&1 | grep "<filename>"
# Expected: 1 line for THIS file.
```

- [ ] **Step 3: Apply the fix**

Replace `{ ...process.env, K: v, ... }` with `{ ...extensionProcessEnv(), K: v, ... }`. If `extensionProcessEnv` is not yet imported, add the import:

```ts
import { extensionProcessEnv } from "./extension-process-env.ts";
```

- [ ] **Step 4: Re-run audit:invariants**

```bash
bun run scripts/structure-audit/check-nimbus-invariants.ts --rule spawn 2>&1 | grep "<filename>"
# Expected: empty (this violation now cleared).
```

- [ ] **Step 5: Run the connector's test (if any)**

```bash
bun test packages/gateway/src/connectors/<name>-sync.test.ts 2>&1 | tail -3
# Expected: all tests pass.
```

If there's no test file for this sync connector, skip — but flag the absence for a follow-up "add test for <name>-sync" issue.

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/connectors/<name>-sync.ts
git commit -m "fix(connectors): route <name>-sync child env through extensionProcessEnv (I1)"
```

Repeat Tasks 2–6 for: aws, azure, gcp, kubernetes, filesystem-v2.

---

## Task 7: Final verification

- [ ] **Step 1: Audit all D10 fixed**

```bash
bun run audit:invariants 2>&1 | grep -c "D10 spawn"
# Expected: 0
```

- [ ] **Step 2: Run the full structure-audit gate locally**

```bash
bun run audit:boundaries
bun scripts/structure-audit/count-any-usage.ts --check
bun run audit:invariants
# All three should exit 0 (D11 still has 56 sites — ignore for this plan; D11 fix is its own future PR if it makes top-5).
```

Expected after this PR's 5 fixes: 0 D10 violations, 56 D11 still present (D11 cleanup is a separate top-5 candidate, if Phase 2 produced one). `audit:invariants` will still exit 1 until D11 is clean too — that's fine for THIS PR's scope.

**Wiring rule:** This PR DOES NOT modify `pr-quality.yml`. The wiring of `_structure.yml` into `pr-quality.yml` is reserved for the LAST top-5 fix PR — i.e., the PR that brings `audit:invariants` to exit 0. If THIS PR is the last (no D11 fix plan exists, or its PR has already landed), proceed to Step 3 below to add the wiring. Otherwise skip to Step 4.

- [ ] **Step 3: Wire `_structure.yml` into `pr-quality.yml` (only if last top-5 fix)**

Edit `.github/workflows/pr-quality.yml`. Add a job that calls the reusable workflow:

```yaml
  structure:
    name: PR quality — Structure
    uses: ./.github/workflows/_structure.yml
```

Confirm `bun run audit:invariants` exits 0. If yes, commit:

```bash
git add .github/workflows/pr-quality.yml
git commit -m "ci(pr-quality): wire _structure.yml gate (Phase 3 close — all top-5 fixes landed)"
```

If `audit:invariants` exits non-zero, STOP — there are remaining top-5 fixes to ship before this wiring lands.

- [ ] **Step 4: Run the project's CI-parity suite**

```bash
bun run test:ci
# Expected: 0 (modulo the pre-existing platform.test.ts Windows EBUSY flake on Windows hosts; non-Windows hosts should be clean).
```

- [ ] **Step 5: Open the PR**

```bash
gh pr create --title "fix(connectors): route sync-connector spawns through extensionProcessEnv (D10 / I1)" --body "<body>"
```

PR body explains the I1 regression, the 5 fixes, the audit:invariants delta (5→0), and (if applicable) the `_structure.yml` wiring step.

---

## Definition of Done

- [ ] All 5 D10 violations fixed (verified by `audit:invariants 2>&1 | grep -c 'D10 spawn'` returning 0).
- [ ] All Gateway connector tests pass.
- [ ] `bun run test:ci` passes (modulo pre-existing flakes documented in B3 PR #135).
- [ ] PR opened against `main`.
- [ ] If this is the last top-5 fix PR: `_structure.yml` is wired into `pr-quality.yml` in the same PR.
```

- [ ] **Step 2: Commit the fix plan**

```bash
git add docs/superpowers/plans/2026-05-01-structure-fixes-d10-sync-connector-spawn.md
git commit -m "$(cat <<'EOF'
docs(structure-audit): add top-5 fix plan #1 — D10 sync-connector spawn

Plan-only commit (Phase 3 work, executed off main as a separate PR).
The 5 violations are 1-line edits using existing extensionProcessEnv()
helper; total cost ~30 minutes per file + tests.

Closes one of the top-5 entries in Phase 2 missed.md.

Refs: docs/structure-audit/missed.md
Refs: docs/superpowers/specs/2026-04-30-structure-audit-design.md § 5, § 7.2
EOF
)"
```

---

## Task 11: Write top-5 fix plan #2 (conditional)

**Files:**
- Create (only if Task 7 produced ≥1 cost-≤2 candidate outside D10): `docs/superpowers/plans/2026-05-01-structure-fixes-<group>.md`

If Task 7's `missed.md` "Top 5 fixes" section names ONLY the D10 group, **skip this task entirely** and proceed to Task 12.

If `missed.md` names a second group (most likely a D11 Bucket-A regex tweak, OR a D7 orphan-files cleanup), write its fix plan now.

- [ ] **Step 1: Determine the group's shape**

Re-read Task 7's `missed.md` "Top 5 fixes" section #2. The shape will be one of:

- **D11 Bucket-A regex tweak** — single file change to `scripts/structure-audit/check-nimbus-invariants.ts`'s `VAULT_KEY_RE` (or the per-call-site context check). Fix plan is short: TDD a new test case for the FP context, tighten the regex.
- **D7 orphan-files cleanup** — N file deletions + import updates. Fix plan is per-file: delete + verify no breakage.
- **Other** — adapt the template.

- [ ] **Step 2: Write the plan**

Use the structure of Task 10's plan (Setup → per-finding tasks → final verification → DoD) but scoped to the specific fixes. Each task block follows the same TDD/commit pattern.

Save to `docs/superpowers/plans/2026-05-01-structure-fixes-<group>.md` (concrete name based on group: e.g., `2026-05-01-structure-fixes-d11-vault-key-fp-regex.md` or `2026-05-01-structure-fixes-d7-orphan-barrels.md`).

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-05-01-structure-fixes-<group>.md
git commit -m "$(cat <<'EOF'
docs(structure-audit): add top-5 fix plan #2 — <group description>

Plan-only commit (Phase 3 work, executed off main as a separate PR).

Refs: docs/structure-audit/missed.md
Refs: docs/superpowers/specs/2026-04-30-structure-audit-design.md § 5, § 7.2
EOF
)"
```

---

## Task 12: Update CLAUDE.md / GEMINI.md cross-references (spec § 7.4)

**Files:**
- Modify: `CLAUDE.md`
- Modify: `GEMINI.md`

Spec § 7.4 calls for:
- A row under Commands referencing `_structure.yml` (the workflow file). The `audit:*` commands are already documented (Phase 1).
- A one-liner under Security Invariants linking I1/I9/I10's static-time complement to `check-nimbus-invariants.ts`.

- [ ] **Step 1: Update the status line in both files**

Append `· B3 Phase 2 ✅` to the Phase 4 progress list:

```diff
- · B3 Phase 1 ✅
+ · B3 Phase 1 ✅ · B3 Phase 2 ✅
```

- [ ] **Step 2: Add the structure-yml row under Commands**

In both files' B3 commands block, add a line at the bottom of the existing "Phase 4 B3" section:

```diff
 # Baselines: docs/structure-audit/{any-baseline.json,db-run-census.json,churn-90d.json,baseline.md}
+# CI gate (reusable workflow): .github/workflows/_structure.yml — wired into pr-quality.yml after Phase 3 top-5 fixes land
```

- [ ] **Step 3: Add the security-invariant cross-reference**

In both files' Security Invariants section, append a paragraph after the table:

```markdown
**Static-time complement:** Phase 1 of the B3 structure audit added
`scripts/structure-audit/check-nimbus-invariants.ts` which enforces I1
(`spawn` under `connectors/` must use `extensionProcessEnv()`) and the
vault-key allow-list at static time. The runtime tests in
`packages/gateway/src/security-invariants.test.ts` remain authoritative
for invariant wiring; the static checks catch regressions before the test
runs. See `docs/structure-audit/baseline.md` for current findings.
```

(Verify the paragraph reads well in both files; the wording should be identical.)

- [ ] **Step 4: Verify both files agree**

```bash
diff <(grep -A2 "Static-time complement" CLAUDE.md) <(grep -A2 "Static-time complement" GEMINI.md)
# Expected: empty (identical)
```

- [ ] **Step 5: Update `docs/structure-audit/sonarqube-rule-tuning.md` with the Phase 2 outcome**

Spec § 4.1 says the file is populated only if Phase 2's first SonarCloud analysis run requires explicit rule disables. Even when no rules are disabled, recording the verification outcome closes the loop and replaces the empty placeholder.

Open `docs/structure-audit/sonarqube-rule-tuning.md`. After the introductory paragraph, add a section:

```markdown
## Phase 2 verification

**Date:** 2026-05-01
**SonarCloud project:** `asafgolombek_Nimbus`
**Profile in use:** Sonar Way (default)

Reviewed the SonarCloud findings produced against PR #135 (Phase 1 close).
Findings were Issues, not rule-disable candidates — the rule profile is
producing actionable signal at acceptable noise levels for this codebase.

**Outcome:** No rules disabled. Sonar Way profile retained as-is for B3.

Re-evaluate at B3 close (Phase 3) — if the top-5 fix work surfaces
new noise patterns, populate the disable table below.

| Rule | Reason | Date | Where |
|---|---|---|---|
| _none_ | Sonar Way verified clean for B3 scope | 2026-05-01 | `sonar-project.properties` |
```

If you DO find that Phase 2's analysis required rule disables (e.g., a SonarCloud rule produces hundreds of false positives on the codebase), add concrete rows to the table with rule keys + reasons + the disable location.

- [ ] **Step 6: Stage all three doc files**

```bash
git add CLAUDE.md GEMINI.md docs/structure-audit/sonarqube-rule-tuning.md
```

- [ ] **Step 7: Commit**

```bash
git commit -m "$(cat <<'EOF'
docs: cross-reference B3 Phase 2 in CLAUDE.md / GEMINI.md + record SonarCloud outcome

Three mirrored updates per the alignment rule + one Phase 2 close-out:

1. Status line — append `B3 Phase 2 ✅` to the Phase 4 progress list.
2. Commands section — note _structure.yml wiring deferred to Phase 3.
3. Security Invariants — paragraph linking I1/I9/I10 static-time
   complement at scripts/structure-audit/check-nimbus-invariants.ts.
4. sonarqube-rule-tuning.md — record Phase 2 verification outcome
   (Sonar Way profile retained; no rules disabled).

Refs: docs/superpowers/specs/2026-04-30-structure-audit-design.md § 4.1, § 7.4
EOF
)"
```

---

## Task 13: Final verification

- [ ] **Step 1: Verify all Phase 2 deliverables exist**

```bash
ls docs/structure-audit/missed.md docs/structure-audit/deferred-backlog.md docs/structure-audit/file-loc.json docs/structure-audit/jscpd-report.json docs/structure-audit/risky-assertions.json
ls .github/workflows/_structure.yml
ls docs/superpowers/plans/2026-05-01-structure-fixes-*.md | head -5
```

Expected: every file lists clean (no "No such file or directory").

- [ ] **Step 2: Run all gates**

```bash
bun run typecheck
echo "typecheck exit=$?"

bun run lint
echo "lint exit=$?"

bun test scripts/structure-audit/
echo "scripts test exit=$?"

bun run audit:boundaries
echo "boundaries exit=$?"

bun scripts/structure-audit/count-any-usage.ts --check
echo "any-check exit=$?"

bun run audit:invariants
echo "invariants exit=$?"
```

Expected:
- typecheck=0, lint=0, scripts test=0
- audit:boundaries=0
- count-any-usage --check=0
- audit:invariants=1 (5 D10 + 56 D11 still present — Phase 3 fixes them)

- [ ] **Step 3: Run the project's CI-parity suite**

```bash
bun run test:ci
echo "test:ci exit=$?"
```

Expected: 0 (modulo the pre-existing platform.test.ts Windows EBUSY flake; non-Windows hosts pass clean).

- [ ] **Step 4: Verify branch state**

```bash
git status
# Expected: clean working tree.

git log --oneline main..HEAD
# Expected: ~7-8 commits (Tasks 7, 8, 9, 10, [11], 12).
```

- [ ] **Step 5: Push and open PR**

```bash
git push -u origin dev/asafgolombek/structure-audit-phase-2

gh pr create --title "B3 structure audit Phase 2 — missed.md, deferred-backlog, CI gate, fix plans" --body "$(cat <<'EOF'
## Summary

- Adds `docs/structure-audit/missed.md` (ranked findings; top-5 fix candidates explicitly named) and `docs/structure-audit/deferred-backlog.md` (cost-≥3 findings + long tail) per design spec § 7.2.
- Commits `jscpd-report.json`, `file-loc.json`, `risky-assertions.json` for Phase 2 reproducibility.
- Adds `.github/workflows/_structure.yml` — fast (≤30 s) Ubuntu-only reusable CI gate calling `audit:boundaries` + `count-any-usage --check` + `audit:invariants`. NOT yet wired into `pr-quality.yml` because the current main has 5 D10 + 56 D11 violations; the LAST Phase 3 fix PR adds the wiring.
- Adds top-5 fix plans under `docs/superpowers/plans/2026-05-01-structure-fixes-*.md` (Phase 3 work).
- Updates `CLAUDE.md` / `GEMINI.md` with the structure.yml command row and the I1/I9/I10 static-complement cross-reference.

## What's NOT in this PR

- The actual top-5 fix code (Phase 3, separate PRs).
- `_structure.yml` wiring into `pr-quality.yml` (last Phase 3 PR).
- `docs/structure-audit/results.md` (B3 close, after Phase 3).

## Test plan

- [ ] Reviewer reads `docs/structure-audit/missed.md` and confirms the top-5 selection looks right.
- [ ] Reviewer reads each top-5 fix plan and confirms scope.
- [ ] `bun run audit:boundaries` exits 0.
- [ ] `bun scripts/structure-audit/count-any-usage.ts --check` exits 0.
- [ ] `bun run audit:invariants` exits 1 (expected; Phase 3 closes).
- [ ] `bun test scripts/structure-audit/` passes (33 tests).
- [ ] `bun run typecheck` and `bun run lint` exit 0.
- [ ] On a non-Windows host, `bun run test:ci` exits 0.
- [ ] `.github/workflows/_structure.yml` is NOT referenced in `pr-quality.yml`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Phase 2 Definition of Done

- [ ] All 13 tasks above are checked off.
- [ ] `docs/structure-audit/missed.md` exists; top-5 explicitly named; no `<…>` placeholders.
- [ ] `docs/structure-audit/deferred-backlog.md` exists; covers D4 (6), D9 (1), D12 (1), D11 Bucket-C, D7 bulk buckets; no placeholders.
- [ ] `.github/workflows/_structure.yml` committed; `pr-quality.yml` NOT modified.
- [ ] At least one top-5 fix plan exists at `docs/superpowers/plans/2026-05-01-structure-fixes-*.md`.
- [ ] `CLAUDE.md` / `GEMINI.md` agree on the new B3 Phase 2 ✅ status, structure.yml row, and security-invariant cross-reference.
- [ ] PR opened with the test-plan checklist.

After Phase 2 lands, **Phase 3** is the user-led execution of the top-5 fix plans (one PR per plan; the last PR also wires `_structure.yml` into `pr-quality.yml`). B3 closes when the last fix PR merges; `docs/structure-audit/results.md` is the surviving record per spec § 7.3.
