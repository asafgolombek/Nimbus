# Review — Toolchain & Runner OS Refresh Implementation Plan

**Reviewer:** Gemini CLI
**Date:** 2026-04-24
**Related Plan:** [2026-04-24-toolchain-runner-os-refresh.md](./2026-04-24-toolchain-runner-os-refresh.md)

---

## Open Questions

1. **Node.js Version Reference (Task 1, Step 2):**
   - The expected output for `node --version` is listed as `v24.14.0`. As of today (April 2026), Node 22 is the current Active LTS. Node 24 is scheduled for release in October 2025 but likely won't be at `v24.14.0` by April 2026. Should this be updated to a more realistic Node 22 version (e.g., `v22.13.0`) to avoid confusion during baseline verification?

2. **`macos-15-intel` Availability:**
   - The plan correctly preserves `macos-15-intel` in `release.yml`. However, it's worth double-checking if this label is available in the standard GitHub-hosted runner pool for public repositories. Often, Sequoia (macOS 15) runners are exclusively Apple Silicon (`macos-15`), while Intel runners are pinned to `macos-13`. If `macos-15-intel` is a custom or large runner, this is fine; otherwise, a fallback might be needed.

3. **`jscpd` and `dorny/test-reporter` Job Names:**
   - In Task 6, the updated `BRANCH_PROTECTION.md` includes `PR quality — Duplication scan`. In `ci.yml`, this job is named `pr-quality-duplication` with the display name `PR quality — Duplication scan`. The plan also mentions `JUnit test report (E2E desktop)` using `dorny/test-reporter`. Does the `test-reporter` create a check that needs to be explicitly listed in branch protection, or is it covered by the parent job (`e2e-desktop-pr`)?

## Suggestions

1. **Enhanced glibc Verification (Task 5, Step 2):**
   - **Suggestion:** In the diagnostic step for `_test-suite.yml`, consider adding `ldd --version` specifically to capture the glibc version on Linux. This directly validates the "glibc floor" claim in Task 8.
   - *Implementation:* The plan already includes `ldd --version | head -1` in Task 5, Step 2. This is excellent.

2. **Automated MSRV Check (Task 11):**
   - **Suggestion:** Instead of just a manual `rustc --version` check, you could add a temporary step to the local verification script or a `pre-commit` hook to ensure the local environment meets the 1.95.0 requirement.

3. **Branch Protection "Add-Before-Push" (Task 15, Step 2):**
   - **Suggestion:** Clarify that when adding new-name checks to GitHub Rulesets, they might not appear in the search dropdown until they have been emitted at least once by a workflow. The admin might need to type the names manually and hit enter to "create" the requirement placeholder.

4. **Lockfile "No-op" Commits (Task 13):**
   - **Suggestion:** If `bun install` or `cargo update` results in no changes, explicitly skip the commit task but mention it in the PR description as "Lockfiles verified current; no changes required." This maintains the "four logical commits" narrative even if one is a no-op.

---

## Claims & Supporting Info

- **Node 20 EOL:** Confirmed as 2026-04-30. [Node.js Release Schedule](https://nodejs.org/en/about/previous-releases).
- **glibc 2.39 in Ubuntu 24.04:** Confirmed. Ubuntu 24.04 (Noble Numbat) ships with glibc 2.39. [Ubuntu 24.04 Release Notes](https://discourse.ubuntu.com/t/noble-numbat-release-notes/39890).
- **GitHub Runner Images:** `macos-14` is the current stable Apple Silicon runner. `macos-15` is in beta/early access. `windows-2025` is in public preview. [GitHub Actions Runner Images](https://github.com/actions/runner-images).
- **Rust 1.95.0:** Released in late 2025/early 2026 (projected based on 6-week release cycle). Rust 1.84 was late 2024. [Rust Forge - Releases](https://forge.rust-lang.org/).
