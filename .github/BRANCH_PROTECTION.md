# Branch protection (repository settings)

Enable these in **GitHub → Settings → Branches → Branch protection rules** for `main` (and `develop` if used as a merge target).

## Recommended required status checks

After workflows have run at least once, add as **required checks**:

| Check | Workflow | When it runs |
|--------|-----------|----------------|
| **PR quality — ubuntu-22.04** | CI | Every pull request |
| **E2E Desktop (PR) — ubuntu-22.04** | CI | Every pull request (Tauri + Playwright) |
| **Security** jobs | Security | Every pull request (`Dependency audit`, `Trivy vulnerability scan`, `Gateway audit JSON + connector.remove vault restore`, `Cargo audit (Tauri)`) |
| **Analyze (JavaScript / TypeScript)** | CodeQL | Pull requests and pushes |
| **CI —** `ubuntu-22.04` / `macos-14` / `windows-2022` | CI | Pushes to `main` / `develop` (full matrix) |

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

See [`SECURITY.md`](../SECURITY.md) for other Scorecard items (fuzzing, CII badge) that need separate enrollment.

## Why both PR quality and CI matrix?

- **PR quality** (single Ubuntu runner) gives fast feedback on every PR.
- **CI matrix** (Ubuntu, macOS, Windows) runs on **push** after merge to prove cross-platform behavior before release and for `e2e-desktop` gating on `main`.
