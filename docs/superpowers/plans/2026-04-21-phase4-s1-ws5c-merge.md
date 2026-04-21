# Phase 4 — Section 1: WS5-C Merge + Branch Hygiene — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the pending WS5-C work currently on `dev/asafgolombek/phase_4_ws5` into `main` via a clean PR, then update status documentation to reflect the merged state. No new features — pure merge + hygiene.

**Architecture:** This section does not create code; it is a merge/verification pipeline. Work happens on the existing feature branch (not a new worktree). The branch already contains WS5-C Plans 1–5 + uncommitted NOSONAR suppressions + the Phase 4 completion design spec.

**Tech Stack:** Bun 1.2+, TypeScript 6.x, Biome, Bun test runner, Vitest (UI), Rust/Tauri (clippy/fmt), GitHub CLI (`gh`), GitHub Actions CI.

---

## Important Context

**PR #57 is open and mergeable.** URL: https://github.com/asafgolombek/Nimbus/pull/57

**Key observation:** the most recent CI run showed one failing check — `PR quality — TS/Bun (ubuntu-22.04) / Test — ubuntu-22.04`. The failure log shows a **StepSecurity `harden-runner` rate-limit error** (GitHub API 403), not actual test failures. SonarCloud, CodeQL, Trivy, Rust/Tauri, Duplication scan, and Dependency audit all passed. The fix is to re-trigger the workflow after the rate limit window (20 minutes) — not to fix code.

**GitHub API rate limit caution:** The shared GitHub API rate limit (5,000/hr) has been observed to exhaust during this session. Before calling any `gh` command, check remaining quota: `gh api rate_limit --jq '.resources.core'`. If `remaining` < 100, defer `gh` calls until the reset timestamp.

**Working tree is not clean on entry.** Two gateway files have uncommitted `// NOSONAR` comment additions:
- `packages/gateway/src/index/local-index.ts` — NOSONAR for the `setConnectorDepth` signature
- `packages/gateway/src/ipc/connector-rpc-handlers.ts` — NOSONAR for `enabled` boolean flag and line 219 resumeConnector

These are legitimate lint suppressions (not WIP code) and should be committed before the merge.

---

## Task 1: Baseline snapshot — verify PR state and plan execution

**Files:** (none modified)

- [ ] **Step 1.1: Check GitHub API rate limit budget**

Run:
```bash
gh api rate_limit --jq '.resources.core | {limit, remaining, reset: (.reset | todateiso8601)}'
```

Expected: an object with `remaining` ≥ 100 and `reset` timestamp. If `remaining` < 100, sleep until the reset timestamp before running any subsequent `gh` command.

- [ ] **Step 1.2: Confirm current branch and PR state**

Run:
```bash
git rev-parse --abbrev-ref HEAD
gh pr view 57 --json number,state,mergeable,statusCheckRollup --jq '{number, state, mergeable, checks: [.statusCheckRollup[] | {name, conclusion}]}'
```

Expected:
- Current branch: `dev/asafgolombek/phase_4_ws5`.
- PR state: `OPEN`, mergeable: `MERGEABLE`.
- Record which checks are `FAILURE` / `SUCCESS` / `SKIPPED`. If any non-transient failure surfaces (e.g., Biome, SonarCloud, real test failures), the plan handles them in Task 4–7; flag now.

- [ ] **Step 1.3: Confirm working tree diff**

Run:
```bash
git status --short
git diff HEAD --stat
```

Expected: two modified files — `packages/gateway/src/index/local-index.ts` and `packages/gateway/src/ipc/connector-rpc-handlers.ts` — totaling a handful of lines of `// NOSONAR` comment additions. If the diff is anything larger or different, stop and ask the user before continuing.

- [ ] **Step 1.4: No commit** — this is purely reconnaissance.

---

## Task 2: Commit the NOSONAR suppressions

The working-tree diff contains legitimate SonarCloud suppression comments. Commit them so the branch is clean before syncing with `main`.

**Files:**
- Modify (already modified on disk): `packages/gateway/src/index/local-index.ts`
- Modify (already modified on disk): `packages/gateway/src/ipc/connector-rpc-handlers.ts`

- [ ] **Step 2.1: Stage only these two files (never `git add -A`)**

```bash
git add packages/gateway/src/index/local-index.ts packages/gateway/src/ipc/connector-rpc-handlers.ts
git status --short
```

Expected: staged changes show only these two files. No other files staged.

- [ ] **Step 2.2: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore(gateway): suppress false-positive SonarCloud findings

NOSONAR markers on setConnectorDepth (already a type alias) and the
enabled boolean flag path in handleConnectorSetConfig.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: one new commit on the branch. `git status --short` now shows no uncommitted changes.

- [ ] **Step 2.3: Verify working tree is clean**

```bash
git status --short
```

Expected: empty output.

---

## Task 3: Sync the branch with latest `main`

Before running local verification, bring the branch up to date with `main` so the tests reflect what will actually land.

**Files:** (merge/rebase may modify any file)

- [ ] **Step 3.1: Fetch latest from origin**

```bash
git fetch origin main
```

Expected: success. Note how many commits `main` is ahead of the branch merge-base via `git log --oneline HEAD..origin/main | wc -l`.

- [ ] **Step 3.2: Merge `origin/main` into the feature branch**

Prefer merge (not rebase) — the branch has many commits and a public PR; rebase would force-push and confuse reviewers.

```bash
git merge origin/main --no-edit
```

Expected: either "Already up to date." or a merge commit is created. Conflicts trigger Step 3.3.

- [ ] **Step 3.3: Resolve conflicts if any**

If `git merge` reports conflicts:

```bash
git status
```

For each conflicted file:
1. Open it, resolve by choosing/combining both sides (prefer keeping WS5-C UI code and any main-side security/bugfix code).
2. Run any file-specific unit tests to confirm the merge did not break behavior.
3. `git add <file>` each resolved file.
4. `git commit` to complete the merge.

If conflicts look risky or structural, stop and ask the user before committing the merge — do not guess.

- [ ] **Step 3.4: Verify head is linear + current**

```bash
git log --oneline origin/main..HEAD | head -5
git log --oneline -1
```

Expected: the feature branch HEAD contains both its original commits and (if applicable) the merge commit.

---

## Task 4: Local typecheck

**Files:** none modified (failures identify files to fix)

- [ ] **Step 4.1: Run typecheck across workspace**

```bash
bun run typecheck
```

Expected: exits `0` with no TypeScript errors across any package.

- [ ] **Step 4.2: If errors, fix them minimally**

For each error:
1. Open the file reported.
2. Apply the minimum fix to satisfy the type.
3. Do **not** weaken types with `any` (project non-negotiable). Use `unknown` if data is truly external, else narrow properly.
4. Re-run `bun run typecheck` until clean.

- [ ] **Step 4.3: Commit fixes if any**

If files were modified:

```bash
git add <specific-file-paths>
git commit -m "$(cat <<'EOF'
fix: resolve typecheck errors uncovered by main merge

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If no files were modified, skip the commit — do not create empty commits.

---

## Task 5: Local lint (Biome)

**Files:** none modified (failures identify files to fix)

- [ ] **Step 5.1: Run lint**

```bash
bun run lint
```

Expected: exits `0`.

- [ ] **Step 5.2: Auto-fix if Biome offers safe fixes**

If Step 5.1 reported violations:

```bash
bun run lint:fix
bun run lint
```

Expected after `lint:fix`: exit `0`, or a small number of remaining issues that require manual intervention.

- [ ] **Step 5.3: Manually fix remaining issues**

For each remaining issue that `lint:fix` did not resolve:
1. Open the reported file.
2. Apply the minimum correction.
3. Do **not** add `// biome-ignore` without a reason; if the violation is a legitimate false positive, include a comment explaining why.

Re-run `bun run lint` until clean.

- [ ] **Step 5.4: Commit fixes if any**

```bash
git add <specific-file-paths>
git commit -m "$(cat <<'EOF'
style: resolve biome findings on branch

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Skip commit if nothing changed.

---

## Task 6: Local Bun test suite

**Files:** none modified (failures identify tests to debug)

- [ ] **Step 6.1: Run the full test suite**

```bash
bun test
```

Expected: all tests pass.

- [ ] **Step 6.2: Debug failures if any**

For each failing test:
1. Read the assertion failure and the file path.
2. Determine whether the test is wrong or the implementation is wrong. If the branch-merge introduced unexpected behavior, the implementation is likely the source of truth; if the test was already failing on the branch, the test needs fixing.
3. Apply the minimum fix.
4. Re-run just the failing test: `bun test <path-to-test-file>`.
5. Re-run the full suite once isolated tests pass.

- [ ] **Step 6.3: Commit fixes if any**

```bash
git add <specific-file-paths>
git commit -m "$(cat <<'EOF'
test: fix regressions surfaced on main merge

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Skip commit if nothing changed.

---

## Task 7: Local UI Vitest + coverage gate

**Files:** none modified (failures identify tests to debug or coverage gaps)

- [ ] **Step 7.1: Run UI component tests with coverage**

```bash
cd packages/ui && bunx vitest run --coverage
```

Expected: all tests pass; coverage summary at the end shows **≥80% lines** and **≥75% branches** on the `packages/ui` scope (the gate enforced in CI).

- [ ] **Step 7.2: If tests fail, debug per-file**

For each failing test:
1. Use `bunx vitest run <relative-path>` to isolate.
2. Fix test or implementation per Task 6 logic.
3. Re-run full suite.

- [ ] **Step 7.3: If coverage gate fails (<80% lines or <75% branches)**

1. Inspect `packages/ui/coverage/index.html` (browser) or `packages/ui/coverage/coverage-summary.json` to locate uncovered files.
2. Add tests for the lowest-covered files first. Prefer component-behavior tests over implementation tests (mock IPC at the `NimbusIpcClient` boundary).
3. Re-run until gate passes.

- [ ] **Step 7.4: Return to workspace root**

```bash
cd ../..
```

- [ ] **Step 7.5: Commit fixes if any**

```bash
git add packages/ui/
git commit -m "$(cat <<'EOF'
test(ui): restore coverage gate after main merge

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Skip commit if nothing changed.

---

## Task 8: Rust fmt + clippy for Tauri

**Files:** none modified (failures identify code to fix)

- [ ] **Step 8.1: Run fmt check**

```bash
cd packages/ui/src-tauri && cargo fmt --all -- --check
```

Expected: exits `0` with no diff.

- [ ] **Step 8.2: Run clippy**

```bash
cargo clippy --all-targets --all-features -- -D warnings
```

Expected: exits `0` with no warnings.

- [ ] **Step 8.3: Fix issues if any**

- For fmt violations: `cargo fmt --all` (no `--check`).
- For clippy warnings: apply the recommended fix, or `#[allow(clippy::lint_name)]` with a justifying comment only if the warning is a false positive.

Re-run both checks until clean.

- [ ] **Step 8.4: Return to workspace root**

```bash
cd ../../..
```

- [ ] **Step 8.5: Commit fixes if any**

```bash
git add packages/ui/src-tauri/
git commit -m "$(cat <<'EOF'
style(tauri): fix rustfmt / clippy findings

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Skip commit if nothing changed.

---

## Task 9: Verify manual-smoke-ws5c.md is signed off

**Files:**
- Read: `docs/manual-smoke-ws5c.md`

- [ ] **Step 9.1: Read the file**

```bash
cat docs/manual-smoke-ws5c.md
```

- [ ] **Step 9.2: Confirm the checklist reflects signed-off state**

Look for one of:
- All checkboxes marked `- [x]` with a "Signed off on YYYY-MM-DD by <name>" line at the end, OR
- An explicit "Verified on <OS> on <date>" note per section.

If the checklist is unchecked but the WS5-C work is complete per other evidence (CI green, functional screenshots), this is a gap. **Stop and ask the user** to walk the checklist on at least Windows (native) and Linux (Hyper-V or WSL2) before merging. Record sign-off in the file.

If the checklist is already signed off, no change needed.

- [ ] **Step 9.3: Commit sign-off if any**

If you edited the file:

```bash
git add docs/manual-smoke-ws5c.md
git commit -m "$(cat <<'EOF'
docs: sign off WS5-C manual smoke checklist

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Skip commit if nothing changed.

---

## Task 10: Push branch and wait for CI green

**Files:** (no local files — triggers CI)

- [ ] **Step 10.1: Push**

```bash
git push origin dev/asafgolombek/phase_4_ws5
```

Expected: push accepted. If rejected (force-needed), investigate first — do not force-push to a PR branch without user approval.

- [ ] **Step 10.2: Check GitHub API rate limit before polling**

```bash
gh api rate_limit --jq '.resources.core | {remaining, reset: (.reset | todateiso8601)}'
```

If `remaining` < 50, sleep until reset before polling CI.

- [ ] **Step 10.3: Wait for CI to complete**

Do NOT poll in a tight loop — use `gh pr checks` to fetch status and sleep between calls:

```bash
gh pr checks 57 --watch
```

`--watch` blocks until all checks finish. Expected: every check ends in `SUCCESS` (or `SKIPPED` for matrix branches not applicable to a PR).

- [ ] **Step 10.4: If any check fails**

Inspect the failing job:
```bash
gh run view <run-id> --log-failed | tail -200
```

Classify:
- **Transient infra failure** (rate-limit, runner offline, network): re-run the specific job via `gh run rerun <run-id> --failed` and return to Step 10.3.
- **Real failure** (test regression, lint violation, missed file): back to the appropriate task (4–8), fix, commit, push, repeat.

---

## Task 11: Merge PR #57 to `main` (squash)

**Files:** (no local files — operates on remote PR)

- [ ] **Step 11.1: Confirm user approval to merge**

Per the spec's branching strategy, merges to `main` are deliberate. Before running the merge command, prompt the user:

> "PR #57 is green on CI and ready to merge. Squash-merge now? [y/n]"

Wait for explicit yes. If no, stop the plan.

- [ ] **Step 11.2: Squash-merge and delete the source branch**

```bash
gh pr merge 57 --squash --delete-branch --subject "feat: WS5-C Settings shell — complete" --body "$(cat <<'EOF'
Merges the complete WS5-C Settings shell (Plans 1–5) to main:

- Profiles, Telemetry, Connectors, Model, Audit, Updates, Data panels.
- Zustand slices + persist middleware (5-key whitelist + forbidden-key deep-scrub).
- Tauri ALLOWED_METHODS grown to 38; NO_TIMEOUT_METHODS list.
- Phase 4 completion design spec + v0.1.0 prerequisites runbook.

Closes Phase 4 WS5-C; unblocks Phase 4 Section 2 (A.1 graph-aware watchers).
EOF
)"
```

Expected: PR is merged, feature branch is deleted on the remote.

- [ ] **Step 11.3: Update local state**

```bash
git checkout main
git pull --ff-only origin main
git branch -D dev/asafgolombek/phase_4_ws5
```

Expected: local `main` is at the squash-merge commit; the feature branch is deleted locally.

---

## Task 12: Post-merge status doc updates (PR to `main`)

After the squash-merge, status documentation must reflect WS5-C as **merged**, not "on branch, PR pending." These small updates go out as a fast-follow PR.

**Files:**
- Modify: `CLAUDE.md` (line 10 status line)
- Modify: `GEMINI.md` (mirror of `CLAUDE.md` status line — verify it exists first)
- Modify: `docs/roadmap.md` (line 8 Phase 4 summary, WS5-C bullet)
- Modify: `docs/README.md` (Phase 4 status row if present)

- [ ] **Step 12.1: Create a fast-follow branch**

```bash
git checkout -b dev/asafgolombek/phase4-s1-post-merge-status
```

- [ ] **Step 12.2: Update `CLAUDE.md` line 10**

Open `CLAUDE.md` and replace the status line:

From:
```
**Status:** Phase 3.5 ✅ Complete; **Phase 4** — Presence 🔵 Active (WS1–4 ✅ · WS5-A ✅ · WS5-B ✅ · WS5-C ✅ on branch, PR pending)
```

To:
```
**Status:** Phase 3.5 ✅ Complete; **Phase 4** — Presence 🔵 Active (WS1–4 ✅ · WS5-A ✅ · WS5-B ✅ · WS5-C ✅)
```

- [ ] **Step 12.3: Mirror in `GEMINI.md` if it exists**

```bash
test -f GEMINI.md && grep -n "WS5-C ✅ on branch" GEMINI.md || echo "no mirror needed"
```

If a matching line exists, apply the same replacement as Step 12.2.

- [ ] **Step 12.4: Update `docs/roadmap.md` Phase 4 summary paragraph**

Open `docs/roadmap.md`. In the long Phase 4 summary paragraph (around line 8), find the substring:
```
**WS5-C (Settings Shell — Plans 4–5) implemented on branch, PR pending:**
```

Replace with:
```
**WS5-C (Settings Shell — Plans 4–5) merged to `main`:**
```

- [ ] **Step 12.5: Update `docs/README.md` Phase 4 row if it says "Active" with WS5-C not merged**

```bash
grep -n "Phase 4\|WS5-C\|Presence" docs/README.md
```

If any line states WS5-C as "pending" or "on branch," update to reflect "WS5-C complete." If the README only references Phase 4 at a coarse level (no WS5-C mention), no edit needed.

- [ ] **Step 12.6: Run lint + typecheck as a sanity check**

```bash
bun run typecheck
bun run lint
```

Expected: both exit `0`. (Docs-only changes rarely affect these; the check is a guardrail.)

- [ ] **Step 12.7: Commit and push**

```bash
git add CLAUDE.md GEMINI.md docs/roadmap.md docs/README.md
# Note: git add tolerates missing files silently only if listed individually;
# if GEMINI.md or docs/README.md were not modified, drop them from the add:
git status --short
# Adjust the add list to match actually-modified files before committing.
git commit -m "$(cat <<'EOF'
docs: WS5-C merged — update Phase 4 status lines

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push -u origin dev/asafgolombek/phase4-s1-post-merge-status
```

- [ ] **Step 12.8: Open the PR**

```bash
gh pr create --base main --title "docs: WS5-C merged — update Phase 4 status lines" --body "$(cat <<'EOF'
## Summary
- Phase 4 status line in CLAUDE.md / GEMINI.md: drop "on branch, PR pending" qualifier.
- Roadmap summary: WS5-C Plans 4-5 reflected as merged.
- README Phase 4 row refreshed if applicable.

## Test plan
- [x] `bun run typecheck` clean.
- [x] `bun run lint` clean.
- [ ] CI green on Ubuntu pr-quality.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Note the PR URL in the output — you will watch its checks in Task 13.

---

## Task 13: Verify post-merge CI green on 3-OS matrix

**Files:** (no local files — monitors CI runs on `main` after Task 11 merge and on the fast-follow PR from Task 12)

- [ ] **Step 13.1: Confirm the `main`-branch CI (full 3-OS matrix) completed after the squash-merge**

```bash
gh api rate_limit --jq '.resources.core | {remaining}'
# If ok:
gh run list --branch main --limit 5 --json databaseId,conclusion,workflowName,createdAt --jq '[.[] | select(.workflowName == "CI")] | .[0:3]'
```

Expected: the first (most recent) `CI` workflow run on `main` is `SUCCESS` across Ubuntu, macOS, and Windows matrix cells.

- [ ] **Step 13.2: If any matrix cell failed on `main`**

This is a real blocker. Back to the investigation loop:
1. `gh run view <failed-run-id> --log-failed | tail -200` to understand the failure.
2. If transient (rate-limit, flaky), rerun the job.
3. If real, open a new feature branch from `main`, write a fix PR, and merge it before proceeding to Section 2.

- [ ] **Step 13.3: Confirm the fast-follow PR (Task 12) CI passes and merge it**

```bash
gh pr checks <fast-follow-pr-number> --watch
```

Once green, with user approval:
```bash
gh pr merge <fast-follow-pr-number> --squash --delete-branch
git checkout main && git pull --ff-only origin main
```

---

## Task 14: Local smoke on Windows + Linux VM

**Files:** (no code — manual verification; captures evidence)

- [ ] **Step 14.1: Windows smoke**

On the Windows dev machine, build and run from the freshly merged `main`:

```bash
git checkout main && git pull --ff-only origin main
bun install
bun run build
cd packages/ui && bunx tauri dev
```

Walk the full `docs/manual-smoke-ws5c.md` checklist. Capture screenshots for each section into `docs/screenshots/ws5c-smoke/win/<section>.png` (one per sub-check, or one aggregate per panel).

Every box must tick. Any failure → GitHub issue + new feature branch to fix; do not proceed to Section 2 until resolved.

- [ ] **Step 14.2: Linux smoke via Hyper-V Ubuntu 22.04 VM**

Prereq: the VM installed as part of Section 0 of the design spec. If it isn't yet:
1. Install Hyper-V (Windows 11 Pro) or VirtualBox (Home): `Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All` (admin PowerShell).
2. Download Ubuntu 22.04.4 LTS ISO. Provision a VM with 8 GB RAM, 40 GB disk.
3. Install Bun + Rust per the root README.
4. Clone the repo into the VM (`/home/<user>/Nimbus`).

In the VM:

```bash
cd ~/Nimbus
git checkout main && git pull
bun install
bun run build
cd packages/ui && bunx tauri dev
```

Walk the same checklist. Evidence into `docs/screenshots/ws5c-smoke/linux/`.

- [ ] **Step 14.3: (Deferred) macOS smoke**

Per the Phase 4 design spec, macOS verification happens via Scaleway M1 rental in Section 14 of the overall plan (release-gate verification), not here. Skip this for Section 1.

- [ ] **Step 14.4: Commit evidence**

If screenshots were captured:

```bash
git checkout -b dev/asafgolombek/phase4-s1-smoke-evidence
mkdir -p docs/screenshots/ws5c-smoke/win docs/screenshots/ws5c-smoke/linux
# Copy captured screenshots into the respective directories.
git add docs/screenshots/ws5c-smoke/
git commit -m "$(cat <<'EOF'
docs: WS5-C smoke evidence on Windows + Linux VM

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push -u origin dev/asafgolombek/phase4-s1-smoke-evidence
gh pr create --base main --title "docs: WS5-C smoke evidence (Win + Linux)" --body "Evidence for WS5-C manual smoke pass on Windows (native) and Linux (Hyper-V Ubuntu 22.04). 🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Merge with user approval (same pattern as Task 11).

---

## Acceptance Check (end of Section 1)

All must hold before declaring Section 1 complete and proceeding to Section 2 (A.1 graph-aware watchers):

- [ ] PR #57 is merged to `main` (squash-merge); source branch deleted on remote and locally.
- [ ] Post-merge status-docs PR (from Task 12) is merged.
- [ ] `main` CI is green on the full 3-OS matrix for the merged commit.
- [ ] `CLAUDE.md` and `docs/roadmap.md` status lines no longer contain "on branch, PR pending" for WS5-C.
- [ ] `docs/manual-smoke-ws5c.md` is signed off.
- [ ] Screenshot evidence for WS5-C smoke on Windows + Linux VM exists (if Task 14 Step 4 committed them).
- [ ] Local `main` is checked out, up-to-date, clean working tree.

---

## Notes for the engineer executing this plan

- **No new features.** Anything resembling feature work belongs in Section 2+, not here. If during local verification you discover a latent bug that requires a fix, that fix must be tightly scoped (a single commit) and justified as a regression surfaced by the `main` merge — not as a new feature.
- **Never force-push** to a branch with an open PR. If you need to rewrite history, open a new PR from a fresh branch and close the old one.
- **Never skip hooks** (`--no-verify`) or bypass signing. If a pre-commit hook blocks you, fix the underlying issue.
- **Rate-limit discipline:** before every `gh` command, re-check `gh api rate_limit`. The shared 5,000/hr bucket is easy to exhaust across multiple agents / humans on the same account.
- **Stop and ask the user** if:
  - A merge conflict is structural (not a trivial line-level conflict).
  - A CI failure is real (not transient) and the fix would grow beyond a one-commit hygiene change.
  - `docs/manual-smoke-ws5c.md` is not signed off and walking the checklist yourself would delay the merge by > half a day.
  - The working tree contains unexpected changes (other than the NOSONAR suppressions described in Task 1).
