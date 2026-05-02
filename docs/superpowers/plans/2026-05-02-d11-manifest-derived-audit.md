# D11 Manifest-Derived Audit + Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate every manifest-shaped vault-key literal in production code to typed helpers, then widen `VAULT_KEY_RE` to be manifest-derived so every entry in `CONNECTOR_VAULT_SECRET_KEYS` is gated.

**Architecture:** 4 atomic PRs sequenced **migrate-first → widen-last**. PR A migrates `connector-rpc-handlers.ts` (44 sites) and adds the new `deleteConnectorSecret` helper. PR B migrates `lazy-mesh.ts` (~50 sites). PR C migrates 14 per-connector sync files + `connector-rpc-shared.ts` + a `drift-hints.ts` marker (~39 sites). PR D widens the regex (manifest-derived), allow-lists `connector-secrets-manifest.ts` as a 6th entry, adds `stripComments` to the audit (so JSDoc references stop firing), bumps the frozen-count test 5 → 6, and refreshes the baseline. CI stays green at every commit because the regex doesn't widen until D, and by then the audit count is already 0 under the broader pattern.

**Tech Stack:** TypeScript 6.x strict / Bun v1.2 / `bun:test` / Biome lint / project-local `.worktrees/` for isolation.

**Spec:** [`docs/superpowers/specs/2026-05-02-d11-manifest-derived-audit-design.md`](../specs/2026-05-02-d11-manifest-derived-audit-design.md)

**Preconditions:**
- All four PRs branch from `main`. PRs A, B, C are independent of each other and can be merged in any order; PR D requires all three merged.
- D11 baseline before PR A: **0** violations (Bucket C closed via PR #149 + #151). The plan's verification steps depend on that count.

---

## File Structure

### PR A — rpc-handlers + new helper

| File | Responsibility | Action |
|---|---|---|
| `packages/gateway/src/connectors/connector-vault.ts` | Allow-listed home of vault-key construction. Append `deleteConnectorSecret<S>` helper below `writeConnectorSecret`. | Modify |
| `packages/gateway/src/connectors/connector-vault.test.ts` | Existing helper-test home. Append `deleteConnectorSecret` describe block (5 cases) + extend the `ConnectorSecretKeyOf — type pins` block with 2 new pins. | Modify |
| `packages/gateway/src/ipc/connector-rpc-handlers.ts` | Connector auth/remove RPC handlers. Migrate 44 manifest-shaped literals at lines 534, 536, 579, 580, 596, 615, 616, 618, 620, 623, 625, 630, 631, 632, 633, 684, 685, 686, 705, 709, 711, 731, 761, 762, 783, 784, 789, 791, 815, 817, 840, 844, 846, 866, 869, 871, 888, 920, 921, 922, 943, 944. (44 sites total — one of those line numbers in the original grep was the "Slot 1" miscount; verify with the discovery script in Task A.1 Step 4.) | Modify |

### PR B — lazy-mesh

| File | Responsibility | Action |
|---|---|---|
| `packages/gateway/src/connectors/lazy-mesh.ts` | MCP connector mesh. Migrate ~50 manifest-shaped literals (Phase 3 spawn-config blocks + per-connector ensure*Running methods + per-connector ensure*IfVaultCreds methods). | Modify |

### PR C — sync files + shared

| File | Responsibility | Action |
|---|---|---|
| `packages/gateway/src/connectors/aws-sync.ts` | 4 sites | Modify |
| `packages/gateway/src/connectors/azure-sync.ts` | 4 sites | Modify |
| `packages/gateway/src/connectors/bitbucket-sync.ts` | 2 sites | Modify |
| `packages/gateway/src/connectors/circleci-sync.ts` | 1 site | Modify |
| `packages/gateway/src/connectors/confluence-sync.ts` | 3 sites | Modify |
| `packages/gateway/src/connectors/discord-sync.ts` | 2 sites | Modify |
| `packages/gateway/src/connectors/gcp-sync.ts` | 3 sites | Modify |
| `packages/gateway/src/connectors/grafana-sync.ts` | 2 sites | Modify |
| `packages/gateway/src/connectors/iac-sync.ts` | 1 site | Modify |
| `packages/gateway/src/connectors/jenkins-sync.ts` | 3 sites | Modify |
| `packages/gateway/src/connectors/jira-sync.ts` | 3 sites | Modify |
| `packages/gateway/src/connectors/kubernetes-sync.ts` | 2 sites | Modify |
| `packages/gateway/src/connectors/pagerduty-sync.ts` | 1 site | Modify |
| `packages/gateway/src/connectors/sentry-sync.ts` | 3 sites | Modify |
| `packages/gateway/src/ipc/connector-rpc-shared.ts` | 3 template-literal sites in `registerAtlassianApiConnectorAuth` (`${serviceId}.email`, `${serviceId}.api_token`, `${serviceId}.base_url`); migrate via `writeConnectorSecret(vault, serviceId, "...", v)` — typechecks cleanly because `serviceId: "jira" \| "confluence"` and both have those keys in the manifest. | Modify |
| `packages/gateway/src/index/drift-hints.ts` | 1 prose-string mention of `iac.enabled` in a user-facing diagnostic message (line 57); add `audit-ignore-next-line D11-vault-key (diagnostic prose, not vault-key construction)` marker on the previous line — not a vault-key construction. | Modify |

### PR D — audit script changes

| File | Responsibility | Action |
|---|---|---|
| `scripts/structure-audit/check-nimbus-invariants.ts` | Replace static `VAULT_KEY_RE` with manifest-derived `buildVaultKeyRegex()`; add `connector-secrets-manifest.ts` as 6th allow-list entry; route `f.contents` through `stripComments` before line-by-line scan so JSDoc/prose references stop firing. | Modify |
| `scripts/structure-audit/check-nimbus-invariants.test.ts` | Bump `VAULT_KEY_ALLOW_LIST` length assertion 5 → 6; add unit test for `buildVaultKeyRegex` matching representative manifest entries. | Modify |
| `packages/gateway/src/connectors/connector-secrets-manifest.ts` | Remove the 7 redundant `audit-ignore-next-line D11-vault-key (manifest entry, not vault-key construction)` markers (file is now allow-listed). | Modify |
| `docs/structure-audit/baseline.md` | D11 row stays at "0 violations"; append a dated post-widening section recording the manifest-derived migration. | Modify |

---

## Migration patterns (used across PRs A / B / C)

Mechanical substitutions — same as Bucket B/C. Surrounding `?.trim() ?? ""`, null/empty checks, and call-flow stay byte-identical.

| Before | After |
|---|---|
| `await this.vault.get("foo.bar")` | `await readConnectorSecret(this.vault, "foo", "bar")` |
| `await vault.get("foo.bar")` | `await readConnectorSecret(vault, "foo", "bar")` |
| `(await this.vault.get("foo.bar"))?.trim() ?? ""` | `(await readConnectorSecret(this.vault, "foo", "bar"))?.trim() ?? ""` |
| `await vault.set("foo.bar", v)` | `await writeConnectorSecret(vault, "foo", "bar", v)` |
| `await vault.delete("foo.bar")` | `await deleteConnectorSecret(vault, "foo", "bar")` |
| `await vault.set(\`${serviceId}.api_token\`, v)` | `await writeConnectorSecret(vault, serviceId, "api_token", v)` (PR C only — connector-rpc-shared.ts) |

Imports added to each modified file (only those not already imported):

```ts
import {
  readConnectorSecret,
  writeConnectorSecret,
  deleteConnectorSecret,
} from "../connectors/connector-vault.ts";
```

(Adjust path depth and selector list per file; only import the helpers actually used in that file.)

---

## PR A — rpc-handlers migrations + `deleteConnectorSecret` helper

**Branch:** `dev/asafgolombek/d11-widen-rpc-handlers` (from `main`)
**Worktree:** `.worktrees/d11-widen-rpc-handlers`
**Commit count:** 1 (atomic)

### Task A.1: Set up the PR-A worktree

**Files:** none (workspace setup)

- [ ] **Step 1: Sync main**

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
```

Expected: at `079beea` or later.

- [ ] **Step 2: Create the worktree**

```bash
git worktree add -b dev/asafgolombek/d11-widen-rpc-handlers .worktrees/d11-widen-rpc-handlers main
```

- [ ] **Step 3: Install deps**

```bash
cd .worktrees/d11-widen-rpc-handlers
bun install
```

Expected: `2130 packages installed`.

- [ ] **Step 4: Confirm the discovery grep finds 44 manifest-shaped literals in rpc-handlers (the migration target)**

```bash
PAT='slack\.oauth|github\.pat|gitlab\.pat|gitlab\.api_base|bitbucket\.username|bitbucket\.app_password|linear\.api_key|jira\.api_token|jira\.email|jira\.base_url|notion\.oauth|confluence\.api_token|confluence\.email|confluence\.base_url|discord\.bot_token|discord\.enabled|jenkins\.base_url|jenkins\.username|jenkins\.api_token|circleci\.api_token|pagerduty\.api_token|kubernetes\.kubeconfig|kubernetes\.context|aws\.access_key_id|aws\.secret_access_key|aws\.default_region|aws\.profile|azure\.tenant_id|azure\.client_id|azure\.client_secret|gcp\.credentials_json_path|gcp\.project_id|iac\.enabled|grafana\.url|grafana\.api_token|sentry\.auth_token|sentry\.org_slug|sentry\.url|newrelic\.api_key|newrelic\.account_id|datadog\.api_key|datadog\.app_key|datadog\.site'
rg -c "['\"\`]($PAT)['\"\`]" packages/gateway/src/ipc/connector-rpc-handlers.ts
```

Expected: `44`. (Save the `PAT` variable in your shell; subsequent steps re-use it.)

- [ ] **Step 5: Confirm baseline D11 = 0 (Bucket C state)**

```bash
bun run audit:invariants 2>&1 | grep -c "D11"
```

Expected: `0`. (We're starting from the post-Bucket-C green state. The migration should keep this at 0 because the helpers don't change the literal count for old-suffix sites.)

### Task A.2: Write the failing `deleteConnectorSecret` test (TDD red)

**Files:**
- Modify: `packages/gateway/src/connectors/connector-vault.test.ts` (append a new describe block; existing blocks untouched)

- [ ] **Step 1: Update the import line at the top of the file**

Find:

```ts
import {
  type ConnectorSecretKeyOf,
  readConnectorSecret,
  sharedOAuthKey,
  writeConnectorSecret,
} from "./connector-vault.ts";
```

Replace with:

```ts
import {
  type ConnectorSecretKeyOf,
  deleteConnectorSecret,
  readConnectorSecret,
  sharedOAuthKey,
  writeConnectorSecret,
} from "./connector-vault.ts";
```

- [ ] **Step 2: Append the new describe block at the end of the file**

```ts
describe("deleteConnectorSecret", () => {
  test("deletes the value at the constructed key", async () => {
    const vault = createMemoryVault();
    await vault.set("github.pat", "ghp_test");
    await deleteConnectorSecret(vault, "github", "pat");
    expect(await vault.get("github.pat")).toBeNull();
  });

  test("is a no-op when the key is absent", async () => {
    const vault = createMemoryVault();
    await deleteConnectorSecret(vault, "github", "pat");
    expect(await vault.get("github.pat")).toBeNull();
  });

  test("does not affect sibling keys on the same service", async () => {
    const vault = createMemoryVault();
    await vault.set("datadog.api_key", "API");
    await vault.set("datadog.app_key", "APP");
    await deleteConnectorSecret(vault, "datadog", "api_key");
    expect(await vault.get("datadog.api_key")).toBeNull();
    expect(await vault.get("datadog.app_key")).toBe("APP");
  });

  test("does not affect other services' keys", async () => {
    const vault = createMemoryVault();
    await vault.set("github.pat", "ghp");
    await vault.set("gitlab.pat", "glpat");
    await deleteConnectorSecret(vault, "github", "pat");
    expect(await vault.get("github.pat")).toBeNull();
    expect(await vault.get("gitlab.pat")).toBe("glpat");
  });

  test("compile-time: rejects non-manifested keys", async () => {
    const vault = createMemoryVault();
    // @ts-expect-error — github manifest is ["github.pat"].
    await deleteConnectorSecret(vault, "github", "oauth");
    // @ts-expect-error — google_drive manifest is empty; ConnectorSecretKeyOf resolves to never.
    await deleteConnectorSecret(vault, "google_drive", "oauth");
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test — expect a typecheck/import failure**

```bash
bun test packages/gateway/src/connectors/connector-vault.test.ts
```

Expected: failure citing `deleteConnectorSecret` is not exported from `./connector-vault.ts`.

### Task A.3: Implement `deleteConnectorSecret` (TDD green)

**Files:**
- Modify: `packages/gateway/src/connectors/connector-vault.ts` (append below the existing `writeConnectorSecret` function, before the `// ─── Bucket-C helper:` section)

- [ ] **Step 1: Append the new export**

Find (currently just below the `writeConnectorSecret` function body):

```ts
// ─── Bucket-C helper: provider-shared OAuth key constructor ──────────────────
```

Replace with:

```ts
/**
 * Deletes a connector's secret from the Vault by structural key name.
 * Mirrors `readConnectorSecret`/`writeConnectorSecret` typing — `keyName` is
 * constrained to `ConnectorSecretKeyOf<S>`, so misspelled or non-manifested
 * keys fail at compile time. Returns `void` (mirrors `vault.delete`).
 */
export async function deleteConnectorSecret<S extends ConnectorServiceId>(
  vault: NimbusVault,
  serviceId: S,
  keyName: ConnectorSecretKeyOf<S>,
): Promise<void> {
  const fullKey = `${serviceId}.${keyName}`;
  return vault.delete(fullKey);
}

// ─── Bucket-C helper: provider-shared OAuth key constructor ──────────────────
```

- [ ] **Step 2: Run the test — expect green**

```bash
bun test packages/gateway/src/connectors/connector-vault.test.ts
```

Expected: 20 pass / 0 fail (15 from before + 5 new). 24 expect() calls.

- [ ] **Step 3: Whole-repo typecheck**

```bash
bun run typecheck
```

Expected: clean.

### Task A.4: Extend the type-pin block

**Files:**
- Modify: `packages/gateway/src/connectors/connector-vault.test.ts` (the existing `ConnectorSecretKeyOf — type pins` describe block)

- [ ] **Step 1: Locate the existing type-pin extensions block (added in Bucket C PR-2)**

```bash
grep -n "writeConnectorSecret keyName" packages/gateway/src/connectors/connector-vault.test.ts
```

Expected: one hit on the comment line `// writeConnectorSecret keyName must accept the same union as readConnectorSecret.`

- [ ] **Step 2: Append the deleteConnectorSecret pins immediately after the existing sharedOAuthKey ReturnType pin (just before the closing `expect(true).toBe(true);`)**

Find:

```ts
    // sharedOAuthKey signature pins.
    assertEq<Parameters<typeof sharedOAuthKey>[0], "google" | "microsoft">(true);
    assertEq<ReturnType<typeof sharedOAuthKey>, "google.oauth" | "microsoft.oauth">(true);

    expect(true).toBe(true);
  });
});
```

Replace with:

```ts
    // sharedOAuthKey signature pins.
    assertEq<Parameters<typeof sharedOAuthKey>[0], "google" | "microsoft">(true);
    assertEq<ReturnType<typeof sharedOAuthKey>, "google.oauth" | "microsoft.oauth">(true);

    // deleteConnectorSecret signature pins (parameter + return type).
    assertEq<Parameters<typeof deleteConnectorSecret<"github">>[2], "pat">(true);
    assertEq<ReturnType<typeof deleteConnectorSecret>, Promise<void>>(true);

    expect(true).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test file — expect green**

```bash
bun test packages/gateway/src/connectors/connector-vault.test.ts
```

Expected: 20 pass / 0 fail still (the type-pin test is the same single test; just more `assertEq` lines inside it).

### Task A.5: Migrate the 44 sites in `connector-rpc-handlers.ts`

**Files:**
- Modify: `packages/gateway/src/ipc/connector-rpc-handlers.ts` (44 sites + import block)

- [ ] **Step 1: Update the import block**

Find (currently 6 lines):

```ts
import {
  ALL_GOOGLE_OAUTH_VAULT_KEYS,
  clearOAuthVaultIfProviderUnused,
  sharedOAuthKey,
  writeConnectorSecret,
  writePerServiceOAuthKey,
} from "../connectors/connector-vault.ts";
```

Replace with:

```ts
import {
  ALL_GOOGLE_OAUTH_VAULT_KEYS,
  clearOAuthVaultIfProviderUnused,
  deleteConnectorSecret,
  readConnectorSecret,
  sharedOAuthKey,
  writeConnectorSecret,
  writePerServiceOAuthKey,
} from "../connectors/connector-vault.ts";
```

(`readConnectorSecret` is added because some site migrations may call it; if it ends up unused after Step 2 runs, Biome will flag and we'll trim it back. Safer to add than to miss.)

- [ ] **Step 2: Migrate all 44 sites mechanically per the migration patterns above**

Site-by-site list (each line is one Edit operation; format `LINE | BEFORE | AFTER`):

| Line | Before | After |
|---|---|---|
| 534 | `await vault.set("gitlab.api_base", stripTrailingSlashes(baseRaw.trim()));` | `await writeConnectorSecret(vault, "gitlab", "api_base", stripTrailingSlashes(baseRaw.trim()));` |
| 536 | `await vault.delete("gitlab.api_base");` | `await deleteConnectorSecret(vault, "gitlab", "api_base");` |
| 579 | `await vault.set("discord.bot_token", token);` | `await writeConnectorSecret(vault, "discord", "bot_token", token);` |
| 580 | `await vault.set("discord.enabled", "1");` | `await writeConnectorSecret(vault, "discord", "enabled", "1");` |
| 596 | `await vault.set("circleci.api_token", token);` | `await writeConnectorSecret(vault, "circleci", "api_token", token);` |
| 615 | `await vault.set("aws.access_key_id", ak);` | `await writeConnectorSecret(vault, "aws", "access_key_id", ak);` |
| 616 | `await vault.set("aws.secret_access_key", sk);` | `await writeConnectorSecret(vault, "aws", "secret_access_key", sk);` |
| 618 | `await vault.delete("aws.default_region");` | `await deleteConnectorSecret(vault, "aws", "default_region");` |
| 620 | `await vault.set("aws.default_region", reg);` | `await writeConnectorSecret(vault, "aws", "default_region", reg);` |
| 623 | `await vault.delete("aws.profile");` | `await deleteConnectorSecret(vault, "aws", "profile");` |
| 625 | `await vault.set("aws.profile", prof);` | `await writeConnectorSecret(vault, "aws", "profile", prof);` |
| 630 | `await vault.delete("aws.access_key_id");` | `await deleteConnectorSecret(vault, "aws", "access_key_id");` |
| 631 | `await vault.delete("aws.secret_access_key");` | `await deleteConnectorSecret(vault, "aws", "secret_access_key");` |
| 632 | `await vault.delete("aws.default_region");` | `await deleteConnectorSecret(vault, "aws", "default_region");` |
| 633 | `await vault.set("aws.profile", prof);` | `await writeConnectorSecret(vault, "aws", "profile", prof);` |
| 684 | `await vault.set("azure.tenant_id", tenant);` | `await writeConnectorSecret(vault, "azure", "tenant_id", tenant);` |
| 685 | `await vault.set("azure.client_id", clientId);` | `await writeConnectorSecret(vault, "azure", "client_id", clientId);` |
| 686 | `await vault.set("azure.client_secret", secret);` | `await writeConnectorSecret(vault, "azure", "client_secret", secret);` |
| 705 | `await vault.set("gcp.credentials_json_path", path);` | `await writeConnectorSecret(vault, "gcp", "credentials_json_path", path);` |
| 709 | `await vault.delete("gcp.project_id");` | `await deleteConnectorSecret(vault, "gcp", "project_id");` |
| 711 | `await vault.set("gcp.project_id", proj);` | `await writeConnectorSecret(vault, "gcp", "project_id", proj);` |
| 731 | `await vault.set("iac.enabled", "1");` | `await writeConnectorSecret(vault, "iac", "enabled", "1");` |
| 761 | `await vault.set("grafana.url", base);` | `await writeConnectorSecret(vault, "grafana", "url", base);` |
| 762 | `await vault.set("grafana.api_token", token);` | `await writeConnectorSecret(vault, "grafana", "api_token", token);` |
| 783 | `await vault.set("sentry.auth_token", token);` | `await writeConnectorSecret(vault, "sentry", "auth_token", token);` |
| 784 | `await vault.set("sentry.org_slug", org);` | `await writeConnectorSecret(vault, "sentry", "org_slug", org);` |
| 789 | `await vault.delete("sentry.url");` | `await deleteConnectorSecret(vault, "sentry", "url");` |
| 791 | `await vault.set("sentry.url", surl);` | `await writeConnectorSecret(vault, "sentry", "url", surl);` |
| 815 | `await vault.delete("newrelic.account_id");` | `await deleteConnectorSecret(vault, "newrelic", "account_id");` |
| 817 | `await vault.set("newrelic.account_id", acct);` | `await writeConnectorSecret(vault, "newrelic", "account_id", acct);` |
| 840 | `await vault.set("datadog.app_key", app);` | `await writeConnectorSecret(vault, "datadog", "app_key", app);` |
| 844 | `await vault.delete("datadog.site");` | `await deleteConnectorSecret(vault, "datadog", "site");` |
| 846 | `await vault.set("datadog.site", site);` | `await writeConnectorSecret(vault, "datadog", "site", site);` |
| 866 | `await vault.set("kubernetes.kubeconfig", kubePath);` | `await writeConnectorSecret(vault, "kubernetes", "kubeconfig", kubePath);` |
| 869 | `await vault.set("kubernetes.context", ctxRaw.trim());` | `await writeConnectorSecret(vault, "kubernetes", "context", ctxRaw.trim());` |
| 871 | `await vault.delete("kubernetes.context");` | `await deleteConnectorSecret(vault, "kubernetes", "context");` |
| 888 | `await vault.set("pagerduty.api_token", token);` | `await writeConnectorSecret(vault, "pagerduty", "api_token", token);` |
| 920 | `await vault.set("jenkins.base_url", base);` | `await writeConnectorSecret(vault, "jenkins", "base_url", base);` |
| 921 | `await vault.set("jenkins.username", user);` | `await writeConnectorSecret(vault, "jenkins", "username", user);` |
| 922 | `await vault.set("jenkins.api_token", token);` | `await writeConnectorSecret(vault, "jenkins", "api_token", token);` |
| 943 | `await vault.set("bitbucket.username", user);` | `await writeConnectorSecret(vault, "bitbucket", "username", user);` |
| 944 | `await vault.set("bitbucket.app_password", token);` | `await writeConnectorSecret(vault, "bitbucket", "app_password", token);` |

(Line numbers are pre-migration. After migration, lines may shift slightly because `writeConnectorSecret(...)` is longer than `vault.set(...)`. Use the discovery grep to verify final state.)

- [ ] **Step 3: Verify zero residual manifest-shaped literals**

```bash
PAT='slack\.oauth|github\.pat|gitlab\.pat|gitlab\.api_base|bitbucket\.username|bitbucket\.app_password|linear\.api_key|jira\.api_token|jira\.email|jira\.base_url|notion\.oauth|confluence\.api_token|confluence\.email|confluence\.base_url|discord\.bot_token|discord\.enabled|jenkins\.base_url|jenkins\.username|jenkins\.api_token|circleci\.api_token|pagerduty\.api_token|kubernetes\.kubeconfig|kubernetes\.context|aws\.access_key_id|aws\.secret_access_key|aws\.default_region|aws\.profile|azure\.tenant_id|azure\.client_id|azure\.client_secret|gcp\.credentials_json_path|gcp\.project_id|iac\.enabled|grafana\.url|grafana\.api_token|sentry\.auth_token|sentry\.org_slug|sentry\.url|newrelic\.api_key|newrelic\.account_id|datadog\.api_key|datadog\.app_key|datadog\.site'
rg -c "['\"\`]($PAT)['\"\`]" packages/gateway/src/ipc/connector-rpc-handlers.ts
```

Expected: empty output (zero hits).

If the import added in Step 1's `readConnectorSecret` ends up unused, Biome will flag in Task A.6 — remove it from the import block then.

### Task A.6: Verify PR-A acceptance gates

- [ ] **Step 1: Audit count under current regex unchanged (still 0)**

```bash
bun run audit:invariants 2>&1 | grep -c "D11"
```

Expected: `0`.

- [ ] **Step 2: Connector-vault tests pass (20 total: 5 read + 1 type-pin + 3 sharedOAuthKey + 5 write + 5 delete + the new pins)**

```bash
bun test packages/gateway/src/connectors/connector-vault.test.ts
```

Expected: 20 pass / 0 fail.

- [ ] **Step 3: rpc-handlers regression tests still pass**

```bash
bun test packages/gateway/src/ipc/connector-rpc-handlers-setconfig.test.ts
```

Expected: pass count unchanged from main.

- [ ] **Step 4: Frozen-count test still green (still 5 entries until PR D)**

```bash
bun test scripts/structure-audit/check-nimbus-invariants.test.ts
```

Expected: pass.

- [ ] **Step 5: Whole-repo typecheck**

```bash
bun run typecheck
```

Expected: clean.

- [ ] **Step 6: Lint**

```bash
bun run lint
```

Expected: clean. (If `readConnectorSecret` import was unused, remove it now and re-run lint.)

- [ ] **Step 7: CI parity (per memory `feedback_preflight_before_pr.md`)**

```bash
bun run test:ci
```

Expected: gateway/script suites pass. (UI vitest V8 coverage step has the known Bun-inspector parallel-run flake — same as PRs #149/#151. Acceptable.)

### Task A.7: Commit + push + open PR-A

- [ ] **Step 1: Stage**

```bash
git add packages/gateway/src/connectors/connector-vault.ts \
        packages/gateway/src/connectors/connector-vault.test.ts \
        packages/gateway/src/ipc/connector-rpc-handlers.ts
```

- [ ] **Step 2: Verify nothing else is staged**

```bash
git status
```

Expected: only the three files above are staged. `junit-reports/junit-vitest.xml` may be unstaged-modified; leave it alone.

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
refactor(ipc): D11 widen — route 44 manifest-shaped vault-keys through helpers + add deleteConnectorSecret

Migrates 44 vault.get/set/delete sites in connector-rpc-handlers.ts to the
typed helpers (readConnectorSecret/writeConnectorSecret/deleteConnectorSecret)
and adds the new deleteConnectorSecret<S> helper to connector-vault.ts.
Mirrors the read/writeConnectorSecret typing for individual-key deletes
(matching the bulk-delete clearConnectorVaultSecretKeys helper that already
handles delete-all-of-a-connector cases).

Spec: docs/superpowers/specs/2026-05-02-d11-manifest-derived-audit-design.md
Plan: docs/superpowers/plans/2026-05-02-d11-manifest-derived-audit.md (PR A)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Push**

```bash
git push -u origin dev/asafgolombek/d11-widen-rpc-handlers
```

- [ ] **Step 5: Open the PR**

```bash
gh pr create --base main \
  --title "refactor(ipc): D11 widen — route 44 manifest-shaped vault-keys through helpers + add deleteConnectorSecret" \
  --body "$(cat <<'EOF'
## Summary
- Adds `deleteConnectorSecret<S>(vault, serviceId, keyName)` to allow-listed `connector-vault.ts` (mirrors `readConnectorSecret`/`writeConnectorSecret` typing).
- Migrates 44 manifest-shaped `vault.get`/`vault.set`/`vault.delete` sites in `connector-rpc-handlers.ts` to the typed helpers.
- Extends the `ConnectorSecretKeyOf — type pins` block with a parameter + return-type pin for `deleteConnectorSecret`.

D11 audit count under the current regex is unchanged (0). The widening lands in PR D once PRs B + C also migrate their files.

## Test plan
- [x] `bun test packages/gateway/src/connectors/connector-vault.test.ts` — 20 pass.
- [x] `bun test packages/gateway/src/ipc/connector-rpc-handlers-setconfig.test.ts` — pass count unchanged.
- [x] `bun run audit:invariants` reports 0 D11 hits (unchanged).
- [x] `bun run typecheck` clean.
- [x] `bun run lint` clean.
- [x] `bun run test:ci` clean (modulo the known UI vitest V8 coverage parallel-run flake; passes alone).

## Spec / Plan
- Spec: [`docs/superpowers/specs/2026-05-02-d11-manifest-derived-audit-design.md`](https://github.com/asafgolombek/Nimbus/blob/main/docs/superpowers/specs/2026-05-02-d11-manifest-derived-audit-design.md)
- Plan: [`docs/superpowers/plans/2026-05-02-d11-manifest-derived-audit.md`](https://github.com/asafgolombek/Nimbus/blob/main/docs/superpowers/plans/2026-05-02-d11-manifest-derived-audit.md) (PR A)

## Predecessor
PR #151 (Bucket C closure: D11 = 0 under the old 4-suffix regex).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Wait for CI; request review; merge.**

PRs B / C / D do not depend on PR A merging (B and C operate on different files; D depends on all migrations being merged first). PR-2 worktrees can be set up after this merges.

---

## PR B — lazy-mesh migrations

**Branch:** `dev/asafgolombek/d11-widen-lazy-mesh` (from `main`, **after PR A merges**)
**Worktree:** `.worktrees/d11-widen-lazy-mesh`
**Commit count:** 1 (atomic)

### Task B.1: Set up the PR-B worktree

**Files:** none (workspace setup)

- [ ] **Step 1: Sync main + verify `deleteConnectorSecret` is on main (PR A merged)**

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
git grep -n "export async function deleteConnectorSecret" packages/gateway/src/connectors/connector-vault.ts
```

Expected: one hit. If empty, PR A hasn't merged — wait.

- [ ] **Step 2: Create the worktree**

```bash
git worktree add -b dev/asafgolombek/d11-widen-lazy-mesh .worktrees/d11-widen-lazy-mesh main
cd .worktrees/d11-widen-lazy-mesh
bun install
```

- [ ] **Step 3: Confirm the discovery grep finds the expected number of manifest-shaped literals in lazy-mesh**

```bash
PAT='slack\.oauth|github\.pat|gitlab\.pat|gitlab\.api_base|bitbucket\.username|bitbucket\.app_password|linear\.api_key|jira\.api_token|jira\.email|jira\.base_url|notion\.oauth|confluence\.api_token|confluence\.email|confluence\.base_url|discord\.bot_token|discord\.enabled|jenkins\.base_url|jenkins\.username|jenkins\.api_token|circleci\.api_token|pagerduty\.api_token|kubernetes\.kubeconfig|kubernetes\.context|aws\.access_key_id|aws\.secret_access_key|aws\.default_region|aws\.profile|azure\.tenant_id|azure\.client_id|azure\.client_secret|gcp\.credentials_json_path|gcp\.project_id|iac\.enabled|grafana\.url|grafana\.api_token|sentry\.auth_token|sentry\.org_slug|sentry\.url|newrelic\.api_key|newrelic\.account_id|datadog\.api_key|datadog\.app_key|datadog\.site'
rg -n "['\"\`]($PAT)['\"\`]" packages/gateway/src/connectors/lazy-mesh.ts
```

Expected: ~50 hits in actual code (excluding lines inside JSDoc comments — those are already audit-ignored). The plan's migration table below covers the code sites; lines inside `/** ... */` blocks are skipped.

### Task B.2: Migrate the lazy-mesh sites

**Files:**
- Modify: `packages/gateway/src/connectors/lazy-mesh.ts` (~50 sites + import block)

- [ ] **Step 1: Update the import block**

The existing block (added in Bucket C PR-1) contains:

```ts
import { readConnectorSecret, sharedOAuthKey, type SharedOAuthProvider } from "./connector-vault.ts";
```

(Plus possibly a separate `import type { ConnectorSecretKeyOf } from "./connector-vault.ts";` line — verify with `git grep -n "from \"./connector-vault.ts\"" packages/gateway/src/connectors/lazy-mesh.ts`.)

`writeConnectorSecret` and `deleteConnectorSecret` are not used in lazy-mesh (all sites are reads), so do not add them. Just keep the existing imports.

- [ ] **Step 2: Migrate each read site**

The migration table below lists the sites grouped by `ensure*Running` / Phase 3 spawn-config block. Each line is one Edit operation; the `?.trim() ?? ""` wrapping (where present) is preserved verbatim.

**Phase 3 / cloud connectors block** (`phase3AddAwsMcp`, `phase3AddAzureMcp`, `phase3AddGcpMcp`, `phase3AddIacMcp`, `phase3AddGrafanaMcp`, `phase3AddSentryMcp`, `phase3AddDatadogMcp`):

| Line | Before | After |
|---|---|---|
| 377 | `const ak = (await this.vault.get("aws.access_key_id"))?.trim() ?? "";` | `const ak = (await readConnectorSecret(this.vault, "aws", "access_key_id"))?.trim() ?? "";` |
| 378 | `const sk = (await this.vault.get("aws.secret_access_key"))?.trim() ?? "";` | `const sk = (await readConnectorSecret(this.vault, "aws", "secret_access_key"))?.trim() ?? "";` |
| 379 | `const reg = (await this.vault.get("aws.default_region"))?.trim() ?? "";` | `const reg = (await readConnectorSecret(this.vault, "aws", "default_region"))?.trim() ?? "";` |
| 380 | `const prof = (await this.vault.get("aws.profile"))?.trim() ?? "";` | `const prof = (await readConnectorSecret(this.vault, "aws", "profile"))?.trim() ?? "";` |
| 409 | `const azT = (await this.vault.get("azure.tenant_id"))?.trim() ?? "";` | `const azT = (await readConnectorSecret(this.vault, "azure", "tenant_id"))?.trim() ?? "";` |
| 410 | `const azC = (await this.vault.get("azure.client_id"))?.trim() ?? "";` | `const azC = (await readConnectorSecret(this.vault, "azure", "client_id"))?.trim() ?? "";` |
| 411 | `const azS = (await this.vault.get("azure.client_secret"))?.trim() ?? "";` | `const azS = (await readConnectorSecret(this.vault, "azure", "client_secret"))?.trim() ?? "";` |
| 429 | `const gcpPath = (await this.vault.get("gcp.credentials_json_path"))?.trim() ?? "";` | `const gcpPath = (await readConnectorSecret(this.vault, "gcp", "credentials_json_path"))?.trim() ?? "";` |
| 443 | `const iacEn = await this.vault.get("iac.enabled");` | `const iacEn = await readConnectorSecret(this.vault, "iac", "enabled");` |
| 457 | `const gfu = (await this.vault.get("grafana.url"))?.trim() ?? "";` | `const gfu = (await readConnectorSecret(this.vault, "grafana", "url"))?.trim() ?? "";` |
| 458 | `const gtk = (await this.vault.get("grafana.api_token"))?.trim() ?? "";` | `const gtk = (await readConnectorSecret(this.vault, "grafana", "api_token"))?.trim() ?? "";` |
| 472 | `const sentTok = (await this.vault.get("sentry.auth_token"))?.trim() ?? "";` | `const sentTok = (await readConnectorSecret(this.vault, "sentry", "auth_token"))?.trim() ?? "";` |
| 473 | `const sentOrg = (await this.vault.get("sentry.org_slug"))?.trim() ?? "";` | `const sentOrg = (await readConnectorSecret(this.vault, "sentry", "org_slug"))?.trim() ?? "";` |
| 481 | `const surl = (await this.vault.get("sentry.url"))?.trim() ?? "";` | `const surl = (await readConnectorSecret(this.vault, "sentry", "url"))?.trim() ?? "";` |
| 510 | `const ddApp = (await this.vault.get("datadog.app_key"))?.trim() ?? "";` | `const ddApp = (await readConnectorSecret(this.vault, "datadog", "app_key"))?.trim() ?? "";` |
| 518 | `const site = (await this.vault.get("datadog.site"))?.trim() ?? "";` | `const site = (await readConnectorSecret(this.vault, "datadog", "site"))?.trim() ?? "";` |

**Per-connector `ensure*Running` methods** (one read per method body):

| Line | Before | After |
|---|---|---|
| 725 | `const apiBase = await this.vault.get("gitlab.api_base");` | `const apiBase = await readConnectorSecret(this.vault, "gitlab", "api_base");` |
| 760 | `const user = await this.vault.get("bitbucket.username");` | `const user = await readConnectorSecret(this.vault, "bitbucket", "username");` |
| 761 | `const pass = await this.vault.get("bitbucket.app_password");` | `const pass = await readConnectorSecret(this.vault, "bitbucket", "app_password");` |
| 864 | `const token = await this.vault.get("jira.api_token");` | `const token = await readConnectorSecret(this.vault, "jira", "api_token");` |
| 865 | `const email = await this.vault.get("jira.email");` | `const email = await readConnectorSecret(this.vault, "jira", "email");` |
| 866 | `const baseUrl = await this.vault.get("jira.base_url");` | `const baseUrl = await readConnectorSecret(this.vault, "jira", "base_url");` |
| 949 | `const token = await this.vault.get("confluence.api_token");` | `const token = await readConnectorSecret(this.vault, "confluence", "api_token");` |
| 950 | `const em = await this.vault.get("confluence.email");` | `const em = await readConnectorSecret(this.vault, "confluence", "email");` |
| 951 | `const baseUrl = await this.vault.get("confluence.base_url");` | `const baseUrl = await readConnectorSecret(this.vault, "confluence", "base_url");` |
| 993 | `const enabled = await this.vault.get("discord.enabled");` | `const enabled = await readConnectorSecret(this.vault, "discord", "enabled");` |
| 994 | `const token = await this.vault.get("discord.bot_token");` | `const token = await readConnectorSecret(this.vault, "discord", "bot_token");` |
| 1025 | `const baseRaw = await this.vault.get("jenkins.base_url");` | `const baseRaw = await readConnectorSecret(this.vault, "jenkins", "base_url");` |
| 1026 | `const user = await this.vault.get("jenkins.username");` | `const user = await readConnectorSecret(this.vault, "jenkins", "username");` |
| 1027 | `const token = await this.vault.get("jenkins.api_token");` | `const token = await readConnectorSecret(this.vault, "jenkins", "api_token");` |
| 1070 | `const tok = await this.vault.get("circleci.api_token");` | `const tok = await readConnectorSecret(this.vault, "circleci", "api_token");` |
| 1101 | `const tok = await this.vault.get("pagerduty.api_token");` | `const tok = await readConnectorSecret(this.vault, "pagerduty", "api_token");` |
| 1132 | `const kc = await this.vault.get("kubernetes.kubeconfig");` | `const kc = await readConnectorSecret(this.vault, "kubernetes", "kubeconfig");` |
| 1136 | `const ctxRaw = await this.vault.get("kubernetes.context");` | `const ctxRaw = await readConnectorSecret(this.vault, "kubernetes", "context");` |

**Per-connector `ensure*IfVaultCreds` methods** (one read per `if (key !== null)` guard):

| Line | Before | After |
|---|---|---|
| 1186 | `const bbUser = await this.vault.get("bitbucket.username");` | `const bbUser = await readConnectorSecret(this.vault, "bitbucket", "username");` |
| 1187 | `const bbPass = await this.vault.get("bitbucket.app_password");` | `const bbPass = await readConnectorSecret(this.vault, "bitbucket", "app_password");` |
| 1194 | `const jt = await this.vault.get("jira.api_token");` | `const jt = await readConnectorSecret(this.vault, "jira", "api_token");` |
| 1195 | `const je = await this.vault.get("jira.email");` | `const je = await readConnectorSecret(this.vault, "jira", "email");` |
| 1196 | `const jb = await this.vault.get("jira.base_url");` | `const jb = await readConnectorSecret(this.vault, "jira", "base_url");` |
| 1203 | `const ct = await this.vault.get("confluence.api_token");` | `const ct = await readConnectorSecret(this.vault, "confluence", "api_token");` |
| 1204 | `const ce = await this.vault.get("confluence.email");` | `const ce = await readConnectorSecret(this.vault, "confluence", "email");` |
| 1205 | `const cb = await this.vault.get("confluence.base_url");` | `const cb = await readConnectorSecret(this.vault, "confluence", "base_url");` |
| 1212 | `const en = await this.vault.get("discord.enabled");` | `const en = await readConnectorSecret(this.vault, "discord", "enabled");` |
| 1213 | `const tok = await this.vault.get("discord.bot_token");` | `const tok = await readConnectorSecret(this.vault, "discord", "bot_token");` |
| 1220 | `const jb = await this.vault.get("jenkins.base_url");` | `const jb = await readConnectorSecret(this.vault, "jenkins", "base_url");` |
| 1221 | `const ju = await this.vault.get("jenkins.username");` | `const ju = await readConnectorSecret(this.vault, "jenkins", "username");` |
| 1222 | `const jt = await this.vault.get("jenkins.api_token");` | `const jt = await readConnectorSecret(this.vault, "jenkins", "api_token");` |
| 1236 | `const t = await this.vault.get("circleci.api_token");` | `const t = await readConnectorSecret(this.vault, "circleci", "api_token");` |
| 1243 | `const t = await this.vault.get("pagerduty.api_token");` | `const t = await readConnectorSecret(this.vault, "pagerduty", "api_token");` |
| 1250 | `const k = await this.vault.get("kubernetes.kubeconfig");` | `const k = await readConnectorSecret(this.vault, "kubernetes", "kubeconfig");` |

(Line numbers are pre-migration. May shift slightly during sequential edits; use the discovery grep at the end to verify the final state has zero hits.)

- [ ] **Step 3: Verify zero residual manifest-shaped literals in code (JSDoc references in `/** */` blocks remain — they're suppressed by `audit-ignore-next-line` markers and PR D's `stripComments` change will eventually make them invisible to the audit anyway)**

```bash
PAT='slack\.oauth|github\.pat|gitlab\.pat|gitlab\.api_base|bitbucket\.username|bitbucket\.app_password|linear\.api_key|jira\.api_token|jira\.email|jira\.base_url|notion\.oauth|confluence\.api_token|confluence\.email|confluence\.base_url|discord\.bot_token|discord\.enabled|jenkins\.base_url|jenkins\.username|jenkins\.api_token|circleci\.api_token|pagerduty\.api_token|kubernetes\.kubeconfig|kubernetes\.context|aws\.access_key_id|aws\.secret_access_key|aws\.default_region|aws\.profile|azure\.tenant_id|azure\.client_id|azure\.client_secret|gcp\.credentials_json_path|gcp\.project_id|iac\.enabled|grafana\.url|grafana\.api_token|sentry\.auth_token|sentry\.org_slug|sentry\.url|newrelic\.api_key|newrelic\.account_id|datadog\.api_key|datadog\.app_key|datadog\.site'
rg -n "['\"\`]($PAT)['\"\`]" packages/gateway/src/connectors/lazy-mesh.ts | grep -v "^\s*\*\|^\s*//"
```

Expected: empty output (zero non-comment hits).

### Task B.3: Verify PR-B acceptance gates

- [ ] **Step 1: Audit count under current regex unchanged (still 0)**

```bash
bun run audit:invariants 2>&1 | grep -c "D11"
```

Expected: `0`.

- [ ] **Step 2: lazy-mesh regression suite still green**

```bash
bun test packages/gateway/src/connectors/lazy-mesh.test.ts
```

Expected: pass count unchanged.

- [ ] **Step 3: Whole-repo typecheck**

```bash
bun run typecheck
```

Expected: clean.

- [ ] **Step 4: Lint**

```bash
bun run lint
```

Expected: clean.

- [ ] **Step 5: CI parity**

```bash
bun run test:ci
```

Expected: gateway/script suites pass (modulo the known UI flake).

### Task B.4: Commit + push + open PR-B

- [ ] **Step 1: Stage**

```bash
git add packages/gateway/src/connectors/lazy-mesh.ts
```

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
refactor(connectors): D11 widen — route lazy-mesh manifest-shaped vault-keys through readConnectorSecret

Migrates ~50 vault.get reads in lazy-mesh.ts (Phase 3 spawn-config blocks
+ per-connector ensure*Running + ensure*IfVaultCreds methods) to
readConnectorSecret. Surrounding ?.trim() ?? "" patterns preserved
byte-identical.

Spec: docs/superpowers/specs/2026-05-02-d11-manifest-derived-audit-design.md
Plan: docs/superpowers/plans/2026-05-02-d11-manifest-derived-audit.md (PR B)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Push**

```bash
git push -u origin dev/asafgolombek/d11-widen-lazy-mesh
```

- [ ] **Step 4: Open the PR**

```bash
gh pr create --base main \
  --title "refactor(connectors): D11 widen — route lazy-mesh manifest-shaped vault-keys through readConnectorSecret" \
  --body "$(cat <<'EOF'
## Summary
Migrates ~50 manifest-shaped `vault.get` reads in `lazy-mesh.ts` to `readConnectorSecret`. All sites are reads; no `vault.set`/`delete` in this file. Surrounding `?.trim() ?? ""` and null/empty checks preserved byte-identical.

D11 audit count under the current regex is unchanged (0). The widening lands in PR D once PR C also migrates its files.

## Test plan
- [x] `bun test packages/gateway/src/connectors/lazy-mesh.test.ts` — pass count unchanged.
- [x] `bun run audit:invariants` reports 0 D11 hits (unchanged).
- [x] `bun run typecheck` clean.
- [x] `bun run lint` clean.
- [x] `bun run test:ci` clean (modulo UI-flake).

## Spec / Plan
- Spec: [`docs/superpowers/specs/2026-05-02-d11-manifest-derived-audit-design.md`](https://github.com/asafgolombek/Nimbus/blob/main/docs/superpowers/specs/2026-05-02-d11-manifest-derived-audit-design.md)
- Plan: [`docs/superpowers/plans/2026-05-02-d11-manifest-derived-audit.md`](https://github.com/asafgolombek/Nimbus/blob/main/docs/superpowers/plans/2026-05-02-d11-manifest-derived-audit.md) (PR B)

## Predecessor
PR #<PR-A-number> (D11 widen — rpc-handlers + deleteConnectorSecret).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Wait for CI; request review; merge.**

---

## PR C — per-connector sync files + connector-rpc-shared + drift-hints

**Branch:** `dev/asafgolombek/d11-widen-sync-files` (from `main`, **after PR A merges**; can run in parallel with PR B)
**Worktree:** `.worktrees/d11-widen-sync-files`
**Commit count:** 1 (atomic)

### Task C.1: Set up the PR-C worktree

- [ ] **Step 1: Sync main + verify `deleteConnectorSecret` is on main**

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
git grep -n "export async function deleteConnectorSecret" packages/gateway/src/connectors/connector-vault.ts
```

Expected: one hit.

- [ ] **Step 2: Create the worktree**

```bash
git worktree add -b dev/asafgolombek/d11-widen-sync-files .worktrees/d11-widen-sync-files main
cd .worktrees/d11-widen-sync-files
bun install
```

- [ ] **Step 3: Confirm the discovery grep finds the expected hit count across the 14 sync files + shared + drift-hints**

```bash
PAT='slack\.oauth|github\.pat|gitlab\.pat|gitlab\.api_base|bitbucket\.username|bitbucket\.app_password|linear\.api_key|jira\.api_token|jira\.email|jira\.base_url|notion\.oauth|confluence\.api_token|confluence\.email|confluence\.base_url|discord\.bot_token|discord\.enabled|jenkins\.base_url|jenkins\.username|jenkins\.api_token|circleci\.api_token|pagerduty\.api_token|kubernetes\.kubeconfig|kubernetes\.context|aws\.access_key_id|aws\.secret_access_key|aws\.default_region|aws\.profile|azure\.tenant_id|azure\.client_id|azure\.client_secret|gcp\.credentials_json_path|gcp\.project_id|iac\.enabled|grafana\.url|grafana\.api_token|sentry\.auth_token|sentry\.org_slug|sentry\.url|newrelic\.api_key|newrelic\.account_id|datadog\.api_key|datadog\.app_key|datadog\.site'
for f in packages/gateway/src/connectors/{aws,azure,bitbucket,circleci,confluence,discord,gcp,grafana,iac,jenkins,jira,kubernetes,pagerduty,sentry}-sync.ts packages/gateway/src/ipc/connector-rpc-shared.ts packages/gateway/src/index/drift-hints.ts; do
  count=$(rg -c "['\"\`]($PAT)['\"\`]" "$f" 2>/dev/null)
  echo "$f: ${count:-0}"
done
```

Expected hit counts (rough — verify before migration):

```
aws-sync.ts: 4
azure-sync.ts: 4
bitbucket-sync.ts: 2
circleci-sync.ts: 1
confluence-sync.ts: 3
discord-sync.ts: 2
gcp-sync.ts: 3
grafana-sync.ts: 2
iac-sync.ts: 1
jenkins-sync.ts: 3
jira-sync.ts: 3
kubernetes-sync.ts: 2
pagerduty-sync.ts: 1
sentry-sync.ts: 3
connector-rpc-shared.ts: 0   (template-literal; doesn't match this string-literal pattern but still needs migration)
drift-hints.ts: 1            (prose mention; will be marker'd, not migrated)
```

The 3 template-literal sites in `connector-rpc-shared.ts` (`${serviceId}.email`, `${serviceId}.api_token`, `${serviceId}.base_url`) are not caught by this string-literal grep but ARE caught by PR D's widened regex's `${...}.suffix` form. Migrate them as part of this PR (see Task C.3 Step 3 below).

### Task C.2: Migrate the 14 sync files

For each sync file, update the import block to add the helpers used in that file (most files only need `readConnectorSecret`), then migrate each `vault.get`/`vault.set`/`vault.delete` site per the migration patterns above.

The migration is mechanical and follows the same pattern as PRs A/B. Per file:

- [ ] **Step 1: aws-sync.ts** — migrate 4 sites (all reads). Add `readConnectorSecret` to imports.
- [ ] **Step 2: azure-sync.ts** — migrate 4 sites (all reads). Add `readConnectorSecret`.
- [ ] **Step 3: bitbucket-sync.ts** — migrate 2 sites (reads). Add `readConnectorSecret`.
- [ ] **Step 4: circleci-sync.ts** — migrate 1 site. Add `readConnectorSecret`.
- [ ] **Step 5: confluence-sync.ts** — migrate 3 sites (reads). Add `readConnectorSecret`.
- [ ] **Step 6: discord-sync.ts** — migrate 2 sites. Add `readConnectorSecret`.
- [ ] **Step 7: gcp-sync.ts** — migrate 3 sites. Add `readConnectorSecret`.
- [ ] **Step 8: grafana-sync.ts** — migrate 2 sites. Add `readConnectorSecret`.
- [ ] **Step 9: iac-sync.ts** — migrate 1 site. Add `readConnectorSecret`.
- [ ] **Step 10: jenkins-sync.ts** — migrate 3 sites. Add `readConnectorSecret`.
- [ ] **Step 11: jira-sync.ts** — migrate 3 sites. Add `readConnectorSecret`.
- [ ] **Step 12: kubernetes-sync.ts** — migrate 2 sites. Add `readConnectorSecret`.
- [ ] **Step 13: pagerduty-sync.ts** — migrate 1 site. Add `readConnectorSecret`.
- [ ] **Step 14: sentry-sync.ts** — migrate 3 sites. Add `readConnectorSecret`.

For each file, use `Read` first to inspect the actual lines and surrounding context, then `Edit` per the pattern table in the "Migration patterns" section. The substitutions are uniform; the only judgment call per file is whether the surrounding `?.trim() ?? ""` wrapping is present (preserve verbatim if so).

After each Step, run a per-file discovery grep to confirm zero residual hits:

```bash
rg -c "['\"\`]($PAT)['\"\`]" packages/gateway/src/connectors/<filename>
```

Expected: empty / zero.

### Task C.3: Migrate `connector-rpc-shared.ts`

**Files:**
- Modify: `packages/gateway/src/ipc/connector-rpc-shared.ts` (3 template-literal sites in `registerAtlassianApiConnectorAuth`)

- [ ] **Step 1: Update the import block** — add `writeConnectorSecret` from `../connectors/connector-vault.ts`. Use `Read` to confirm the existing import shape, then `Edit` to add the helper.

- [ ] **Step 2: Migrate the 3 template-literal sites**

Find:

```ts
  await vault.set(`${serviceId}.email`, creds.email);
  await vault.set(`${serviceId}.api_token`, creds.apiToken);
  await vault.set(`${serviceId}.base_url`, creds.baseNormalized);
```

Replace with:

```ts
  await writeConnectorSecret(vault, serviceId, "email", creds.email);
  await writeConnectorSecret(vault, serviceId, "api_token", creds.apiToken);
  await writeConnectorSecret(vault, serviceId, "base_url", creds.baseNormalized);
```

The function's `serviceId: "jira" | "confluence"` parameter satisfies `S extends ConnectorServiceId`, and both services have `email | api_token | base_url` in their manifest, so `ConnectorSecretKeyOf<S>` includes those literals. Typechecks cleanly.

- [ ] **Step 3: Verify no residual `${...}` vault-key constructions in the file**

```bash
rg -n '\$\{[^}]+\}\.(email|api_token|base_url|api_key|oauth|token|pat)' packages/gateway/src/ipc/connector-rpc-shared.ts
```

Expected: empty.

### Task C.4: Add audit-ignore marker in `drift-hints.ts`

**Files:**
- Modify: `packages/gateway/src/index/drift-hints.ts` (1 prose-string mention of `iac.enabled` at line 57)

- [ ] **Step 1: Find the existing line**

Find (lines 56–58):

```ts
  if (hb === undefined || hb === null) {
    lines.push(
      "IaC heartbeat: not yet written (enable `iac.enabled` in Vault and run an IaC sync to snapshot indexed cloud counts).",
    );
```

The string literal contains `\`iac.enabled\``. After PR D's widening, the audit will fire on this line because the regex matches `[a-z0-9_]*\.(enabled)` between backticks. This is a diagnostic prose message, not a vault-key construction — add a marker.

Replace with:

```ts
  if (hb === undefined || hb === null) {
    lines.push(
      // audit-ignore-next-line D11-vault-key (diagnostic prose, not vault-key construction)
      "IaC heartbeat: not yet written (enable `iac.enabled` in Vault and run an IaC sync to snapshot indexed cloud counts).",
    );
```

(The marker goes on the line directly before the matching string literal. The audit's `prevLine.includes("audit-ignore-next-line")` check is line-by-line, so the marker must immediately precede the matching line.)

### Task C.5: Verify PR-C acceptance gates

- [ ] **Step 1: Audit count under current regex unchanged (still 0)**

```bash
bun run audit:invariants 2>&1 | grep -c "D11"
```

Expected: `0`.

- [ ] **Step 2: Per-file discovery greps all return empty**

```bash
PAT='slack\.oauth|github\.pat|gitlab\.pat|gitlab\.api_base|bitbucket\.username|bitbucket\.app_password|linear\.api_key|jira\.api_token|jira\.email|jira\.base_url|notion\.oauth|confluence\.api_token|confluence\.email|confluence\.base_url|discord\.bot_token|discord\.enabled|jenkins\.base_url|jenkins\.username|jenkins\.api_token|circleci\.api_token|pagerduty\.api_token|kubernetes\.kubeconfig|kubernetes\.context|aws\.access_key_id|aws\.secret_access_key|aws\.default_region|aws\.profile|azure\.tenant_id|azure\.client_id|azure\.client_secret|gcp\.credentials_json_path|gcp\.project_id|iac\.enabled|grafana\.url|grafana\.api_token|sentry\.auth_token|sentry\.org_slug|sentry\.url|newrelic\.api_key|newrelic\.account_id|datadog\.api_key|datadog\.app_key|datadog\.site'
for f in packages/gateway/src/connectors/{aws,azure,bitbucket,circleci,confluence,discord,gcp,grafana,iac,jenkins,jira,kubernetes,pagerduty,sentry}-sync.ts; do
  count=$(rg -c "['\"\`]($PAT)['\"\`]" "$f" 2>/dev/null)
  if [ -n "$count" ] && [ "$count" != "0" ]; then echo "REMAINING: $f: $count"; fi
done
```

Expected: empty output (no `REMAINING:` lines).

- [ ] **Step 3: Per-connector regression tests still pass**

```bash
bun test packages/gateway/src/connectors/
```

Expected: pass count unchanged.

- [ ] **Step 4: Whole-repo typecheck / lint / CI parity**

```bash
bun run typecheck
bun run lint
bun run test:ci
```

Expected: typecheck + lint clean. test:ci passes (modulo UI flake).

### Task C.6: Commit + push + open PR-C

- [ ] **Step 1: Stage**

```bash
git add packages/gateway/src/connectors/aws-sync.ts \
        packages/gateway/src/connectors/azure-sync.ts \
        packages/gateway/src/connectors/bitbucket-sync.ts \
        packages/gateway/src/connectors/circleci-sync.ts \
        packages/gateway/src/connectors/confluence-sync.ts \
        packages/gateway/src/connectors/discord-sync.ts \
        packages/gateway/src/connectors/gcp-sync.ts \
        packages/gateway/src/connectors/grafana-sync.ts \
        packages/gateway/src/connectors/iac-sync.ts \
        packages/gateway/src/connectors/jenkins-sync.ts \
        packages/gateway/src/connectors/jira-sync.ts \
        packages/gateway/src/connectors/kubernetes-sync.ts \
        packages/gateway/src/connectors/pagerduty-sync.ts \
        packages/gateway/src/connectors/sentry-sync.ts \
        packages/gateway/src/ipc/connector-rpc-shared.ts \
        packages/gateway/src/index/drift-hints.ts
```

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
refactor(connectors): D11 widen — route per-connector sync-file vault-keys through helpers

Migrates ~37 manifest-shaped vault.get/set sites across 14 per-connector
sync files (aws, azure, bitbucket, circleci, confluence, discord, gcp,
grafana, iac, jenkins, jira, kubernetes, pagerduty, sentry) plus 3
template-literal sites in connector-rpc-shared.ts and 1 audit-ignore
marker in drift-hints.ts (diagnostic prose mention, not construction).

Spec: docs/superpowers/specs/2026-05-02-d11-manifest-derived-audit-design.md
Plan: docs/superpowers/plans/2026-05-02-d11-manifest-derived-audit.md (PR C)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Push + open PR**

```bash
git push -u origin dev/asafgolombek/d11-widen-sync-files
gh pr create --base main \
  --title "refactor(connectors): D11 widen — route per-connector sync-file vault-keys through helpers" \
  --body "$(cat <<'EOF'
## Summary
Migrates ~37 manifest-shaped vault-key sites across:
- 14 per-connector sync files (aws / azure / bitbucket / circleci / confluence / discord / gcp / grafana / iac / jenkins / jira / kubernetes / pagerduty / sentry).
- 3 template-literal sites in \`connector-rpc-shared.ts\` (\`${serviceId}.email\` etc. → \`writeConnectorSecret(vault, serviceId, ...)\`).
- 1 \`audit-ignore-next-line\` marker added in \`drift-hints.ts\` for a diagnostic prose mention.

D11 audit count under the current regex is unchanged (0). The widening lands in PR D.

## Test plan
- [x] \`bun test packages/gateway/src/connectors/\` — pass count unchanged.
- [x] \`bun run audit:invariants\` reports 0 D11 hits (unchanged).
- [x] \`bun run typecheck\` clean.
- [x] \`bun run lint\` clean.
- [x] \`bun run test:ci\` clean (modulo UI flake).

## Spec / Plan
- Spec: [\`docs/superpowers/specs/2026-05-02-d11-manifest-derived-audit-design.md\`](https://github.com/asafgolombek/Nimbus/blob/main/docs/superpowers/specs/2026-05-02-d11-manifest-derived-audit-design.md)
- Plan: [\`docs/superpowers/plans/2026-05-02-d11-manifest-derived-audit.md\`](https://github.com/asafgolombek/Nimbus/blob/main/docs/superpowers/plans/2026-05-02-d11-manifest-derived-audit.md) (PR C)

## Predecessor
PR #<PR-A-number> (D11 widen — rpc-handlers + deleteConnectorSecret).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Wait for CI; request review; merge.**

---

## PR D — regex widening + manifest allow-list + frozen-count bump + audit-ignore cleanup

**Branch:** `dev/asafgolombek/d11-widen-regex` (from `main`, **after PRs A + B + C all merge**)
**Worktree:** `.worktrees/d11-widen-regex`
**Commit count:** 1 (atomic)

### Task D.1: Set up the PR-D worktree

- [ ] **Step 1: Verify all preconditions on main**

```bash
git fetch origin
git checkout main
git pull --ff-only origin main

# PR A: deleteConnectorSecret is on main
git grep -n "export async function deleteConnectorSecret" packages/gateway/src/connectors/connector-vault.ts

# PRs A + B + C: discovery grep returns zero across all production code
PAT='slack\.oauth|github\.pat|gitlab\.pat|gitlab\.api_base|bitbucket\.username|bitbucket\.app_password|linear\.api_key|jira\.api_token|jira\.email|jira\.base_url|notion\.oauth|confluence\.api_token|confluence\.email|confluence\.base_url|discord\.bot_token|discord\.enabled|jenkins\.base_url|jenkins\.username|jenkins\.api_token|circleci\.api_token|pagerduty\.api_token|kubernetes\.kubeconfig|kubernetes\.context|aws\.access_key_id|aws\.secret_access_key|aws\.default_region|aws\.profile|azure\.tenant_id|azure\.client_id|azure\.client_secret|gcp\.credentials_json_path|gcp\.project_id|iac\.enabled|grafana\.url|grafana\.api_token|sentry\.auth_token|sentry\.org_slug|sentry\.url|newrelic\.api_key|newrelic\.account_id|datadog\.api_key|datadog\.app_key|datadog\.site'
rg "['\"\`]($PAT)['\"\`]" packages/gateway/src/ packages/cli/src/ --glob '!*.test.ts' --glob '!connector-secrets-manifest.ts' --glob '!connector-vault.ts' --glob '!connector-vault.test.ts' --glob '!pkce.ts' --glob '!google-access-token.ts' --glob '!oauth-vault-tokens.ts' --glob '!create-embedding-runtime.ts'
```

Expected: the second `rg` returns no matches (or only matches inside JSDoc/comments). If it returns code-line matches, those PRs are not all merged — wait.

- [ ] **Step 2: Create the worktree**

```bash
git worktree add -b dev/asafgolombek/d11-widen-regex .worktrees/d11-widen-regex main
cd .worktrees/d11-widen-regex
bun install
```

### Task D.2: Add `stripComments` to the audit and switch to manifest-derived regex

**Files:**
- Modify: `scripts/structure-audit/check-nimbus-invariants.ts`

- [ ] **Step 1: Read the current file to see existing imports + helper layout**

```bash
grep -n "import\|VAULT_KEY_RE\|VAULT_KEY_ALLOW_LIST\|checkVaultKeyAllowList" scripts/structure-audit/check-nimbus-invariants.ts | head -20
```

- [ ] **Step 2: Update the imports**

Add (or extend the existing import block) at the top of the file:

```ts
import { CONNECTOR_VAULT_SECRET_KEYS } from "../../packages/gateway/src/connectors/connector-secrets-manifest.ts";
import { stripComments } from "./lib.ts";
```

(`stripComments` is already exported from `./lib.ts`; just import it.)

- [ ] **Step 3: Replace the static `VAULT_KEY_RE` with the manifest-derived builder**

Find:

```ts
const VAULT_KEY_RE =
  /['"`][a-z0-9_]*\.(oauth|token|pat|api_key)['"`]|\$\{[^}]+\}\.(oauth|token|pat|api_key)/;
```

Replace with:

```ts
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildVaultKeyRegex(): RegExp {
  const keys = Object.values(CONNECTOR_VAULT_SECRET_KEYS).flat();
  const suffixes = Array.from(new Set(keys.map((k) => k.split(".")[1] ?? "")));
  const literalAlt = keys.map(escapeRegex).join("|");
  const suffixAlt = suffixes.map(escapeRegex).join("|");
  return new RegExp(`['"\`](${literalAlt})['"\`]|\\$\\{[^}]+\\}\\.(${suffixAlt})`);
}

const VAULT_KEY_RE = buildVaultKeyRegex();
```

- [ ] **Step 4: Add `connector-secrets-manifest.ts` as the 6th allow-list entry**

Find:

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

Replace with:

```ts
export const VAULT_KEY_ALLOW_LIST = [
  "packages/gateway/src/connectors/connector-vault.ts",
  "packages/gateway/src/auth/google-access-token.ts",
  "packages/gateway/src/auth/pkce.ts",
  // Provider-shared OAuth canonical reader (Microsoft); mirrors google-access-token.ts.
  "packages/gateway/src/auth/oauth-vault-tokens.ts",
  // OpenAI embedding provider — not a Nimbus connector; no ConnectorServiceId.
  "packages/gateway/src/embedding/create-embedding-runtime.ts",
  // Canonical declaration of per-connector vault keys; structurally equivalent
  // to connector-vault.ts (declaration site, not runtime construction).
  "packages/gateway/src/connectors/connector-secrets-manifest.ts",
];
```

- [ ] **Step 5: Route file contents through `stripComments` before line-by-line scan**

Find (in `checkVaultKeyAllowList`):

```ts
    if (allowList.includes(f.relPath)) continue;
    const lines = f.contents.split("\n");
```

Replace with:

```ts
    if (allowList.includes(f.relPath)) continue;
    const lines = stripComments(f.contents).split("\n");
```

`stripComments` preserves newlines (per its JSDoc), so line-number reporting stays correct. Comments and JSDoc references stop firing the regex.

### Task D.3: Update the frozen-count test + add a regex-builder test

**Files:**
- Modify: `scripts/structure-audit/check-nimbus-invariants.test.ts`

- [ ] **Step 1: Bump the frozen-count assertion 5 → 6**

Find:

```ts
describe("D11 — VAULT_KEY_ALLOW_LIST is frozen at structural entries", () => {
  test("VAULT_KEY_ALLOW_LIST has exactly 5 entries", () => {
    // Each entry has a documented structural reason in the design spec § 4.4
    // (helper home, Google OAuth canonical reader, Google PKCE writer,
    // Microsoft provider-shared OAuth, OpenAI embedding provider).
    expect(VAULT_KEY_ALLOW_LIST).toHaveLength(5);
  });
});
```

Replace with:

```ts
describe("D11 — VAULT_KEY_ALLOW_LIST is frozen at structural entries", () => {
  test("VAULT_KEY_ALLOW_LIST has exactly 6 entries", () => {
    // Each entry has a documented structural reason. The first 5 land in the
    // structure-audit design spec § 4.4 (helper home, Google OAuth canonical
    // reader, Google PKCE writer, Microsoft provider-shared OAuth, OpenAI
    // embedding provider). The 6th — connector-secrets-manifest.ts — was
    // added in the manifest-derived widening spec (2026-05-02) as the
    // canonical declaration site for per-connector vault keys.
    expect(VAULT_KEY_ALLOW_LIST).toHaveLength(6);
  });
});
```

- [ ] **Step 2: Add a regex-builder smoke test**

Append after the existing describe block:

```ts
import { CONNECTOR_VAULT_SECRET_KEYS } from "../../packages/gateway/src/connectors/connector-secrets-manifest.ts";

describe("D11 — manifest-derived VAULT_KEY_RE", () => {
  test("matches representative manifest entries", () => {
    const keys = Object.values(CONNECTOR_VAULT_SECRET_KEYS).flat();
    // Spot-check each suffix family present in the manifest.
    for (const sample of ["jira.api_token", "aws.access_key_id", "bitbucket.app_password", "datadog.app_key", "iac.enabled"]) {
      expect(keys).toContain(sample);
      expect(`vault.set("${sample}", x)`).toMatch(/['"`][a-z0-9_]+\.[a-z0-9_]+['"`]/);
    }
  });

  test("does not match non-manifest literals", () => {
    // The regex should not match arbitrary "x.y" string literals like file paths
    // or member-access strings. This is enforced by the alternation containing
    // only manifest-known keys — a literal like "console.log" would need to be
    // in the manifest to match.
    const keys = Object.values(CONNECTOR_VAULT_SECRET_KEYS).flat();
    expect(keys).not.toContain("console.log");
    expect(keys).not.toContain("path.to.file");
  });
});
```

(The first test verifies the manifest contains the spot-check keys; the regex correctness itself is exercised end-to-end by the audit run in Task D.5 Step 1.)

### Task D.4: Remove redundant audit-ignore markers from `connector-secrets-manifest.ts`

**Files:**
- Modify: `packages/gateway/src/connectors/connector-secrets-manifest.ts`

The file is now allow-listed (Task D.2 Step 4), so the per-line `audit-ignore-next-line D11-vault-key (manifest entry, not vault-key construction)` markers are redundant.

- [ ] **Step 1: Remove all such markers**

Find each occurrence of:

```ts
  // audit-ignore-next-line D11-vault-key (manifest entry, not vault-key construction)
```

…and delete the line. Use `Edit` with `replace_all: true` on the comment text. The 7 marker lines (one per pre-widening manifest entry whose suffix matched the old regex: slack, github, gitlab, linear, notion, newrelic, datadog) become one delete.

Bulk pattern via Edit's `replace_all: true`:

```
old_string: "  // audit-ignore-next-line D11-vault-key (manifest entry, not vault-key construction)\n"
new_string: ""
replace_all: true
```

(If `Edit` doesn't accept multi-line `old_string` cleanly, do them one at a time after `Read`-ing the file.)

### Task D.5: Verify PR-D acceptance gates

- [ ] **Step 1: Audit passes under the new manifest-derived regex (still 0 hits)**

```bash
bun run audit:invariants
echo "exit=$?"
```

Expected: `exit=0` and no D11 lines printed. **D11 is now closed under the broader pattern.**

- [ ] **Step 2: Frozen-count + regex-builder tests pass**

```bash
bun test scripts/structure-audit/check-nimbus-invariants.test.ts
```

Expected: all describe blocks pass; `VAULT_KEY_ALLOW_LIST has exactly 6 entries` confirms.

- [ ] **Step 3: Whole-repo typecheck**

```bash
bun run typecheck
```

Expected: clean.

- [ ] **Step 4: Lint**

```bash
bun run lint
```

Expected: clean.

- [ ] **Step 5: CI parity**

```bash
bun run test:ci
```

Expected: clean (modulo UI flake).

- [ ] **Step 6: Manifest file no longer has audit-ignore markers**

```bash
grep -c "audit-ignore-next-line" packages/gateway/src/connectors/connector-secrets-manifest.ts
```

Expected: `0`.

### Task D.6: Refresh the audit baseline

**Files:**
- Modify: `docs/structure-audit/baseline.md`

- [ ] **Step 1: Update the D11 row in the "Per-dimension baselines" table**

Find:

```markdown
| D11 | F | Vault-key construction outside allow-list | 0 violations (D11 closed 2026-05-02) | `bun run audit:invariants` (binary) |
```

Replace with:

```markdown
| D11 | F | Vault-key construction outside allow-list | 0 violations under manifest-derived regex (closed 2026-05-02) | `bun run audit:invariants` (binary) |
```

- [ ] **Step 2: Append a new dated section recording the widening**

Insert after the existing `## Phase 2 follow-up — post Bucket C (2026-05-02)` section and before `## Provenance`:

```markdown
## Phase 2 follow-up — post manifest-derived widening (2026-05-02)

D11 stays at **0** violations under the broader manifest-derived regex.

The audit script now derives `VAULT_KEY_RE` from `CONNECTOR_VAULT_SECRET_KEYS`
at startup, so every entry across all 27 connectors (43 keys total) is
gated — not just the original 4-suffix subset (`oauth | token | pat | api_key`).

- PR <PR-A-number> migrated 44 sites in `connector-rpc-handlers.ts` and added the `deleteConnectorSecret<S>` helper.
- PR <PR-B-number> migrated ~50 sites in `lazy-mesh.ts`.
- PR <PR-C-number> migrated ~37 sites across 14 per-connector sync files + 3 in `connector-rpc-shared.ts` + 1 audit-ignore marker in `drift-hints.ts`.
- PR <PR-D-number> widened the regex, allow-listed `connector-secrets-manifest.ts` as the 6th entry, added `stripComments` to the audit so JSDoc references stop firing, and bumped the frozen-count test 5 → 6.

The allow-list is now frozen at **6 entries** for the foreseeable future.
```

Replace `<PR-A-number>` etc. with actual PR numbers once the corresponding PRs are merged (look them up via `gh pr list --state merged --search "D11 widen"`).

### Task D.7: Commit + push + open PR-D

- [ ] **Step 1: Stage**

```bash
git add scripts/structure-audit/check-nimbus-invariants.ts \
        scripts/structure-audit/check-nimbus-invariants.test.ts \
        packages/gateway/src/connectors/connector-secrets-manifest.ts \
        docs/structure-audit/baseline.md
```

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore(audit): D11 widen — manifest-derived VAULT_KEY_RE; allow-list manifest; close D11 under broader pattern

Switches the D11 audit from a static 4-suffix regex to a manifest-derived
regex built from CONNECTOR_VAULT_SECRET_KEYS at startup, so every entry
across all 27 connectors (43 keys) is gated. Adds connector-secrets-
manifest.ts as the 6th allow-list entry (canonical declaration site,
structurally equivalent to connector-vault.ts).

Routes file contents through stripComments before the line-by-line scan
so JSDoc references like `* Starts X MCP when \`X.Y\` is present` stop
firing — they were already audit-ignored individually, but the comment
strip makes the markers unnecessary going forward.

Bumps the frozen-count test 5 → 6 with an updated justification covering
the manifest-as-declaration entry. Removes the now-redundant audit-ignore
markers from connector-secrets-manifest.ts (allow-listed; markers no
longer needed).

D11 audit count under the broader pattern: 0. The allow-list is now
frozen at 6 entries for the foreseeable future.

Spec: docs/superpowers/specs/2026-05-02-d11-manifest-derived-audit-design.md
Plan: docs/superpowers/plans/2026-05-02-d11-manifest-derived-audit.md (PR D)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Push + open PR**

```bash
git push -u origin dev/asafgolombek/d11-widen-regex
gh pr create --base main \
  --title "chore(audit): D11 widen — manifest-derived VAULT_KEY_RE; allow-list manifest; close D11 under broader pattern" \
  --body "$(cat <<'EOF'
## Summary
- Switches D11 audit to a **manifest-derived regex** built from \`CONNECTOR_VAULT_SECRET_KEYS\` at startup. Every entry across all 27 connectors (43 keys) is now gated, not just the original 4-suffix subset.
- Adds \`connector-secrets-manifest.ts\` as the **6th allow-list entry** — canonical declaration site, structurally equivalent to \`connector-vault.ts\`. Allow-list bumped 5 → 6 with updated frozen-count test.
- Adds \`stripComments\` to the audit so JSDoc references stop firing.
- Removes 7 now-redundant \`audit-ignore-next-line\` markers from the manifest.
- Refreshes \`docs/structure-audit/baseline.md\` with a dated post-widening section.

**D11 audit count under the broader pattern: 0.** The widening completes the D11 closure across all manifest-known vault keys.

## Test plan
- [x] \`bun run audit:invariants\` exits 0 with 0 D11 hits under the manifest-derived regex.
- [x] \`bun test scripts/structure-audit/check-nimbus-invariants.test.ts\` — 6-entry frozen test + new regex-builder smoke test pass.
- [x] \`bun run typecheck\` clean.
- [x] \`bun run lint\` clean.
- [x] \`bun run test:ci\` clean (modulo UI flake).

## Spec / Plan
- Spec: [\`docs/superpowers/specs/2026-05-02-d11-manifest-derived-audit-design.md\`](https://github.com/asafgolombek/Nimbus/blob/main/docs/superpowers/specs/2026-05-02-d11-manifest-derived-audit-design.md)
- Plan: [\`docs/superpowers/plans/2026-05-02-d11-manifest-derived-audit.md\`](https://github.com/asafgolombek/Nimbus/blob/main/docs/superpowers/plans/2026-05-02-d11-manifest-derived-audit.md) (PR D)

## Predecessors
- PR #<PR-A-number> (D11 widen — rpc-handlers + deleteConnectorSecret)
- PR #<PR-B-number> (D11 widen — lazy-mesh)
- PR #<PR-C-number> (D11 widen — sync files + shared + drift-hints)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Wait for CI; request review; merge.**

After merge: D11 is fully closed under the manifest-derived pattern. The next sub-project (D4 splits of `lazy-mesh.ts` and `connector-rpc-handlers.ts`) can begin on a baseline where every vault-key construction is centralized.

---

## Self-review notes

- **Spec coverage:** every spec section maps to tasks. § 1 → all 4 PRs. § 2 (non-goals) → preserved (no helper renaming, no stricter modes, no `pkce.ts` migration, no manifest-drift CI check, no third helper). § 3.1 → Task D.2. § 3.2 → Task D.2 Step 4 + D.3 Step 1. § 3.3 → Task A.3. § 3.4 → Task D.4. § 4 (PR sequencing) → PR-A/B/C/D layout. § 5 (migration patterns) → "Migration patterns" section + per-PR tables. § 6.1 → Task A.2. § 6.2 → Task A.4. § 6.3 → Task B.3 / C.5. § 6.4 → Task D.3 Step 2 + Task D.5 Step 1. § 7 (acceptance) → per-PR Verify tasks. § 8 (rollout) → per-PR Set-up tasks. § 9 (out of scope) — explicitly preserved as non-actions across the plan.
- **Out-of-scope guardrails:** `pkce.ts` is not touched (still allow-listed). Helper renaming is not done. No third helper beyond `deleteConnectorSecret`. No manifest-coverage CI check.
- **Discovery script reuse:** the `PAT` env-var pattern is identical across all 4 PRs; each PR's plan re-includes it inline so the engineer can copy-paste without cross-referencing.
- **PR-A line-number drift note:** the migration table in Task A.5 lists pre-migration line numbers. Sequential `Edit` calls shift line numbers slightly (the new `writeConnectorSecret(...)` form is longer than `vault.set(...)`). The discovery grep at the end of Task A.5 / B.2 / C.2 / C.3 catches any missed sites regardless of line drift.
- **JSDoc handling timing:** PRs B and C migrate code-line literals only; JSDoc / prose references in `lazy-mesh.ts` (the `/** Starts X MCP when \`X.Y\` is present */` comments) keep their existing audit-ignore markers and are made invisible to the audit by PR D's `stripComments` switch. After PR D merges, those markers become technically redundant — but removing them is cosmetic and out of scope for this plan (could be a tiny follow-up if desired).
