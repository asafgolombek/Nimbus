# Perf Audit (B2) — PR-C-2a (reference-run infra + cleanup) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land everything PR-C-2 needs that does **not** depend on physical reference hardware: a self-hosted-runner-targeted `_perf-reference.yml` workflow, the cost-fallback gate in `_perf.yml` (cron split + per-step `if:`), the `--protocol-confirmed` bench CLI flag, the `missed.md` / `deferred-backlog.md` / `reference-runner-setup.md` skeletons, and the deferred `scripts/capture-benchmarks.ts` deletion.

**Architecture:** A new dispatch-only workflow targets a self-hosted runner with the `reference-m1air` label, runs `bun packages/gateway/src/perf/bench-runner.ts --all --reference --runs 3 --protocol-confirmed`, sanity-checks the resulting `history.jsonl` diff via `git status --porcelain` + `wc -l` + `jq`, and opens a `perf`-labelled PR. The existing `_perf.yml` keeps GHA-hosted-runner coverage but skips macOS+Windows heavy steps on Mon–Sat nightlies (cost-fallback). The `--protocol-confirmed` flag is parsed in `bench-runner.ts` (where `BenchCliDeps` is constructed) and wires `confirmReferenceProtocol: () => true` into the existing orchestrator gate at `bench-cli.ts:317`.

**Tech Stack:** Bun v1.2+ / TypeScript 6.x strict, `bun:test`, GitHub Actions YAML, `gh` CLI, `jq`. No new devDependencies.

**Spec source:** [`docs/superpowers/specs/2026-04-29-perf-audit-pr-c-2a-design.md`](../specs/2026-04-29-perf-audit-pr-c-2a-design.md). All decisions D-R through D-AD are captured there.

**Predecessor plan:** [`2026-04-29-perf-audit-pr-c-1.md`](./2026-04-29-perf-audit-pr-c-1.md) (PR-C-1, merged via commits `103256d` → `a747016`) — landed `_perf.yml`, `slo.md`, `baseline.md` skeleton, the four typed perf modules (`slo-thresholds.ts`, `threshold-comparator.ts`, `pr-comment-formatter.ts`, `bench-ci.ts`) and retired `slo-ux.md` + `benchmark.yml`.

**Out of scope:** Self-hosted runner registration on the M1 Air (operator action in PR-C-2b). Reference run dispatch + populated `SLO_THRESHOLDS` workload values + populated `baseline.md` (PR-C-2b). Top-5 missed ranking + populated `deferred-backlog.md` rows (PR-C-2b). Astro page for `slo.md` (revisit when `packages/docs/` grows a Reference / SLO category). Real Ollama-driven S9 + real Tauri-renderer instrumentation (hypothetical PR-B-2b-3).

---

## Pre-flight

Before starting Task 1, confirm working state:

```bash
git status -s            # working tree should be clean (or only the existing M .claude/settings.local.json)
git log -1 --oneline     # current HEAD
gh repo view --json name,owner --jq '.owner.login + "/" + .name'   # confirm asafgolombek/Nimbus
bun --version            # >= 1.2
```

If the current branch (`dev/asafgolombek/perf-pr-c-1-spec`) is not appropriate for PR-C-2a (e.g., it's already targeted at PR-C-1's merged work), create a fresh branch from the latest `main`:

```bash
git fetch origin main
git checkout -b dev/asafgolombek/perf-pr-c-2a origin/main
git cherry-pick 236f486 3f41df7    # the two PR-C-2a spec commits
```

Otherwise, continue on the existing branch.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `packages/gateway/src/perf/bench-runner.ts` | Modify | Parse `--protocol-confirmed`; wire `confirmReferenceProtocol: () => true` into `runBenchCli` deps when present; update HELP text |
| `packages/gateway/src/perf/bench-runner.test.ts` | Modify | Add positive + negative test for `--protocol-confirmed` |
| `packages/cli/src/commands/bench.ts` | Modify | Update HELP text to document `--protocol-confirmed` (no behavioural change — pass-through) |
| `.github/workflows/_perf-reference.yml` | Create | Dispatch-only self-hosted reference run; opens `perf`-labelled bot PR |
| `.github/workflows/_perf.yml` | Modify | Cron split (`'0 4 * * 1-6'` + `'0 4 * * 0'`); per-step `if:` cost-fallback gate on heavy steps; update comment block |
| `docs/perf/missed.md` | Create | Top-5 + full-list table skeleton; populated by PR-C-2b |
| `docs/perf/deferred-backlog.md` | Create | Misses 6–N skeleton; populated by PR-C-2b |
| `docs/perf/reference-runner-setup.md` | Create | Operator runbook (registration, protocol checklist, dispatch, teardown, security notes) |
| `scripts/capture-benchmarks.ts` | Delete | Subsumed by S2-a per parent spec § 4.7 step 2 (precondition: ≥3 successful S2-a runs on `_perf.yml`) |

**Total:** 4 created, 3 modified, 1 deleted.

---

## Execution order

Tasks are sequential. Critical dependencies:

- **T1** (`--protocol-confirmed` flag) lands first — the workflow YAML invokes it.
- **T2** (`bench.ts` HELP text) is independent of T1 but cosmetically pairs with it.
- **T3** (`_perf-reference.yml`) depends on T1 (workflow uses the flag).
- **T4** (`_perf.yml` cost-fallback) is independent.
- **T5** (`docs/perf/missed.md`), **T6** (`docs/perf/deferred-backlog.md`), **T7** (`docs/perf/reference-runner-setup.md`) are independent of code tasks.
- **T8** (`scripts/capture-benchmarks.ts` deletion) is independent — but has a runtime precondition that may push it to a post-merge follow-up.
- **T9** (verification suite) depends on all preceding tasks.
- **T10** (open PR) is the terminal task.

---

## Task 1 — `--protocol-confirmed` flag in `bench-runner.ts`

**Files:**
- Modify: `packages/gateway/src/perf/bench-runner.ts`
- Modify: `packages/gateway/src/perf/bench-runner.test.ts`

- [ ] **Step 1.1: Write the failing positive test**

Append to `packages/gateway/src/perf/bench-runner.test.ts` inside the `describe("runBenchRunnerMain", …)` block (before the closing `});`):

```typescript
  test("--protocol-confirmed allows --reference to proceed without interactive prompt", async () => {
    const dir = freshDir();
    const historyPath = join(dir, "history.jsonl");
    try {
      const exitCode = await runBenchRunnerMain([
        "--surface",
        "S2-a",
        "--runs",
        "1",
        "--corpus",
        "small",
        "--reference",
        "--protocol-confirmed",
        "--history",
        historyPath,
        "--fixture-cache",
        dir,
      ]);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(readFileSync(historyPath, "utf8").trim());
      expect(parsed.runner).toBe("reference-m1air");
      expect(parsed.reference_protocol_compliant).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--reference without --protocol-confirmed refuses to record (default still gates)", async () => {
    const dir = freshDir();
    const historyPath = join(dir, "history.jsonl");
    try {
      const exitCode = await runBenchRunnerMain([
        "--surface",
        "S2-a",
        "--runs",
        "1",
        "--corpus",
        "small",
        "--reference",
        "--history",
        historyPath,
        "--fixture-cache",
        dir,
      ]);
      expect(exitCode).not.toBe(0);
      // history.jsonl must not exist or must be empty when the gate trips.
      let contents = "";
      try {
        contents = readFileSync(historyPath, "utf8");
      } catch {
        // file absent is also acceptable — the orchestrator refused before writing
      }
      expect(contents.trim()).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 1.2: Run the new tests to confirm they fail**

```bash
cd C:/gitrepo/Nimbus
bun test packages/gateway/src/perf/bench-runner.test.ts -t "--protocol-confirmed"
```

Expected: the positive test FAILs with `exitCode != 0` (default `confirmReferenceProtocol` returns `false` and refuses the run). The negative test may already PASS — that's fine, it's a regression guard.

- [ ] **Step 1.3: Implement the flag in `bench-runner.ts`**

Edit `packages/gateway/src/perf/bench-runner.ts`. Inside `runBenchRunnerMain`, after the `--help` check (line ~76–79) and before the existing `historyPath` resolution, parse and consume the new flag. Replace the `try { ... } finally { ... }` block to thread the new dep when present:

```typescript
  const stdout = deps.stdout ?? ((s: string) => process.stdout.write(`${s}\n`));
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    stdout(HELP);
    return 0;
  }

  // Strip --protocol-confirmed before runBenchCli sees args; capture its
  // presence to wire confirmReferenceProtocol non-interactively (D-X).
  const protocolConfirmed = hasFlag(args, "--protocol-confirmed");
  const cliArgs = protocolConfirmed
    ? args.filter((a) => a !== "--protocol-confirmed")
    : args;

  const historyPath =
    deps.historyPath ??
    takeFlag(cliArgs, "--history") ??
    join(process.cwd(), "docs/perf/history.jsonl");
  const fixtureCacheDir = takeFlag(cliArgs, "--fixture-cache");

  const runId = randomUUID();
  const runner = detectRunner(cliArgs);

  const ctxFactory = (): IncompleteContext => ({
    runId,
    runner,
    reason: "interrupted",
    nimbusGitSha: process.env["GITHUB_SHA"] ?? "unknown",
    bunVersion: typeof Bun === "undefined" ? "unknown" : Bun.version,
    osVersion: `${process.platform} ${process.arch}`,
  });
  const uninstall = installIncompleteSignalHandler(historyPath, ctxFactory);

  try {
    return await runBenchCli(cliArgs, {
      runId,
      historyPath,
      ...(fixtureCacheDir !== undefined && { fixtureCacheDir }),
      ...(protocolConfirmed && { confirmReferenceProtocol: () => true }),
      stdout,
      stderr: (s) => process.stderr.write(`${s}\n`),
    });
  } finally {
    uninstall();
  }
```

Note: every reference to `args` after the strip uses `cliArgs` (the filtered copy) so the orchestrator never sees the new flag. The `args` parameter itself stays unchanged (caller's array is not mutated).

- [ ] **Step 1.4: Update the `HELP` constant in the same file**

Replace the `--reference` line in the `Flags:` block to mention the new flag and add a new line for it:

```typescript
const HELP = `nimbus bench — perf bench harness (Phase 1A)

Usage:
  nimbus bench --surface <id> [--corpus small|medium|large] [--runs N] (--reference|--gha)
  nimbus bench --all [--corpus ...] [--runs N] (--reference|--gha)

Flags:
  --surface <id>      one of: S1, S2-a, S2-b, S2-c, S3, S4, S5, S6-drive, S6-gmail, S6-github,
                      S7-a, S7-b, S7-c, S8-l{50|500|5000}-b{1|8|32|64} (12 cells),
                      S9, S10, S11-a, S11-b
  --all               run every registered surface
  --corpus <tier>     small | medium | large
  --runs <N>          per-surface invocations (default 5)
  --reference         tag as reference-m1air (interactive protocol confirm by default)
  --protocol-confirmed  non-interactive §4.2 protocol confirmation; intended for CI
                        dispatch from .github/workflows/_perf-reference.yml
  --gha               tag as gha-<os> (auto-derived from process.platform)
  --history <path>    history.jsonl override
  --fixture-cache <p> fixture cache dir override
  --help              this message

See docs/superpowers/specs/2026-04-26-perf-audit-design.md for the surface table.
`;
```

- [ ] **Step 1.5: Run the tests to confirm they pass**

```bash
bun test packages/gateway/src/perf/bench-runner.test.ts
```

Expected: all tests pass (existing two from PR-C-1 + the two new ones).

- [ ] **Step 1.6: Run the full perf coverage gate to confirm no regression**

```bash
bun run test:coverage:perf
```

Expected: exit 0; line coverage ≥ 80% (PR-C-1 gate inherited).

- [ ] **Step 1.7: Run typecheck and lint**

```bash
bun run typecheck
bun run lint
```

Expected: both exit 0.

- [ ] **Step 1.8: Commit**

```bash
git add packages/gateway/src/perf/bench-runner.ts packages/gateway/src/perf/bench-runner.test.ts
git commit -m "$(cat <<'EOF'
feat(perf): --protocol-confirmed flag on bench-runner for non-interactive --reference

CI dispatch from _perf-reference.yml needs to bypass the interactive §4.2
protocol prompt. The flag wires confirmReferenceProtocol: () => true into
the runBenchCli deps when present; default behaviour unchanged. The flag
is stripped from argv before runBenchCli sees it so the orchestrator does
not need to know the new vocabulary. Tests cover both branches.

Spec: D-X in docs/superpowers/specs/2026-04-29-perf-audit-pr-c-2a-design.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — Update `bench.ts` CLI HELP text

**Files:**
- Modify: `packages/cli/src/commands/bench.ts`

- [ ] **Step 2.1: Update the `HELP` constant**

In `packages/cli/src/commands/bench.ts`, locate the `HELP` constant (lines 23–42). Add the `--protocol-confirmed` flag in the `Flags:` block, placed immediately after the `--reference` line:

```typescript
const HELP = `nimbus bench — perf bench harness (Phase 1A)

Usage:
  nimbus bench --surface <id> [--corpus small|medium|large] [--runs N] (--reference|--gha)
  nimbus bench --all [--corpus ...] [--runs N] (--reference|--gha)

Flags:
  --surface <id>      one of: S1, S2-a, S2-b, S2-c, S3, S4, S5, S11-a, S11-b
                      (cluster C — S6/S7/S8/S9/S10 — lands in PR-B-2b)
  --all               run every registered surface
  --corpus <tier>     small | medium | large
  --runs <N>          per-surface invocations (default 5)
  --reference         tag as reference-m1air (interactive protocol confirm by default)
  --protocol-confirmed  non-interactive §4.2 protocol confirmation; intended for CI
                        dispatch from .github/workflows/_perf-reference.yml
  --gha               tag as gha-<os> (auto-derived from process.platform)
  --history <path>    history.jsonl override
  --fixture-cache <p> fixture cache dir override
  --help              this message

See docs/superpowers/specs/2026-04-26-perf-audit-design.md for the surface table.
`;
```

(The CLI command itself is a pure pass-through; no behavioural change.)

- [ ] **Step 2.2: Run typecheck and lint**

```bash
bun run typecheck
bun run lint
```

Expected: both exit 0.

- [ ] **Step 2.3: Commit**

```bash
git add packages/cli/src/commands/bench.ts
git commit -m "$(cat <<'EOF'
docs(cli): document --protocol-confirmed in nimbus bench --help

Mirrors the same HELP-text update in packages/gateway/src/perf/bench-runner.ts.
The CLI is a pure pass-through wrapper, so no behavioural change is needed —
just operator-discoverability.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — Create `_perf-reference.yml` workflow

**Files:**
- Create: `.github/workflows/_perf-reference.yml`

- [ ] **Step 3.1: Resolve pinned action SHAs**

Open `.github/workflows/_perf.yml` and copy the pinned SHAs / versions for `actions/checkout` and `oven-sh/setup-bun` (or, if `setup-bun` is not used directly, look at `.github/actions/setup-nimbus-ci/action.yml` for the canonical Bun setup). Note the exact pinned form (e.g. `actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2`). Use the same pinning for the new workflow.

```bash
grep -E "uses: actions/checkout@|uses: oven-sh/setup-bun@|uses: \./.github/actions/setup-nimbus-ci" .github/workflows/_perf.yml .github/actions/setup-nimbus-ci/action.yml 2>/dev/null
```

Expected: prints the canonical pinning. Use the same pins below.

- [ ] **Step 3.2: Write the workflow file**

Create `.github/workflows/_perf-reference.yml`:

```yaml
name: Performance Reference Run (M1 Air)

# Triggers (spec §4.2 + design D-T):
#   - workflow_dispatch only. Operator manually triggers from the Actions UI
#     after preparing the M1 Air per the §4.2 protocol checklist.
#
# This workflow runs on the self-hosted runner registered with the
# `reference-m1air` label (see docs/perf/reference-runner-setup.md). It
# performs the bench, sanity-checks the resulting history.jsonl line, and
# opens a `perf`-labelled bot PR for review.

on:
  workflow_dispatch:
    inputs:
      protocol_attested:
        description: "Have you completed the §4.2 reference protocol checklist? (AC powered, Low Power Mode off, fresh reboot ≥5 min, no Spotlight/Time Machine/iCloud/Messages activity, display on)"
        required: true
        type: boolean
        default: false
      notes:
        description: "Optional free-form notes (e.g., thermal state, deviations from protocol). Goes into PR body, not the history line."
        required: false
        type: string
        default: ""

# Spec §4.3 — only one reference run at a time. cancel-in-progress: false
# so a queued dispatch waits for the current run to finish rather than
# corrupting its measurements.
concurrency:
  group: bench-reference
  cancel-in-progress: false

jobs:
  reference-run:
    name: Reference benchmark run (M1 Air)
    runs-on: [self-hosted, macOS, ARM64, reference-m1air]
    # 3 runs × ~15 min worst-case + setup overhead. Reference protocol
    # explicitly forbids parallelism, so this is a wall-clock budget.
    timeout-minutes: 60
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
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          fetch-depth: 0           # we read git history (HEAD:docs/perf/history.jsonl)
          persist-credentials: true # we push back to the same repo

      - name: Setup Bun and install dependencies
        uses: ./.github/actions/setup-nimbus-ci

      - name: Run reference benchmark (3 runs, all surfaces)
        # Direct bench-runner.ts invocation matches the existing _perf.yml
        # pattern (line 136). No separate `bun run build` step needed —
        # the bench harness runs against TS source via Bun.
        run: |
          set -euo pipefail
          bun packages/gateway/src/perf/bench-runner.ts \
            --all \
            --reference \
            --runs 3 \
            --protocol-confirmed \
            --history "${{ github.workspace }}/docs/perf/history.jsonl"

      - name: Sanity-check history.jsonl diff
        id: sanity
        shell: bash
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
        shell: bash
        run: |
          set -euo pipefail
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
        shell: bash
        run: |
          set -euo pipefail
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
          gh pr create \
            --title "perf: reference benchmark run $(date -u +%Y-%m-%d) (${GITHUB_SHA::7})" \
            --body "$body" \
            --label perf \
            --base main \
            --head "$BRANCH"
          echo "PR opened on branch $BRANCH" >> "$GITHUB_STEP_SUMMARY"
```

(If `Step 3.1` revealed different pinned SHAs in the repo, substitute them into the `actions/checkout@…` line above. The `./.github/actions/setup-nimbus-ci` action is a local composite action — no SHA pin needed.)

- [ ] **Step 3.3: Validate the YAML parses**

```bash
bun -e 'import("yaml").then(({parse}) => parse(require("node:fs").readFileSync(".github/workflows/_perf-reference.yml","utf8")))' && echo OK
```

Expected: `OK`. (If `yaml` is not installed, fall back to `bunx js-yaml < .github/workflows/_perf-reference.yml > /dev/null && echo OK`.)

- [ ] **Step 3.4: Run actionlint if available**

```bash
which actionlint && actionlint .github/workflows/_perf-reference.yml || echo "actionlint not installed; skipping (CI will run it)"
```

Expected: clean output, or "actionlint not installed; skipping" if the binary isn't on PATH locally.

- [ ] **Step 3.5: Verify the workflow's validation gate from any branch (no runner needed)**

This step runs after the file is pushed but before any reference-runner is registered. It proves the gate works end-to-end without needing a runner online.

```bash
# Push the branch first
git add .github/workflows/_perf-reference.yml
git push -u origin HEAD

# Dispatch with protocol_attested=false from the new branch
gh workflow run _perf-reference.yml --ref "$(git branch --show-current)" -f protocol_attested=false
sleep 5
# Watch the latest run; should fail at the validation step.
gh run list --workflow=_perf-reference.yml --limit 1
```

Expected: the run fails. Open it in the UI to confirm the failure message references the §4.2 checklist. **Note:** if no `reference-m1air` runner is registered, the workflow_dispatch will queue the run waiting for an available runner; the validation step never executes and the test is inconclusive. In that case, defer this step to PR-C-2b's runner-registration phase and skip it now.

- [ ] **Step 3.6: Commit**

```bash
git add .github/workflows/_perf-reference.yml
git commit -m "$(cat <<'EOF'
ci(perf): _perf-reference.yml — self-hosted M1 Air reference run workflow

workflow_dispatch only; targets [self-hosted, macOS, ARM64, reference-m1air];
permissions limited to contents:write + pull-requests:write; concurrency
group bench-reference (one run at a time, queue not cancel). Steps:
validate protocol attestation → checkout → setup → bench-runner.ts
--all --reference --runs 3 --protocol-confirmed → robust sanity check
(git status --porcelain + wc -l delta + jq on runner/SHA/os_version) →
commit + push branch → gh pr create with perf label.

Spec: D-T, D-U, D-V, D-AA, D-AB in
docs/superpowers/specs/2026-04-29-perf-audit-pr-c-2a-design.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — `_perf.yml` cron split + cost-fallback gate

**Files:**
- Modify: `.github/workflows/_perf.yml`

- [ ] **Step 4.1: Update the `on:` block (cron split)**

In `.github/workflows/_perf.yml`, replace the `on:` block (lines 15–21) with:

```yaml
on:
  push:
    branches: [main]
  pull_request:
    types: [opened, synchronize, reopened, labeled]
  schedule:
    - cron: "0 4 * * 1-6"   # Mon–Sat 04:00 UTC — Linux only (cost-fallback gate, D-W/D-AB)
    - cron: "0 4 * * 0"     # Sunday 04:00 UTC — full three-OS coverage
```

- [ ] **Step 4.2: Update the cost-discipline comment block**

Replace the comment block (lines 3–14) with:

```yaml
# Triggers (spec §4.3, design D-W/D-AB):
#   - push to main: writes the per-OS baseline artifact subsequent PRs diff against.
#   - schedule: '0 4 * * 1-6' (Mon–Sat, Linux only via cost-fallback gate);
#               '0 4 * * 0'   (Sunday, full three-OS coverage).
#   - pull_request: run only when labels include `perf` (auto-applied by labeler.yml
#     on changes under packages/gateway/src/{engine,db,embedding,connectors,llm,voice,perf}/**).
#
# Cost-fallback gate (spec §4.3): macOS+Windows skip the heavy bench/upload/
# compare steps on Mon–Sat nightlies; cheap setup steps (Harden Runner,
# Checkout, Setup Bun, install) run unconditionally. Net: ~95% per-non-Linux-OS
# minutes saved on weekday nights. Push-to-main and perf-PRs always run all
# three OSes, so artifacts on `main` are kept fresh on every merge.
```

- [ ] **Step 4.3: Add `if:` to the heavy steps**

Find the three "heavy" steps in the `benchmark` job and add the cost-fallback gate to each. Steps to modify (current line numbers from the read above):

1. `Run bench` (line 131) — add `if:` *before* the `shell: bash` line.
2. `Upload run history artifact` (line 141) — add `if:` *before* the `uses:` line.
3. `Compare + post PR-comment delta` (line 150) — add `if:` *before* the `shell: bash` line.

The same `if:` value goes on all three:

```yaml
      - name: Run bench
        if: |
          matrix.os == 'ubuntu-24.04' ||
          github.event_name != 'schedule' ||
          github.event.schedule == '0 4 * * 0'
        shell: bash
        run: |
          set -euo pipefail
          mkdir -p "${RUNNER_TEMP}/perf-fixtures"
          bun packages/gateway/src/perf/bench-runner.ts \
            --all --gha --runs 5 --corpus small \
            --history "${RUNNER_TEMP}/run-history.jsonl" \
            --fixture-cache "${RUNNER_TEMP}/perf-fixtures"

      - name: Upload run history artifact
        if: |
          matrix.os == 'ubuntu-24.04' ||
          github.event_name != 'schedule' ||
          github.event.schedule == '0 4 * * 0'
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7
        with:
          name: perf-${{ steps.runner-id.outputs.id }}-${{ github.sha }}
          path: ${{ runner.temp }}/run-history.jsonl
          retention-days: 90

      - name: Compare + post PR-comment delta
        if: |
          matrix.os == 'ubuntu-24.04' ||
          github.event_name != 'schedule' ||
          github.event.schedule == '0 4 * * 0'
        shell: bash
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          set -euo pipefail
          bun packages/gateway/src/perf/bench-ci.ts \
            --current "${RUNNER_TEMP}/run-history.jsonl" \
            --runner "${{ steps.runner-id.outputs.id }}"
```

- [ ] **Step 4.4: Validate YAML**

```bash
bunx js-yaml < .github/workflows/_perf.yml > /dev/null && echo OK
which actionlint && actionlint .github/workflows/_perf.yml || echo "actionlint not installed; skipping"
```

Expected: `OK`; actionlint clean (or skipped).

- [ ] **Step 4.5: Mental dry-run of the gate (no commands)**

Verify the truth table:

| `event_name` | `event.schedule` | `matrix.os` | gate? |
|---|---|---|---|
| `push` | (n/a) | any | ✅ true (`event_name != 'schedule'`) |
| `pull_request` | (n/a) | any | ✅ true |
| `schedule` | `0 4 * * 0` | any | ✅ true (Sunday matches) |
| `schedule` | `0 4 * * 1-6` | `ubuntu-24.04` | ✅ true (matrix.os matches) |
| `schedule` | `0 4 * * 1-6` | `macos-15` | ❌ false (skips heavy) |
| `schedule` | `0 4 * * 1-6` | `windows-2025` | ❌ false (skips heavy) |

If any row above doesn't match expectations, revise the `if:` expression before committing.

- [ ] **Step 4.6: Commit**

```bash
git add .github/workflows/_perf.yml
git commit -m "$(cat <<'EOF'
ci(perf): cost-fallback gate — Linux nightly + macOS/Windows on Sundays only

Splits the daily 04:00 UTC cron into '0 4 * * 1-6' (Mon-Sat) and
'0 4 * * 0' (Sunday). Adds an `if:` cost-fallback gate to the three
heavy matrix steps (bench, upload, compare): they run when (a) the
matrix is ubuntu-24.04, OR (b) the trigger is not `schedule` (push,
PR), OR (c) the cron is the Sunday one. macOS/Windows runners on
weekday nightlies provision-then-skip — ~95% of per-non-Linux-OS
nightly minutes saved. Push-to-main and perf-PRs unaffected.

The gate-condition syntax requires the Sunday cron to literally
exist; documented at the design level as D-AB. Comment block at the
workflow head is updated to point at the active gate.

Spec: D-H, D-W, D-AB in
docs/superpowers/specs/2026-04-29-perf-audit-pr-c-2a-design.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — Create `docs/perf/missed.md` skeleton

**Files:**
- Create: `docs/perf/missed.md`

- [ ] **Step 5.1: Write the file**

Create `docs/perf/missed.md` with this exact content:

```markdown
# Performance threshold misses

> **Status:** PR-C-2a — skeleton. Populated by PR-C-2b after the M1 Air reference run.

Misses ranked by `user_felt_impact_score / engineering_cost_estimate` per spec [§3.4](../superpowers/specs/2026-04-26-perf-audit-design.md). Top 5 → fix plans (PR-D-1 … PR-D-N). Misses 6–N → [`deferred-backlog.md`](./deferred-backlog.md).

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

- [ ] **Step 5.2: Verify the link to spec §3.4 resolves**

```bash
test -f docs/superpowers/specs/2026-04-26-perf-audit-design.md && echo OK
```

Expected: `OK`.

- [ ] **Step 5.3: Commit**

```bash
git add docs/perf/missed.md
git commit -m "$(cat <<'EOF'
docs(perf): missed.md skeleton (populated by PR-C-2b)

Top-5 + full-list table with Confidence column per spec §3.4 rubric.
Mirrors the B1 audit's results.md shape so retained-Low items are
visibly flagged in the deferred backlog rather than silently mixed in.

Spec: parent §10 + design D-E.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6 — Create `docs/perf/deferred-backlog.md` skeleton

**Files:**
- Create: `docs/perf/deferred-backlog.md`

- [ ] **Step 6.1: Write the file**

Create `docs/perf/deferred-backlog.md` with this exact content:

```markdown
# Performance miss deferred backlog

> **Status:** PR-C-2a — skeleton. Populated by PR-C-2b.

Misses 6–N — picked up by **B2-v2 (post-`v0.1.0`)** per spec [§11](../superpowers/specs/2026-04-26-perf-audit-design.md). Each row carries `Confidence` (mirrors B1) so retained-Low items are visibly flagged here rather than silently mixed into the top-5.

| Surface | Threshold violated | Observed (p50 / p95) | Impact (1–5) | Cost (1–5) | Impact / Cost | Confidence | Why deferred |
|---|---|---|---|---|---|---|---|
| _TBD — populated by PR-C-2b._ | | | | | | | |
```

- [ ] **Step 6.2: Commit**

```bash
git add docs/perf/deferred-backlog.md
git commit -m "$(cat <<'EOF'
docs(perf): deferred-backlog.md skeleton (populated by PR-C-2b)

Misses 6-N table with Confidence + "why deferred" columns. Picked up
by B2-v2 (post-v0.1.0) per spec §11.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7 — Create `docs/perf/reference-runner-setup.md`

**Files:**
- Create: `docs/perf/reference-runner-setup.md`

- [ ] **Step 7.1: Write the file**

Create `docs/perf/reference-runner-setup.md` with this exact content:

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
```

- [ ] **Step 7.2: Verify the runbook references resolve**

```bash
# The workflow file referenced in step 3.
test -f .github/workflows/_perf-reference.yml && echo "workflow OK"
# The §4.2 spec section.
grep -q "Reference-run protocol" docs/superpowers/specs/2026-04-26-perf-audit-design.md && echo "spec §4.2 OK"
```

Expected: both lines print `OK`.

- [ ] **Step 7.3: Commit**

```bash
git add docs/perf/reference-runner-setup.md
git commit -m "$(cat <<'EOF'
docs(perf): reference-runner-setup.md — operator runbook for M1 Air

Covers: runner registration (gh auth scopes, registration-token API call,
config.sh --labels macOS,ARM64,reference-m1air), §4.2 pre-flight checklist
copy-pasteable, dispatch (gh workflow run _perf-reference.yml), teardown,
and security notes (public-repo self-hosted RCE mitigations, one-shot vs
persistent trade-offs, dedicated-user-account isolation, token hygiene).

Spec: D-AC in
docs/superpowers/specs/2026-04-29-perf-audit-pr-c-2a-design.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8 — Verify capture-benchmarks precondition + delete

**Files:**
- Delete: `scripts/capture-benchmarks.ts`

- [ ] **Step 8.1: List the 3 most recent successful `_perf.yml` runs on `main`**

```bash
gh run list \
  --workflow=_perf.yml \
  --branch=main \
  --status=success \
  --json databaseId,createdAt,conclusion,headSha \
  --limit 10
```

Expected: a JSON array with at least 3 entries that have `"conclusion":"success"`.

If fewer than 3 successful runs exist, **defer this task** — go directly to Step 8.5 ("Defer-path") and do NOT delete the file. Otherwise continue.

- [ ] **Step 8.2: Inspect the S2-a values across those 3 runs**

For each of the 3 most recent successful run IDs from Step 8.1, download the ubuntu artifact and check S2-a's p95:

```bash
mkdir -p /tmp/perf-precondition
for run_id in <RUN_ID_1> <RUN_ID_2> <RUN_ID_3>; do
  sha=$(gh run view "$run_id" --json headSha -q .headSha)
  gh run download "$run_id" --name "perf-gha-ubuntu-$sha" --dir "/tmp/perf-precondition/$run_id" 2>/dev/null \
    && jq '.surfaces["S2-a"]' "/tmp/perf-precondition/$run_id/run-history.jsonl"
done
```

(Substitute the actual database IDs from Step 8.1's output. The `gha-ubuntu` naming comes from `_perf.yml:124`.)

Expected: each prints a JSON object with `samples_count: 100` and a finite `p95_ms` value. If any run has `stub_reason` set on S2-a or returns a 404 (artifact expired / never uploaded), the precondition is not met — **defer this task**.

- [ ] **Step 8.3: Sanity-check S2-a values against capture-benchmarks baseline**

The legacy `scripts/capture-benchmarks.ts` measured the same SQL builder against the same warm in-memory tier (parent spec § 4.7). The S2-a p95 values from Step 8.2 should be in the same order of magnitude as the values that `gh-pages` last recorded.

```bash
# Print each S2-a p95 — eyeball that they are not wildly different (no >10× regression vs. legacy expectations of < 100ms p95 on a clean ubuntu runner).
jq '.surfaces["S2-a"].p95_ms' /tmp/perf-precondition/*/run-history.jsonl
```

Expected: each value is finite and < 200 ms (sanity threshold; the original capture-benchmarks alert was at 200 % of baseline). If any value is outlier-high or zero, investigate before deleting — this might indicate S2-a is broken, in which case keep the legacy script as a safety net.

- [ ] **Step 8.4: Delete the file**

```bash
git rm scripts/capture-benchmarks.ts
```

Then verify no other references remain in code or workflows:

```bash
grep -rn "capture-benchmarks" packages/ scripts/ .github/ 2>&1
```

Expected: no matches (or only documentation/historical references in `docs/`, which is fine).

- [ ] **Step 8.5: Commit (delete-path)**

```bash
git commit -m "$(cat <<'EOF'
chore(perf): retire scripts/capture-benchmarks.ts (subsumed by S2-a)

S2-a's first 3+ successful nightly runs on _perf.yml have produced p95
values in the same range as the legacy capture-benchmarks.ts baseline
(same SQL builder, same warm in-memory tier, parent spec §4.7). The
script is now redundant.

No package.json scripts referenced it (benchmark.yml retired in PR-C-1
took the last invocation with it). docs/ historical references retained
as audit trail.

Spec: parent §4.7 step 2 + D-Q (PR-C-1) + D-Y (PR-C-2a).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8.5 (alternative — defer-path): Document the deferral**

If Steps 8.1–8.3 indicated the precondition is not yet met, do NOT delete the file. Instead, edit the PR description (in Task 10) to include:

> **`scripts/capture-benchmarks.ts` deletion deferred.** Spec §4.7 step 2 requires ≥3 successful S2-a nightly runs on `_perf.yml` with values comparable to the legacy baseline. As of this PR's open date, the precondition is not yet met (only N runs visible / S2-a values still settling). Tracked as a follow-up commit on `main` after the next round of nightlies. No code or workflow change in this PR for the deletion.

No commit in this case.

- [ ] **Step 8.6: Clean up the precondition-check scratch directory**

Run unconditionally (delete-path or defer-path):

```bash
rm -rf /tmp/perf-precondition
```

Expected: silent. The directory was a transient artifact-inspection cache; nothing committed depends on it.

---

## Task 9 — Self-review and verification

**Files:** none (verification-only).

- [ ] **Step 9.1: Run the typecheck**

```bash
bun run typecheck
```

Expected: exit 0.

- [ ] **Step 9.2: Run lint (Biome)**

```bash
bun run lint
```

Expected: exit 0.

- [ ] **Step 9.3: Run the perf coverage gate**

```bash
bun run test:coverage:perf
```

Expected: exit 0; line coverage ≥ 80%.

- [ ] **Step 9.4: Run regen-slo:check (PR-C-1 drift guard)**

```bash
bun run regen-slo:check
```

Expected: exit 0. (PR-C-2a does not change `SLO_THRESHOLDS`, so `slo.md` should be byte-identical to its regenerated form.)

- [ ] **Step 9.5: Run the full CI test suite as preflight**

This catches integration regressions and matches the project memory note "Run CI-parity tests before every PR push".

```bash
bun run test:ci
```

Expected: exit 0. (May take 5–10 min depending on machine.)

- [ ] **Step 9.6: Sanity-check the file inventory matches the plan**

```bash
git log --name-status origin/main..HEAD | grep -E "^[AMD]" | sort -u
```

Expected output (order may vary):

```
A       .github/workflows/_perf-reference.yml
A       docs/perf/deferred-backlog.md
A       docs/perf/missed.md
A       docs/perf/reference-runner-setup.md
M       .github/workflows/_perf.yml
M       packages/cli/src/commands/bench.ts
M       packages/gateway/src/perf/bench-runner.ts
M       packages/gateway/src/perf/bench-runner.test.ts
```

Plus optionally `D scripts/capture-benchmarks.ts` if Task 8 took the delete-path.

If anything is unexpectedly missing or extra, investigate before opening the PR.

---

## Task 10 — Open PR

**Files:** none (PR creation only).

- [ ] **Step 10.1: Push the branch**

```bash
git push -u origin HEAD
```

- [ ] **Step 10.2: Open the PR**

Adjust the body if Task 8 took the defer-path (uncomment the deferred-precondition note and adjust the bullet under "Deliverables").

```bash
gh pr create --title "perf: PR-C-2a — reference-run infra + cleanup" --body "$(cat <<'EOF'
## Summary

PR-C-2a delivers the half of PR-C-2 that does **not** depend on physical reference hardware. PR-C-2b (a small data-and-prose PR) follows after the operator registers the M1 Air as a self-hosted runner and dispatches the reference run.

Spec: [`docs/superpowers/specs/2026-04-29-perf-audit-pr-c-2a-design.md`](docs/superpowers/specs/2026-04-29-perf-audit-pr-c-2a-design.md). Plan: [`docs/superpowers/plans/2026-04-29-perf-audit-pr-c-2a.md`](docs/superpowers/plans/2026-04-29-perf-audit-pr-c-2a.md).

## Deliverables

- `_perf-reference.yml` — `workflow_dispatch`-only workflow targeting a `[self-hosted, macOS, ARM64, reference-m1air]` runner. Steps: validate `protocol_attested` → bench (`--all --reference --runs 3 --protocol-confirmed`) → robust sanity check (`git status --porcelain` + `wc -l` delta + `jq` on runner / SHA / `os_version`) → commit + push branch → open `perf`-labelled bot PR. Permissions scoped to `contents: write` + `pull-requests: write`.
- `_perf.yml` cost-fallback gate — cron split (`'0 4 * * 1-6'` Mon–Sat for Linux; `'0 4 * * 0'` Sunday for full three-OS), per-step `if:` on the heavy bench / upload / compare steps. macOS+Windows runners on weekday nightlies provision-then-skip — ~95% per-non-Linux-OS minutes saved. Push-to-main and `perf`-PRs always run all three OSes.
- `--protocol-confirmed` flag in `bench-runner.ts` — non-interactive §4.2 protocol confirmation; required for CI dispatch from `_perf-reference.yml`. Wires `confirmReferenceProtocol: () => true` into `runBenchCli` deps when present; default behaviour unchanged. Tests cover both branches.
- `docs/perf/missed.md` skeleton — top-5 + full-list table with `Confidence` column, populated by PR-C-2b.
- `docs/perf/deferred-backlog.md` skeleton — misses 6–N, populated by PR-C-2b.
- `docs/perf/reference-runner-setup.md` — operator runbook (registration, §4.2 checklist, dispatch, teardown, security notes).
- `scripts/capture-benchmarks.ts` deleted (subsumed by S2-a per parent spec §4.7 step 2; precondition verified — see plan Task 8). _← if defer-path taken in Task 8, replace this bullet with: "`scripts/capture-benchmarks.ts` deletion deferred — precondition (≥3 successful S2-a nightlies with values comparable to legacy baseline) not yet met. Tracked as a follow-up commit on `main`."_

## Docs-site decision

`slo.md` stays as raw markdown for v0.1.0. It is regenerated from `slo-thresholds.ts` (PR-C-1) by `scripts/regen-slo.ts` and CI-guarded by `regen-slo:check`. Adding an Astro re-export layer would risk drift between the const and the rendered page. Revisit when `packages/docs/` grows a Reference / SLO category. (Spec D-Z; parent spec §10 deliverable.)

## Out of scope (PR-C-2b)

- Self-hosted runner registration on the M1 Air (operator action; runbook in `docs/perf/reference-runner-setup.md`).
- Reference run dispatch + populated `SLO_THRESHOLDS` workload values + populated `baseline.md`.
- Top-5 missed ranking + populated `deferred-backlog.md` rows.

## Test plan

- [ ] `bun run test:coverage:perf` exits 0 with both new `--protocol-confirmed` tests included.
- [ ] `bun run regen-slo:check` exits 0 (no `SLO_THRESHOLDS` change in this PR).
- [ ] `bun run typecheck` exits 0.
- [ ] `bun run lint` exits 0.
- [ ] `bun run test:ci` exits 0 (full CI-parity preflight).
- [ ] PR-quality CI passes on this branch (`actionlint` validates both new and modified workflow YAML).
- [ ] Once the runner is registered (PR-C-2b prep), dispatch with `protocol_attested=false` is rejected at the validation step (proves the gate works without producing a measurement).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 10.3: Verify the `perf` label was applied**

```bash
gh pr view --json labels -q '.labels[].name'
```

Expected: includes `perf` (auto-applied by `.github/labeler.yml` because `packages/gateway/src/perf/**` changed). If not present, add it manually:

```bash
gh pr edit --add-label perf
```

- [ ] **Step 10.4: Watch CI**

```bash
gh pr checks --watch
```

Expected: all checks pass. If `_perf.yml` is triggered (it is — this PR is `perf`-labelled), the matrix runs all three OSes and the bench-ci comparator posts a delta comment. Workload-row deltas record but do not gate (PR-C-1 D-B); UX-row deltas gate.

---

## Review feedback log

Plan reviewed by Gemini CLI on 2026-04-29 (`docs/superpowers/plans/2026-04-29-perf-audit-pr-c-2a-review.md`). Each item verified against the actual code per the project memory note "verify external AI-review claims".

| Reviewer item | Verdict | Verification |
|---|---|---|
| OQ1 — `reference_protocol_compliant` field on success | Dismissed | `bench-cli.ts:307` sets the field on every reference-run history line that completes; gate fails-closed before line 307 if confirmation returns false. Plan T1 test expectation is correct. |
| OQ2 — `os_version` in successful history line | Dismissed | `bench-cli.ts:303` populates `os_version: \`${platform()} ${release()} (${hostname()})\`` in `buildHistoryLine` for successful runs (the `ctxFactory` for incomplete runs is a separate path). T3 sanity check is valid. |
| OQ3 — sanity check robustness for multi-file changes | Dismissed | `awk '{print $2}'` on multi-file `git status --porcelain` produces a multi-line string; `[[ "$changed" != "docs/perf/history.jsonl" ]]` correctly evaluates true (different) and fails the step. Reviewer's alternative is more verbose without being more correct. |
| OQ4 — `bun install` lockfile drift | Dismissed | `.github/actions/setup-nimbus-ci/action.yml` defaults to `frozen-install: "true"` (line 18); `bun install --frozen-lockfile` cannot modify `bun.lock`. Bench fixture caches default to `$TMPDIR/nimbus-bench-fixtures/`, outside the workspace. Sanity check correctly fails (fail-safe) on any unexpected dirt. |
| S1 — `/tmp/perf-precondition` cleanup | **Applied** | Added Step 8.6 to remove the scratch directory after the precondition-check phase, on both delete-path and defer-path. |
| S2 — workflow input mentions "AC powered" | Dismissed | Reviewer's own follow-up acknowledged it's already covered. No-op. |
| S3 — `BenchCliDeps.confirmReferenceProtocol` typed optional | Dismissed | Already verified in design-review pass (D-AD). `bench-cli.ts:61` has the optional `?:`. Reviewer repeating a dismissed point. |

---

## Acceptance criteria for PR-C-2a (mirrors spec § 11)

When this PR merges:

1. `.github/workflows/_perf-reference.yml` exists; `workflow_dispatch` only; targets `[self-hosted, macOS, ARM64, reference-m1air]`; permissions `contents: write` + `pull-requests: write`; `concurrency: bench-reference`.
2. `protocol_attested: false` dispatch fails at the validation step (verifiable from any branch once a runner is registered).
3. `.github/workflows/_perf.yml` cron is split (`'0 4 * * 1-6'` + `'0 4 * * 0'`); cost-fallback `if:` is on the heavy steps; macOS/Windows runners on a weekday `schedule` event provision-then-skip.
4. `--protocol-confirmed` flag is parsed in `packages/gateway/src/perf/bench-runner.ts`, wires `confirmReferenceProtocol: () => true` into the `runBenchCli` deps; tests pass; both `bench-runner.ts`'s and `packages/cli/src/commands/bench.ts`'s `--help` text document the flag.
5. `docs/perf/missed.md` and `docs/perf/deferred-backlog.md` exist as templated skeletons with TBD rows + `Confidence` column + rubric reference.
6. `docs/perf/reference-runner-setup.md` exists with the operator runbook (registration, pre-flight checklist, dispatch, teardown, security notes).
7. `scripts/capture-benchmarks.ts` is deleted (precondition verified per Task 8) — or, if precondition not met, deferral documented in PR description.
8. PR description documents the docs-site decision: `slo.md` stays raw markdown for v0.1.0; revisit when `packages/docs/` grows a Reference / SLO category.
9. `bun run test:coverage:perf`, `bun run regen-slo:check`, `bun run typecheck`, `bun run lint`, `bun run test:ci`, and PR-quality CI all pass.
10. Self-review of all three new doc files: no placeholders other than the explicitly-marked TBD rows; rubric link resolves.
