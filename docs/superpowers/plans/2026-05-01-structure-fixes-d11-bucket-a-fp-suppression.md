# Structure-Audit Top-5 Fix #2 — D11 Bucket A False-Positive Suppression

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to land this fix as a single PR off `main`.

**Goal:** Drop the D11 vault-key audit count from **56 → 36** by suppressing the **20 false-positive (FP) sites** identified by the Phase 2 structure-audit triage. None of the 20 sites is a real vault-key construction — they are JSDoc references, manifest entries (where the manifest IS the canonical source of truth), log-redaction key strings, and a runtime `endsWith(".oauth")` shape-check on already-restored entries. The fix is a **per-line opt-out comment** (`// audit-ignore-next-line D11-vault-key (reason)`) honoured by a ~1-line addition to `scripts/structure-audit/check-nimbus-invariants.ts`. After this fix, the remaining 36 D11 hits are real violations that belong to a separate Bucket B fix-plan.

**Confidence:** HIGH. The 20 sites were enumerated by Phase 2 triage; each is documented below with file path, line number, and the reason it is an FP. The script change is mechanically trivial (a previous-line lookup) and is covered by a unit test added in this PR. Cost: ~1 line of script + 1 unit test + 20 single-line comment annotations across 7 files. Impact: removes 20/56 (~36%) of the noise from the D11 gate, making the remaining 36 hits a tractable Bucket B target.

**Architecture:** Two-part change.

1. **Script change** (Part 1): In `scripts/structure-audit/check-nimbus-invariants.ts`, the `checkVaultKeyAllowList` function iterates lines. Before the existing `if (!VAULT_KEY_RE.test(line)) continue;` test, insert a check for an opt-out marker on the **immediately-previous line** (`i - 1`). If the previous line contains the literal substring `audit-ignore-next-line D11-vault-key`, skip this line.

2. **Annotations** (Part 2): At each of the 20 FP sites, insert a comment **on the line immediately above** the flagged line (no blank line between marker and target). The marker is matched via `prevLine.includes("audit-ignore-next-line D11-vault-key")` so the surrounding comment syntax (`//`, `/* */`, `*` inside JSDoc) does not matter — only the substring must appear. The parenthesised reason (e.g., `(manifest entry, not vault-key construction)`) is documentation for human readers and is not parsed by the script.

**Why per-line opt-out (not a file-level allow-list extension):** the existing `VAULT_KEY_ALLOW_LIST` exempts entire files. The 20 FPs sit in 7 files where the *rest* of the file would still be subject to the gate (e.g., `connector-secrets-manifest.ts` has 7 manifest entries that are FPs, but a future bug that *constructs* a vault-key dynamically in the same file should still be flagged). Per-line opt-out preserves the gate's coverage on real violations while precisely silencing each FP. This is the same opt-out pattern used by `biome-ignore` and `eslint-disable-next-line`.

**The 20 FP sites (file → line → category):**

| # | File | Line | Category | Reason FP |
|---|---|---|---|---|
| 1–7 | `packages/gateway/src/connectors/lazy-mesh.ts` | 567, 622, 665, 701, 775, 811, 886 | JSDoc | Each line is a JSDoc comment like `* token exists (per-service keys or legacy 'google.oauth')` — describing keys, not constructing them. |
| 8 | `packages/gateway/src/connectors/connector-secrets-manifest.ts` | 14 | Manifest entry | Entry like `slack: ["slack.oauth"]` — the manifest IS the canonical source of truth declaring the keys. |
| 9 | `packages/gateway/src/connectors/connector-secrets-manifest.ts` | 15 | Manifest entry | Same — different connector. |
| 10 | `packages/gateway/src/connectors/connector-secrets-manifest.ts` | 17 | Manifest entry | Same. |
| 11 | `packages/gateway/src/connectors/connector-secrets-manifest.ts` | 19 | Manifest entry | Same. |
| 12 | `packages/gateway/src/connectors/connector-secrets-manifest.ts` | 21 | Manifest entry | Same. |
| 13 | `packages/gateway/src/connectors/connector-secrets-manifest.ts` | 34 | Manifest entry | Same. |
| 14 | `packages/gateway/src/connectors/connector-secrets-manifest.ts` | 35 | Manifest entry | Same. |
| 15 | `packages/gateway/src/platform/gateway-log-file.ts` | 73 | Log-redaction key | String `"err.api_key"` — a redaction key path matched against logged objects, not a vault key. |
| 16 | `packages/gateway/src/platform/gateway-log-file.ts` | 74 | Log-redaction key | String `"err.token"` — same. |
| 17 | `packages/gateway/src/connectors/registry.ts` | 17 | JSDoc | JSDoc reference. |
| 18 | `packages/gateway/src/auth/oauth-vault-tokens.ts` | 109 | JSDoc | JSDoc block. |
| 19 | `packages/mcp-connectors/outlook/src/server.ts` | 5 | JSDoc | JSDoc. |
| 20 | `packages/gateway/src/commands/data-import.ts` | 96 | Runtime shape-check | `endsWith(".oauth")` against an already-restored entry's key — checking shape, not constructing. |

**Tech Stack:** Existing `scripts/structure-audit/check-nimbus-invariants.ts` and its existing test file `scripts/structure-audit/check-nimbus-invariants.test.ts`. Bun test runner. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-30-structure-audit-design.md` § 5 (rule design) and § 7.2 (gate enablement); `docs/structure-audit/missed.md` (top-5 entry #2).

**Branch:** `dev/asafgolombek/structure-fixes-d11-bucket-a-fp-suppression` (off `main`).

**Important constraints:**

- **Marker placement is positional.** The opt-out is matched on the **immediately-previous line** (`i - 1`). A blank line between the marker and the target line breaks the match. Annotations MUST be on the line directly above the FP — no blank line, no other intervening comment.
- **Marker substring.** Only the literal substring `audit-ignore-next-line D11-vault-key` is matched. The parenthesised reason and the surrounding comment syntax (`//`, `/* */`, `* ` inside a JSDoc block) do not matter — pick whichever syntax is grammatical in context (a `//` comment cannot appear inside a `/* ... */` block; use `*` continuation in JSDoc).
- **Audit:invariants will still fail.** This PR drops D11 from 56 → 36 — the remaining 36 are real violations that need a separate Bucket B fix. Therefore this PR does NOT enable the `_structure.yml` workflow in `ci.yml` (since `audit:invariants` will still exit 1).

---

## Task 1: Setup

- [ ] **Step 1: Create the branch off `main`**

```bash
git checkout main
git pull origin main --quiet
git checkout -b dev/asafgolombek/structure-fixes-d11-bucket-a-fp-suppression
```

- [ ] **Step 2: Verify the violation count baseline**

```bash
bun run scripts/structure-audit/check-nimbus-invariants.ts --rule vault-key 2>&1 | grep -c "D11 vault-key"
# Expected: 56
```

If the count is anything other than 56, STOP. Either the codebase has drifted (real new violations have been added), some FP has been independently fixed, or files have moved. Re-run the Phase 2 triage in `docs/structure-audit/missed.md` before proceeding.

- [ ] **Step 3: Verify the 20 FP sites still exist at the documented line numbers**

```bash
bun run scripts/structure-audit/check-nimbus-invariants.ts --rule vault-key 2>&1 | grep -E "(lazy-mesh|connector-secrets-manifest|gateway-log-file|registry\.ts|outlook/src/server|oauth-vault-tokens|data-import)"
```

Confirm the output includes lines for each of the 20 sites in the table above. If any line numbers have drifted by ≤2 lines (e.g., from upstream `main` merges), update the table in this plan in-place and proceed. If they have drifted by more than 2 lines or any FP has vanished entirely, STOP and update `docs/structure-audit/missed.md` first.

---

## Task 2 (TDD): Add a failing test for the new opt-out behavior

**Files:**
- Modify: `scripts/structure-audit/check-nimbus-invariants.test.ts`

- [ ] **Step 1: Add the failing test**

Append a new test inside the existing `describe("D11 — checkVaultKeyAllowList", ...)` block. The test fixture has a vault-key string preceded by an opt-out comment line; the expected result is zero violations.

```ts
test("ignores vault-key when previous line has audit-ignore-next-line D11-vault-key marker", () => {
  const violations = checkVaultKeyAllowList(
    [
      {
        relPath: "packages/gateway/src/connectors/some-other.ts",
        contents:
          "// audit-ignore-next-line D11-vault-key (manifest entry, not vault-key construction)\n" +
          'const entry = "slack.oauth";',
      },
    ],
    ALLOW_LIST,
  );
  expect(violations).toHaveLength(0);
});

test("still flags vault-key when no opt-out marker is on previous line", () => {
  const violations = checkVaultKeyAllowList(
    [
      {
        relPath: "packages/gateway/src/connectors/some-other.ts",
        contents: "// just a regular comment\n" + 'const entry = "slack.oauth";',
      },
    ],
    ALLOW_LIST,
  );
  expect(violations).toHaveLength(1);
});
```

- [ ] **Step 2: Run the test — confirm the first new test FAILS**

```bash
bun test scripts/structure-audit/check-nimbus-invariants.test.ts 2>&1 | tail -20
# Expected: 1 failure ("ignores vault-key when previous line has audit-ignore-next-line ... marker")
# The second test ("still flags ...") passes pre-fix.
```

If the first new test passes pre-fix, the script already implements the opt-out somehow — STOP and re-read the script before committing. The fix in Task 3 should make the test pass; pre-fix it must fail.

---

## Task 3: Apply the script change

**Files:**
- Modify: `scripts/structure-audit/check-nimbus-invariants.ts`

- [ ] **Step 1: Read the function**

Confirm the current shape of `checkVaultKeyAllowList` (around lines 53–73). The loop body structure is:

```ts
for (let i = 0; i < lines.length; i++) {
  const line = lines[i] as string;
  if (!VAULT_KEY_RE.test(line)) continue;
  out.push({ rule: "D11-vault-key", file: f.relPath, line: i + 1, snippet: line.trim() });
}
```

- [ ] **Step 2: Insert the opt-out check BEFORE the regex test**

Add a 2-line block (constant + conditional) immediately after `const line = lines[i] as string;` and before `if (!VAULT_KEY_RE.test(line)) continue;`:

```ts
const prevLine = lines[i - 1] ?? "";
if (prevLine.includes("audit-ignore-next-line D11-vault-key")) continue;
```

The `?? ""` handles `i === 0` (no previous line) safely. The order matters — placing the opt-out check BEFORE the regex test means the test never runs on opted-out lines, which is a tiny perf win and keeps the loop body shape consistent.

The function should now look like:

```ts
export function checkVaultKeyAllowList(
  files: readonly FileEntry[],
  allowList: readonly string[] = VAULT_KEY_ALLOW_LIST,
): Violation[] {
  const out: Violation[] = [];
  for (const f of files) {
    if (allowList.includes(f.relPath)) continue;
    const lines = f.contents.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as string;
      const prevLine = lines[i - 1] ?? "";
      if (prevLine.includes("audit-ignore-next-line D11-vault-key")) continue;
      if (!VAULT_KEY_RE.test(line)) continue;
      out.push({
        rule: "D11-vault-key",
        file: f.relPath,
        line: i + 1,
        snippet: line.trim(),
      });
    }
  }
  return out;
}
```

---

## Task 4: Verify tests pass

- [ ] **Step 1: Re-run the test file**

```bash
bun test scripts/structure-audit/check-nimbus-invariants.test.ts 2>&1 | tail -10
# Expected: all tests pass (the original 7 + the 2 new = 9 tests total).
```

If any pre-existing test now fails, the script change has a regression — likely the placement of the new lines is off, or the existing test fixtures had data that was inadvertently silenced. Re-read Task 3.

- [ ] **Step 2: Confirm the audit count has not yet dropped**

```bash
bun run scripts/structure-audit/check-nimbus-invariants.ts --rule vault-key 2>&1 | grep -c "D11 vault-key"
# Expected: still 56 (we have not yet annotated any FP sites).
```

- [ ] **Step 3: Commit script + test together**

```bash
git add scripts/structure-audit/check-nimbus-invariants.ts scripts/structure-audit/check-nimbus-invariants.test.ts
git commit -m "feat(structure-audit): honour per-line audit-ignore-next-line D11-vault-key marker"
```

---

## Task 5: Annotate `lazy-mesh.ts` (7 JSDoc sites)

**Files:**
- Modify: `packages/gateway/src/connectors/lazy-mesh.ts`

- [ ] **Step 1: Read each flagged JSDoc block**

Use `Read` on the 7 line ranges to confirm each is a JSDoc continuation line starting with ` * `. Lines: **567, 622, 665, 701, 775, 811, 886**.

- [ ] **Step 2: Insert opt-out marker above each line**

Each opt-out marker MUST live inside the same JSDoc block (so the file still parses cleanly). Use a JSDoc continuation line:

```
 * audit-ignore-next-line D11-vault-key (JSDoc reference, not vault-key construction)
 * token exists (per-service keys or legacy 'google.oauth')
```

After insertion, all 7 violation line numbers will increase by 1 each (since you inserted a line above). That's fine — the annotation is now on the immediately-previous line, which is what the script checks.

**IMPORTANT:** Insert the markers in **reverse line order** (886 first, then 811, then 775, etc.) so each insertion does not shift the line numbers of the still-pending sites. If you insert top-down, every subsequent line number drifts by the cumulative count of prior insertions.

- [ ] **Step 3: Verify the count dropped by 7**

```bash
bun run scripts/structure-audit/check-nimbus-invariants.ts --rule vault-key 2>&1 | grep -c "D11 vault-key"
# Expected: 49 (56 - 7).
```

If not 49, the markers landed on the wrong lines. Re-check by running the rule and inspecting which `lazy-mesh.ts` lines are still flagged.

- [ ] **Step 4: Typecheck + lint**

```bash
bun run typecheck 2>&1 | tail -5
bunx biome check packages/gateway/src/connectors/lazy-mesh.ts 2>&1 | tail -5
# Both: no new errors.
```

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/connectors/lazy-mesh.ts
git commit -m "chore(structure-audit): annotate 7 D11 FP JSDoc sites in lazy-mesh.ts"
```

---

## Task 6: Annotate `connector-secrets-manifest.ts` (7 manifest entries)

**Files:**
- Modify: `packages/gateway/src/connectors/connector-secrets-manifest.ts`

- [ ] **Step 1: Read each flagged manifest entry**

Use `Read` on the 7 line ranges to confirm each is a manifest entry of the shape `<connector>: ["<connector>.oauth"]` (or similar) inside the `CONNECTOR_VAULT_SECRET_KEYS` map. Lines: **14, 15, 17, 19, 21, 34, 35**.

- [ ] **Step 2: Insert opt-out marker above each line**

Use a `//` line comment (TypeScript syntax — outside any JSDoc block):

```ts
// audit-ignore-next-line D11-vault-key (manifest entry, not vault-key construction)
slack: ["slack.oauth"],
```

Insert in **reverse line order** (35 first, then 34, then 21, 19, 17, 15, 14) to prevent line-number drift between insertions.

- [ ] **Step 3: Verify the count dropped by 7 more**

```bash
bun run scripts/structure-audit/check-nimbus-invariants.ts --rule vault-key 2>&1 | grep -c "D11 vault-key"
# Expected: 42 (49 - 7).
```

- [ ] **Step 4: Typecheck + lint**

```bash
bun run typecheck 2>&1 | tail -5
bunx biome check packages/gateway/src/connectors/connector-secrets-manifest.ts 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/connectors/connector-secrets-manifest.ts
git commit -m "chore(structure-audit): annotate 7 D11 FP manifest entries in connector-secrets-manifest.ts"
```

---

## Task 7: Annotate the remaining 6 sites (5 files)

**Files:**
- Modify: `packages/gateway/src/platform/gateway-log-file.ts` (lines 73, 74)
- Modify: `packages/gateway/src/connectors/registry.ts` (line 17)
- Modify: `packages/gateway/src/auth/oauth-vault-tokens.ts` (line 109)
- Modify: `packages/mcp-connectors/outlook/src/server.ts` (line 5)
- Modify: `packages/gateway/src/commands/data-import.ts` (line 96)

- [ ] **Step 1: Annotate `gateway-log-file.ts` lines 73 + 74**

Insert in **reverse order**: line 74 first, then line 73. Use `//` line comments — these are TypeScript code lines (string literals in a redaction-keys array), not inside a JSDoc block:

```ts
// audit-ignore-next-line D11-vault-key (log-redaction key path, not vault-key construction)
"err.api_key",
// audit-ignore-next-line D11-vault-key (log-redaction key path, not vault-key construction)
"err.token",
```

- [ ] **Step 2: Annotate `registry.ts` line 17**

Line 17 is a JSDoc reference. Use a JSDoc continuation:

```
 * audit-ignore-next-line D11-vault-key (JSDoc reference, not vault-key construction)
 * <existing JSDoc text containing the .oauth substring>
```

- [ ] **Step 3: Annotate `oauth-vault-tokens.ts` line 109**

Line 109 is inside a JSDoc block. Same pattern:

```
 * audit-ignore-next-line D11-vault-key (JSDoc reference, not vault-key construction)
 * <existing JSDoc line with .oauth>
```

- [ ] **Step 4: Annotate `outlook/src/server.ts` line 5**

JSDoc reference — same pattern as Task 5/Task 7-Step 3.

- [ ] **Step 5: Annotate `data-import.ts` line 96**

Line 96 is a runtime `.endsWith(".oauth")` check. Use a `//` line comment:

```ts
// audit-ignore-next-line D11-vault-key (shape-check on already-restored entry, not vault-key construction)
if (entry.key.endsWith(".oauth")) {
```

- [ ] **Step 6: Verify the count dropped to 36**

```bash
bun run scripts/structure-audit/check-nimbus-invariants.ts --rule vault-key 2>&1 | grep -c "D11 vault-key"
# Expected: 36 (42 - 6).
```

If the count is anything other than 36, one or more annotations are misplaced (likely a blank line between marker and target, or the marker is in the wrong file). Re-run the rule and audit which file/line is still flagged.

- [ ] **Step 7: Typecheck + lint everything**

```bash
bun run typecheck 2>&1 | tail -5
bunx biome check \
  packages/gateway/src/platform/gateway-log-file.ts \
  packages/gateway/src/connectors/registry.ts \
  packages/gateway/src/auth/oauth-vault-tokens.ts \
  packages/mcp-connectors/outlook/src/server.ts \
  packages/gateway/src/commands/data-import.ts \
  2>&1 | tail -10
# All: no new errors.
```

- [ ] **Step 8: Commit**

```bash
git add \
  packages/gateway/src/platform/gateway-log-file.ts \
  packages/gateway/src/connectors/registry.ts \
  packages/gateway/src/auth/oauth-vault-tokens.ts \
  packages/mcp-connectors/outlook/src/server.ts \
  packages/gateway/src/commands/data-import.ts
git commit -m "chore(structure-audit): annotate remaining 6 D11 FP sites (log-file/registry/outlook/oauth-vault/data-import)"
```

---

## Task 8: Final verification

- [ ] **Step 1: Confirm D11 count delta**

```bash
bun run scripts/structure-audit/check-nimbus-invariants.ts --rule vault-key 2>&1 | grep -c "D11 vault-key"
# Expected: 36
```

The drop is 56 → 36. The remaining 36 are real violations that belong to a separate Bucket B fix-plan (out of scope for this PR).

- [ ] **Step 2: Run the full structure-audit gate locally**

```bash
bun run audit:boundaries
bun scripts/structure-audit/count-any-usage.ts --check
bun run audit:invariants
```

`audit:boundaries` and `count-any-usage --check` should exit 0 (clean since Phase 1/2). `audit:invariants` will exit **non-zero** (36 D11 violations remain, plus possibly D10 violations if the D10 fix has not yet merged). That's expected for THIS PR's scope.

- [ ] **Step 3: Decide whether to wire `_structure.yml` into `ci.yml`**

Run:

```bash
bun run audit:invariants
echo "exit: $?"
```

- If exit code is **0**: ALL top-5 fixes are now landed (D10 + D11 Bucket A + D7 Bucket A + ...). This is the LAST top-5 fix to merge — wire `_structure.yml` into `ci.yml` in this same PR. Edit `.github/workflows/ci.yml` and add the job:

  ```yaml
    structure:
      name: PR quality — Structure
      uses: ./.github/workflows/_structure.yml
  ```

  Then commit:

  ```bash
  git add .github/workflows/ci.yml
  git commit -m "ci(pr-quality): wire _structure.yml gate (Phase 3 close — all top-5 fixes landed)"
  ```

- If exit code is **non-zero** (the expected case for this PR — D11 still has 36 real violations): SKIP the wiring. Document in the PR body that the next fix (D11 Bucket B or a coordinated final wiring PR) will do the wiring.

- [ ] **Step 4: Run the project's CI-parity suite**

```bash
bun run test:ci
# Expected: 0 (modulo pre-existing platform.test.ts Windows EBUSY flake on Windows hosts).
```

- [ ] **Step 5: Open the PR**

```bash
gh pr create --title "chore(structure-audit): suppress 20 D11 vault-key false positives via per-line markers" --body "<body>"
```

PR body must include:

- The triage summary (20 FP sites across 7 files; categories: JSDoc / manifest / log-redaction / runtime shape-check)
- The script change description (1-line addition, honours `// audit-ignore-next-line D11-vault-key` markers)
- The unit test added in this PR
- The D11 count delta (56 → 36)
- An explicit note that **36 real D11 violations remain** and belong to a separate Bucket B fix-plan
- Whether this PR wires `_structure.yml` into `ci.yml` (only if it was the last top-5 fix)
- Spec ref: `docs/superpowers/specs/2026-04-30-structure-audit-design.md` § 5, § 7.2

---

## Definition of Done

- [ ] Script change applied: `checkVaultKeyAllowList` honours `// audit-ignore-next-line D11-vault-key` markers on the immediately-previous line.
- [ ] Two new unit tests added in `check-nimbus-invariants.test.ts`; all 9 tests in the file pass.
- [ ] All 20 FP sites annotated (7 in lazy-mesh, 7 in connector-secrets-manifest, 2 in gateway-log-file, 1 each in registry / outlook / oauth-vault-tokens / data-import).
- [ ] D11 count drops from 56 → 36 (`bun run scripts/structure-audit/check-nimbus-invariants.ts --rule vault-key 2>&1 | grep -c "D11 vault-key"` returns 36).
- [ ] `bun run typecheck` passes.
- [ ] `bunx biome check` passes on all 7 modified source files.
- [ ] `bun run test:ci` passes (modulo pre-existing flakes documented in B3 PR #135).
- [ ] PR opened against `main` with a body that names all 20 sites and the script change.
- [ ] If this is the last top-5 fix PR: `_structure.yml` is wired into `ci.yml` in the same PR; `audit:invariants` exits 0 in CI. Otherwise: `audit:invariants` exits non-zero (expected — 36 real D11 violations remain) and the wiring is reserved for a later PR.
