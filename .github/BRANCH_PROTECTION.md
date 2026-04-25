# Branch protection (repository settings)

Enable these in **GitHub → Settings → Branches → Branch protection rules** for `main` (and `develop` if used as a merge target).

## TL;DR — clear Scorecard **Branch-Protection** / **Code-Review** (High)

Those findings measure **default-branch rules** on GitHub, not files in this repo. Configure them once; the next **Scorecard** run (Tuesday schedule or push to `main`, see `.github/workflows/scorecard.yml`) refreshes SARIF and the alerts typically move to **Closed** or downgrade.

### Option A — **Rulesets** (recommended UI)

1. Repo → **Settings** → **Rules** → **Rulesets** → **New ruleset** → **New branch ruleset**.
2. **Ruleset name:** e.g. `main — required reviews + checks`.
3. **Enforcement status:** **Active**.
4. **Target branches** → **Add target** → **Include default branch** (or **Add pattern** `main`).
5. Under **Branch rules**, enable at least (see [mapping table](#map-scorecard-branch-protection-warnings-to-github) for Scorecard wording):
   - **Require a pull request before merging**
   - **Required approvals** → **2** for maximal OpenSSF Scorecard (use **1** if you are solo and accept a lower score).
   - **Require status checks to pass** → **Add checks** → pick jobs from the [table below](#recommended-required-status-checks) (names must match the Actions tab exactly).
   - **Require review from Code Owners** (uses [`.github/CODEOWNERS`](./CODEOWNERS) on `main`).
   - **Dismiss stale pull request approvals when new commits are pushed**
   - **Require approval of the most recent reviewable push** (wording may vary by plan).
6. **Bypass list** — leave **empty** so admins cannot skip rules (fixes Scorecard “does not apply to administrators”).
7. **Create** / **Save** the ruleset.

### Option B — **Classic** branch protection rule

1. **Settings** → **Branches** → **Add branch protection rule** (or edit existing) for `main`.
2. Enable **Require a pull request before merging**, **Require approvals** (prefer **2** for Scorecard; **1** if solo), **Require review from Code Owners**, **Require status checks to pass** (add checks from the table below), **Dismiss stale reviews**, and **Require review before merging the most recent push** if shown.
3. Enable **Do not allow bypassing the above settings** for administrators (same as “rules apply to administrators” in Scorecard).

After this is live on `main`, open **Security → Code scanning**, filter **Tool: Scorecard**, and use **Dismiss** only if a finding is a false positive (rare for these three).

## Map Scorecard Branch-Protection warnings to GitHub

Scorecard **Branch-Protection** (rule `BranchProtectionID`) reads **enforced** rules on **`main`**. Typical warnings and how to clear them:

| Scorecard warning (gist) | What to set on `main` |
|----------------------------|------------------------|
| Branch protection **does not apply to administrators** | **Rulesets:** leave **Bypass list** empty (do not add admins or “Repository admin”). **Classic:** enable **Do not allow bypassing the above settings**. |
| **Required approving review count** is only 1 | Set **Required number of approvals** to **2** for a higher Scorecard score; keep **1** if that matches your team size. |
| **Code owners** review not required | Enable **Require review from Code Owners** and merge [`.github/CODEOWNERS`](./CODEOWNERS) on `main`. |
| **Last push approval** disabled | Enable **Require approval of the most recent reviewable push** (rulesets) or the closest equivalent in classic rules. |
| **No status checks** found for merge | In the same ruleset, **Require status checks to pass** and add checks from the [table below](#recommended-required-status-checks). They must be **required before merge** — Scorecard only sees checks GitHub **blocks merges** on, not jobs that merely exist in YAML. |

**Finding check names:** open **Actions** → pick a recent **CI** / **Security** / **CodeQL** run on `main` or a PR → copy each **job name** exactly (including punctuation and OS suffixes) into the ruleset search box.

## Scorecard alerts in “Code scanning” (no file in repo)

Scorecard uploads SARIF to **Security → Code scanning**. Findings such as **Branch-Protection**, **Code-Review**, and **Maintained** are **not** tied to a path in the tree: they score **GitHub settings** and **project activity**. Closing them is done in the UI (and with ongoing maintenance), then the next **Scorecard** run (see `.github/workflows/scorecard.yml`: scheduled and on push to `main`) refreshes or drops the alert.

| Scorecard finding | What actually changes the score |
|--------------------|-----------------------------------|
| **Branch-Protection** | Strong default-branch rule: require PR, required status checks (below), optional “include administrators”. |
| **Code-Review** | Same rule: required approving reviews, optional CODEOWNERS reviews, dismiss stale reviews, “require approval of most recent push” if your plan offers it. |
| **Maintained** | Steady **commits**, **releases**, and **issue/PR triage** (Scorecard looks at activity windows). **Dependabot** (`.github/dependabot.yml`) already helps. Repos **younger than ~90 days** often score **0** until that window passes — expected, not a misconfiguration. |
| **Fuzzing** | Continuous fuzzing Scorecard recognizes includes **[OSS-Fuzz](https://google.github.io/oss-fuzz/)** (separate application repo), **[ClusterFuzzLite](https://github.com/google/clusterfuzzlite)**, or **[OneFuzz](https://github.com/microsoft/onefuzz)** wiring — not a one-line repo change. |
| **CII-Best-Practices** | Complete the [OpenSSF Best Practices](https://www.bestpractices.dev/) questionnaire for this repository (badge is optional). |

**Security-Policy** is satisfied by [`docs/SECURITY.md`](../docs/SECURITY.md) on the default branch (separate from the rows above).

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

**Note:** Required checks must match the **exact** job names shown in the Actions UI. After changing workflow job names, update the rule accordingly. Marking every Security job as required ensures `bun audit`, Trivy, gateway contract tests, and `cargo audit` all block merges when they fail.

## Security features (org or repo)

- **Secret scanning** — detect leaked secrets in the repository.
- **Push protection** for secrets — block pushes that contain high-confidence patterns (if your plan supports it).

These are configured under **Settings → Code security and analysis**, not in workflow files.

## OpenSSF Scorecard: Branch-Protection and Code-Review

Scorecard’s **Branch-Protection** and **Code-Review** checks reflect **default-branch** settings (usually `main`), not YAML in this repo. To improve those scores:

1. **Branch protection rule for `main`** (and `develop` if it is a protected merge target):
   - Require a pull request before merging.
   - Require approvals (at least one; use more for sensitive repos).
   - Require status checks to pass (see the table above).
   - Prefer **Require review from Code Owners** if you add a `CODEOWNERS` file.
   - Enable **Do not allow bypassing the above settings** for administrators when your governance model allows it.
2. **Code-Review** in Scorecard also considers review policy depth (e.g. dismiss stale reviews, required review on last push) — configure those in the same branch rule UI.

See [`docs/SECURITY.md`](../docs/SECURITY.md) for other Scorecard items (fuzzing, CII badge) that need separate enrollment.

## Why both PR quality and CI matrix?

- **PR quality** (single Ubuntu runner) gives fast feedback on every PR.
- **CI matrix** (Ubuntu, macOS, Windows) runs on **push** after merge to prove cross-platform behavior before release and for `e2e-desktop` gating on `main`.
