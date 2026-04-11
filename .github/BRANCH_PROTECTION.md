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

## Why both PR quality and CI matrix?

- **PR quality** (single Ubuntu runner) gives fast feedback on every PR.
- **CI matrix** (Ubuntu, macOS, Windows) runs on **push** after merge to prove cross-platform behavior before release and for `e2e-desktop` gating on `main`.
