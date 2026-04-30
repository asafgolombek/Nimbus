# Perf Audit — PR-C-2a (reference-run infra + cleanup) Design

**Date:** 2026-04-29
**Parent spec:** [`2026-04-26-perf-audit-design.md`](./2026-04-26-perf-audit-design.md) — defines the surface table, threshold semantics, reference-hardware protocol, and PR sequence (PR-A → PR-B-1 → PR-B-2a → PR-B-2b-1 → PR-B-2b-2 → PR-C-1 → **PR-C-2a → PR-C-2b** → PR-D-N). Read it first; this doc fills in PR-C-2a's architectural decisions.
**Predecessor:** PR-C-1 (merged via commits `103256d` → `a747016`, retired plan + design docs removed in 2026-04-30 cleanup) — landed `_perf.yml`, `slo.md`, `baseline.md` skeleton, `slo-thresholds.ts` (SSoT), the threshold comparator, the PR-comment formatter, the `bench-ci` orchestrator, and retired `slo-ux.md` + `benchmark.yml`. Decisions D-A through D-Q from the PR-C-1 design carry over and PR-C-2a extends them with D-R through D-AD captured below.

## 1. Goal

Land everything PR-C-2 needs that does **not** depend on physical reference hardware: a self-hosted-runner-targeted workflow that operators dispatch from the Actions UI to perform a § 4.2-compliant reference run and open a `perf`-labelled PR with the resulting `history.jsonl` line; the cost-fallback gate in `_perf.yml`; the `missed.md` / `deferred-backlog.md` / `reference-runner-setup.md` skeletons; the `--protocol-confirmed` bench CLI flag that makes non-interactive reference runs possible; and the `scripts/capture-benchmarks.ts` deletion (deferred from PR-C-1 per spec § 4.7 step 2).

After this PR merges:
- An operator with a registered self-hosted runner on a 2020 M1 Air can trigger a reference run via `workflow_dispatch`. The run produces a single aggregated `history.jsonl` line and opens a `perf`-labelled PR for review.
- `_perf.yml` runs Linux only on weekday nightlies; macOS + Windows run on Sunday-04:00 nightlies, on every push to `main`, and on every `perf`-labelled PR.
- `missed.md` and `deferred-backlog.md` exist as templated skeletons ready for PR-C-2b to populate.
- `scripts/capture-benchmarks.ts` is gone (verified that S2-a has shipped ≥3 successful nightly runs first).

PR-C-2b is then a small data-and-prose PR: register the runner, dispatch the workflow, merge the resulting bot PR, populate `SLO_THRESHOLDS` workload values, populate `baseline.md`, fill in the missed-list ranking and deferred-backlog rows.

## 2. PR boundary

| Deliverable | PR-C-2a | PR-C-2b |
|---|---|---|
| `_perf-reference.yml` workflow | ✅ full implementation | — |
| `_perf.yml` cost-fallback gate | ✅ | — |
| `--protocol-confirmed` bench CLI flag | ✅ | — |
| `docs/perf/missed.md` | ✅ skeleton (frontmatter + rubric reference + empty table + "populated by PR-C-2b" note) | populates rows from the reference-run threshold violations |
| `docs/perf/deferred-backlog.md` | ✅ skeleton (same shape) | populates rows |
| `docs/perf/reference-runner-setup.md` | ✅ operator runbook | — |
| `scripts/capture-benchmarks.ts` deletion | ✅ (precondition met: ≥3 successful S2-a nightly runs on `_perf.yml` since PR-C-1 landed) | — |
| Docs-site decision (Astro vs raw markdown for `slo.md`) | ✅ documented in PR description: stay raw markdown for v0.1.0 | — |
| Self-hosted runner registration on M1 Air | — | ✅ operator action (one-shot) |
| Reference run dispatch | — | ✅ operator triggers `_perf-reference.yml` |
| Workload threshold values in `SLO_THRESHOLDS` + regenerated `slo.md` | — | ✅ |
| `docs/perf/baseline.md` measurements | — | ✅ |
| Top-5 missed ranking + Confidence column | — | ✅ |

The split is dictated by which deliverables depend on the operator having registered a self-hosted runner and run a bench against it. Everything in PR-C-2a is reviewable and shippable from a Windows dev machine; PR-C-2b is "register the runner, click Run, fill in the numbers."

## 3. Architecture

```
                     ┌────────────────────────────────────────────────┐
                     │  PR-C-2a-only artefacts                        │
                     │                                                │
                     │  .github/workflows/_perf-reference.yml         │
                     │     workflow_dispatch only                     │
                     │     runs-on: [self-hosted, macOS, ARM64,       │
                     │                reference-m1air]                │
                     │     inputs: protocol_attested, notes           │
                     │     permissions: contents:write, PRs:write     │
                     │                                                │
                     │     ↓ steps                                    │
                     │     1. Validate protocol_attested              │
                     │     2. Checkout / Setup / build                │
                     │     3. nimbus bench --all --reference          │
                     │            --runs 3 --protocol-confirmed       │
                     │     4. Sanity-check history.jsonl diff         │
                     │     5. Configure git, commit, push branch      │
                     │     6. gh pr create --label perf               │
                     │                                                │
                     └────────────────────────────────────────────────┘

                     ┌────────────────────────────────────────────────┐
                     │  Modifications                                 │
                     │                                                │
                     │  _perf.yml: cost-fallback gate on heavy steps  │
                     │     if: matrix.os == 'ubuntu-24.04' ||         │
                     │         github.event_name != 'schedule' ||     │
                     │         github.event.schedule == '0 4 * * 0'   │
                     │                                                │
                     │  packages/gateway/src/perf/bench-runner.ts:    │
                     │     +--protocol-confirmed flag                 │
                     │     wires into BenchCliDeps.confirmReference-  │
                     │     Protocol = () => true                      │
                     │  packages/cli/src/commands/bench.ts:           │
                     │     pass-through (HELP text update only)       │
                     └────────────────────────────────────────────────┘

                     ┌────────────────────────────────────────────────┐
                     │  Doc skeletons                                 │
                     │  docs/perf/missed.md                           │
                     │  docs/perf/deferred-backlog.md                 │
                     │  docs/perf/reference-runner-setup.md           │
                     └────────────────────────────────────────────────┘

                     ┌────────────────────────────────────────────────┐
                     │  Deletion                                      │
                     │  scripts/capture-benchmarks.ts                 │
                     │  (precondition: ≥3 S2-a runs on _perf.yml)     │
                     └────────────────────────────────────────────────┘
```

Three boundaries:

- **Workflow ↔ TS.** `_perf-reference.yml` only invokes `nimbus bench` and `gh pr create`; no gating, no formatting in YAML. Same discipline as `_perf.yml`.
- **Self-hosted runner ↔ hosted runners.** PR-C-2a is the only place the repo references self-hosted infrastructure. `_perf.yml` stays GHA-hosted-runners-only. The split keeps elevated permissions (`contents: write`) confined to one workflow.
- **Operator attestation ↔ harness state.** `protocol_attested` workflow input → `--protocol-confirmed` CLI flag → `BenchCliDeps.confirmReferenceProtocol = () => true`. No env-var path; the operator's explicit checkbox at dispatch time is the single human gate.

## 4. `_perf-reference.yml` workflow

```yaml
name: Performance Reference Run (M1 Air)

# Triggers: workflow_dispatch only.
# This workflow runs on the self-hosted M1 Air registered with the
# `reference-m1air` label. It performs a §4.2-compliant reference run,
# stages the resulting history.jsonl line, and opens a perf-labelled PR.
on:
  workflow_dispatch:
    inputs:
      protocol_attested:
        description: "Have you completed the §4.2 reference protocol checklist? (AC powered, Low Power Mode off, fresh reboot, no Spotlight/Time Machine/iCloud/Messages activity, display on)"
        required: true
        type: boolean
        default: false
      notes:
        description: "Optional free-form notes (e.g., thermal state, deviations from protocol). Goes into PR body, not the history line."
        required: false
        type: string
        default: ""

# Spec § 4.3 — only one reference run at a time.
concurrency:
  group: bench-reference
  cancel-in-progress: false

jobs:
  reference-run:
    name: Reference benchmark run (M1 Air)
    runs-on: [self-hosted, macOS, ARM64, reference-m1air]
    timeout-minutes: 60   # 3 runs × ~15 min worst case + setup overhead
    permissions:
      contents: write       # branch push
      pull-requests: write  # gh pr create

    steps:
      - name: Validate protocol attestation
        if: inputs.protocol_attested != true
        run: |
          echo "::error::Reference run requires §4.2 protocol attestation."
          echo "Re-dispatch with protocol_attested=true after completing the checklist."
          echo "See docs/perf/reference-runner-setup.md and spec §4.2."
          exit 1

      - name: Checkout
        uses: actions/checkout@<pinned>
        with:
          fetch-depth: 0
          persist-credentials: true   # we push back to the same repo

      - name: Setup Bun
        uses: oven-sh/setup-bun@<pinned>
        with:
          bun-version-file: ".bun-version"

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Run reference benchmark (3 runs, all surfaces)
        # Direct bench-runner.ts invocation matches the existing _perf.yml
        # pattern (line 136) — no separate `bun run build` step needed; the
        # bench harness runs against TS source via Bun.
        run: |
          bun packages/gateway/src/perf/bench-runner.ts \
            --all \
            --reference \
            --runs 3 \
            --protocol-confirmed \
            --history "${{ github.workspace }}/docs/perf/history.jsonl"

      - name: Sanity-check history.jsonl diff
        id: sanity
        run: |
          set -euo pipefail
          # 1. Exactly one file modified (no incidental edits).
          changed=$(git status --porcelain | awk '{print $2}')
          if [[ "$changed" != "docs/perf/history.jsonl" ]]; then
            echo "::error::Expected only docs/perf/history.jsonl to change; got:"
            git status --porcelain
            exit 1
          fi
          # 2. Exactly one line added (count delta — robust against whitespace
          #    diffs and file-creation header noise).
          before=$(git show HEAD:docs/perf/history.jsonl 2>/dev/null | wc -l || echo 0)
          after=$(wc -l < docs/perf/history.jsonl)
          if [[ "$((after - before))" != "1" ]]; then
            echo "::error::Expected +1 line in history.jsonl; got delta $((after - before))"
            exit 1
          fi
          # 3. Last line is a valid JSON record with the expected runner, SHA,
          #    and a populated os_version (proves auto-capture worked).
          last=$(tail -n 1 docs/perf/history.jsonl)
          echo "$last" | jq -e \
            --arg sha "$GITHUB_SHA" \
            '.runner == "reference-m1air"
             and .nimbus_git_sha == $sha
             and (.os_version | type == "string" and length > 0)' \
            >/dev/null || {
              echo "::error::history.jsonl last line failed validation:"
              echo "$last"
              exit 1
            }
          echo "branch=perf/reference-run-$(date -u +%Y-%m-%d)-${GITHUB_SHA::7}" >> "$GITHUB_OUTPUT"

      - name: Commit and push branch
        env:
          BRANCH: ${{ steps.sanity.outputs.branch }}
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git checkout -b "$BRANCH"
          git add docs/perf/history.jsonl
          git commit -m "perf: reference benchmark run $(date -u +%Y-%m-%d) (${GITHUB_SHA::7})"
          git push origin "$BRANCH"

      - name: Open perf-labelled PR
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          BRANCH: ${{ steps.sanity.outputs.branch }}
          NOTES: ${{ inputs.notes }}
        run: |
          body=$(cat <<EOF
          ## Reference benchmark run

          - **Runner:** \`reference-m1air\` (self-hosted, M1 Air, 8 GB / 256 GB)
          - **Triggered by:** @${{ github.actor }} via workflow_dispatch
          - **macOS version:** see \`os_version\` field in the new history line
          - **Notes:** ${NOTES:-_(none)_}

          ### § 4.2 Reference protocol checklist (operator attested)

          - [x] AC powered
          - [x] Low Power Mode off
          - [x] Fresh reboot ≥5 min before run
          - [x] No Spotlight / Time Machine / iCloud / Messages / Bun / Docker / Xcode activity
          - [x] Display on, screensaver disabled
          - [x] macOS version recorded (auto-captured in \`os_version\`)

          ### History line

          One aggregated line (median across 3 runs per surface, spec §4.5) appended to \`docs/perf/history.jsonl\`.

          ### Reviewer action

          Spot-check the surface values for sanity (compare against last reference run if available). Merge to record the run as the new reference baseline. PR-C-2b will then populate \`SLO_THRESHOLDS\` workload values from this line.
          EOF
          )
          gh pr create \\
            --title "perf: reference benchmark run $(date -u +%Y-%m-%d) (${GITHUB_SHA::7})" \\
            --body "$body" \\
            --label perf \\
            --base main \\
            --head "$BRANCH"
          echo "PR opened on branch $BRANCH" >> "$GITHUB_STEP_SUMMARY"
```

(Action SHAs left as `<pinned>` placeholders — plan phase pins them to the same versions used elsewhere in the repo, matching the existing `actionlint`/Harden-Runner conventions.)

### 4.1 Why this shape

- **`workflow_dispatch` only.** Reference runs are operator-triggered, weekly at most. No need for schedule. No `pull_request` trigger — the workflow opens PRs, never runs *on* them.
- **No `Harden Runner` step.** That action is GHA-hosted-runner-only. Self-hosted runners come with the operator's machine policy; documenting safe practices is the operator runbook's job (`reference-runner-setup.md`), not the workflow's.
- **Single job, single OS.** No matrix. Self-hosted runner targeting is by label triple `[self-hosted, macOS, ARM64, reference-m1air]`. The `reference-m1air` custom label is the canonical identifier from spec § 4.4 — matches `RunnerKind` enum.
- **`fetch-depth: 0` + `persist-credentials: true`.** The job pushes a branch back to the repo and opens a PR; both require credentials. `fetch-depth: 0` lets the bench harness resolve `nimbus_git_sha` without surprises.
- **Sanity-check is mandatory, not aspirational.** Catches three failure modes early: harness wrote zero or multiple lines (regression), wrote the wrong runner (config bug), wrote the wrong SHA (race / detached HEAD). All three are bugs we'd rather not commit.
- **`gh pr create` not `peter-evans/create-pull-request`.** `gh` is preinstalled on hosted runners; for self-hosted we install it as part of runner setup (documented in the runbook). One fewer third-party action surface for credentials to flow through.

## 5. `_perf.yml` cost-fallback gate

Two coordinated changes. The `if:`-on-heavy-steps gate alone is not sufficient — the gate condition references `github.event.schedule == '0 4 * * 0'`, which only matches if such a cron exists. The current schedule block has only `'0 4 * * *'` (every day). Without splitting the cron, the condition would never short-circuit to "yes, run macOS today" via the schedule path.

### 5.1 Schedule split

Replace the single daily cron with a Mon–Sat daily + a Sunday cron:

```yaml
on:
  push:
    branches: [main]
  pull_request:
    types: [opened, synchronize, reopened, labeled]
  schedule:
    - cron: "0 4 * * 1-6"   # Mon–Sat 04:00 UTC — Linux only (cost-fallback)
    - cron: "0 4 * * 0"     # Sunday 04:00 UTC — full three-OS coverage
```

Each cron fires exactly once per scheduled day; `github.event.schedule` carries the literal cron string at run time (GHA passes it through), so the gate can branch on it.

### 5.2 Per-step gate

Add an `if:` to the **heavy** steps (the `nimbus bench` invocation, the artifact upload, the `bench-ci` comparator step) gated on:

```yaml
if: |
  matrix.os == 'ubuntu-24.04' ||
  github.event_name != 'schedule' ||
  github.event.schedule == '0 4 * * 0'
```

Cheap setup steps (Harden Runner, Checkout, Setup Bun, install) run unconditionally — keeps YAML readable; the runner provisions, does ~2 min of housekeeping, then exits. Per-non-Linux-OS minutes drop by ~95% on Mon–Sat nightlies.

### 5.3 Coverage matrix

| Trigger | Linux | macOS | Windows |
|---|---|---|---|
| `push` to `main` | ✅ | ✅ | ✅ |
| `perf`-labelled PR | ✅ | ✅ | ✅ |
| Mon–Sat 04:00 UTC schedule | ✅ | ⏭ skip heavy | ⏭ skip heavy |
| Sunday 04:00 UTC schedule | ✅ | ✅ | ✅ |

`bench-ci`'s "previous artifact" lookup (`bench-ci.ts:85, runListLatestSuccess`) already handles a missing per-OS artifact gracefully (logs `treating as first-run` and emits the no-baseline comment) — so even on the rare case where a `perf`-PR runs macOS without a recent main macOS artifact, the workflow degrades to first-run rather than failing. Push-to-main runs all three OSes regardless of weekday, so macOS / Windows artifacts on `main` are refreshed on every merge — the Sunday weekly schedule is the no-PR-traffic baseline check, not the artifact-keep-alive.

The existing comment block at `_perf.yml:9-14` becomes the implementation rather than the documented-but-unwired stub. Update the comment to point at the active `if:` lines and the cron split.

## 6. Doc skeletons

### 6.1 `docs/perf/missed.md`

```markdown
# Performance threshold misses

> **Status:** PR-C-2a — skeleton. Populated by PR-C-2b after the M1 Air reference run.

Misses ranked by `user_felt_impact_score / engineering_cost_estimate` per spec [§ 3.4](../superpowers/specs/2026-04-26-perf-audit-design.md). Top 5 → fix plans (PR-D-1 … PR-D-N). Misses 6–N → [`deferred-backlog.md`](./deferred-backlog.md).

Each row carries `Confidence: High | Medium | Low` (mirrors the B1 audit's `results.md` schema) so retained-Low items are visibly flagged.

## Top 5

_TBD — populated by PR-C-2b._

| Rank | Surface | Threshold violated | Observed (p50 / p95) | Impact (1–5) | Cost (1–5) | Impact / Cost | Confidence | Proposed fix |
|---|---|---|---|---|---|---|---|---|
| 1 | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| 2 | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| 3 | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| 4 | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| 5 | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |

## All misses (full list)

_TBD — populated by PR-C-2b. Misses 6–N also recorded in [`deferred-backlog.md`](./deferred-backlog.md)._
```

### 6.2 `docs/perf/deferred-backlog.md`

```markdown
# Performance miss deferred backlog

> **Status:** PR-C-2a — skeleton. Populated by PR-C-2b.

Misses 6–N — picked up by **B2-v2 (post-`v0.1.0`)** per spec [§ 11](../superpowers/specs/2026-04-26-perf-audit-design.md). Each row carries `Confidence` (mirrors B1) so retained-Low items are visibly flagged here rather than silently mixed into the top-5.

| Surface | Threshold violated | Observed (p50 / p95) | Impact (1–5) | Cost (1–5) | Impact / Cost | Confidence | Why deferred |
|---|---|---|---|---|---|---|---|
| _TBD — populated by PR-C-2b._ | | | | | | | |
```

### 6.3 `docs/perf/reference-runner-setup.md`

```markdown
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
   curl -o actions-runner-osx-arm64.tar.gz -L \\
     https://github.com/actions/runner/releases/download/v<VERSION>/actions-runner-osx-arm64-<VERSION>.tar.gz
   tar xzf ./actions-runner-osx-arm64.tar.gz
   ./config.sh \\
     --url https://github.com/${OWNER}/${REPO} \\
     --token <REGISTRATION_TOKEN> \\
     --labels macOS,ARM64,reference-m1air \\
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
   gh workflow run _perf-reference.yml \\
     -f protocol_attested=true \\
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
```

## 7. `--protocol-confirmed` bench CLI flag

The flag is parsed and consumed in **`packages/gateway/src/perf/bench-runner.ts`** — the standalone entry script that constructs `BenchCliDeps` and calls `runBenchCli(args, deps)`. Today (line 101–107) those deps omit `confirmReferenceProtocol`, so the orchestrator falls back to `defaultConfirm()` which returns `false` and refuses the run.

PR-C-2a's change in `bench-runner.ts`:

- Read `--protocol-confirmed` off `args` (using the existing `hasFlag` helper). If present, strip it before `runBenchCli` consumes the rest of `args` (the orchestrator does not need to see it).
- When the flag was present, set `confirmReferenceProtocol: () => true` in the deps object. When absent, leave the dep unset — the orchestrator's existing `defaultConfirm()` still gates interactive sessions.

`packages/cli/src/commands/bench.ts` (the thin `Bun.spawn` wrapper) is a pure pass-through and needs no behavioural change. Its `HELP` text gets one new line documenting `--protocol-confirmed` ("non-interactive §4.2 protocol confirmation; intended for CI dispatch from `_perf-reference.yml`"). The same one-line update goes into `bench-runner.ts`'s own `--help` block.

Tests (in `bench-runner.test.ts`, or — if that file does not exist — added alongside `bench-cli.test.ts`):

- One positive test: invoking `runBench` (or `bench-runner` `main()` if directly testable) with `--reference --protocol-confirmed` succeeds where it would otherwise be refused.
- One negative test: invoking with `--reference` alone still refuses (exit code 2) — guards against accidentally making the gate permissive.

Coverage stays inside the existing `bun run test:coverage:perf` ≥80% line gate; no new coverage gate.

## 8. `scripts/capture-benchmarks.ts` deletion

**Precondition** (operator verifies before merge): `_perf.yml` has produced ≥3 successful nightly runs on `main` since PR-C-1 landed (commit `b4dff23`, 2026-04-29). Each run includes a passing `S2-a` measurement whose p95 is comparable to the legacy `capture-benchmarks.ts` baseline (within ~25% — same SQL builder, same warm in-memory tier, per spec § 4.7).

The plan task documents the verification commands:

```sh
# 3 most recent successful _perf.yml runs on main, ubuntu-24.04
gh run list --workflow=_perf.yml --branch=main --status=success --json databaseId,conclusion --limit 10
# Inspect the S2-a value in each run's artifact
gh run download <run-id> --name perf-ubuntu-24.04-<sha> --dir /tmp/perf-<sha>
jq '.surfaces["S2-a"]' /tmp/perf-<sha>/run-history.jsonl
```

Deletion is a one-liner: `git rm scripts/capture-benchmarks.ts`. Verified scope: no `bench:capture` script in `package.json`, no workflow references (`benchmark.yml` already retired in PR-C-1), no source-code imports. All other references live in spec/plan documents (historical context); leave them.

If the precondition is not met when this PR is otherwise ready, the deletion item slips to a follow-up commit on `main`; rest of PR-C-2a still ships.

## 9. Edge cases

| Case | Behavior |
|---|---|
| `protocol_attested: false` at dispatch | Workflow fails at validation step before bench runs. No PR opened. Operator re-dispatches. |
| Bench harness writes `incomplete: true` (e.g., S9 Ollama model not installed) | Workflow still commits + opens PR; PR body mentions "spot-check for sanity" — reviewer sees `incomplete` and decides whether to merge or re-trigger after fixing. |
| Bench harness throws | Step fails before commit; no PR opened; operator inspects logs. |
| Sanity-check fails (zero new lines, multiple new lines, wrong runner, wrong SHA) | Step fails with the offending diff in the log. Branch is not pushed. No PR. |
| `gh pr create` fails because branch already exists from prior aborted run | Step fails with `gh`'s underlying error; operator deletes the stale branch and re-triggers. Branch naming `perf/reference-run-<YYYY-MM-DD>-<short-sha>` keeps collisions rare in practice. |
| Two reference runs dispatched concurrently | `concurrency: { group: bench-reference, cancel-in-progress: false }` queues the second; first finishes before second starts. No measurement skew. |
| Runner offline at dispatch | GHA queues the workflow; operator brings the runner online or cancels. No partial state. |
| Cost-fallback gate matches accidentally (wrong cron expression) | Inert — gate is fail-safe (false negative just runs more bench, never less). PR-quality YAML lint catches typos. |
| `_perf.yml` cost-fallback skips macOS but a `perf` PR still expects macOS data | The `if:` condition includes `github.event_name != 'schedule'` — `pull_request` events always run all three OSes. No coverage loss. |
| `--protocol-confirmed` flag passed without `--reference` | No-op. Flag only affects the reference-protocol confirmation gate; non-reference runs ignore it. Test asserts this. |
| `capture-benchmarks.ts` deletion lands but a stale workflow somewhere still invokes it | Verified absent by grep; if it exists, the next `bun run` against it fails fast. PR-quality CI catches the regression on the same PR. |

## 10. Testing strategy

| Module | Test type | Coverage approach |
|---|---|---|
| `--protocol-confirmed` flag | Unit | One test asserting the flag wires `confirmReferenceProtocol → () => true` through `bench-runner.ts`'s deps construction; one negative test asserting the default (no flag) still refuses on a `--reference` run with exit code 2. |
| `_perf-reference.yml` | YAML lint + dispatch dry-run | `actionlint` parses the file in PR-quality. Operator can `gh workflow run _perf-reference.yml -f protocol_attested=false` from any branch — workflow fails at validation before reaching bench, proving the gate works without needing the runner online. Documented in plan. |
| `_perf.yml` cost-fallback gate | YAML lint + manual trigger inspection | `actionlint` parses. Operator can inspect the next `_perf.yml` schedule run on Monday (non-Sunday) and confirm macOS / Windows steps skip. Plan task records the inspection command. |
| `missed.md` / `deferred-backlog.md` / `reference-runner-setup.md` | Spec self-review | Sections render cleanly in GitHub markdown view; rubric reference resolves; checklist items match § 4.2 verbatim. |
| `capture-benchmarks.ts` deletion | Static check | After deletion: `grep -r "capture-benchmarks" packages/ scripts/ .github/` returns no results outside `docs/`. |

The `bun run test:coverage:perf` gate (≥80% lines) extends to the new `--protocol-confirmed` flag wiring automatically. No new coverage gates introduced.

## 11. Acceptance criteria for PR-C-2a

When this PR merges:

1. `.github/workflows/_perf-reference.yml` exists; `workflow_dispatch` only; targets `[self-hosted, macOS, ARM64, reference-m1air]`; permissions `contents: write` + `pull-requests: write`; `concurrency: bench-reference`.
2. `protocol_attested: false` dispatch fails at the validation step (verifiable from any branch).
3. `.github/workflows/_perf.yml` cost-fallback gate is wired on the heavy steps; macOS / Windows runners on a weekday `schedule` event provision-then-skip.
4. `--protocol-confirmed` flag is parsed in `packages/gateway/src/perf/bench-runner.ts`, wires `confirmReferenceProtocol: () => true` into the `runBenchCli` deps; tests pass; both `bench-runner.ts`'s and `packages/cli/src/commands/bench.ts`'s `--help` text document the flag.
5. `docs/perf/missed.md` and `docs/perf/deferred-backlog.md` exist as templated skeletons with TBD rows + `Confidence` column + rubric reference.
6. `docs/perf/reference-runner-setup.md` exists with the operator runbook (registration, pre-flight checklist, dispatch, teardown).
7. `scripts/capture-benchmarks.ts` is deleted (precondition verified — see § 8).
8. PR description documents the docs-site decision: `slo.md` stays raw markdown for v0.1.0; revisit when `packages/docs/` grows a Reference / SLO category.
9. `bun run test:coverage:perf`, `bun run test:ci`, and PR-quality CI all pass.
10. Self-review of all three new doc files: no placeholders other than the explicitly-marked TBD rows; rubric link resolves.

## 12. Out of scope

- Self-hosted runner registration on the M1 Air → operator action in PR-C-2b's setup phase.
- Reference run dispatch + populated `SLO_THRESHOLDS` workload values + populated `baseline.md` → PR-C-2b.
- Top-5 missed ranking + populated `deferred-backlog.md` → PR-C-2b.
- Astro page for `slo.md` → revisit when `packages/docs/` grows a Reference / SLO category. PR description documents the v0.1.0 decision.
- Long-term `history.jsonl` retention (1000-line cap, archive split) → spec § 4.4, post-v0.1.0 concern.
- Real Ollama-driven S9 + real Tauri-renderer instrumentation for S3/S5 → hypothetical PR-B-2b-3.

## 13. Decisions log

| ID | Decision | Source |
|---|---|---|
| D-R | Split PR-C-2 into PR-C-2a (no hardware needed) and PR-C-2b (needs M1 Air). PR-C-2a delivers infrastructure + skeletons + cleanup; PR-C-2b is a small data-and-prose PR after the run. | Brainstorming Q3 |
| D-S | Reference machine stays as 2020 M1 Air per spec § 4.1. No spec amendment. | Brainstorming Q2 |
| D-T | Reference run history.jsonl change is committed via a `gh pr create` PR, not direct push to `main`. Matches spec § 4.4 (perf-labelled PRs); creates audit trail; PR push triggers `_perf.yml` `bench-ci` orchestrator on real reference numbers as a free integration test. | Brainstorming Q2 |
| D-U | `_perf-reference.yml` is a separate workflow file, not a job inside `_perf.yml`. Keeps elevated permissions (`contents: write`) confined; keeps `_perf.yml` scheduled-only / hosted-only / read-only. | Brainstorming Q3 |
| D-V | Workflow inputs are `protocol_attested: boolean` + `notes: string` only. `macos_version` is **not** a separate input — `os_version` field already captures it (`darwin <release> (<hostname>)`). Notes go in the PR body, not the JSON line — no schema change. | Section 2 design |
| D-W | Cost-fallback gate uses `if:` on heavy steps in the existing matrix job (per spec § 4.3 wording), not a dynamic-matrix approach. Cheap setup steps (Harden Runner, Checkout, Setup Bun, install) run unconditionally — keeps YAML readable; ~95% of per-non-Linux-OS minutes still saved. | Section 3 design |
| D-X | `--protocol-confirmed` is a CLI flag (not an env var) so the audit trail is visible in `argv` of the workflow log. Operator dispatching with `protocol_attested: true` is the explicit human gate; the flag only wires the dependency. | Section 7 |
| D-Y | `capture-benchmarks.ts` deletion has a precondition check (≥3 successful S2-a runs on `_perf.yml`). If unmet at PR-ready time, the deletion slips to a follow-up commit on `main`; rest of PR-C-2a still ships. Inherits D-Q from PR-C-1's spec. | Section 8 |
| D-Z | Docs-site decision for `slo.md`: stays raw markdown for v0.1.0. `slo.md` is regenerated from `slo-thresholds.ts`; an Astro layer adds a re-export step that risks drift. Revisit when `packages/docs/` grows a Reference / SLO category. Documented in PR description per spec § 10. | Section 1 |
| D-AA | Sanity-check rewrite: replace fragile `git diff \| grep -c '^+{'` with `git status --porcelain` (only-expected-file check) + `wc -l` delta + `tail -n 1 \| jq -e` validating runner / SHA / non-empty `os_version`. More robust under whitespace / file-creation diffs and explicitly verifies the `os_version` auto-capture. | Review feedback (Gemini OQ2 + S2) |
| D-AB | `_perf.yml` cron split: replace `'0 4 * * *'` with two crons — `'0 4 * * 1-6'` (Mon–Sat, Linux only via the cost-fallback gate) and `'0 4 * * 0'` (Sunday, full three-OS). The `if:`-on-heavy-steps gate alone is insufficient because `github.event.schedule == '0 4 * * 0'` only matches if such a cron exists. | Review feedback (Gemini OQ3) |
| D-AC | Runbook security expansion: documented public-repo self-hosted RCE concern with three structural mitigations (`workflow_dispatch`-only, repo settings, label uniqueness), explicit one-shot-vs-persistent trade-off, dedicated-user-account isolation pattern for persistent setups, `gh auth login` scope requirement (`repo,workflow`). | Review feedback (Gemini OQ4 + S3) |
| D-AD | Dismissed without change: Gemini OQ1 (`history.jsonl` initial state — `appendHistoryLine` already creates parent dirs and append-creates the file via `mkdirSync(recursive:true)` + `appendFileSync`), Gemini OQ5 (`protocol_attested` boolean default — already covered by the `if: inputs.protocol_attested != true` validation step that fails the run with exit 1), Gemini S1 (`mkdir -p docs/perf` — redundant with checkout + `appendHistoryLine`), Gemini S4 (`confirmReferenceProtocol` typed optional — already optional at `bench-cli.ts:61`). All four claims contradicted by the actual code/spec; verified before dismissal per memory note "verify external AI-review claims". | Review feedback (Gemini OQ1, OQ5, S1, S4) |

---

*Spec written by Claude Opus 4.7 — 2026-04-29. Review feedback from Gemini CLI applied 2026-04-29.*
