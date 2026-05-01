# Structure-Audit Top-5 Fix #3 — D7 Bucket A Orphan File Deletion

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to land this fix as a single PR off `main`.

**Goal:** Delete **6 orphan files** flagged by knip (D7 — unused-file gate) and confirmed zero-importer by Phase 2 triage. Total ~114 lines of code removed; **zero caller updates needed**. After this fix, the knip orphan count drops by 6.

**Confidence:** HIGH. Each of the 6 files was verified zero-importer by Grep across the entire repo during Phase 2 triage (no `import` statement, no `require`, no dynamic loader resolves to any of them). The files are: 4 unused barrel `index.ts` re-exports, one CLI helper that defines but never invokes `getRepoRoot()`, and one React component with zero callers and no test references. Each deletion is mechanical (`git rm`); the only risk is a knip false-positive, which `bun run typecheck` will surface immediately. Cost: 6 `git rm` operations + 6 typecheck runs. Impact: removes ~114 LoC of dead code and 6 entries from the knip orphan report.

**Architecture:** Per-file deletion with **one commit per file**. After each deletion, run `bun run typecheck`:

- If typecheck passes: the file is genuinely unused — commit and proceed.
- If typecheck fails: the file is a knip false-positive (knip missed an importer). Restore the file (`git restore <path>`) and document in the PR body. Do NOT skip typecheck-failures with a hand-wave — they are the entire point of running typecheck after each delete.

The per-file commit cadence is deliberate: a single commit per delete makes a knip FP surgically revertable without losing the other 5 successful deletions.

**The 6 files (verified Phase 2 triage):**

| # | File | LoC | Symbols re-exported / defined | Reason for deletion |
|---|---|---|---|---|
| 1 | `packages/gateway/src/auth/index.ts` | 13 | 8 re-exports (auth helpers) | Orphan barrel; zero importers (downstream code imports from the source modules directly). |
| 2 | `packages/gateway/src/extensions/index.ts` | 23 | 6 re-exports | Orphan barrel; zero importers. |
| 3 | `packages/gateway/src/index/index.ts` | 14 | 4 re-exports | Orphan barrel; zero importers. |
| 4 | `packages/gateway/src/sync/index.ts` | 19 | 8 re-exports | Orphan barrel; zero importers. |
| 5 | `packages/cli/src/lib/repo-root.ts` | 23 | `getRepoRoot()` defined but never called | `resolveGatewayLaunch` is the actually-used function and lives elsewhere; `getRepoRoot()` is dead. |
| 6 | `packages/ui/src/components/Skeleton.tsx` | 22 | One React component | Zero JSX callers, no test references. |

**Total LoC removed:** ~114.

**Tech Stack:** Standard `git rm`. No new dependencies, no code edits beyond deletion.

**Spec:** `docs/superpowers/specs/2026-04-30-structure-audit-design.md` § 5, § 7.2 (knip gate); `docs/structure-audit/missed.md` (top-5 entry #3 — D7 Bucket A).

**Branch:** `dev/asafgolombek/structure-fixes-d7-orphan-deletion` (off `main`).

**Important constraints:**

- **One file deleted per commit.** Six commits, in any order. This is non-negotiable: if a knip FP surfaces (typecheck fails), the per-file commit boundary is the unit of revert. Batched commits muddy the revert.
- **Typecheck after EVERY delete.** If `bun run typecheck` fails, restore the file IMMEDIATELY (`git restore <path>` or `git checkout HEAD -- <path>` if pre-commit). Do NOT proceed to the next file until the working tree is clean.
- **No code edits.** This PR is pure deletion. If a delete reveals an importer (typecheck failure), the importer's code change belongs to a follow-up PR with its own design discussion (probably "remove this importer" or "inline the symbol that was imported"). This PR's scope is strictly `git rm` of confirmed orphans.

---

## Task 1: Setup

- [ ] **Step 1: Create the branch off `main`**

```bash
git checkout main
git pull origin main --quiet
git checkout -b dev/asafgolombek/structure-fixes-d7-orphan-deletion
```

- [ ] **Step 2: Verify all 6 files exist**

```bash
ls -la \
  packages/gateway/src/auth/index.ts \
  packages/gateway/src/extensions/index.ts \
  packages/gateway/src/index/index.ts \
  packages/gateway/src/sync/index.ts \
  packages/cli/src/lib/repo-root.ts \
  packages/ui/src/components/Skeleton.tsx
```

All 6 must exist. If any is missing, it has been deleted upstream — STOP and update the triage table in `docs/structure-audit/missed.md`.

- [ ] **Step 3: Verify the baseline knip orphan count**

```bash
bunx knip --reporter json > /tmp/knip-baseline.json
bun -e 'const r = JSON.parse(await Bun.file("/tmp/knip-baseline.json").text()); console.log("orphan files:", r.files.length);'
```

Note the baseline orphan count. After all 6 deletions, the count should drop by exactly 6 (verified in Task 8).

---

## Task 2: Delete `packages/gateway/src/auth/index.ts`

- [ ] **Step 1: Confirm zero importers**

```bash
bun run scripts/grep-importers.sh packages/gateway/src/auth/index.ts 2>/dev/null || \
  rg -n "from ['\"].*auth/index['\"]|from ['\"].*auth['\"]" packages/ --type ts 2>&1 | head -20
```

(If `scripts/grep-importers.sh` does not exist, fall back to a Grep tool search for `from ".*auth/index"` and `from ".*auth"` across `packages/`. The latter may match real imports of sibling modules — manually verify none of them resolve to `auth/index.ts` specifically. The Phase 2 triage already confirmed zero — this step is a defense-in-depth re-check at delete-time.)

- [ ] **Step 2: Delete and typecheck**

```bash
git rm packages/gateway/src/auth/index.ts
bun run typecheck 2>&1 | tail -5
```

- If typecheck passes: proceed to Step 3.
- If typecheck fails: this is a knip FP. Run `git restore --staged packages/gateway/src/auth/index.ts && git checkout HEAD -- packages/gateway/src/auth/index.ts` to restore. Document in the PR body which symbol was imported and from where. Do NOT proceed to the other deletions in this task — go to Task 3.

- [ ] **Step 3: Commit**

```bash
git commit -m "chore(structure-audit): delete orphan barrel packages/gateway/src/auth/index.ts (D7)"
```

---

## Task 3: Delete `packages/gateway/src/extensions/index.ts`

- [ ] **Step 1: Confirm zero importers**

```bash
rg -n "from ['\"].*extensions/index['\"]" packages/ --type ts 2>&1 | head -20
# Expected: empty (no matches).
```

Note: `from ".../extensions"` (without `/index`) MAY resolve to `extensions/index.ts` via Node module resolution. Check for that too:

```bash
rg -n "from ['\"]\.\./extensions['\"]|from ['\"]\./extensions['\"]" packages/gateway/src/ --type ts | head -20
# Verify each match resolves to a sibling module (e.g., `../extensions/spawn-env.ts`), NOT to the barrel.
```

- [ ] **Step 2: Delete and typecheck**

```bash
git rm packages/gateway/src/extensions/index.ts
bun run typecheck 2>&1 | tail -5
```

- If typecheck passes: proceed.
- If typecheck fails: knip FP. Restore (`git restore --staged ... && git checkout HEAD -- ...`), document, skip this task.

- [ ] **Step 3: Commit**

```bash
git commit -m "chore(structure-audit): delete orphan barrel packages/gateway/src/extensions/index.ts (D7)"
```

---

## Task 4: Delete `packages/gateway/src/index/index.ts`

- [ ] **Step 1: Confirm zero importers**

```bash
rg -n "from ['\"].*src/index/index['\"]" packages/ --type ts 2>&1 | head -20
rg -n "from ['\"]\.\./index['\"]|from ['\"]\./index['\"]" packages/gateway/src/ --type ts 2>&1 | head -20
# Verify each match resolves to a sibling module (e.g., `../index/lan-peers-v19-sql.ts`), NOT to the barrel.
```

- [ ] **Step 2: Delete and typecheck**

```bash
git rm packages/gateway/src/index/index.ts
bun run typecheck 2>&1 | tail -5
```

- If typecheck passes: proceed.
- If typecheck fails: knip FP. Restore, document, skip.

- [ ] **Step 3: Commit**

```bash
git commit -m "chore(structure-audit): delete orphan barrel packages/gateway/src/index/index.ts (D7)"
```

---

## Task 5: Delete `packages/gateway/src/sync/index.ts`

- [ ] **Step 1: Confirm zero importers**

```bash
rg -n "from ['\"].*sync/index['\"]" packages/ --type ts 2>&1 | head -20
rg -n "from ['\"]\.\./sync['\"]|from ['\"]\./sync['\"]" packages/gateway/src/ --type ts 2>&1 | head -20
# Verify each match resolves to a sibling module (e.g., `../sync/connectivity.ts`), NOT to the barrel.
```

- [ ] **Step 2: Delete and typecheck**

```bash
git rm packages/gateway/src/sync/index.ts
bun run typecheck 2>&1 | tail -5
```

- If typecheck passes: proceed.
- If typecheck fails: knip FP. Restore, document, skip.

- [ ] **Step 3: Commit**

```bash
git commit -m "chore(structure-audit): delete orphan barrel packages/gateway/src/sync/index.ts (D7)"
```

---

## Task 6: Delete `packages/cli/src/lib/repo-root.ts`

- [ ] **Step 1: Confirm zero importers AND zero callers of `getRepoRoot`**

```bash
rg -n "from ['\"].*lib/repo-root['\"]" packages/ --type ts 2>&1 | head -20
rg -n "\bgetRepoRoot\b" packages/ --type ts 2>&1 | head -20
# Both: only the file itself appears (and that file is being deleted).
```

The Phase 2 triage noted that `resolveGatewayLaunch` is the actually-used helper and lives in a different file — it is unaffected by this deletion.

- [ ] **Step 2: Delete and typecheck**

```bash
git rm packages/cli/src/lib/repo-root.ts
bun run typecheck 2>&1 | tail -5
```

- If typecheck passes: proceed.
- If typecheck fails: knip FP. Restore, document, skip.

- [ ] **Step 3: Commit**

```bash
git commit -m "chore(structure-audit): delete orphan packages/cli/src/lib/repo-root.ts (D7)"
```

---

## Task 7: Delete `packages/ui/src/components/Skeleton.tsx`

- [ ] **Step 1: Confirm zero callers AND zero test references**

```bash
rg -n "from ['\"].*components/Skeleton['\"]" packages/ui/src/ 2>&1 | head -20
rg -n "<Skeleton\b" packages/ui/src/ 2>&1 | head -20
rg -n "\bSkeleton\b" packages/ui/src/__tests__/ packages/ui/test/ 2>/dev/null | head -20
# All: empty (only the component file itself).
```

- [ ] **Step 2: Delete and typecheck**

```bash
git rm packages/ui/src/components/Skeleton.tsx
bun run typecheck 2>&1 | tail -5
```

The UI package uses Vitest, not `bun test`, but typecheck still applies to its `.tsx`. Vitest itself does not need to be invoked (Skeleton has no test references).

- If typecheck passes: proceed.
- If typecheck fails: knip FP. Restore, document, skip.

- [ ] **Step 3: Commit**

```bash
git commit -m "chore(structure-audit): delete orphan packages/ui/src/components/Skeleton.tsx (D7)"
```

---

## Task 8: Final verification

- [ ] **Step 1: Regenerate the knip report and confirm orphan count delta**

```bash
bunx knip --reporter json > docs/structure-audit/knip-report.json
bun -e 'const r = JSON.parse(await Bun.file("docs/structure-audit/knip-report.json").text()); console.log("orphan files:", r.files.length);'
```

Compare against Task 1 Step 3's baseline. The count should have dropped by exactly 6 (or by `(6 - <number of knip FPs encountered>)` if any deletion was skipped). If the delta is wrong, audit which file the knip report still lists as orphan and confirm whether you actually deleted it.

- [ ] **Step 2: Stage the regenerated knip report**

```bash
git add docs/structure-audit/knip-report.json
git commit -m "chore(structure-audit): regenerate knip-report.json after orphan deletions"
```

- [ ] **Step 3: Run the full structure-audit gate locally**

```bash
bun run audit:boundaries
bun scripts/structure-audit/count-any-usage.ts --check
bun run audit:invariants
bunx knip
```

- `audit:boundaries`, `count-any-usage --check`, `knip`: should each be at-or-below the baseline state (this PR did not introduce any new violation).
- `audit:invariants` will likely still exit non-zero (D10 + D11 may still have violations depending on PR ordering).

- [ ] **Step 4: Decide whether to wire `_structure.yml` into `ci.yml`**

Run:

```bash
bun run audit:invariants
echo "exit: $?"
```

- If exit code is **0**: ALL top-5 fixes are now landed (D10 + D11 Bucket A + D7 Bucket A). This is the LAST top-5 fix to merge — wire `_structure.yml` into `ci.yml` in this same PR. Edit `.github/workflows/ci.yml` and add the job:

  ```yaml
    structure:
      name: PR quality — Structure
      uses: ./.github/workflows/_structure.yml
  ```

  Then commit:

  ```bash
  git add .github/workflows/ci.yml
  git commit -m "ci(pr-quality): wire _structure.yml gate (Phase 3 close — all top-5 fixes landed)"
  ```

- If exit code is **non-zero**: SKIP the wiring. The next fix PR (or a coordinated final wiring PR) will do it.

**Note on knip-as-gate:** the D7 gate (knip) is enforced by `_structure.yml` independently of `audit:invariants`. Even when `audit:invariants` still exits non-zero from D10/D11, knip itself may now be passing. The wiring decision above is gated on `audit:invariants` (the union of all D-rules) and NOT on knip alone.

- [ ] **Step 5: Run the project's CI-parity suite**

```bash
bun run test:ci
# Expected: 0 (modulo pre-existing platform.test.ts Windows EBUSY flake on Windows hosts).
```

- [ ] **Step 6: Open the PR**

```bash
gh pr create --title "chore(structure-audit): delete 6 orphan files (~114 LoC, D7 Bucket A)" --body "<body>"
```

PR body must include:

- The list of 6 files deleted (with LoC each)
- Confirmation that each was zero-importer (Phase 2 triage + delete-time `rg` re-check + post-delete `bun run typecheck` pass)
- Any knip FPs encountered (file restored, importer documented) — ideally none
- The knip orphan-count delta (baseline → post-PR = baseline - 6)
- Whether this PR wires `_structure.yml` into `ci.yml` (only if it was the last top-5 fix)
- Spec ref: `docs/superpowers/specs/2026-04-30-structure-audit-design.md` § 5, § 7.2

---

## Definition of Done

- [ ] All 6 orphan files deleted (or, for any knip FP encountered, the file is restored and the FP is documented in the PR body).
- [ ] Each deletion has its own commit (per-file commit cadence preserved).
- [ ] `bun run typecheck` passes after each deletion AND at the end.
- [ ] `bun run test:ci` passes (modulo pre-existing flakes documented in B3 PR #135).
- [ ] `docs/structure-audit/knip-report.json` regenerated and committed; orphan count drops by 6 (or by `6 - <FP count>`).
- [ ] PR opened against `main` with a body that names all 6 files and any FPs encountered.
- [ ] If this is the last top-5 fix PR: `_structure.yml` is wired into `ci.yml` in the same PR; `audit:invariants` exits 0 in CI. Otherwise: `audit:invariants` exits non-zero (expected — D10 / D11 violations may still remain) and the wiring is reserved for a later PR.
