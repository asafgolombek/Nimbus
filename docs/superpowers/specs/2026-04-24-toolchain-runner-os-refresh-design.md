# Design — Toolchain & runner OS refresh

**Branch:** `dev/asafgolombek/upgrade_packages`
**Date:** 2026-04-24
**Status:** Approved — ready for implementation plan
**Scope:** First of three planned maintenance PRs (this one · third-party packages · code-quality audit).

---

## 1. Goal

Land a single PR that refreshes the CI runner OS labels, pins the TypeScript/Rust toolchain versions the project relies on, and updates the MSRV — without touching third-party npm/cargo packages beyond Tauri plugin patch-level bumps that fall out of lockfile regeneration.

**Driver:** Node 20 hits End-of-Life on 2026-04-30 (six days after this spec is written). The rest of the toolchain has accumulated enough drift that piecemeal bumps would cost more CI cycles than one coordinated sweep.

## 2. In scope

1. Runner OS bumps across all workflows:
   - `ubuntu-22.04` → `ubuntu-24.04`
   - `macos-14` → `macos-15`
   - `windows-2022` → `windows-2025`
   - `macos-15-intel` stays unchanged (already current; only in `release.yml`).
2. `node-version: "20"` → `"22"` in `.github/workflows/publish-client.yml` (verified via grep: the only `node-version` occurrence in the repo).
3. `rust-version = "1.88.0"` → `"1.95.0"` in `packages/ui/src-tauri/Cargo.toml` (same three-component format as today).
4. Regenerate `packages/ui/src-tauri/Cargo.lock` via `cargo update` — picks up Tauri plugin patch-level bumps within `tauri-plugin-*@"2"` (major-floating already).
5. Regenerate `bun.lock` via `bun install` — picks up `@tauri-apps/plugin-*@"^2"` patch-level bumps.
6. Update `.github/BRANCH_PROTECTION.md` required-checks table to reference new job names, and fix the pre-existing typo: doc lists "PR quality — ubuntu-22.04" but the actual job name in `ci.yml` is `"PR quality — TS/Bun (ubuntu-22.04)"` (discovered during spec research — must be corrected in the new-name table).
7. PR description contains the post-merge branch-protection runbook (admin step).
8. Add a short diagnostic step to `.github/workflows/_test-suite.yml` that prints `bun --version`, `rustc --version`, `node --version` (best-effort), and `ldd --version` (Linux only) before tests run — makes runner-OS surprises easy to debug in CI logs.
9. Add a one-paragraph support-matrix note to `docs/SECURITY.md` documenting the new minimum glibc floor (≥ 2.39) for Linux binaries built on ubuntu-24.04.

## 3. Out of scope

- Third-party GitHub Actions SHA pins — Dependabot currently has zero open PRs for these; they are current. No manual bump needed.
- Third-party npm packages (`@mastra/*`, React, Zustand, Radix UI, `@xenova/transformers`, etc.) — separate spec, separate PR.
- Third-party cargo crates beyond Tauri plugins (`serde_json`, `tokio`, `interprocess`, `thiserror`) — separate spec.
- Code-quality audit (security review, performance analysis, SOLID/duplication review, bug hunt) — separate spec after package upgrade lands.
- Bun major-version pin — stays at floating `"1.3"` (auto-picks up 1.3.12).
- Tauri major migration — no 3.x exists; `tauri = "2.10.3"` stays (no newer minor/patch at spec time).
- `dtolnay/rust-toolchain@stable` — stays floating; only the Cargo.toml MSRV is bumped.

## 4. Non-negotiables touched

None. This PR does not change license fields, the HITL gate, the Vault interface, the PAL dispatch, or any `any`-vs-`unknown` typing. It is a pure infrastructure refresh.

## 5. Files touched

| File | Kind of change | Estimated edits |
|---|---|---|
| `.github/workflows/ci.yml` | OS label replacements | 12 |
| `.github/workflows/release.yml` | OS label replacements | 12 |
| `.github/workflows/_test-suite.yml` | OS label replacement (default param) | 1 |
| `.github/workflows/security.yml` | OS label replacements | 6 |
| `.github/workflows/codeql.yml` | OS label replacements | 2 |
| `.github/workflows/benchmark.yml` | OS label replacement | 1 |
| `.github/workflows/publish-client.yml` | OS + `node-version` bump | 2 |
| `.github/workflows/scorecard.yml` | OS label replacement | 1 |
| `.github/workflows/labeler.yml` | Verify (may already use generic label) | 0–1 |
| `.github/workflows/lock-threads.yml` | Verify | 0–1 |
| `.github/workflows/release-please.yml` | Verify | 0–1 |
| `.github/workflows/stale.yml` | Verify | 0–1 |
| `packages/ui/src-tauri/Cargo.toml` | `rust-version` bump | 1 |
| `packages/ui/src-tauri/Cargo.lock` | Regenerated | auto |
| `bun.lock` | Regenerated | auto |
| `.github/BRANCH_PROTECTION.md` | Required-check names table update + typo fix | ~6 |
| `.github/workflows/_test-suite.yml` (additional) | Add diagnostic `env` print step | ~6 |
| `docs/SECURITY.md` | Append glibc-floor note to "Supported Versions" | ~3 |

**No changes to:**
- `.github/actions/setup-nimbus-ci/action.yml` — Bun default `"1.3"` stays; it resolves to 1.3.12 already.
- `.github/actions/setup-rust-tauri/action.yml` — `dtolnay/rust-toolchain@stable` stays; apt package names all exist on Ubuntu 24.04 (verified: `libgtk-3-dev`, `libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `libsoup-3.0-dev`, `libjavascriptcoregtk-4.1-dev`, `libsecret-tools`, `gnome-keyring`).

## 6. Runner OS bump — per-platform risk analysis

### Ubuntu 22.04 → 24.04

- **Tauri Linux deps:** all present on 24.04 with identical package names. No action needed in `setup-rust-tauri/action.yml` or `codeql.yml`.
- **glibc floor:** 22.04 ships glibc 2.35; 24.04 ships 2.39. Gateway binaries produced by `packages/gateway/compile-gateway.ts` on 24.04 require glibc ≥ 2.39 at runtime. This drops support for Ubuntu 22.04 LTS (2.35) and Debian 12 (2.36) as a *runtime* environment for the Linux binaries — modern desktop distros (Ubuntu 24.04+, Fedora 40+, Debian 13) are unaffected. **This PR documents the new floor in `docs/SECURITY.md` "Supported Versions"** so the support posture is explicit, not inferred. If a user attempts to run on a pre-2.39 glibc, the dynamic linker already emits `GLIBC_2.39 not found` — no custom check needed at this stage (a friendlier preflight in Gateway startup is tracked as follow-up in § 13).
- **libsecret / gnome-keyring behavior:** Vault integration tests exercise the real keyring via D-Bus. No API changes 22.04 → 24.04; tests should pass as-is.
- **Snap vs .deb packaging:** `scripts/package-installers-linux.ts` targets `.deb` + tarball; no Snap today. 24.04 does not change this.

### macOS 14 → 15

- **Xcode / Command Line Tools:** macos-15 runners ship Xcode 16.x by default (vs 15.x on macos-14). Affects `cargo build` for `aarch64-apple-darwin`. Expected clean; verify via CI matrix.
- **Code-signing / notarization:** `release.yml` performs codesign on macOS runners. Notarization ticket format is stable across 14↔15. No change expected, but the release.yml matrix (both macos-14 and macos-15-intel today) is the acceptance gate.
- **Keychain API:** `NimbusVault` macOS impl uses `security` CLI + Keychain Services. Stable API surface.
- **macos-15-intel runner:** already used in `release.yml` for x86_64 builds. No change.

### Windows 2022 → 2025

- **MSVC toolchain:** windows-2025 runners ship VS 2022 Build Tools 17.latest. Rust `x86_64-pc-windows-msvc` target remains fully supported.
- **Named Pipe IPC:** same kernel API surface; no regression expected.
- **DPAPI:** unchanged across 2022↔2025.
- **PowerShell:** both runners ship PowerShell 5.1 and PowerShell 7; TTS tests using `powershell.exe` SAPI work identically.
- **CRLF / line ending behavior:** unchanged.

**Overall risk:** Low-to-medium. The existing 3-OS push-matrix is precisely the mechanism that catches cross-platform regressions; if one platform fails after merge, revert the single OS-bump commit.

## 7. Branch-protection coordination (the only non-code risk)

### Problem

`BRANCH_PROTECTION.md` documents required status checks by **exact job name**, which includes the OS suffix. Examples from the current table:

- `PR quality — ubuntu-22.04`
- `E2E Desktop (PR) — ubuntu-22.04`
- `CI — ubuntu-22.04 / macos-14 / windows-2022`

After this PR merges, those job names become:

- `PR quality — TS/Bun (ubuntu-24.04)` (note: also fixes the typo — doc currently omits `TS/Bun`)
- `E2E Desktop (PR) — ubuntu-24.04`
- `CI — TS/Bun (ubuntu-24.04) / CI — TS/Bun (macos-15) / CI — TS/Bun (windows-2025)`
- Plus the Rust/Tauri variants which were not in the doc at all today.

GitHub's branch protection rules reference check names as free-form strings. When a referenced name disappears, new PRs cannot satisfy that required check and merges block.

### Three failure modes

1. **Admin updates branch protection before PR is merged.** Old names vanish from required-checks list; this PR can't merge because its new-named checks aren't in the list either and the old-named checks don't run on this PR's workflow revision.
2. **Admin updates branch protection after merge but references wrong names.** Future PRs fail the required checks permanently.
3. **Admin forgets.** Required-checks list points at names that haven't been emitted since the merge; subsequent PRs pass without the (stale) gate actually running.

### Runbook (goes in the PR description)

**Approach A — admin pre-stages (recommended):**

1. Admin opens Settings → Rulesets (or Branches) for `main`.
2. Admin **adds** the new-name checks to the required-checks list (leaves old-name checks alone for now).
3. PR author pushes branch. CI runs the new-named jobs and passes.
4. Old-named checks never run on this PR (they no longer exist in the workflow), so branch protection reports them "Expected — waiting for status to be reported" and blocks merge.
5. Admin **removes** the old-name checks from the required-checks list.
6. Merge becomes available → merge PR.
7. Push-to-`main` full matrix runs under new names → if green, done.

Because the workflow file changes and the branch-protection config are updated in coordinated steps (add before push, remove between push and merge), `main` is never unprotected and no PR merges with checks skipped.

**Approach B — admin temporary bypass:**

1. Admin uses the branch-protection "Allow specific actors to bypass" (or disables "Do not allow bypassing" for the merge window) — one-time exception.
2. PR merges via admin bypass.
3. Admin replaces old-name checks with new-name checks in the required list post-merge.

Approach A keeps the "protected merge" invariant intact throughout; Approach B is simpler and acceptable for a solo-admin repo but leaves a brief window where `main` protection is weakened. This repo is solo-admin today, so Approach B is tolerable; Approach A remains preferred.

## 8. Verification strategy

### Local (pre-push)

1. `bun install` — regenerates `bun.lock`; inspect diff; confirm only Tauri plugin patches change, no unrelated deps.
2. `cd packages/ui/src-tauri && cargo update && cargo build --release` — regenerates `Cargo.lock`; verifies Rust 1.95 compiles all Tauri deps locally.
3. `bun run typecheck` — TS strict-mode sanity across all packages.
4. `bun run lint` — Biome check.
5. `bun test` — full unit suite.
6. `bun run test:ci` — executes `scripts/run-tests.ts`, the CI-parity test runner that mirrors the `_test-suite.yml` test steps locally.

### CI (post-push)

1. PR-gate jobs run on `ubuntu-24.04` (new name). Required: admin has already added new names to required-checks (Runbook A step 2).
2. Merge triggers push-to-`main` full matrix on all three new OS. Green = done.
3. If any OS platform fails: identify whether it's runner-OS-specific (revert OS commit) or toolchain-version-specific (narrow to the commit).

### E2E Desktop

- PR-gate E2E is opt-in via `ci:e2e-desktop` label. **Recommended to apply the label on this PR** to exercise the Tauri build + Playwright on `ubuntu-24.04` before merge, since the main reason OS bumps break is the GUI stack.

### Diagnostic environment print

In `_test-suite.yml`, add a step near the top of each test job:

```yaml
- name: Diagnostic — runtime environment
  shell: bash
  run: |
    echo "=== Runtime versions ==="
    bun --version
    rustc --version 2>/dev/null || echo "(rustc not installed on this job)"
    node --version 2>/dev/null || echo "(node not installed on this job)"
    if [ "$RUNNER_OS" = "Linux" ]; then
      ldd --version | head -1
    fi
```

Purpose: when a post-merge matrix failure happens on one platform, CI logs will already carry the exact versions, eliminating a round-trip to `ssh -tt` into a runner or add debug commits.

## 9. Rollback

### Option 1 — clean revert

`git revert -m 1 <merge-sha>` on `main`. All four logical commits revert atomically. Safe: no schema migrations, no data changes, no vault format changes.

### Option 2 — partial revert

If commits are structured per §10 (one concern per commit), cherry-revert only the failing concern's commit from `main`:

- If OS bump fails: revert commit 1 only. Node/Rust/Tauri stay.
- If Node 22 fails npm publish: revert commit 2 only.
- If Rust 1.95 MSRV triggers a local-dev-blocker: revert commit 3.
- If Tauri plugin patch causes regression: revert commit 4.

### Option 3 — forward-fix

Preferred if the fix is small (e.g., add `lib<foo>-dev` to apt-install on Ubuntu 24.04). New commit on `main`, full push matrix re-runs.

## 10. Commit structure on branch

Four logical commits for bisectability and partial-rollback support:

1. **`ci: bump runner OS to ubuntu-24.04 / macos-15 / windows-2025`**
   Edits: 36 runner-OS labels across all workflows + BRANCH_PROTECTION.md required-check names + typo fix + diagnostic env-print step in `_test-suite.yml` + glibc floor note in `docs/SECURITY.md`. (These changes all share the same root cause — the OS bump — so they belong in one commit for clean revert.)
2. **`ci: bump Node to 22 in publish-client workflow`**
   Edits: `publish-client.yml` `node-version`.
3. **`build(tauri): bump MSRV to 1.95 and regenerate Cargo.lock`**
   Edits: `Cargo.toml` `rust-version`, `Cargo.lock` regeneration.
4. **`build: regenerate bun.lock for Tauri plugin patches`**
   Edits: `bun.lock` regeneration.

PR description bundles the runbook from §7 as the top section.

## 11. Test plan checklist for PR description

- [ ] Local `bun install` clean, no unrelated lock diff.
- [ ] Local `cargo build --release` green with Rust 1.95.
- [ ] Local `bun run typecheck` green.
- [ ] Local `bun run lint` green.
- [ ] Local `bun test` green.
- [ ] Local `bun run test:ci` green (CI-parity runner).
- [ ] PR-gate CI green on `ubuntu-24.04` (ts + rust + duplication).
- [ ] `ci:e2e-desktop` label applied; PR E2E green.
- [ ] Admin has staged new-name required-checks per Runbook A before merge.
- [ ] Post-merge push matrix green on all three OS (ubuntu-24.04 / macos-15 / windows-2025).
- [ ] Post-merge: admin removes old-name required-checks from branch protection.
- [ ] Post-merge: `BRANCH_PROTECTION.md` rendered on GitHub reflects new names.

## 12. Acceptance criteria

1. PR merges on `main` with full 3-OS push-matrix green.
2. `gh workflow run release.yml` dry-run (if feasible on a throwaway tag) demonstrates macOS / Windows / Linux release bundles still build. Optional stretch goal; not blocking if release.yml only fires on real tags.
3. `@nimbus-dev/client` npm publish workflow passes a dry-run under Node 22 (triggered by `client-v*` tag — can be tested on a pre-release tag).
4. `BRANCH_PROTECTION.md` on `main` reflects new job names and is internally consistent with `ci.yml` actual names.
5. No new open Dependabot PRs created during this branch's lifetime that would conflict with the four logical commits (monitor and coordinate with Dependabot by either merging its PRs first or rebasing on top).

## 13. Follow-up specs and tickets (explicitly out of scope here)

**Follow-up specs:**

1. **`2026-04-??-third-party-package-upgrades-design.md`** — npm (`@mastra/*`, React ecosystem, Radix, Zustand, `@xenova/transformers`, etc.) + cargo crates (`serde_json`, `tokio`, `interprocess`, `thiserror`, etc.).
2. **`2026-04-??-code-quality-audit-design.md`** — security / performance / SOLID / duplication / bug-hunt audit producing a prioritized finding list. Each finding becomes its own small PR triaged against Phase 4 workstream priority.

**Smaller follow-up tickets (do not need full specs):**

3. **Developer-environment doctor check** — a new command (e.g., `nimbus doctor --dev` or a `scripts/dev/check-toolchain.sh`) that validates local Rust ≥ 1.95, Node ≥ 22, Bun ≥ 1.3, and a git pre-commit hook installed. Intentionally *separate* from `nimbus doctor` (end-user command), per review feedback Q1. Low priority.
4. **Friendlier glibc preflight** — optional check at Gateway startup (or in `nimbus-verify.sh`) that detects the host's glibc version and prints an actionable message if below 2.39 before the dynamic-linker error fires. Low priority; the default error is already parseable by humans.
5. **Wildcard / OS-agnostic job names** — rename CI jobs from `PR quality — TS/Bun (ubuntu-24.04)` to `PR quality — TS/Bun (linux)` (or drop OS suffix entirely) so future runner-OS refreshes don't require a branch-protection dance. Medium priority; tied into the next OS refresh.
6. **Tauri plugin minor-version pinning** — switch `tauri-plugin-* = "2"` → `"2.x"` (or explicit minor) in `Cargo.toml` / `package.json` and let Dependabot propose minor bumps. Low priority; current floating-major is fine.

## 14. Dependabot coordination

Dependabot runs weekly on this repo for `bun`, `cargo`, and `github-actions` ecosystems (see `.github/dependabot.yml`). During the lifetime of this branch (expected ≤ a few days), Dependabot may open new PRs that touch `bun.lock`, `Cargo.lock`, or action SHA pins — potentially conflicting with commits 3 and 4 of this branch.

**Preferred strategy:**

1. **Merge Dependabot PRs first, then rebase this branch.** Dependabot PRs are typically single-line lockfile bumps; they are cheap to merge and leave our branch's lockfile-regeneration commits to pick up the already-merged changes when rebased on `main`.
2. **Do not merge this branch's lockfile commits while a Dependabot lockfile PR is open.** If both land in the same week there's a low risk of textual conflict even though semantically both are "regenerate from current manifest."
3. **If a Dependabot PR opens a *major* bump** (e.g., a framework upgrade that exits `.github/dependabot.yml`'s ignore-list), defer it entirely — that PR's change is out of scope for the toolchain-refresh spec.

## 15. Sources

- [Bun v1.3.12 release notes](https://bun.com/blog)
- [Node.js release schedule](https://github.com/nodejs/Release)
- [Node 20 EOL = 2026-04-30](https://nodejs.org/en/about/previous-releases)
- [Rust 1.95.0 release](https://blog.rust-lang.org/releases/latest/)
- [Tauri releases](https://github.com/tauri-apps/tauri/releases)
- [GitHub Actions runner images](https://github.com/actions/runner-images)
