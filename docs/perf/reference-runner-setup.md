# Reference runner setup (M1 Air)

How to register a 2020 M1 MacBook Air as a GitHub Actions self-hosted runner with the `reference-m1air` label, perform a § 4.2-compliant reference benchmark, and tear down.

## Prerequisites

- 2020 M1 MacBook Air, 8 GB / 256 GB (matches spec § 4.1 reference machine).
- macOS 14+ (Sonoma) or later.
- Bun 1.2+ installed (`brew install bun` or `curl -fsSL https://bun.sh/install | bash`).
- `gh` CLI installed (`brew install gh`) and authenticated. Run `gh auth login --scopes repo,workflow` before continuing — the registration-token API call below requires those scopes.
- Repo write permissions.

## Register the runner

1. Generate a registration token:

   ```sh
   gh api -X POST /repos/${OWNER}/${REPO}/actions/runners/registration-token | jq -r .token
   ```

2. Download and configure the runner agent. Substitute the latest version from <https://github.com/actions/runner/releases>.

   ```sh
   mkdir -p ~/actions-runner && cd ~/actions-runner
   curl -o actions-runner-osx-arm64.tar.gz -L \
     https://github.com/actions/runner/releases/download/v<VERSION>/actions-runner-osx-arm64-<VERSION>.tar.gz
   tar xzf ./actions-runner-osx-arm64.tar.gz
   ./config.sh \
     --url https://github.com/${OWNER}/${REPO} \
     --token <REGISTRATION_TOKEN> \
     --labels macOS,ARM64,reference-m1air \
     --unattended
   ```

3. Run interactively for a one-shot session:

   ```sh
   ./run.sh
   ```

   Or install as a launchd service for persistence (`./svc.sh install && ./svc.sh start`). Operator's choice — for borrowed-laptop one-shots, interactive is fine.

## Pre-flight checklist (spec § 4.2)

Before triggering a reference run, complete every step in order. Failure to record any step flags the run as `incomplete: true` and excludes it from CI delta comparisons.

- [ ] AC powered (Apple Silicon throttles meaningfully on battery under sustained load).
- [ ] Low Power Mode off.
- [ ] Fresh reboot ≥5 minutes before run (CPU caches and file caches in a known state).
- [ ] Activity Monitor pre-flight: no other Nimbus / Bun / Docker / Xcode / Spotlight indexing / Time Machine / iCloud sync / Messages activity. Save a screenshot for the PR record.
- [ ] Display on, screensaver disabled (Apple Silicon raises base frequency when display is on).
- [ ] macOS version recorded (auto-captured in `os_version`).

## Trigger a run

1. Confirm the runner is online:

   ```sh
   gh api /repos/${OWNER}/${REPO}/actions/runners | jq '.runners[] | select(.labels[].name == "reference-m1air")'
   ```

2. Dispatch the workflow from the GitHub Actions UI (or CLI):

   ```sh
   gh workflow run _perf-reference.yml \
     -f protocol_attested=true \
     -f notes="optional context"
   ```

3. The workflow runs `nimbus bench --all --reference --runs 3 --protocol-confirmed`, sanity-checks the result, opens a `perf`-labelled PR.

4. Review and merge the PR. PR-C-2b reads the new `history.jsonl` line to populate `SLO_THRESHOLDS` workload values + `baseline.md`.

## Teardown (one-shot use)

```sh
cd ~/actions-runner
./config.sh remove --token $(gh api -X POST /repos/${OWNER}/${REPO}/actions/runners/remove-token | jq -r .token)
```

For persistent installations: stop the launchd service first (`./svc.sh stop && ./svc.sh uninstall`), then `config.sh remove`.

## Security notes

**Public-repo self-hosted runner risk.** GitHub's documented guidance discourages self-hosted runners on public repos because any PR (including from forks) can run workflows on the runner — a remote-code-execution vector. Three structural mitigations apply here:

1. **`workflow_dispatch` only.** `_perf-reference.yml` has no `pull_request` or `push` trigger. Forks cannot dispatch a workflow run; only repo collaborators with `actions: write` permission can. This is the primary defence.
2. **Repo settings.** Verify under **Settings → Actions → General**: "Require approval for first-time contributors" or stricter is enabled. This blocks any future workflow that *does* fire on `pull_request` from running on the self-hosted runner without maintainer approval.
3. **No other workflow targets the `reference-m1air` label.** Search the repo (`grep -rn "reference-m1air" .github/`) before adding any new workflow. Only `_perf-reference.yml` should match.

**One-shot vs persistent setup.**

- **One-shot (recommended for borrowed M1 Air).** Run `./run.sh` in a terminal; press Ctrl+C when done; `./config.sh remove` to deregister. The runner is online only while the operator is in front of the machine. Minimal exposure window.
- **Persistent (only if you own the M1 Air and dedicate it to this).** Install as a launchd service. The runner stays online and accepts dispatches at any time. Requires: the dedicated-user-account isolation pattern below; lockscreen + FileVault enabled; the user account has no access to the operator's main keychain.

**Account isolation (mandatory if persistent).** Create a dedicated macOS user account on the M1 Air whose home directory holds only the runner agent and Bun. The account does not log into the operator's iCloud, has no access to the main keychain, and runs no other software. The runner's working directory is fully isolated from operator data.

**Token hygiene.**
- Never check the registration token into git or copy it into any persistent file. The token expires in ~1 hour.
- The runner has access to repo write tokens during workflow execution (`GITHUB_TOKEN`). The `_perf-reference.yml` workflow's `permissions:` block scopes that to `contents: write` + `pull-requests: write` — no `actions: write`, no organisation-level scopes.
- `gh auth login`'s saved token (used by the operator before runner registration) lives in `~/.config/gh/hosts.yml`. Treat it like any OAuth credential.
