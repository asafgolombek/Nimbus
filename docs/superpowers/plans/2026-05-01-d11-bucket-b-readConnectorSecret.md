# D11 Bucket B — `readConnectorSecret` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate D11 Bucket B (11 vault-key construction sites in 11 production files) by routing them through a typed `readConnectorSecret(vault, serviceId, keyName)` helper co-located in `packages/gateway/src/connectors/connector-vault.ts`. After this PR, the live D11 violation count drops from 36 to 21 (Bucket C only), and `VAULT_KEY_ALLOW_LIST` is frozen at exactly 5 entries by a unit test.

**Architecture:** A tiny generic helper in `connector-vault.ts` (already on the D11 allow-list) wraps `vault.get(`${serviceId}.${keyName}`)` with a `ConnectorSecretKeyOf<S>` mapped type derived from `CONNECTOR_VAULT_SECRET_KEYS`. Misspelled or non-manifested keys fail at compile time. Two structurally-distinct files (`oauth-vault-tokens.ts` for provider-shared Microsoft OAuth; `embedding/create-embedding-runtime.ts` for OpenAI) are added to the allow-list rather than migrated. The audit's source-file iterator is extended to skip `**/testing/**` so test fixtures are no longer false-flagged.

**Tech Stack:** TypeScript 6.x strict, `bun test`, Bun.Glob, no new dependencies.

**Spec:** [`docs/superpowers/specs/2026-05-01-d11-bucket-b-readConnectorSecret-design.md`](../specs/2026-05-01-d11-bucket-b-readConnectorSecret-design.md)

---

## Pre-flight checklist

Before starting Task 1:

- [ ] Working tree is clean except for the two untracked spec docs (`...-design.md`, `...-review.md`).
- [ ] Current branch is `main`.
- [ ] `bun install` is up to date.

---

### Task 0: Worktree, branch, and commit the spec

**Files:**
- Modify (commit): `docs/superpowers/specs/2026-05-01-d11-bucket-b-readConnectorSecret-design.md`
- Modify (commit): `docs/superpowers/specs/2026-05-01-d11-bucket-b-readConnectorSecret-review.md`

- [ ] **Step 1: Create worktree + branch**

```bash
git worktree add .worktrees/d11-bucket-b-readConnectorSecret -b dev/asafgolombek/d11-bucket-b-readConnectorSecret
```

- [ ] **Step 2: Switch to the worktree**

All subsequent steps run in `.worktrees/d11-bucket-b-readConnectorSecret`.

- [ ] **Step 3: Stage and commit the spec + review**

```bash
git add docs/superpowers/specs/2026-05-01-d11-bucket-b-readConnectorSecret-design.md \
        docs/superpowers/specs/2026-05-01-d11-bucket-b-readConnectorSecret-review.md
git commit -m "$(cat <<'EOF'
docs(structure-audit): add D11 Bucket B readConnectorSecret design + review

Spec for routing 11 production vault-key-construction sites through
a typed readConnectorSecret helper in connector-vault.ts. Companion
review (Gemini CLI) captures three accepted/deferred/rejected decisions.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify commit**

```bash
git log --oneline -1
```

Expected: `<sha> docs(structure-audit): add D11 Bucket B readConnectorSecret design + review`

---

### Task 1: Extend `iterateGlob` to skip `/testing/`

This task fixes the false-positive D11 hit on `packages/gateway/src/testing/bun-test-support.ts:80`.

**Files:**
- Modify: `scripts/structure-audit/lib.ts:149-153`
- Test (new): `scripts/structure-audit/lib.test.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/structure-audit/lib.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { iterateSourceFiles } from "./lib.ts";

describe("iterateSourceFiles", () => {
  test("excludes paths under */testing/*", async () => {
    const visited: string[] = [];
    for await (const f of iterateSourceFiles()) {
      visited.push(f.relPath);
    }
    const testingPaths = visited.filter((p) => p.includes("/testing/"));
    expect(testingPaths).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test — confirm it fails**

```bash
bun test scripts/structure-audit/lib.test.ts
```

Expected: FAIL — `testingPaths` contains `packages/gateway/src/testing/bun-test-support.ts` and `packages/sdk/src/testing/index.ts`.

- [ ] **Step 3: Add the iterator exclusion**

In `scripts/structure-audit/lib.ts`, locate the existing exclusion block in `iterateGlob`:

```ts
    if (relPath.endsWith(".test.ts")) continue;
    if (relPath.endsWith("-sql.ts")) continue;
    if (relPath.endsWith(".d.ts")) continue;
    if (relPath.includes("/__fixtures__/")) continue;
    if (relPath.includes("/test/fixtures/")) continue;
```

Add one line directly below:

```ts
    if (relPath.includes("/testing/")) continue;
```

- [ ] **Step 4: Run the test — confirm it passes**

```bash
bun test scripts/structure-audit/lib.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/structure-audit/lib.ts scripts/structure-audit/lib.test.ts
git commit -m "$(cat <<'EOF'
chore(structure-audit): exclude /testing/ paths from iterateSourceFiles

Brings D8/D9/D10/D11 audits in line with the existing /test/fixtures/
and /__fixtures__/ rules: test-support modules are tooling, not
runtime, and should not be audit-gated.

Removes the false-positive D11 hit on packages/gateway/src/testing/
bun-test-support.ts:80.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Add `ConnectorSecretKeyOf` type + `readConnectorSecret` helper (TDD)

**Files:**
- Modify: `packages/gateway/src/connectors/connector-vault.ts` (append helper after the existing exports)
- Test (new): `packages/gateway/src/connectors/connector-vault.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/gateway/src/connectors/connector-vault.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { createMemoryVault } from "../testing/bun-test-support.ts";
import { readConnectorSecret } from "./connector-vault.ts";

describe("readConnectorSecret", () => {
  test("returns the stored value when the key is set", async () => {
    const vault = createMemoryVault();
    await vault.set("github.pat", "ghp_test");
    expect(await readConnectorSecret(vault, "github", "pat")).toBe("ghp_test");
  });

  test("returns null when the key is absent", async () => {
    const vault = createMemoryVault();
    expect(await readConnectorSecret(vault, "github", "pat")).toBeNull();
  });

  test("does not trim or coerce empty string", async () => {
    const vault = createMemoryVault();
    await vault.set("slack.oauth", "  raw value  ");
    expect(await readConnectorSecret(vault, "slack", "oauth")).toBe("  raw value  ");

    await vault.set("notion.oauth", "");
    expect(await readConnectorSecret(vault, "notion", "oauth")).toBe("");
  });

  test("resolves api_key and app_key to distinct vault keys (datadog multi-key)", async () => {
    const vault = createMemoryVault();
    await vault.set("datadog.api_key", "API");
    await vault.set("datadog.app_key", "APP");
    expect(await readConnectorSecret(vault, "datadog", "api_key")).toBe("API");
    expect(await readConnectorSecret(vault, "datadog", "app_key")).toBe("APP");
  });

  test("resolves non-credential-shaped keys (gitlab.api_base)", async () => {
    const vault = createMemoryVault();
    await vault.set("gitlab.api_base", "https://gitlab.example.com/api/v4");
    expect(await readConnectorSecret(vault, "gitlab", "api_base")).toBe(
      "https://gitlab.example.com/api/v4",
    );
  });

  test("compile-time: rejects non-manifested keys", () => {
    const vault = createMemoryVault();
    // @ts-expect-error — manifest is ["github.pat"]; "oauth" is not a github key.
    void readConnectorSecret(vault, "github", "oauth");

    // @ts-expect-error — google_drive manifest is empty; ConnectorSecretKeyOf resolves to never.
    void readConnectorSecret(vault, "google_drive", "oauth");

    // The runtime expectation is irrelevant for these checks; the assertion
    // is that the file typechecks only with the @ts-expect-error directives.
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests — confirm they fail**

```bash
bun test packages/gateway/src/connectors/connector-vault.test.ts
```

Expected: FAIL — `readConnectorSecret` is not exported.

- [ ] **Step 3: Add the helper to `connector-vault.ts`**

The file already imports `NimbusVault` (type) and `ConnectorServiceId` (type) at the top — those don't need to be added. The only new import is `CONNECTOR_VAULT_SECRET_KEYS` (value, not type) from the manifest module.

Append at the end of `packages/gateway/src/connectors/connector-vault.ts` (after the existing `clearOAuthVaultIfProviderUnused` function):

```ts
// ─── Bucket-B helper: typed connector-secret reader ──────────────────────────

import { CONNECTOR_VAULT_SECRET_KEYS } from "./connector-secrets-manifest.ts";

/**
 * Bare-key view derived from `CONNECTOR_VAULT_SECRET_KEYS`. For service `S`,
 * extracts the suffix after the dot in each fully-qualified manifest entry.
 *
 * Services with an empty manifest array (e.g. `google_drive`) resolve to `never`,
 * making `readConnectorSecret(vault, "google_drive", ...)` uncallable — those
 * services use OAuth via auth/google-access-token.ts, not this helper.
 */
export type ConnectorSecretKeyOf<S extends ConnectorServiceId> =
  (typeof CONNECTOR_VAULT_SECRET_KEYS)[S][number] extends `${S}.${infer K}`
    ? K
    : never;

/**
 * Reads a connector's secret from the Vault by structural key name. Returns
 * the raw stored value (no trim, no default) — semantics match `vault.get`.
 * Misspelled or non-manifested key names fail at compile time.
 */
export async function readConnectorSecret<S extends ConnectorServiceId>(
  vault: NimbusVault,
  serviceId: S,
  keyName: ConnectorSecretKeyOf<S>,
): Promise<string | null> {
  const fullKey = `${serviceId}.${keyName}`;
  return vault.get(fullKey);
}
```

Note: the import statement at the top of this code block (`import { CONNECTOR_VAULT_SECRET_KEYS } …`) needs to be moved to the top of the file alongside the other imports. Biome will auto-format this on `bun run lint:fix` (Step 4).

- [ ] **Step 4: Move the import to the top of the file (style)**

Run:

```bash
bun run lint:fix
```

Verify the import block at the top of `connector-vault.ts` now includes:

```ts
import { CONNECTOR_VAULT_SECRET_KEYS } from "./connector-secrets-manifest.ts";
```

…and the `import` line at the bottom of the file is gone.

- [ ] **Step 5: Run the tests — confirm they pass**

```bash
bun test packages/gateway/src/connectors/connector-vault.test.ts
```

Expected: PASS — all 6 tests.

- [ ] **Step 6: Run typecheck**

```bash
bun run typecheck
```

Expected: clean. The `@ts-expect-error` directives confirm `ConnectorSecretKeyOf` rejects unmanifested keys.

- [ ] **Step 7: Commit**

```bash
git add packages/gateway/src/connectors/connector-vault.ts \
        packages/gateway/src/connectors/connector-vault.test.ts
git commit -m "$(cat <<'EOF'
feat(connectors): add readConnectorSecret helper for D11 Bucket B

Typed wrapper around vault.get that derives valid key names from
CONNECTOR_VAULT_SECRET_KEYS. ConnectorSecretKeyOf<S> resolves to the
union of bare key suffixes for service S, or never for services with
an empty manifest. Misspelled or non-manifested keys fail at compile
time.

No production caller yet — subsequent commits route the 11 Bucket B
sites through this helper.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Export `VAULT_KEY_ALLOW_LIST`, add 2 structural entries, and freeze the count

Single-commit shape — promote the constant, add the 2 entries, and add the assertion test all together so HEAD stays green at every commit.

**Files:**
- Modify: `scripts/structure-audit/check-nimbus-invariants.ts:16-20`
- Modify: `scripts/structure-audit/check-nimbus-invariants.test.ts`

- [ ] **Step 1: Promote the constant + add 2 entries**

In `scripts/structure-audit/check-nimbus-invariants.ts`, replace the 3-entry private const:

```ts
const VAULT_KEY_ALLOW_LIST = [
  "packages/gateway/src/connectors/connector-vault.ts",
  "packages/gateway/src/auth/google-access-token.ts",
  "packages/gateway/src/auth/pkce.ts",
];
```

with the 5-entry export (comments must match verbatim — see spec § 4.2):

```ts
export const VAULT_KEY_ALLOW_LIST = [
  "packages/gateway/src/connectors/connector-vault.ts",
  "packages/gateway/src/auth/google-access-token.ts",
  "packages/gateway/src/auth/pkce.ts",
  // Provider-shared OAuth canonical reader (Microsoft); mirrors google-access-token.ts.
  "packages/gateway/src/auth/oauth-vault-tokens.ts",
  // OpenAI embedding provider — not a Nimbus connector; no ConnectorServiceId.
  "packages/gateway/src/embedding/create-embedding-runtime.ts",
];
```

- [ ] **Step 2: Add the frozen-count test**

In `scripts/structure-audit/check-nimbus-invariants.test.ts`, extend the import block from:

```ts
import {
  checkSpawnInvariant,
  checkVaultKeyAllowList,
  collectDbRunCensus,
} from "./check-nimbus-invariants.ts";
```

to:

```ts
import {
  VAULT_KEY_ALLOW_LIST,
  checkSpawnInvariant,
  checkVaultKeyAllowList,
  collectDbRunCensus,
} from "./check-nimbus-invariants.ts";
```

Append a new `describe` block (after the existing `describe("D11 — checkVaultKeyAllowList", …)` block):

```ts
describe("D11 — VAULT_KEY_ALLOW_LIST is frozen at structural entries", () => {
  test("VAULT_KEY_ALLOW_LIST has exactly 5 entries", () => {
    // Each entry has a documented structural reason in the design spec § 4.4
    // (helper home, Google OAuth canonical reader, Google PKCE writer,
    // Microsoft provider-shared OAuth, OpenAI embedding provider).
    // Adding a 6th entry requires updating this test, forcing a PR-level
    // discussion of why the new file legitimately constructs vault keys.
    expect(VAULT_KEY_ALLOW_LIST).toHaveLength(5);
  });
});
```

- [ ] **Step 3: Run the test — confirm it passes**

```bash
bun test scripts/structure-audit/check-nimbus-invariants.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run the audit — confirm the two added files are no longer flagged**

```bash
bun run audit:invariants 2>&1 | grep -E "oauth-vault-tokens|create-embedding-runtime" || echo "OK — neither file appears"
```

Expected: `OK — neither file appears`. (The 11 Bucket B sites still fire — they're cleared in Tasks 4–10.)

- [ ] **Step 5: Commit**

```bash
git add scripts/structure-audit/check-nimbus-invariants.ts \
        scripts/structure-audit/check-nimbus-invariants.test.ts
git commit -m "$(cat <<'EOF'
chore(structure-audit): freeze VAULT_KEY_ALLOW_LIST at 5 structural entries

Promotes VAULT_KEY_ALLOW_LIST to an export, adds two structural
entries, and asserts the count in a unit test.

Added entries (each with a structural reason recorded inline):
- auth/oauth-vault-tokens.ts — provider-shared Microsoft OAuth
  canonical reader; mirrors google-access-token.ts.
- embedding/create-embedding-runtime.ts — OpenAI is not a Nimbus
  connector; openai.api_key has no ConnectorServiceId.

The new test forces a PR-level discussion when anyone adds a 6th
entry, preserving D11's "vault keys live in 5 named files" signal.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Migrate `auth/notion-access-token.ts` and `auth/slack-access-token.ts`

These two files are tiny single-call readers — bundle them into one commit.

**Files:**
- Modify: `packages/gateway/src/auth/notion-access-token.ts:10`
- Modify: `packages/gateway/src/auth/slack-access-token.ts:10`

- [ ] **Step 1: Edit `auth/notion-access-token.ts`**

Replace the `vault.get` call:

```ts
// before
const raw = await vault.get("notion.oauth");
```

```ts
// after
const raw = await readConnectorSecret(vault, "notion", "oauth");
```

Add the import at the top of the file (alongside the existing `NimbusVault` import):

```ts
import { readConnectorSecret } from "../connectors/connector-vault.ts";
```

- [ ] **Step 2: Edit `auth/slack-access-token.ts`**

Same shape — replace `vault.get("slack.oauth")` with `readConnectorSecret(vault, "slack", "oauth")` and add the import.

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck
```

Expected: clean.

- [ ] **Step 4: Re-run the audit — confirm both files no longer fire D11**

```bash
bun run audit:invariants 2>&1 | grep -E "notion-access-token|slack-access-token" || echo "OK — neither file appears"
```

Expected: `OK — neither file appears`.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/auth/notion-access-token.ts \
        packages/gateway/src/auth/slack-access-token.ts
git commit -m "$(cat <<'EOF'
refactor(auth): route notion/slack token readers through readConnectorSecret

D11 Bucket B migration — clears 2 violations.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Migrate `platform/assemble.ts`

**Files:**
- Modify: `packages/gateway/src/platform/assemble.ts:127,133`

- [ ] **Step 1: Add the import**

At the top of `packages/gateway/src/platform/assemble.ts`, add (alongside existing imports):

```ts
import { readConnectorSecret } from "../connectors/connector-vault.ts";
```

- [ ] **Step 2: Replace line 127**

```ts
// before
const pat = await vault.get("github.pat");
```

```ts
// after
const pat = await readConnectorSecret(vault, "github", "pat");
```

- [ ] **Step 3: Replace line 133**

```ts
// before
const cciTok = await vault.get("circleci.api_token");
```

```ts
// after
const cciTok = await readConnectorSecret(vault, "circleci", "api_token");
```

- [ ] **Step 4: Typecheck**

```bash
bun run typecheck
```

Expected: clean. (The `circleci.api_token` call is currently unflagged by D11 but migrates for consistency.)

- [ ] **Step 5: Re-run the audit**

```bash
bun run audit:invariants 2>&1 | grep "platform/assemble" || echo "OK — file no longer appears"
```

Expected: `OK — file no longer appears`.

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/platform/assemble.ts
git commit -m "$(cat <<'EOF'
refactor(platform): route assemble.ts vault reads through readConnectorSecret

D11 Bucket B migration — clears 1 D11 violation; migrates the
sibling circleci.api_token read alongside for consistency.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Migrate `connectors/datadog-sync.ts`

**Files:**
- Modify: `packages/gateway/src/connectors/datadog-sync.ts:119,120,124`
- Test (existing, must still pass): `packages/gateway/src/connectors/datadog-sync.test.ts`

- [ ] **Step 1: Run existing tests as a baseline**

```bash
bun test packages/gateway/src/connectors/datadog-sync.test.ts
```

Expected: PASS. Note any pre-existing failures so you can distinguish them from regressions.

- [ ] **Step 2: Add the import**

At the top of `packages/gateway/src/connectors/datadog-sync.ts`, add:

```ts
import { readConnectorSecret } from "./connector-vault.ts";
```

- [ ] **Step 3: Replace the three reads**

```ts
// before (lines 119/120/124)
const apiKey = (await ctx.vault.get("datadog.api_key"))?.trim() ?? "";
const appKey = (await ctx.vault.get("datadog.app_key"))?.trim() ?? "";
// (intervening lines unchanged)
const siteRaw = await ctx.vault.get("datadog.site");
```

```ts
// after
const apiKey = (await readConnectorSecret(ctx.vault, "datadog", "api_key"))?.trim() ?? "";
const appKey = (await readConnectorSecret(ctx.vault, "datadog", "app_key"))?.trim() ?? "";
// (intervening lines unchanged)
const siteRaw = await readConnectorSecret(ctx.vault, "datadog", "site");
```

- [ ] **Step 4: Run datadog-sync tests**

```bash
bun test packages/gateway/src/connectors/datadog-sync.test.ts
```

Expected: PASS — semantics are identical, so existing tests must still pass.

- [ ] **Step 5: Re-run the audit**

```bash
bun run audit:invariants 2>&1 | grep "datadog-sync" || echo "OK — file no longer appears"
```

Expected: `OK`.

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/connectors/datadog-sync.ts
git commit -m "$(cat <<'EOF'
refactor(connectors): route datadog-sync vault reads through readConnectorSecret

D11 Bucket B migration — clears 1 D11 violation; migrates the two
sibling datadog.app_key and datadog.site reads alongside for
consistency (currently unflagged because the audit regex only matches
.api_key / .pat / .oauth / .token suffixes).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Migrate `connectors/github-actions-sync.ts`

**Files:**
- Modify: `packages/gateway/src/connectors/github-actions-sync.ts:219`

- [ ] **Step 1: Baseline test run**

```bash
bun test packages/gateway/src/connectors/github-actions-sync.test.ts
```

Expected: PASS.

- [ ] **Step 2: Add import**

```ts
import { readConnectorSecret } from "./connector-vault.ts";
```

- [ ] **Step 3: Replace line 219**

```ts
// before
const pat = await ctx.vault.get("github.pat");
```

```ts
// after
const pat = await readConnectorSecret(ctx.vault, "github", "pat");
```

- [ ] **Step 4: Run tests**

```bash
bun test packages/gateway/src/connectors/github-actions-sync.test.ts
```

Expected: PASS.

- [ ] **Step 5: Audit check**

```bash
bun run audit:invariants 2>&1 | grep "github-actions-sync" || echo "OK"
```

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/connectors/github-actions-sync.ts
git commit -m "$(cat <<'EOF'
refactor(connectors): route github-actions-sync vault read through readConnectorSecret

D11 Bucket B migration — clears 1 violation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Migrate `connectors/github-sync.ts`

**Files:**
- Modify: `packages/gateway/src/connectors/github-sync.ts:333`

- [ ] **Step 1: Baseline test run**

```bash
bun test packages/gateway/src/connectors/github-sync.test.ts
```

- [ ] **Step 2: Add import**

```ts
import { readConnectorSecret } from "./connector-vault.ts";
```

- [ ] **Step 3: Replace line 333**

```ts
// before
const pat = await ctx.vault.get("github.pat");
```

```ts
// after
const pat = await readConnectorSecret(ctx.vault, "github", "pat");
```

- [ ] **Step 4: Run tests**

```bash
bun test packages/gateway/src/connectors/github-sync.test.ts
```

Expected: PASS.

- [ ] **Step 5: Audit check**

```bash
bun run audit:invariants 2>&1 | grep "connectors/github-sync" || echo "OK"
```

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/connectors/github-sync.ts
git commit -m "$(cat <<'EOF'
refactor(connectors): route github-sync vault read through readConnectorSecret

D11 Bucket B migration — clears 1 violation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Migrate `connectors/gitlab-sync.ts`

**Files:**
- Modify: `packages/gateway/src/connectors/gitlab-sync.ts:593,598`

- [ ] **Step 1: Baseline test run**

```bash
bun test packages/gateway/src/connectors/gitlab-sync.test.ts
```

- [ ] **Step 2: Add import**

```ts
import { readConnectorSecret } from "./connector-vault.ts";
```

- [ ] **Step 3: Replace line 593**

```ts
// before
const pat = await ctx.vault.get("gitlab.pat");
```

```ts
// after
const pat = await readConnectorSecret(ctx.vault, "gitlab", "pat");
```

- [ ] **Step 4: Replace line 598**

```ts
// before
const apiBase = normalisedApiBase(await ctx.vault.get("gitlab.api_base"));
```

```ts
// after
const apiBase = normalisedApiBase(await readConnectorSecret(ctx.vault, "gitlab", "api_base"));
```

- [ ] **Step 5: Run tests**

```bash
bun test packages/gateway/src/connectors/gitlab-sync.test.ts
```

Expected: PASS.

- [ ] **Step 6: Audit check**

```bash
bun run audit:invariants 2>&1 | grep "gitlab-sync" || echo "OK"
```

- [ ] **Step 7: Commit**

```bash
git add packages/gateway/src/connectors/gitlab-sync.ts
git commit -m "$(cat <<'EOF'
refactor(connectors): route gitlab-sync vault reads through readConnectorSecret

D11 Bucket B migration — clears 1 D11 violation; migrates the
sibling gitlab.api_base read for consistency.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Migrate the remaining 4 connector sync files

Bundle the four single-key connector reads + `slack-sync` (also single-key) into one commit. Each is a single-line replacement plus an import.

**Files:**
- Modify: `packages/gateway/src/connectors/linear-sync.ts:219`
- Modify: `packages/gateway/src/connectors/newrelic-sync.ts:38`
- Modify: `packages/gateway/src/connectors/notion-sync.ts:239`
- Modify: `packages/gateway/src/connectors/slack-sync.ts:399`

- [ ] **Step 1: Edit `linear-sync.ts`**

Add import at the top:

```ts
import { readConnectorSecret } from "./connector-vault.ts";
```

Replace line 219:

```ts
// before
const apiKey = await ctx.vault.get("linear.api_key");
// after
const apiKey = await readConnectorSecret(ctx.vault, "linear", "api_key");
```

- [ ] **Step 2: Edit `newrelic-sync.ts`**

Add import. Replace line 38:

```ts
// before
const key = (await ctx.vault.get("newrelic.api_key"))?.trim() ?? "";
// after
const key = (await readConnectorSecret(ctx.vault, "newrelic", "api_key"))?.trim() ?? "";
```

- [ ] **Step 3: Edit `notion-sync.ts`**

Add import. Replace line 239:

```ts
// before
const rawVault = await ctx.vault.get("notion.oauth");
// after
const rawVault = await readConnectorSecret(ctx.vault, "notion", "oauth");
```

- [ ] **Step 4: Edit `slack-sync.ts`**

Add import. Replace line 399:

```ts
// before
const rawVault = await ctx.vault.get("slack.oauth");
// after
const rawVault = await readConnectorSecret(ctx.vault, "slack", "oauth");
```

- [ ] **Step 5: Run all four sync test files**

```bash
bun test packages/gateway/src/connectors/linear-sync.test.ts \
         packages/gateway/src/connectors/newrelic-sync.test.ts \
         packages/gateway/src/connectors/notion-sync.test.ts \
         packages/gateway/src/connectors/slack-sync.test.ts
```

Expected: PASS for all four files.

- [ ] **Step 6: Audit check — should now show only Bucket C violations**

```bash
bun run audit:invariants 2>&1 | grep "D11" | wc -l
```

Expected: `21` (Bucket C only — `lazy-mesh.ts` × 12 + `connector-rpc-handlers.ts` × 9).

- [ ] **Step 7: Commit**

```bash
git add packages/gateway/src/connectors/linear-sync.ts \
        packages/gateway/src/connectors/newrelic-sync.ts \
        packages/gateway/src/connectors/notion-sync.ts \
        packages/gateway/src/connectors/slack-sync.ts
git commit -m "$(cat <<'EOF'
refactor(connectors): route 4 sync files through readConnectorSecret

D11 Bucket B migration — clears the final 4 violations
(linear, newrelic, notion, slack sync readers).

Bucket B is now empty. Live D11 violation count: 21 (Bucket C only).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Verify all caller migration is complete

A defensive grep to catch any missed call site.

- [ ] **Step 1: Confirm zero `vault.get("<service>.<key>")` literals remain in the migrated files**

```bash
git grep -nE 'vault\.get\("[a-z_]+\.[a-z_]+"\)' \
  -- packages/gateway/src/auth/notion-access-token.ts \
     packages/gateway/src/auth/slack-access-token.ts \
     packages/gateway/src/platform/assemble.ts \
     packages/gateway/src/connectors/datadog-sync.ts \
     packages/gateway/src/connectors/github-actions-sync.ts \
     packages/gateway/src/connectors/github-sync.ts \
     packages/gateway/src/connectors/gitlab-sync.ts \
     packages/gateway/src/connectors/linear-sync.ts \
     packages/gateway/src/connectors/newrelic-sync.ts \
     packages/gateway/src/connectors/notion-sync.ts \
     packages/gateway/src/connectors/slack-sync.ts
```

Expected: zero matches.

- [ ] **Step 2: Confirm every migrated file calls `readConnectorSecret` at least once**

```bash
MISSING=0
for f in packages/gateway/src/auth/notion-access-token.ts \
         packages/gateway/src/auth/slack-access-token.ts \
         packages/gateway/src/platform/assemble.ts \
         packages/gateway/src/connectors/datadog-sync.ts \
         packages/gateway/src/connectors/github-actions-sync.ts \
         packages/gateway/src/connectors/github-sync.ts \
         packages/gateway/src/connectors/gitlab-sync.ts \
         packages/gateway/src/connectors/linear-sync.ts \
         packages/gateway/src/connectors/newrelic-sync.ts \
         packages/gateway/src/connectors/notion-sync.ts \
         packages/gateway/src/connectors/slack-sync.ts; do
  if ! grep -q 'readConnectorSecret(' "$f"; then
    echo "MISSING: $f does not call readConnectorSecret"
    MISSING=1
  fi
done
[ "$MISSING" = "0" ] && echo "OK — all 11 files call readConnectorSecret"
```

Expected: `OK — all 11 files call readConnectorSecret`.

If any file is missing, return to that file's migration task and verify the change was committed. Per-file presence is stronger than a global call-count floor — adding a 12th caller in the future does not regress this check.

---

### Task 12: Re-validate audit baselines and update `baseline.md`

The iterator change (Task 1) widens D8/D9/D10/D11. This task captures any baseline shifts.

**Files:**
- Modify: `docs/structure-audit/baseline.md` (update D11 line, add post-Phase-2 note)
- Possibly modify: `docs/structure-audit/{any-baseline.json,db-run-census.json,risky-assertions.json}` (if iterator change shifted counts)

- [ ] **Step 1: Re-run all four audits**

```bash
bun run audit:invariants 2>&1 | tail -5
bun scripts/structure-audit/count-any-usage.ts --check
bun run audit:dead-code | tail -5
bun scripts/structure-audit/list-risky-assertions.ts
bun scripts/structure-audit/measure-file-loc.ts
```

Note any audit that fails or reports a count change vs. the committed baseline.

- [ ] **Step 2: If `count-any-usage --check` fails**

The iterator change excluded `bun-test-support.ts` and `sdk/src/testing/index.ts` from the `any` scan. If those files contain `any`, the baseline drops. Run:

```bash
bun scripts/structure-audit/count-any-usage.ts --update
git diff docs/structure-audit/any-baseline.json
```

If the diff shows a reduction, the new baseline is correct — commit it. If it shows an increase, **stop and investigate** — that's a regression, not the iterator change.

- [ ] **Step 3: Re-run `risky-assertions` and check for delta**

```bash
bun scripts/structure-audit/list-risky-assertions.ts
git diff docs/structure-audit/risky-assertions.json
```

Document any line-count change in the PR description. The list is informational, so no gate fires — just commit the regenerated file.

- [ ] **Step 4: Update `baseline.md` D11 row**

Edit `docs/structure-audit/baseline.md`. Find the D11 row in the per-dimension table:

```markdown
| D11 | F | Vault-key construction outside allow-list | 56 violations | `bun run audit:invariants` (binary) |
```

Add a "Phase 2 follow-up" note immediately after the table (or as a new sub-section), reflecting the post-PR state:

```markdown
## Phase 2 follow-up — post Bucket B (2026-05-01)

D11 violations reduced from the Phase 1 baseline of 56 to **21** (Bucket C only):
- Bucket A (20 false positives) — suppressed by `audit-ignore-next-line` markers (PR #135).
- Bucket B (15 sites) — routed through `readConnectorSecret` helper or added to the now-frozen 5-entry allow-list (this PR).
- Bucket C (21 sites in `lazy-mesh.ts` + `connector-rpc-handlers.ts`) — deferred; tracked in [`deferred-backlog.md`](./deferred-backlog.md).
```

- [ ] **Step 5: Commit baseline + report regenerations**

```bash
git add docs/structure-audit/baseline.md
# Only add regenerated reports if they actually changed:
git add -u docs/structure-audit/risky-assertions.json docs/structure-audit/any-baseline.json 2>/dev/null
git commit -m "$(cat <<'EOF'
docs(structure-audit): record D11 → 21 post Bucket B; refresh baselines

Updates baseline.md with the post-Bucket-B D11 count (21, Bucket C
only). Regenerates other audit baselines if the /testing/ iterator
change shifted them.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: CLAUDE.md / GEMINI.md key-file table update

The new exports (`readConnectorSecret`, `ConnectorSecretKeyOf`) live in `connector-vault.ts`, which already has a row in the key-file table. Update its purpose blurb.

**Files:**
- Modify: `CLAUDE.md` (table row for `connector-vault.ts`)
- Modify: `GEMINI.md` (same row — kept in sync per CLAUDE.md instructions)

- [ ] **Step 1: Find and update the row in `CLAUDE.md`**

The current row reads:

```markdown
| `packages/gateway/src/connectors/connector-vault.ts` | Per-service OAuth vault key helpers — `perServiceOAuthVaultKey()`, `writePerServiceOAuthKey()`, `migrateToPerServiceOAuthKeys()` (Phase 4) |
```

Update to:

```markdown
| `packages/gateway/src/connectors/connector-vault.ts` | Per-service OAuth vault key helpers + typed connector-secret reader — `perServiceOAuthVaultKey()`, `writePerServiceOAuthKey()`, `migrateToPerServiceOAuthKeys()`, `readConnectorSecret()` (Phase 4 / D11 Bucket B) |
```

- [ ] **Step 2: Mirror the change in `GEMINI.md`**

Find the same row and apply the identical edit.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md GEMINI.md
git commit -m "$(cat <<'EOF'
docs: note readConnectorSecret in CLAUDE.md / GEMINI.md key-file table

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Full CI-parity preflight

Per the user's standing rule: run the full CI suite locally before pushing any PR.

- [ ] **Step 1: Run the full CI suite**

```bash
bun run test:ci
```

Expected: all green. Note duration; if anything fails, fix before pushing.

- [ ] **Step 2: Run the full structure-audit pack**

```bash
bun run audit:structure
```

Expected: exits 0 (no binary violations). The orchestrator writes a fresh `docs/structure-audit/run-<timestamp>.json` blob — do NOT commit it (those run blobs are not committed except by the audit publishing step).

- [ ] **Step 3: Lint + typecheck final pass**

```bash
bun run lint && bun run typecheck
```

Expected: both pass.

---

### Task 15: Push branch and open PR

- [ ] **Step 1: Push the branch**

```bash
git push -u origin dev/asafgolombek/d11-bucket-b-readConnectorSecret
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "refactor(structure-audit): D11 Bucket B — route 11 sites through readConnectorSecret" --body "$(cat <<'EOF'
## Summary
- Eliminates D11 Bucket B (11 vault-key construction sites in 11 production files) by routing them through a typed `readConnectorSecret(vault, serviceId, keyName)` helper in `connector-vault.ts`.
- Adds 2 structurally-distinct files to the D11 allow-list (`oauth-vault-tokens.ts` for provider-shared Microsoft OAuth; `embedding/create-embedding-runtime.ts` for OpenAI). Allow-list is now frozen at 5 entries by a unit test.
- Extends the structure-audit iterator to skip `**/testing/**` paths (mirrors existing `/test/fixtures/` rule).
- D11 violation count: **36 → 21** (Bucket C only). Post-PR baseline recorded in `docs/structure-audit/baseline.md`.

## Test plan
- [ ] `bun test packages/gateway/src/connectors/connector-vault.test.ts` — 6 tests pass (3 behavioural + 3 type-level)
- [ ] `bun test scripts/structure-audit/check-nimbus-invariants.test.ts` — frozen-count test passes
- [ ] `bun test scripts/structure-audit/lib.test.ts` — `/testing/` iterator exclusion verified
- [ ] `bun run audit:invariants` exits 0
- [ ] `bun run audit:invariants 2>&1 | grep -c D11` reports `21`
- [ ] `bun run test:ci` clean (Ubuntu CI parity)
- [ ] All 11 connector sync test suites still pass (`datadog`, `github-actions`, `github`, `gitlab`, `linear`, `newrelic`, `notion`, `slack`)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Capture PR URL**

The `gh pr create` output prints the PR URL. Record it for follow-up.

---

## Self-review checklist (run after Task 15, before declaring done)

- [ ] Spec coverage: every section of `2026-05-01-d11-bucket-b-readConnectorSecret-design.md` is implemented by a numbered task.
  - §1 Goal — Tasks 4–10, 12
  - §2 Non-goals — captured by what is NOT in the plan (no `writeConnectorSecret` work)
  - §3 Helper API — Task 2
  - §4.1 Migration table — Tasks 4–10
  - §4.2 Allow-list additions — Task 3
  - §4.3 Iterator extension — Task 1
  - §4.4 Final allow-list — Task 3
  - §5 CI gate (frozen-count test) — Task 3
  - §6 Helper tests — Task 2
  - §7 Acceptance criteria — verified across Tasks 11, 12, 14
  - §8 Rollout (single PR) — single-branch plan; Task 0 sets up branch, Task 15 opens PR
- [ ] Type consistency: `readConnectorSecret` signature matches across Task 2 (definition) and Tasks 4–10 (callers).
- [ ] No placeholders: every step contains the exact code or command to run; no "TBD" / "TODO" / "similar to above".

---

## What this plan deliberately does NOT do

- It does not introduce `writeConnectorSecret(serviceId, value)`. That helper lands with Bucket C.
- It does not widen `VAULT_KEY_RE` to catch additional suffixes (`api_token` / `app_key` / `api_base` / `site` / `account_id` / etc.). That is sequenced after Bucket C — see spec §9.
- It does not touch `lazy-mesh.ts` or `connector-rpc-handlers.ts`. Those are Bucket C and have their own deferred entry.
- It does not change the `CONNECTOR_VAULT_SECRET_KEYS` manifest shape or any vault.set / vault.delete semantics.
- It does not refactor any caller's null/empty/trim guard logic — those stay verbatim.
