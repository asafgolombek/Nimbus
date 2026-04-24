# Toolchain & Runner OS Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land a single PR on `dev/asafgolombek/upgrade_packages` that bumps CI runner OS labels to ubuntu-24.04 / macos-15 / windows-2025, updates Node 20 → 22, bumps Rust MSRV 1.88.0 → 1.95.0, regenerates lockfiles to pick up Tauri plugin patch-level updates, and documents the new Linux glibc floor.

**Architecture:** Pure infrastructure refresh — no production code changes. Four logical commits for bisectability and partial rollback: (1) OS bump bundle with supporting doc updates, (2) Node 22, (3) Rust MSRV + Cargo.lock, (4) bun.lock. Validation is via existing test suites + post-merge CI matrix; no new tests required because no new behavior is added.

**Tech Stack:** GitHub Actions workflows (YAML), Bun 1.3.x, Rust 1.95.0 toolchain, Node 22 LTS, Tauri 2.10.3 + plugins, macOS 15 / Windows 2025 / Ubuntu 24.04 runners. Related spec: [`docs/superpowers/specs/2026-04-24-toolchain-runner-os-refresh-design.md`](../specs/2026-04-24-toolchain-runner-os-refresh-design.md).

**Spec summary:** [§ 1–15 of the design spec]. Key non-negotiables: license fields unchanged, no type `any` introduced, no HITL/Vault/PAL changes, no new production dependencies.

---

## Task 1: Baseline verification

**Files:** none modified — read-only inspection.

- [ ] **Step 1: Confirm you are on the upgrade branch with a clean tree**

Run:
```bash
git status --short && git branch --show-current
```
Expected output:
```
<empty>
dev/asafgolombek/upgrade_packages
```
If the working tree is dirty, stop and resolve before proceeding.

- [ ] **Step 2: Record local toolchain versions for later comparison**

Run:
```bash
bun --version && rustc --version && node --version
```
Expected (approximate — exact patch versions may differ):
```
1.3.11
rustc 1.88.0 (6b00bc388 2025-06-23)
v24.14.0
```
Note these down. After the Rust MSRV bump (Task 8) we want `cargo build` to still succeed with your locally-installed Rust; if it's < 1.95.0, run `rustup update stable` before Task 8.

- [ ] **Step 3: Run the baseline CI-parity suite to confirm green starting state**

Run:
```bash
bun run test:ci
```
Expected: exit code 0. If any test fails on the clean baseline, STOP — the refresh PR must start from a green baseline, otherwise failures later can't be attributed to the refresh.

Duration: 3–10 minutes depending on machine.

---

## Task 2: Runner OS bump — ci.yml

**Files:**
- Modify: `.github/workflows/ci.yml` (12 occurrences)

- [ ] **Step 1: Replace all ubuntu-22.04 / macos-14 / windows-2022 references**

In `.github/workflows/ci.yml`, make these exact replacements:
- Line 21: `runs-on: ubuntu-22.04` → `runs-on: ubuntu-24.04`
- Line 57: `name: PR quality — TS/Bun (ubuntu-22.04)` → `name: PR quality — TS/Bun (ubuntu-24.04)`
- Line 61: `runner: ubuntu-22.04` → `runner: ubuntu-24.04`
- Line 71: `name: PR quality — Rust/Tauri (ubuntu-22.04)` → `name: PR quality — Rust/Tauri (ubuntu-24.04)`
- Line 74: `runs-on: ubuntu-22.04` → `runs-on: ubuntu-24.04`
- Line 97: `runs-on: ubuntu-22.04` → `runs-on: ubuntu-24.04`
- Line 129: `os: [ubuntu-22.04, macos-14, windows-2022]` → `os: [ubuntu-24.04, macos-15, windows-2025]`
- Line 134: `run-packaging: ${{ matrix.os == 'ubuntu-22.04' }}` → `run-packaging: ${{ matrix.os == 'ubuntu-24.04' }}`
- Line 145: `os: [ubuntu-22.04, macos-14, windows-2022]` → `os: [ubuntu-24.04, macos-15, windows-2025]`
- Line 170: `name: E2E Desktop (PR) — ubuntu-22.04` → `name: E2E Desktop (PR) — ubuntu-24.04`
- Line 173: `runs-on: ubuntu-22.04` → `runs-on: ubuntu-24.04`
- Line 240: `os: [ubuntu-22.04, macos-14, windows-2022]` → `os: [ubuntu-24.04, macos-15, windows-2025]`

Line numbers are as of the baseline commit; adjust if the file has moved.

- [ ] **Step 2: Verify all old OS labels are gone from ci.yml**

Run:
```bash
grep -n "ubuntu-22.04\|macos-14\|windows-2022" .github/workflows/ci.yml
```
Expected output: empty (exit code 1).
If any match remains, go back and fix it.

---

## Task 3: Runner OS bump — release.yml

**Files:**
- Modify: `.github/workflows/release.yml` (10 occurrences — `macos-15-intel` stays)

- [ ] **Step 1: Replace OS labels, preserving macos-15-intel**

In `.github/workflows/release.yml`, make these exact replacements (leave `macos-15-intel` untouched):
- Line 19: `runs-on: ubuntu-22.04` → `runs-on: ubuntu-24.04`
- Line 50: `runner: ubuntu-22.04` → `runner: ubuntu-24.04`
- Line 70: `runner: ubuntu-22.04` → `runner: ubuntu-24.04`
- Line 75: `runner: macos-15-intel` → **no change** (already current)
- Line 80: `runner: macos-14` → `runner: macos-15`
- Line 84: `runner: windows-2022` → `runner: windows-2025`
- Line 150: `runner: ubuntu-22.04` → `runner: ubuntu-24.04`
- Line 154: `runner: macos-15-intel` → **no change**
- Line 159: `runner: macos-14` → `runner: macos-15`
- Line 163: `runner: windows-2022` → `runner: windows-2025`
- Line 206: `runs-on: ubuntu-22.04` → `runs-on: ubuntu-24.04`
- Line 411: `runs-on: ubuntu-22.04` → `runs-on: ubuntu-24.04`

- [ ] **Step 2: Verify**

Run:
```bash
grep -n "ubuntu-22.04\|macos-14\b\|windows-2022" .github/workflows/release.yml
```
Expected: empty. Note the `\b` word boundary so `macos-15-intel` is not matched. Also verify `macos-15-intel` still appears on lines 75 and 154:
```bash
grep -n "macos-15-intel" .github/workflows/release.yml
```
Expected: lines 75 and 154 (or equivalent post-edit line numbers).

---

## Task 4: Runner OS bump — security.yml, codeql.yml, benchmark.yml, scorecard.yml, publish-client.yml

**Files:**
- Modify: `.github/workflows/security.yml` (6 occurrences, all ubuntu-22.04)
- Modify: `.github/workflows/codeql.yml` (2 occurrences, all ubuntu-22.04)
- Modify: `.github/workflows/benchmark.yml` (1 occurrence, ubuntu-22.04)
- Modify: `.github/workflows/scorecard.yml` (1 occurrence, ubuntu-22.04)
- Modify: `.github/workflows/publish-client.yml` (1 occurrence — OS only; `node-version` bump is separate in Task 11)

- [ ] **Step 1: Bulk replace ubuntu-22.04 → ubuntu-24.04 in these files**

These are all `runs-on: ubuntu-22.04` single-line replacements. Use one Edit per file with `replace_all: true`:

For each of the files above, replace `ubuntu-22.04` with `ubuntu-24.04`.

- [ ] **Step 2: Verify all five files**

Run:
```bash
grep -n "ubuntu-22.04\|macos-14\|windows-2022" \
  .github/workflows/security.yml \
  .github/workflows/codeql.yml \
  .github/workflows/benchmark.yml \
  .github/workflows/scorecard.yml \
  .github/workflows/publish-client.yml
```
Expected: empty.

- [ ] **Step 3: Confirm `publish-client.yml` still has `node-version: "20"`**

Run:
```bash
grep -n "node-version" .github/workflows/publish-client.yml
```
Expected: `42:          node-version: "20"` (Node bump is intentionally deferred to Task 11).

---

## Task 5: Runner OS bump — _test-suite.yml description comment + add diagnostic step

**Files:**
- Modify: `.github/workflows/_test-suite.yml` (1 comment + new ~12-line step)

- [ ] **Step 1: Update the `runner` input description to reference current OS**

Edit `.github/workflows/_test-suite.yml` line 9:
- Old: `        description: GitHub-hosted runner label (e.g. ubuntu-22.04)`
- New: `        description: GitHub-hosted runner label (e.g. ubuntu-24.04)`

This is a documentation comment only — doesn't affect runner selection.

- [ ] **Step 2: Insert the diagnostic environment-print step in the `test` job**

In `.github/workflows/_test-suite.yml`, insert this step between the `Setup Bun and install dependencies` step (ends at line 41) and the `Linux — libsecret + D-Bus` step (starts at line 43):

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

Place it after `Setup Bun and install dependencies` so Bun is already on PATH. Do NOT add this to the `coverage-gates` job — that job inherits from `test` via `needs: test`, and runs on the same OS, so duplicating the diagnostic adds log noise without new signal.

- [ ] **Step 3: Verify the file parses as valid YAML**

Run:
```bash
bunx yaml --file .github/workflows/_test-suite.yml >/dev/null 2>&1 && echo "OK" || echo "INVALID YAML"
```
Expected: `OK`. If invalid, re-check indentation — YAML is indentation-sensitive.

(Alternative if `bunx yaml` is unavailable: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/_test-suite.yml'))"` — or just rely on the CI run to catch it.)

---

## Task 6: Update BRANCH_PROTECTION.md (new check names + typo fix)

**Files:**
- Modify: `.github/BRANCH_PROTECTION.md` (lines 63–73 required-checks table)

- [ ] **Step 1: Replace the required-checks table**

Edit `.github/BRANCH_PROTECTION.md` — find this block (approx lines 63–73):

```markdown
## Recommended required status checks

After workflows have run at least once, add as **required checks**:

| Check | Workflow | When it runs |
|--------|-----------|----------------|
| **PR quality — ubuntu-22.04** | CI | Every pull request |
| **E2E Desktop (PR) — ubuntu-22.04** | CI | Every pull request (Tauri + Playwright) |
| **Security** jobs | Security | Every pull request (`Dependency audit`, `Trivy vulnerability scan`, `Gateway audit JSON + connector.remove vault restore`, `Cargo audit (Tauri)`) |
| **Analyze (JavaScript / TypeScript)** | CodeQL | Pull requests and pushes |
| **CI —** `ubuntu-22.04` / `macos-14` / `windows-2022` | CI | Pushes to `main` / `develop` (full matrix) |
```

Replace with:

```markdown
## Recommended required status checks

After workflows have run at least once, add as **required checks**:

| Check | Workflow | When it runs |
|--------|-----------|----------------|
| **PR quality — TS/Bun (ubuntu-24.04)** | CI | Every pull request |
| **PR quality — Rust/Tauri (ubuntu-24.04)** | CI | Every pull request (when `packages/ui/src-tauri/` changes) |
| **PR quality — Duplication scan** | CI | Every pull request |
| **E2E Desktop (PR) — ubuntu-24.04** | CI | Every pull request carrying the `ci:e2e-desktop` label |
| **Security** jobs | Security | Every pull request (`Dependency audit`, `Trivy vulnerability scan`, `Gateway audit JSON + connector.remove vault restore`, `Cargo audit (Tauri)`) |
| **Analyze (JavaScript / TypeScript)** | CodeQL | Pull requests and pushes |
| **CI — TS/Bun (ubuntu-24.04)** / **CI — TS/Bun (macos-15)** / **CI — TS/Bun (windows-2025)** | CI | Pushes to `main` / `develop` (TS/Bun matrix) |
| **CI — Rust/Tauri (ubuntu-24.04)** / **CI — Rust/Tauri (macos-15)** / **CI — Rust/Tauri (windows-2025)** | CI | Pushes to `main` / `develop` (Rust/Tauri matrix) |
```

Note the changes:
1. `PR quality — ubuntu-22.04` → `PR quality — TS/Bun (ubuntu-24.04)` (fixes pre-existing typo — doc omitted `TS/Bun` qualifier that exists in `ci.yml` line 57)
2. Added new row for `PR quality — Rust/Tauri (ubuntu-24.04)` (existed in workflow but missing from doc)
3. Added new row for `PR quality — Duplication scan` (existed in workflow but missing from doc)
4. `E2E Desktop (PR) — ubuntu-22.04` → `E2E Desktop (PR) — ubuntu-24.04`
5. Rebuilt the push-matrix row as two explicit rows (TS/Bun + Rust/Tauri) with all three OSes — previous doc conflated them into one row.

- [ ] **Step 2: Verify the doc mentions no stale OS**

Run:
```bash
grep -n "ubuntu-22.04\|macos-14\|windows-2022" .github/BRANCH_PROTECTION.md
```
Expected: empty.

---

## Task 7: Update supporting reference docs that describe the CI runners

**Files:**
- Modify: `docs/architecture.md` (2 occurrences on lines 67 and 1190)
- Modify: `docs/README.md` (1 occurrence on line 367)
- Modify: `docs/security-hardening.md` (1 occurrence on line 24)
- Modify: `.claude/commands/nimbus-testing.md` (1 occurrence on line 286)

These docs describe the *current* CI runner state for contributors; they must match reality after the bump. Historical spec/plan docs under `docs/superpowers/` are intentionally left unchanged (they're frozen snapshots of prior decisions).

- [ ] **Step 1: Update docs/architecture.md**

In `docs/architecture.md`, make these replacements:
- Line 67: `| **CI runner** | \`windows-2022\` | \`macos-14\` | \`ubuntu-22.04\` |` → `| **CI runner** | \`windows-2025\` | \`macos-15\` | \`ubuntu-24.04\` |`
- Line 1190: `same steps on \`ubuntu-22.04\`, \`macos-14\`, \`windows-2022\` in parallel` → `same steps on \`ubuntu-24.04\`, \`macos-15\`, \`windows-2025\` in parallel`

- [ ] **Step 2: Update docs/README.md**

In `docs/README.md` line 367: `| **CI runner** | \`windows-2022\` | \`macos-14\` | \`ubuntu-22.04\` |` → `| **CI runner** | \`windows-2025\` | \`macos-15\` | \`ubuntu-24.04\` |`

- [ ] **Step 3: Update docs/security-hardening.md**

In `docs/security-hardening.md` line 24, update the referenced check names to match BRANCH_PROTECTION.md changes from Task 6. Specifically, replace:
- `**PR quality — ubuntu-22.04**` → `**PR quality — TS/Bun (ubuntu-24.04)**`
- `**E2E Desktop (PR) — ubuntu-22.04**` → `**E2E Desktop (PR) — ubuntu-24.04**`

- [ ] **Step 4: Update .claude/commands/nimbus-testing.md**

In `.claude/commands/nimbus-testing.md` line 286: `Full 3-platform matrix: \`windows-2022\`, \`macos-14\`, \`ubuntu-22.04\`` → `Full 3-platform matrix: \`windows-2025\`, \`macos-15\`, \`ubuntu-24.04\``

- [ ] **Step 5: Verify all four docs**

Run:
```bash
grep -n "ubuntu-22.04\|macos-14\|windows-2022" \
  docs/architecture.md \
  docs/README.md \
  docs/security-hardening.md \
  .claude/commands/nimbus-testing.md
```
Expected: empty.

- [ ] **Step 6: Skip-confirm that historical spec/plan docs are intentionally untouched**

Run:
```bash
grep -l "ubuntu-22.04\|macos-14\|windows-2022" docs/superpowers/ -r 2>/dev/null | sort
```
Expected to still return:
```
docs/superpowers/plans/2026-04-23-signing-pipeline.md
docs/superpowers/plans/2026-04-24-ws7-vscode-extension.md
docs/superpowers/specs/2026-04-23-signing-pipeline-design.md
docs/superpowers/specs/2026-04-24-toolchain-runner-os-refresh-design.md
docs/superpowers/specs/2026-04-24-toolchain-runner-os-refresh-review.md
```
These are intentionally left — signing-pipeline and ws7 are frozen historical specs; the toolchain-refresh design/review docs describe the transition itself and must keep the old-name references to be readable.

---

## Task 8: Add glibc floor note to docs/SECURITY.md

**Files:**
- Modify: `docs/SECURITY.md` (insert after line 12, before the `---` on line 14)

- [ ] **Step 1: Add the platform support note**

In `docs/SECURITY.md`, locate this section (lines 3–14):

```markdown
## Supported Versions

Nimbus is in active development (Phase 4 — Presence; Phase 3.5 Observability is complete). Only the latest commit on `main` receives security fixes. There are no stable release branches yet.

| Branch / Tag | Supported |
|---|---|
| `main` (HEAD) | ✅ Yes |
| Older commits | ❌ No |

Once versioned releases begin (target: Phase 4 — `v0.1.0`), this table will be updated with a supported version range.

---
```

Insert a new subsection immediately **before** the `---` on line 14:

```markdown
### Linux runtime support — glibc floor

Starting with releases built on or after 2026-04-24, Nimbus Linux binaries are compiled on Ubuntu 24.04 runners and require **glibc ≥ 2.39** at runtime. Supported distros (tested): Ubuntu 24.04+, Fedora 40+, Debian 13+, Arch and other current rolling releases. Older distros (Ubuntu 22.04 LTS, Debian 12, RHEL 9 and their derivatives) will emit a `GLIBC_2.39 not found` dynamic-linker error on launch; no workaround beyond upgrading the host OS.

macOS and Windows binaries are unaffected by this change.
```

Resulting structure:
```markdown
## Supported Versions

...table...

Once versioned releases begin (...), this table will be updated...

### Linux runtime support — glibc floor

...new paragraph...

---
```

- [ ] **Step 2: Verify**

Run:
```bash
grep -A2 "glibc" docs/SECURITY.md | head -10
```
Expected: shows the new paragraph.

---

## Task 9: Commit 1 — OS bump bundle

**Files:** all files touched in Tasks 2–8 (9 workflows + 5 docs).

- [ ] **Step 1: Review staged changes before commit**

Run:
```bash
git add .github/workflows/ci.yml .github/workflows/release.yml .github/workflows/security.yml \
  .github/workflows/codeql.yml .github/workflows/benchmark.yml .github/workflows/scorecard.yml \
  .github/workflows/publish-client.yml .github/workflows/_test-suite.yml \
  .github/BRANCH_PROTECTION.md docs/architecture.md docs/README.md \
  docs/security-hardening.md .claude/commands/nimbus-testing.md docs/SECURITY.md
git diff --cached --stat
```
Expected: ~14 files changed, ~80 lines modified total (exact count varies).

- [ ] **Step 2: Commit with the agreed message**

Run:
```bash
git commit -m "$(cat <<'EOF'
ci: bump runner OS to ubuntu-24.04 / macos-15 / windows-2025

- Replace all ubuntu-22.04 / macos-14 / windows-2022 labels across
  ci/release/security/codeql/benchmark/scorecard/publish-client workflows
  (macos-15-intel preserved for Intel release builds).
- Add diagnostic env-print step in _test-suite.yml to surface runtime
  versions (bun/rustc/node/ldd) at the top of each test job.
- Update BRANCH_PROTECTION.md required-check table to new job names
  and fix pre-existing typo (missing "TS/Bun" qualifier).
- Update architecture.md / README.md / security-hardening.md /
  .claude/commands/nimbus-testing.md CI-runner references.
- Document glibc >= 2.39 Linux runtime floor in docs/SECURITY.md.

Branch protection: admin must add new-name required checks to the
ruleset before pushing, then remove old-name entries after this PR's
CI passes — see design spec section 7.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Verify commit landed**

Run:
```bash
git log --oneline -1
```
Expected: first word of summary starts with `ci: bump runner OS...`.

---

## Task 10: Node 22 bump in publish-client.yml + Commit 2

**Files:**
- Modify: `.github/workflows/publish-client.yml` (line 42)

- [ ] **Step 1: Bump node-version**

In `.github/workflows/publish-client.yml`, replace:
- Line 42: `          node-version: "20"` → `          node-version: "22"`

- [ ] **Step 2: Verify**

Run:
```bash
grep -n "node-version" .github/workflows/publish-client.yml
```
Expected: `42:          node-version: "22"`.

Also re-grep that Node 20 is gone from the repo entirely:
```bash
grep -rn 'node-version: *"20"\|setup-node.*node-version.*20' .github/ 2>/dev/null
```
Expected: empty.

- [ ] **Step 3: Commit**

Run:
```bash
git add .github/workflows/publish-client.yml
git commit -m "$(cat <<'EOF'
ci: bump Node to 22 LTS in publish-client workflow

Node 20 reaches End-of-Life 2026-04-30. Bump to Node 22 (Active LTS,
supported through 2027-04).

Only the client-publish workflow invokes Node directly — all other CI
executes via Bun, so this is the sole setup-node reference in the repo.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Rust MSRV bump in Cargo.toml

**Files:**
- Modify: `packages/ui/src-tauri/Cargo.toml` (line 9)

- [ ] **Step 1: Bump rust-version**

In `packages/ui/src-tauri/Cargo.toml`, replace:
- Line 9: `rust-version = "1.88.0"` → `rust-version = "1.95.0"`

- [ ] **Step 2: Verify**

Run:
```bash
grep -n "rust-version" packages/ui/src-tauri/Cargo.toml
```
Expected: `9:rust-version = "1.95.0"`.

- [ ] **Step 3: Verify local Rust meets the new MSRV**

Run:
```bash
rustc --version
```
If output is below `1.95.0`, run:
```bash
rustup update stable
rustc --version
```
Re-verify it is now ≥ 1.95.0 before proceeding. (This is a soft gate — CI uses `dtolnay/rust-toolchain@stable` which always installs current-stable, so CI will pass either way, but local dev after this commit will require ≥ 1.95.)

---

## Task 12: Regenerate Cargo.lock and verify + Commit 3

**Files:**
- Modify: `packages/ui/src-tauri/Cargo.lock` (regenerated)

- [ ] **Step 1: Regenerate the lockfile**

Run:
```bash
cd packages/ui/src-tauri && cargo update
```
Expected output: a list of `Updating` lines for crates that have newer versions within existing SemVer ranges (mainly `tauri-plugin-*` patch bumps and transitive deps).

- [ ] **Step 2: Verify the workspace still builds**

Run (still in `packages/ui/src-tauri`):
```bash
cargo build --release
```
Expected: compiles successfully. First build after `cargo update` may re-download and re-build from scratch (~2–8 minutes depending on machine).

If the build fails with a MSRV-related error on a transitive crate:
- Either the transitive crate's newer version raised ITS MSRV above 1.95 — use `cargo update -p <crate> --precise <older-version>` to pin back.
- Or the MSRV bump exposed a latent compilation issue — stop and investigate.

- [ ] **Step 3: Return to repo root and review the diff**

Run:
```bash
cd ../../.. && git diff --stat packages/ui/src-tauri/Cargo.lock
```
Expected: shows insertions/deletions to `Cargo.lock` (usually 20–100 line changes for patch bumps).

- [ ] **Step 4: Commit**

Run:
```bash
git add packages/ui/src-tauri/Cargo.toml packages/ui/src-tauri/Cargo.lock
git commit -m "$(cat <<'EOF'
build(tauri): bump MSRV to 1.95.0 and regenerate Cargo.lock

Bumps rust-version from 1.88.0 (June 2025) to 1.95.0 (April 2026) in
packages/ui/src-tauri/Cargo.toml. CI uses dtolnay/rust-toolchain@stable
(current-stable; already >= 1.95) so this only affects local dev.

Cargo.lock regenerated via `cargo update` — picks up patch-level bumps
within existing SemVer ranges (primarily tauri-plugin-* and transitive
deps). No manifest dependency changes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Regenerate bun.lock + Commit 4

**Files:**
- Modify: `bun.lock` (regenerated)

- [ ] **Step 1: Confirm the working tree is clean except for anything you've deliberately not yet committed**

Run:
```bash
git status --short
```
Expected: empty.

- [ ] **Step 2: Run bun install to refresh the lockfile**

Run:
```bash
bun install
```
Expected: short output ending in "Done." If any `@tauri-apps/plugin-*` or other package has a newer patch version available under the existing `^2` range, `bun.lock` will update.

- [ ] **Step 3: Inspect the diff**

Run:
```bash
git diff --stat bun.lock
```
Expected:
- Empty diff means no package had a newer patch available — totally fine, skip to Step 5.
- Non-empty diff means some `@tauri-apps/plugin-*` or transitive dep bumped within its SemVer range.

If non-empty, preview what changed:
```bash
git diff bun.lock | head -40
```
Expected: only lines containing versions, hashes, and dependency-graph entries — no new top-level package names appearing. (If a new top-level dep appears, something unexpected is going on — stop and investigate.)

- [ ] **Step 4: Verify nothing else regressed with the new lockfile**

Run:
```bash
bun run typecheck && bun run lint
```
Expected: exit code 0 on both.

- [ ] **Step 5: Commit (if bun.lock changed) or skip (if no diff)**

If `git diff --stat bun.lock` showed changes:
```bash
git add bun.lock
git commit -m "$(cat <<'EOF'
build: regenerate bun.lock for @tauri-apps/plugin-* patch bumps

Regenerates the JS lockfile to pick up patch-level updates for
@tauri-apps/plugin-* and transitive Vite/Vitest/React-ecosystem
dependencies within existing SemVer ranges. No package.json changes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If the diff was empty, proceed to Task 14 without creating a commit (don't create empty commits).

---

## Task 14: Full CI-parity local run

**Files:** none modified — validation only.

- [ ] **Step 1: Run the CI-parity suite end-to-end**

Run:
```bash
bun run test:ci
```
Expected: exit code 0. This mirrors the `_test-suite.yml` steps: lockfile integrity, typecheck, lint, build, unit tests (with coverage), integration tests, e2e, UI component tests, and VS Code extension tests.

Duration: 5–15 minutes.

If any test fails:
- **Typecheck failures:** most likely a regenerated @types/* package tightened types. Fix and amend the relevant commit.
- **Unit test failures:** inspect which test; regressions here are unexpected — likely a Bun 1.3.12 behavior drift. Stop and investigate.
- **Lint failures:** run `bun run lint:fix` and amend the relevant commit.
- **Integration test failures on Linux without d-bus:** normal when running outside the `run-with-optional-dbus.sh` wrapper — these are gated in CI to run only when the right env is present.

- [ ] **Step 2: Confirm no untracked files leaked in**

Run:
```bash
git status --short
```
Expected: empty.

If `bun install` or `cargo update` regenerated any file you haven't committed, decide whether it belongs in an existing commit (amend) or a new commit.

---

## Task 15: Push branch and coordinate with admin for branch-protection

**Files:** none modified — operational step.

- [ ] **Step 1: Inspect the four-commit series before pushing**

Run:
```bash
git log --oneline @{u}..HEAD 2>/dev/null || git log --oneline origin/main..HEAD
```
Expected: 4–5 commits (4 planned commits + optionally the bun.lock commit if it was a no-op):
- `ci: bump runner OS to ubuntu-24.04 / macos-15 / windows-2025`
- `ci: bump Node to 22 LTS in publish-client workflow`
- `build(tauri): bump MSRV to 1.95.0 and regenerate Cargo.lock`
- `build: regenerate bun.lock for @tauri-apps/plugin-* patch bumps` (optional)
- Plus the earlier spec/review commits from the brainstorming session.

- [ ] **Step 2: BEFORE pushing — admin pre-stage required checks**

Per design spec § 7 Runbook A, the repo admin (AsafGolombek) must first add new-name required checks to branch protection:

1. Open **GitHub → Settings → Rules → Rulesets** (or **Branches** if using classic rules).
2. Edit the ruleset that targets `main`.
3. Under **Require status checks to pass**, **add** these new-name checks (keep existing old-name entries for now):
   - `PR quality — TS/Bun (ubuntu-24.04)`
   - `PR quality — Rust/Tauri (ubuntu-24.04)`
   - `PR quality — Duplication scan` (may already exist; check)
   - `E2E Desktop (PR) — ubuntu-24.04` (optional — only if you'll apply the `ci:e2e-desktop` label to this PR)
   - Security workflow checks (names unchanged; verify still required)
   - `Analyze (JavaScript / TypeScript)` (name unchanged; verify still required)
4. Save. Do NOT yet remove old-name entries — they will block this PR's merge until step 5 below.

- [ ] **Step 3: Push the branch**

Run:
```bash
git push -u origin dev/asafgolombek/upgrade_packages
```

- [ ] **Step 4: Open the PR**

Run:
```bash
gh pr create --title "ci: bump runner OS / Node 22 / Rust MSRV 1.95 / Tauri plugin patches" --body "$(cat <<'EOF'
## Summary

- Runner OS bump: `ubuntu-22.04` → `ubuntu-24.04`, `macos-14` → `macos-15`, `windows-2022` → `windows-2025` (`macos-15-intel` preserved for Intel builds).
- Node 20 → 22 in `publish-client.yml` (Node 20 EOL on 2026-04-30).
- Rust MSRV 1.88.0 → 1.95.0; regenerated `Cargo.lock` and `bun.lock` to pick up patch-level updates for Tauri plugins and transitive deps.
- Added diagnostic env-print step to `_test-suite.yml` for easier post-bump debugging.
- Documented the new Linux glibc ≥ 2.39 runtime floor in `docs/SECURITY.md`.
- Updated `BRANCH_PROTECTION.md`, `architecture.md`, `README.md`, `security-hardening.md`, and `.claude/commands/nimbus-testing.md` to reference new OS/job names.

Spec: [`docs/superpowers/specs/2026-04-24-toolchain-runner-os-refresh-design.md`](../blob/dev/asafgolombek/upgrade_packages/docs/superpowers/specs/2026-04-24-toolchain-runner-os-refresh-design.md)

## Branch-protection runbook (admin action required)

Before this PR can merge, the required-status-checks list in branch protection must reference the **new** OS-suffixed check names (see spec § 7 Runbook A):

1. ✅ Admin adds new-name checks to required list (done before push).
2. CI runs on this PR under new names → passes.
3. Admin removes old-name checks (`PR quality — ubuntu-22.04`, `E2E Desktop (PR) — ubuntu-22.04`, `CI — ubuntu-22.04 / macos-14 / windows-2022`) from required list.
4. PR merges.
5. Push-to-main full matrix runs under new names → if green, rollout complete.

## Test plan

- [x] Local `bun run test:ci` green (CI-parity runner).
- [x] Local `cargo build --release` green with Rust 1.95.0.
- [ ] PR-gate CI green on `ubuntu-24.04` (TS/Bun + Rust/Tauri + Duplication scan).
- [ ] `ci:e2e-desktop` label applied; E2E Desktop PR job green on `ubuntu-24.04`.
- [ ] Post-merge push matrix green on all three OS (`ubuntu-24.04` / `macos-15` / `windows-2025`).
- [ ] Post-merge: admin removes old-name required checks from branch protection.
- [ ] Post-merge: `BRANCH_PROTECTION.md` rendered on GitHub reflects new names.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Apply the ci:e2e-desktop label (recommended)**

Run:
```bash
gh pr edit --add-label "ci:e2e-desktop"
```
This triggers the desktop E2E workflow on the PR — worth exercising because the main place OS bumps break is the GUI stack (Tauri build + Playwright).

- [ ] **Step 6: Watch the PR checks**

Run:
```bash
gh pr checks --watch
```
Expected: all required checks green within 15–45 minutes (depending on whether E2E Desktop runs).

If any check fails:
- **PR quality — Rust/Tauri:** likely Rust toolchain or Tauri compile issue on ubuntu-24.04. Inspect logs, fix forward.
- **PR quality — TS/Bun:** likely Node/Bun version difference or missing apt package on 24.04. Inspect logs.
- **E2E Desktop:** likely Playwright browser install, Tauri WebDriver setup, or xvfb on 24.04. Inspect logs.

If the fix is small, commit on the branch and push; CI re-runs.

- [ ] **Step 7: Admin finalizes branch-protection**

Once this PR's required checks are all green:

1. Admin returns to **Settings → Rules → Rulesets**.
2. **Removes** the old-name required checks:
   - `PR quality — ubuntu-22.04`
   - `E2E Desktop (PR) — ubuntu-22.04`
   - `CI — TS/Bun (ubuntu-22.04)`, `CI — TS/Bun (macos-14)`, `CI — TS/Bun (windows-2022)`
   - `CI — Rust/Tauri (ubuntu-22.04)`, `CI — Rust/Tauri (macos-14)`, `CI — Rust/Tauri (windows-2022)`
3. Saves.
4. The PR now passes branch protection.

- [ ] **Step 8: Merge**

Run:
```bash
gh pr merge --squash --auto
```
Or use the GitHub UI — merge method per repo convention (note: previous PRs in this repo used merge commits, not squash — check `git log --oneline -5 main` convention before choosing).

- [ ] **Step 9: Post-merge — watch the main-branch push matrix**

Run:
```bash
gh run list --workflow=ci.yml --branch=main --limit 1
gh run watch $(gh run list --workflow=ci.yml --branch=main --limit 1 --json databaseId -q '.[0].databaseId')
```
Expected: all three OSes in the TS/Bun matrix and Rust/Tauri matrix green.

If any OS fails on the push matrix:
- If the failure is clearly OS-specific (e.g., "apt package X not found on 24.04"), fix-forward with a new PR that adds the missing package.
- If the failure is deep/unknown and time-pressing, revert the merge with `git revert -m 1 <merge-sha>` and iterate.

- [ ] **Step 10: Verify main's subsequent PR experience**

Open any small follow-up PR (even a README tweak) and confirm:
- New-name checks run and are marked required.
- Old-name checks do not appear in the required list.
- PR merge unblocks cleanly.

This confirms the branch-protection migration is fully complete.

---

## Spec coverage check

Design spec sections mapped to tasks:

| Spec § | Requirement | Task(s) |
|---|---|---|
| § 2.1 | Runner OS bumps (36 refs) | 2, 3, 4, 5 |
| § 2.2 | Node 20 → 22 in publish-client | 10 |
| § 2.3 | Rust MSRV 1.88.0 → 1.95.0 | 11 |
| § 2.4 | Cargo.lock regeneration | 12 |
| § 2.5 | bun.lock regeneration | 13 |
| § 2.6 | BRANCH_PROTECTION.md update + typo fix | 6 |
| § 2.7 | PR description + runbook | 15 |
| § 2.8 | Diagnostic env-print step | 5 |
| § 2.9 | glibc floor note in SECURITY.md | 8 |
| § 7 | Branch-protection coordination | 15 (steps 2, 7) |
| § 8 | Verification (local + CI) | 14, 15 |
| § 9 | Rollback | 15 (step 9) |
| § 10 | Commit structure (4 commits) | 9, 10, 12, 13 |
| § 14 | Dependabot coordination | (operational — respect if a PR opens during this branch's life) |

No gaps.

## Placeholder scan

Scanned for: TBD, TODO, "implement later", "add error handling" (without spec), "similar to", "appropriate" (without detail). None present.

## Consistency check

- `rust-version` string: `"1.95.0"` used consistently (not `"1.95"`).
- Runner labels: `ubuntu-24.04`, `macos-15`, `windows-2025` used consistently.
- `macos-15-intel` always marked as unchanged.
- Commit messages use consistent `ci:`, `build(tauri):`, `build:` conventional-commit prefixes.
- `BRANCH_PROTECTION.md` check names in Task 6 match `ci.yml` job names after Task 2 edits.
