# Security policy

## Supported versions

Security fixes are applied on the active development branch (`main`) and released as tagged versions when appropriate. Use the latest release for production-like deployments.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security reports.**

1. Use GitHub **private vulnerability reporting** for this repository: open the repo on GitHub, then **Security** → **Advisories** → **Report a vulnerability** (or use the “Report a vulnerability” entry point shown in the Security tab for your role).
2. If private reporting is unavailable, contact the maintainers through a **non-public** channel they publish for security (for example org security contact or maintainer email), with enough detail to reproduce the issue and assess impact.

Include: affected component (Gateway, CLI, UI, connector, etc.), steps to reproduce, and suspected impact (confidentiality / integrity / availability). We aim to acknowledge reports within a few business days.

## OpenSSF Scorecard (supply chain)

Some Scorecard findings are enforced in-repo (workflows, CodeQL, dependency scanning). Others depend on **repository or organization settings** or **external programs**:

| Finding | What fixes it |
|--------|----------------|
| **Security-Policy** | This file (`SECURITY.md`) on the default branch. |
| **Branch-Protection** / **Code-Review** | Branch protection rules: required reviews, required status checks, optional CODEOWNERS. See [`.github/BRANCH_PROTECTION.md`](.github/BRANCH_PROTECTION.md). |
| **Maintained** | Ongoing commits, releases, and issue/PR handling (project activity). |
| **Fuzzing** | Typically [OSS-Fuzz](https://google.github.io/oss-fuzz/) (or another continuous fuzzing program) integrated with the project; not covered by this file alone. |
| **CII-Best-Practices** | [OpenSSF Best Practices badge](https://www.bestpractices.dev/) — self-certification questionnaire for the repository. |

For workflow and token hygiene used in CI, see [`docs/security-hardening.md`](docs/security-hardening.md).
