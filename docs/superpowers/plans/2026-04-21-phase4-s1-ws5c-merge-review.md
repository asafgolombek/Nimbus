# Review: Phase 4 — Section 1: WS5-C Merge + Branch Hygiene — Implementation Plan

This review identifies open questions and suggestions for the implementation plan "Phase 4 — Section 1: WS5-C Merge + Branch Hygiene".

## 1. Branch and PR State

- **Observation:** The plan assumes PR #57 is the primary target. 
- **Check:** Since the branch `dev/asafgolombek/phase_4_ws5` is already mentioned in the `GEMINI.md` and `CLAUDE.md` as having a pending PR, ensure that the PR #57 correctly corresponds to this branch and includes all Plan 5 changes (Data Panel).
- **Suggestion:** In Task 1.2, explicitly verify that the PR title or description mentions "WS5-C" and "Data Panel" to ensure we are merging the intended scope.

## 2. Rate Limit & GitHub CLI

- **Observation:** The plan is very cautious about GitHub API rate limits (Task 1.1, 10.2). This is good practice.
- **Suggestion:** If the rate limit is hit, instead of just "sleeping," the agent could perform local tasks (like Task 4, 5, 6, 7, 8) that don't require the GitHub API, provided the branch is already synced.

## 3. Merge Strategy (Task 3)

- **Observation:** Step 3.2 uses `git merge origin/main`.
- **Note:** Squash-merging (Task 11) will effectively "clean up" the history anyway, but a merge commit on the feature branch is standard for syncing.
- **Conflict Resolution:** Step 3.3 correctly identifies that risky conflicts should be referred to the user.

## 4. Verification & Smoke Tests (Task 14)

- **Observation:** Task 14.2 requires a Hyper-V Ubuntu VM.
- **Question:** Does the current environment (where the agent is running) have access to start/manage a Hyper-V VM? If the agent is running in a standard CLI environment on the host, it might not be able to "see" inside the VM unless it can SSH into it.
- **Suggestion:** If the agent cannot access the VM directly, Task 14.2 should be marked as "User Action Required" where the agent provides the commands for the user to run in the VM and then asks for the results/screenshots.

## 5. Documentation Updates (Task 12)

- **Observation:** The plan updates `CLAUDE.md`, `GEMINI.md`, `docs/roadmap.md`, and `docs/README.md`.
- **Correction:** In Task 12.2, the "From" state in the plan shows `WS5-C ✅ on branch, PR pending`. Ensure the replacement exactly matches the current state of the file to avoid `replace` tool failures.

## 6. Minor Plan Errors

- **Task 14.4 Snippet:** The plan suggests creating a PR for smoke evidence. 
- **Suggestion:** Usually, screenshots are not committed to the repo to keep the `.git` size down, unless the project specifically uses a `/docs/screenshots` folder for versioned documentation. If the project prefers external hosting or a wiki, adapt this step. (The `GEMINI.md` context doesn't explicitly forbid screenshot commits, so follow the plan but be mindful of repo size).

## 7. Technical Logic (Task 7)

- **Observation:** Step 7.1 runs `bunx vitest run --coverage`.
- **Check:** Ensure the `vitest` and `@vitest/coverage-v8` (or similar) are installed in `packages/ui`. If the gate fails, the plan correctly suggests adding tests.
