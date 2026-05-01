# Structure-Audit Top-5 Fix #1 — D10 Sync-Connector Spawn Invariants

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to land this fix as a single PR off `main`.

**Goal:** Fix all 5 D10 violations surfaced by the Phase 1/2 audit. Each violation is a `Bun.spawn(...)` call under `packages/gateway/src/connectors/` that constructs the child process's environment from `{ ...process.env, ... }` (or omits the `env` field entirely, which Bun treats as inheriting all of `process.env`) instead of routing through `extensionProcessEnv()` — a regression of security invariant **I1** (`docs/SECURITY-INVARIANTS.md`).

**Architecture:** Each of the 5 connectors has a small per-file env-builder pattern. The fix is to call `extensionProcessEnv(extra)` instead of constructing `{ ...process.env, ...extra }` manually (or instead of relying on Bun's default full-inheritance when `env` is missing). The helper preserves an audited BASELINE_KEYS allow-list (`PATH`, `HOME`, `TMPDIR`, `TEMP`, `TMP`, `APPDATA`, `LOCALAPPDATA`, `USERPROFILE`, `SYSTEMROOT`, `BUN_INSTALL`, `LANG`, `TZ`) which covers everything `aws`/`az`/`gcloud`/`kubectl`/`git` actually need to locate their CLI binary, find the user's config dir, resolve a temp path, and emit localized output. The connector-specific keys (e.g., `AWS_*`, `AZURE_*`, `KUBECONFIG`, `GOOGLE_APPLICATION_CREDENTIALS`) are passed via the helper's `extra` parameter.

**Two special cases:**

1. **`aws-sync.ts`:** the `{ ...process.env }` is at line 45, inside the local `awsProcessEnv()` helper. The `Bun.spawn` at line 69 forwards the helper's output unchanged. The audit script flags line 69 (where the spawn lives) but the actual `process.env` spread is at line 45 — fixing the helper resolves the violation transitively. Do NOT add `extensionProcessEnv` at the spawn site; rewrite the helper.

2. **`filesystem-v2-sync.ts`:** the `Bun.spawn(...)` at line 79 (in `gitLogRecords`, called from line 69) has **NO `env` field at all**. Bun's documented default when `env` is omitted is to inherit the full `process.env` of the parent — which is precisely the I1 leak the helper is meant to prevent. The fix is to ADD an `env` field: `env: extensionProcessEnv({})` (empty extras — `git` only needs the BASELINE_KEYS).

**Tech Stack:** Existing `extensionProcessEnv()` helper at `packages/gateway/src/extensions/spawn-env.ts`; existing usage pattern in `packages/gateway/src/connectors/lazy-mesh.ts:18` for reference. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-30-structure-audit-design.md` § 6.2 (D10 gate); `CLAUDE.md` Security Invariants table I1.

**Branch:** `dev/asafgolombek/structure-fixes-d10-sync-connector-spawn` (off `main`).

---

## Task 1: Setup

- [ ] **Step 1: Create the branch off `main`**

```bash
git checkout main
git pull origin main --quiet
git checkout -b dev/asafgolombek/structure-fixes-d10-sync-connector-spawn
```

- [ ] **Step 2: Verify the violation set hasn't changed**

```bash
bun run audit:invariants 2>&1 | grep "D10 spawn"
```

Expected: 5 lines matching exactly these files (line numbers may have drifted post-`main`-merges; that's fine, just confirm the file set):

| File | Triage line at plan-write time |
|---|---|
| `packages/gateway/src/connectors/aws-sync.ts` | 69 (spawn) — actual `process.env` spread is at line 45 (helper) |
| `packages/gateway/src/connectors/azure-sync.ts` | 41 |
| `packages/gateway/src/connectors/gcp-sync.ts` | 37 |
| `packages/gateway/src/connectors/kubernetes-sync.ts` | 111 |
| `packages/gateway/src/connectors/filesystem-v2-sync.ts` | 69 (call site) — actual spawn with no `env` is at line 79 |

If any file's violation has been fixed independently, has new violations, or a new connector has been added with the same anti-pattern, STOP and update `docs/structure-audit/missed.md` before proceeding. Do not proceed with an outdated violation set.

---

## Task 2: Fix `aws-sync.ts` (helper refactor — special case)

**Files:**
- Modify: `packages/gateway/src/connectors/aws-sync.ts` (helper at line ~45)
- Verify: `packages/gateway/src/connectors/aws-sync.test.ts` (if present)

- [ ] **Step 1: Read the violating helper block**

Use the `Read` tool on `packages/gateway/src/connectors/aws-sync.ts` lines 36–60. Confirm the current shape:

```ts
async function awsProcessEnv(ctx: SyncContext): Promise<Record<string, string | undefined> | null> {
  // ... vault reads, ok-check ...
  const e = { ...process.env } as Record<string, string | undefined>;
  if (ak !== "") { e["AWS_ACCESS_KEY_ID"] = ak; }
  if (sk !== "") { e["AWS_SECRET_ACCESS_KEY"] = sk; }
  if (reg !== "") { e["AWS_DEFAULT_REGION"] = reg; }
  if (prof !== "") { e["AWS_PROFILE"] = prof; }
  return e;
}
```

- [ ] **Step 2: Run audit:invariants to confirm the violation**

```bash
bun run scripts/structure-audit/check-nimbus-invariants.ts --rule spawn 2>&1 | grep aws-sync
# Expected: 1 line for aws-sync.ts at line ~69.
```

- [ ] **Step 3: Apply the fix — rewrite the helper, NOT the spawn**

Add the import at the top of the file (alongside the other relative imports):

```ts
import { extensionProcessEnv } from "../extensions/spawn-env.ts";
```

Replace the helper body so it builds `extra` first, then calls `extensionProcessEnv`. The return type narrows from `Record<string, string | undefined>` to `Record<string, string>` — verify the spawn site at line 69 (`env: env`) accepts the narrower type. Bun.spawn's `env` option accepts `Record<string, string>`, so this is fine.

Suggested replacement:

```ts
async function awsProcessEnv(ctx: SyncContext): Promise<Record<string, string> | null> {
  const ak = (await ctx.vault.get("aws.access_key_id"))?.trim() ?? "";
  const sk = (await ctx.vault.get("aws.secret_access_key"))?.trim() ?? "";
  const reg = (await ctx.vault.get("aws.default_region"))?.trim() ?? "";
  const prof = (await ctx.vault.get("aws.profile"))?.trim() ?? "";
  const ok = (ak !== "" && sk !== "" && (reg !== "" || prof !== "")) || (prof !== "" && ak === "");
  if (!ok) {
    return null;
  }
  const extra: Record<string, string> = {};
  if (ak !== "") { extra["AWS_ACCESS_KEY_ID"] = ak; }
  if (sk !== "") { extra["AWS_SECRET_ACCESS_KEY"] = sk; }
  if (reg !== "") { extra["AWS_DEFAULT_REGION"] = reg; }
  if (prof !== "") { extra["AWS_PROFILE"] = prof; }
  return extensionProcessEnv(extra);
}
```

The `Bun.spawn` at line 69 does NOT change — it still passes `env` straight through.

- [ ] **Step 4: Re-run audit:invariants**

```bash
bun run scripts/structure-audit/check-nimbus-invariants.ts --rule spawn 2>&1 | grep aws-sync
# Expected: empty (this violation now cleared).
```

- [ ] **Step 5: Run the connector test (if any)**

```bash
bun test packages/gateway/src/connectors/aws-sync.test.ts 2>&1 | tail -5
# Expected: all tests pass.
```

If no test file exists, skip and flag a follow-up "add test for aws-sync" issue in the PR body.

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/connectors/aws-sync.ts
git commit -m "fix(connectors): route aws-sync child env through extensionProcessEnv (I1)"
```

---

## Task 3: Fix `azure-sync.ts` (inline at spawn site)

**Files:**
- Modify: `packages/gateway/src/connectors/azure-sync.ts` (line ~41)
- Verify: `packages/gateway/src/connectors/azure-sync.test.ts` (if present)

- [ ] **Step 1: Read the violating spawn block**

Read lines 30–50. Confirm the current shape:

```ts
const env = {
  ...process.env,
  AZURE_TENANT_ID: tenant,
  AZURE_CLIENT_ID: clientId,
  AZURE_CLIENT_SECRET: secret,
} as Record<string, string | undefined>;
const proc = Bun.spawn(["az", ...args, "-o", "json"], { env, stdout: "pipe", stderr: "pipe" });
```

- [ ] **Step 2: Run audit:invariants to confirm the violation**

```bash
bun run scripts/structure-audit/check-nimbus-invariants.ts --rule spawn 2>&1 | grep azure-sync
# Expected: 1 line for azure-sync.ts at line ~41.
```

- [ ] **Step 3: Apply the fix**

Add the import (alongside the other relative imports):

```ts
import { extensionProcessEnv } from "../extensions/spawn-env.ts";
```

Replace the env construction:

```ts
const env = extensionProcessEnv({
  AZURE_TENANT_ID: tenant,
  AZURE_CLIENT_ID: clientId,
  AZURE_CLIENT_SECRET: secret,
});
const proc = Bun.spawn(["az", ...args, "-o", "json"], { env, stdout: "pipe", stderr: "pipe" });
```

- [ ] **Step 4: Re-run audit:invariants**

```bash
bun run scripts/structure-audit/check-nimbus-invariants.ts --rule spawn 2>&1 | grep azure-sync
# Expected: empty.
```

- [ ] **Step 5: Run the connector test (if any)**

```bash
bun test packages/gateway/src/connectors/azure-sync.test.ts 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/connectors/azure-sync.ts
git commit -m "fix(connectors): route azure-sync child env through extensionProcessEnv (I1)"
```

---

## Task 4: Fix `gcp-sync.ts` (inline at spawn site)

**Files:**
- Modify: `packages/gateway/src/connectors/gcp-sync.ts` (line ~37)
- Verify: `packages/gateway/src/connectors/gcp-sync.test.ts` (if present)

- [ ] **Step 1: Read the violating spawn block**

Read lines 25–45. Confirm the current shape:

```ts
const env = {
  ...process.env,
  GOOGLE_APPLICATION_CREDENTIALS: credPath,
} as Record<string, string | undefined>;
const proc = Bun.spawn(["gcloud", ...args, "--format", "json"], { env, stdout: "pipe", stderr: "pipe" });
```

- [ ] **Step 2: Run audit:invariants to confirm the violation**

```bash
bun run scripts/structure-audit/check-nimbus-invariants.ts --rule spawn 2>&1 | grep gcp-sync
# Expected: 1 line for gcp-sync.ts at line ~37.
```

- [ ] **Step 3: Apply the fix**

Add the import:

```ts
import { extensionProcessEnv } from "../extensions/spawn-env.ts";
```

Replace the env construction:

```ts
const env = extensionProcessEnv({ GOOGLE_APPLICATION_CREDENTIALS: credPath });
const proc = Bun.spawn(["gcloud", ...args, "--format", "json"], { env, stdout: "pipe", stderr: "pipe" });
```

- [ ] **Step 4: Re-run audit:invariants**

```bash
bun run scripts/structure-audit/check-nimbus-invariants.ts --rule spawn 2>&1 | grep gcp-sync
# Expected: empty.
```

- [ ] **Step 5: Run the connector test (if any)**

```bash
bun test packages/gateway/src/connectors/gcp-sync.test.ts 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/connectors/gcp-sync.ts
git commit -m "fix(connectors): route gcp-sync child env through extensionProcessEnv (I1)"
```

---

## Task 5: Fix `kubernetes-sync.ts` (inline at spawn site)

**Files:**
- Modify: `packages/gateway/src/connectors/kubernetes-sync.ts` (line ~111)
- Verify: `packages/gateway/src/connectors/kubernetes-sync.test.ts` (if present)

- [ ] **Step 1: Read the violating spawn block**

Read lines 100–120. Confirm the current shape:

```ts
const proc = Bun.spawn(args, {
  env: { ...process.env, KUBECONFIG: kubeconfig },
  stdout: "pipe",
  stderr: "pipe",
});
```

- [ ] **Step 2: Run audit:invariants to confirm the violation**

```bash
bun run scripts/structure-audit/check-nimbus-invariants.ts --rule spawn 2>&1 | grep kubernetes-sync
# Expected: 1 line for kubernetes-sync.ts at line ~111.
```

- [ ] **Step 3: Apply the fix**

Add the import:

```ts
import { extensionProcessEnv } from "../extensions/spawn-env.ts";
```

Replace the inline env literal:

```ts
const proc = Bun.spawn(args, {
  env: extensionProcessEnv({ KUBECONFIG: kubeconfig }),
  stdout: "pipe",
  stderr: "pipe",
});
```

- [ ] **Step 4: Re-run audit:invariants**

```bash
bun run scripts/structure-audit/check-nimbus-invariants.ts --rule spawn 2>&1 | grep kubernetes-sync
# Expected: empty.
```

- [ ] **Step 5: Run the connector test (if any)**

```bash
bun test packages/gateway/src/connectors/kubernetes-sync.test.ts 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/connectors/kubernetes-sync.ts
git commit -m "fix(connectors): route kubernetes-sync child env through extensionProcessEnv (I1)"
```

---

## Task 6: Fix `filesystem-v2-sync.ts` (add missing `env` field — special case)

**Files:**
- Modify: `packages/gateway/src/connectors/filesystem-v2-sync.ts` (spawn at line ~79, inside `gitLogRecords` starting at line ~65)
- Verify: `packages/gateway/src/connectors/filesystem-v2-sync.test.ts` (if present)

- [ ] **Step 1: Read the violating spawn block**

Read lines 60–85. Confirm the current shape — note the spawn options object has NO `env` field:

```ts
const proc = Bun.spawn(
  [
    "git",
    "-C", root,
    "log",
    `--max-count=${String(maxCount)}`,
    "-z",
    "--pretty=format:%H%x00%ct%x00%s",
  ],
  { stdout: "pipe", stderr: "pipe" },
);
```

Bun's default when `env` is omitted is to inherit all of `process.env` — that's what triggers the audit violation.

- [ ] **Step 2: Run audit:invariants to confirm the violation**

```bash
bun run scripts/structure-audit/check-nimbus-invariants.ts --rule spawn 2>&1 | grep filesystem-v2-sync
# Expected: 1 line for filesystem-v2-sync.ts at line ~69.
```

- [ ] **Step 3: Apply the fix — ADD an `env` field**

Add the import:

```ts
import { extensionProcessEnv } from "../extensions/spawn-env.ts";
```

Add `env: extensionProcessEnv({})` to the spawn options. `git log` needs PATH to find the `git` binary and TZ/LANG to format output correctly — both are in BASELINE_KEYS, so empty extras is correct.

```ts
const proc = Bun.spawn(
  [
    "git",
    "-C", root,
    "log",
    `--max-count=${String(maxCount)}`,
    "-z",
    "--pretty=format:%H%x00%ct%x00%s",
  ],
  { env: extensionProcessEnv({}), stdout: "pipe", stderr: "pipe" },
);
```

- [ ] **Step 4: Re-run audit:invariants**

```bash
bun run scripts/structure-audit/check-nimbus-invariants.ts --rule spawn 2>&1 | grep filesystem-v2-sync
# Expected: empty.
```

- [ ] **Step 5: Run the connector test (if any)**

```bash
bun test packages/gateway/src/connectors/filesystem-v2-sync.test.ts 2>&1 | tail -5
```

If the test exercises a real `git` binary against a temp repo, watch for any `GIT_*` env var the test was implicitly relying on through the inherited environment — none of `GIT_DIR`, `GIT_INDEX_FILE`, `GIT_AUTHOR_NAME`, etc. are in BASELINE_KEYS, so a test that depended on them would now fail. The fix is to either set them explicitly in the test setup or add them to the helper's `extra` parameter (do NOT add them to BASELINE_KEYS without an audit). If this happens, document and stop for human review.

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/connectors/filesystem-v2-sync.ts
git commit -m "fix(connectors): scope filesystem-v2-sync git env via extensionProcessEnv (I1)"
```

---

## Task 7: Final verification

- [ ] **Step 1: Audit all D10 fixed**

```bash
bun run audit:invariants 2>&1 | grep -c "D10 spawn"
# Expected: 0
```

- [ ] **Step 2: Run the full structure-audit gate locally**

```bash
bun run audit:boundaries
bun scripts/structure-audit/count-any-usage.ts --check
bun run audit:invariants
```

`audit:boundaries` and `count-any-usage --check` should exit 0 (these have been clean since the Phase 1/2 audit).

`audit:invariants` exits 0 only if **all** D-rules pass — D10 is now clean (5→0), but D11 may still have ~56 sites and any other top-5 fix's violations may still exist. Whether `audit:invariants` exits 0 here depends on PR ordering:

- If this is the LAST top-5 fix PR to merge (i.e., D11 fix-plan #2 has already merged, plus any other top-5 fix), `audit:invariants` will exit 0 — proceed to **Step 3** to wire `_structure.yml` into `ci.yml`.
- If it is NOT the last (some other top-5 fix is still outstanding), `audit:invariants` will exit non-zero — that's fine for THIS PR's scope. Skip Step 3 and go straight to Step 4. The wiring is reserved for whichever top-5 fix lands LAST.

- [ ] **Step 3: Wire `_structure.yml` into `ci.yml` (only if last top-5 fix)**

Edit `.github/workflows/ci.yml`. Add a job that calls the reusable workflow alongside the other PR-quality jobs:

```yaml
  structure:
    name: PR quality — Structure
    uses: ./.github/workflows/_structure.yml
```

Confirm `bun run audit:invariants` exits 0. If yes, commit:

```bash
git add .github/workflows/ci.yml
git commit -m "ci(pr-quality): wire _structure.yml gate (Phase 3 close — all top-5 fixes landed)"
```

If `audit:invariants` exits non-zero, STOP — there is at least one remaining top-5 fix outstanding. Do not wire the workflow. Document in the PR body and let the LAST PR do the wiring.

- [ ] **Step 4: Run the project's CI-parity suite**

```bash
bun run test:ci
# Expected: 0 (modulo the pre-existing platform.test.ts Windows EBUSY flake on Windows hosts;
# non-Windows hosts should be clean).
```

- [ ] **Step 5: Open the PR**

```bash
gh pr create --title "fix(connectors): route sync-connector spawns through extensionProcessEnv (D10 / I1)" --body "<body>"
```

PR body must explain:

- The I1 regression (link to `CLAUDE.md` Security Invariants table row I1 and `docs/SECURITY-INVARIANTS.md`)
- The 5 fixes (one bullet per file with one-line description; call out the `aws-sync` helper-not-spawn special case and the `filesystem-v2-sync` missing-`env` special case)
- The `audit:invariants` D10 delta (5→0)
- Whether this PR also wires `_structure.yml` into `ci.yml` (yes only if it was the last top-5 fix)
- Spec ref: `docs/superpowers/specs/2026-04-30-structure-audit-design.md` § 6.2

---

## Definition of Done

- [ ] All 5 D10 violations fixed (verified by `bun run audit:invariants 2>&1 | grep -c 'D10 spawn'` returning 0).
- [ ] All Gateway connector tests still pass (`bun test packages/gateway/src/connectors/*-sync.test.ts`).
- [ ] `bun run test:ci` passes (modulo pre-existing flakes documented in B3 PR #135).
- [ ] PR opened against `main` with a body that names all 5 fixes and the two special cases.
- [ ] If this is the last top-5 fix PR: `_structure.yml` is wired into `ci.yml` in the same PR; `audit:invariants` exits 0 in CI.
