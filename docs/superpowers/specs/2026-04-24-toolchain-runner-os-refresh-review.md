# Review — Toolchain & runner OS refresh design

**Reviewer:** Gemini CLI
**Date:** 2026-04-24
**Related Spec:** [2026-04-24-toolchain-runner-os-refresh-design.md](./2026-04-24-toolchain-runner-os-refresh-design.md)

---

## Open Questions

1. **GitHub Runner Label Availability:** 
   - Is `windows-2025` already in General Availability for the project's GitHub organization? It has been in limited preview/beta; if not available, the fallback to `windows-2022` should be documented.
   - For `macos-15-intel`, can you confirm this is a valid label for your runner pool? Standard GitHub-hosted macOS runners for version 15 (Sequoia) are typically Apple Silicon. Intel runners are often pinned to `macos-13`.

2. **Glibc Floor (Ubuntu 24.04):**
   - The spec notes that binaries built on `ubuntu-24.04` will require glibc ≥ 2.39. This effectively drops support for Ubuntu 22.04 LTS (which uses 2.35) and Debian 12 (2.36). Is this "stated support posture" documented for end-users, or should a warning be added to `docs/SECURITY.md` or the installer scripts?

3. **Node 22 Consistency:**
   - The spec bumps Node to 22 only in `publish-client.yml`. Since `ubuntu-24.04` runners currently default to Node 20 (though this may change), should we explicitly set `node-version: "22"` in `ci.yml` and `_test-suite.yml` as well to ensure the test environment matches the publish environment?

4. **Dependabot Coordination:**
   - If Dependabot opens a lockfile-related PR (e.g., for a security fix in a dev dependency) during the execution of this branch, what is the preferred rebase strategy to avoid lockfile conflicts?

## Suggestions

1. **`nimbus doctor` Update:**
   - **Suggestion:** Add a check to `packages/cli/src/commands/doctor.ts` to verify the local environment meets the new MSRV (Rust 1.95+) and Node (22+) requirements. This provides immediate, actionable feedback to developers who haven't updated their local toolchains.

2. **glibc Pre-flight Check:**
   - **Suggestion:** Add a small pre-flight check in `scripts/release/nimbus-verify.sh` or the Gateway startup logic to detect the system's glibc version. If it's below 2.39 (when running a binary built on 24.04), provide a clear error message explaining the OS requirement.

3. **Wildcard Job Names (Future):**
   - **Suggestion:** While GitHub currently requires exact names for status checks in branch protection, consider if renaming jobs to exclude the OS version (e.g., `PR quality — Linux` instead of `PR quality — ubuntu-24.04`) would reduce maintenance overhead for future OS refreshes. (Note: The spec already addresses the immediate name change via a coordinated runbook).

4. **`_test-suite.yml` Validation:**
   - **Suggestion:** In `.github/workflows/_test-suite.yml`, add a diagnostic step that prints the environment details (`node -v`, `bun -v`, `rustc --version`, `ldd --version`). This will be invaluable for debugging if the runner OS bump introduces subtle environment differences.

5. **Tauri Plugin Major-Floating:**
   - **Suggestion:** The spec mentions Tauri plugins are "major-floating" (`@tauri-apps/plugin-*@"^2"` and `tauri-plugin-*@"2"`). Consider pinning these to minor versions (e.g., `~2.x.y`) in a follow-up PR if stability becomes an issue, although for this PR, regenerating the lockfile as planned is appropriate.

---

## Verification Checklist Enhancement

- [ ] Verify `windows-2025` job starts correctly on a test push before merging to `main`.
- [ ] Verify `macos-15-intel` job starts correctly (or confirm it is a private/large runner).
- [ ] Run `ldd --version` on the `ubuntu-24.04` runner in a test job to confirm glibc 2.39.
