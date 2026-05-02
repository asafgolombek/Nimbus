# D11 Bucket C — `writeConnectorSecret` + `sharedOAuthKey`

**Date:** 2026-05-02
**Phase:** Phase 4 / B3 structure audit — Phase 2 follow-up (Bucket C)
**Source:** [`docs/structure-audit/missed.md`](../../structure-audit/missed.md) "D11 Bucket C" rows; [`docs/structure-audit/deferred-backlog.md`](../../structure-audit/deferred-backlog.md) "D11 — vault-key centralization (Bucket C)"
**Predecessor specs:**
- [`2026-04-30-structure-audit-design.md`](./2026-04-30-structure-audit-design.md)
- [`2026-05-01-d11-bucket-b-readConnectorSecret-design.md`](./2026-05-01-d11-bucket-b-readConnectorSecret-design.md)
**Predecessor PRs:** [#145](https://github.com/asafgolombek/Nimbus/pull/145) (Bucket B), [#146](https://github.com/asafgolombek/Nimbus/pull/146) (type pinning)

---

## 1 — Goal

Eliminate the remaining 21 D11 violations (Bucket C) in two PRs, closing D11 entirely.

**Pre-PR audit count (verified live with `bun run audit:invariants`):** 21 D11 violations, all in Bucket C.
- 12 sites in `packages/gateway/src/connectors/lazy-mesh.ts` — all reads.
- 9 sites in `packages/gateway/src/ipc/connector-rpc-handlers.ts` — 6 writes + 1 read + 2 sharedKey assignments.

**Post-PR-2 audit count target:** **0**. D11 closed.

After both PRs:
- All vault-key construction lives inside `connector-vault.ts` (entry #1 of the frozen 5-entry `VAULT_KEY_ALLOW_LIST`).
- Per-service reads + writes flow through typed `readConnectorSecret` / `writeConnectorSecret` helpers.
- Provider-shared OAuth keys flow through `sharedOAuthKey(provider)`.
- The frozen-count test stays green (no allow-list entries added).

## 2 — Non-goals

- **Widening `VAULT_KEY_RE` or making it manifest-derived.** Deferred to its own follow-up spec after Bucket C closes (per Bucket B spec § 9). The regex change has independent design dimensions (which key suffixes count as "secret"? manifest-derived vs. enumerated?) that warrant a separate brainstorm. Bundling here would risk re-firing on Bucket C lines mid-implementation.
- **No new allow-list entries.** The frozen 5-entry list stays at 5; the Task-3 length-assertion test stays green throughout.
- **No `readSharedOAuth(vault, provider)` / `writeSharedOAuth(vault, provider, value)` wrappers.** Just `sharedOAuthKey(provider)` — callers compose with `vault.get` / `vault.set` directly. The wrapper-helper variant would be one-line passthroughs to those expressions; YAGNI.
- **No change to `vault.delete` semantics, the `CONNECTOR_VAULT_SECRET_KEYS` manifest shape, or any caller's surrounding null/empty/trim guard logic.**
- **No structural refactor of `lazy-mesh.ts` or `connector-rpc-handlers.ts`.** Both are large hot files (1408 / 1103 LOC) flagged for D4 split. Targeted Bucket C migration only; the splits are separate refactor candidates tracked in `deferred-backlog.md`.

## 3 — PR 1: lazy-mesh reads

### 3.1 New export from `connector-vault.ts`

```ts
export type SharedOAuthProvider = "google" | "microsoft";

/**
 * Returns the provider-shared OAuth vault key (`google.oauth` or `microsoft.oauth`).
 * Used when the caller is operating on the provider-wide token rather than
 * a per-service token. The literal lives inside this allow-listed file,
 * so D11 doesn't fire at the call site.
 */
export function sharedOAuthKey(
  provider: SharedOAuthProvider,
): `${SharedOAuthProvider}.oauth` {
  return `${provider}.oauth`;
}
```

Returns the literal union `` `${SharedOAuthProvider}.oauth` `` (i.e. `"google.oauth" | "microsoft.oauth"`) — TypeScript's template-literal inference resolves the body's `` `${provider}.oauth` `` to that exact union. The narrower return type matches the pattern set by `readConnectorSecret`/`writeConnectorSecret` (helpers return what their underlying op produces) and is implicitly assignable to `string` at the `vault.get`/`vault.set` boundary, so no widening cast is required at any call site.

### 3.2 Two new typed methods on `LazyMcpMesh`

The existing private method:

```ts
private async ensureIfVaultKeyNonEmpty(key: string, runner: () => Promise<void>): Promise<void> {
  const value = await this.vault.get(key);
  if (value !== null && value !== "") await runner();
}
```

…is removed and replaced by two typed methods:

```ts
private async ensureIfConnectorSecretSet<S extends ConnectorServiceId>(
  serviceId: S,
  keyName: ConnectorSecretKeyOf<S>,
  runner: () => Promise<void>,
): Promise<void> {
  const value = await readConnectorSecret(this.vault, serviceId, keyName);
  if (value !== null && value !== "") await runner();
}

private async ensureIfProviderOAuthSet(
  provider: SharedOAuthProvider,
  runner: () => Promise<void>,
): Promise<void> {
  const value = await this.vault.get(sharedOAuthKey(provider));
  if (value !== null && value !== "") await runner();
}
```

Implementer must `git grep ensureIfVaultKeyNonEmpty -- packages/` before deletion to confirm the 6 call sites in §3.3 are the only callers.

### 3.3 Migration table (12 sites in `lazy-mesh.ts`)

| Lines | Before | After |
|---|---|---|
| 488 | `(await this.vault.get("newrelic.api_key"))?.trim() ?? ""` | `(await readConnectorSecret(this.vault, "newrelic", "api_key"))?.trim() ?? ""` |
| 502 | `(await this.vault.get("datadog.api_key"))?.trim() ?? ""` | `(await readConnectorSecret(this.vault, "datadog", "api_key"))?.trim() ?? ""` |
| 677 | `await this.vault.get("github.pat")` | `await readConnectorSecret(this.vault, "github", "pat")` |
| 714 | `await this.vault.get("gitlab.pat")` | `await readConnectorSecret(this.vault, "gitlab", "pat")` |
| 826 | `await this.vault.get("linear.api_key")` | `await readConnectorSecret(this.vault, "linear", "api_key")` |
| 902 | `await this.vault.get("notion.oauth")` | `await readConnectorSecret(this.vault, "notion", "oauth")` |
| 1238 | `this.ensureIfVaultKeyNonEmpty("microsoft.oauth", () => …)` | `this.ensureIfProviderOAuthSet("microsoft", () => …)` |
| 1241 | `this.ensureIfVaultKeyNonEmpty("github.pat", () => this.ensureGithubRunning())` | `this.ensureIfConnectorSecretSet("github", "pat", () => this.ensureGithubRunning())` |
| 1242 | `this.ensureIfVaultKeyNonEmpty("gitlab.pat", …)` | `this.ensureIfConnectorSecretSet("gitlab", "pat", …)` |
| 1244 | `this.ensureIfVaultKeyNonEmpty("slack.oauth", …)` | `this.ensureIfConnectorSecretSet("slack", "oauth", …)` |
| 1245 | `this.ensureIfVaultKeyNonEmpty("linear.api_key", …)` | `this.ensureIfConnectorSecretSet("linear", "api_key", …)` |
| 1247 | `this.ensureIfVaultKeyNonEmpty("notion.oauth", …)` | `this.ensureIfConnectorSecretSet("notion", "oauth", …)` |

Surrounding `(await ...)?.trim() ?? ""` parenthesisation, null/empty checks, and call-runner control flow stay byte-identical.

### 3.4 Imports in `lazy-mesh.ts`

```ts
import { readConnectorSecret, sharedOAuthKey } from "./connector-vault.ts";
```

Plus the type import for the new method signatures (may already exist):

```ts
import type { ConnectorSecretKeyOf } from "./connector-vault.ts";
import type { ConnectorServiceId } from "./connector-catalog.ts";
```

Verify the existing imports during implementation; only add what's missing.

### 3.5 Single PR-1 commit

All 12 sites + the two new methods + the helper-method removal land in one commit so HEAD stays green.

**Post-PR-1 D11 count:** 21 − 12 = **9** (rpc-handlers only).

## 4 — PR 2: rpc-handlers writes

### 4.1 New export from `connector-vault.ts`

```ts
/**
 * Writes a connector's secret to the Vault by structural key name.
 * Mirrors `readConnectorSecret`'s typing — `keyName` is constrained to
 * `ConnectorSecretKeyOf<S>`, so misspelled or non-manifested keys fail
 * at compile time. Returns `void` (mirrors `vault.set`).
 */
export async function writeConnectorSecret<S extends ConnectorServiceId>(
  vault: NimbusVault,
  serviceId: S,
  keyName: ConnectorSecretKeyOf<S>,
  value: string,
): Promise<void> {
  const fullKey = `${serviceId}.${keyName}`;
  return vault.set(fullKey, value);
}
```

`sharedOAuthKey` is reused from PR 1.

### 4.2 Migration table (9 sites in `connector-rpc-handlers.ts`)

| Line | Before | After |
|---|---|---|
| 365 | `return await vault.get("microsoft.oauth")` | `return await vault.get(sharedOAuthKey("microsoft"))` |
| 401 | `await vault.set("microsoft.oauth", microsoftOAuthBackup)` | `await vault.set(sharedOAuthKey("microsoft"), microsoftOAuthBackup)` |
| 510 | `await vault.set("github.pat", token)` | `await writeConnectorSecret(vault, "github", "pat", token)` |
| 529 | `await vault.set("gitlab.pat", token)` | `await writeConnectorSecret(vault, "gitlab", "pat", token)` |
| 551 | `await vault.set("linear.api_key", token)` | `await writeConnectorSecret(vault, "linear", "api_key", token)` |
| 809 | `await vault.set("newrelic.api_key", token)` | `await writeConnectorSecret(vault, "newrelic", "api_key", token)` |
| 837 | `await vault.set("datadog.api_key", api)` | `await writeConnectorSecret(vault, "datadog", "api_key", api)` |
| 1020 | `sharedKey = "google.oauth";` | `sharedKey = sharedOAuthKey("google");` |
| 1022 | `sharedKey = "microsoft.oauth";` | `sharedKey = sharedOAuthKey("microsoft");` |

### 4.3 Imports in `connector-rpc-handlers.ts`

```ts
import { sharedOAuthKey, writeConnectorSecret } from "../connectors/connector-vault.ts";
```

### 4.4 `sharedKey` variable type compatibility

Lines 1020/1022 assign to a local variable `sharedKey`, declared at line 1018 as `string | undefined` (verified by review). `sharedOAuthKey(...)` returns `"google.oauth" | "microsoft.oauth"`, which is assignable to `string | undefined` — no typecheck friction. No widening cast or local-type change required.

### 4.5 Single PR-2 commit

All 9 sites + `writeConnectorSecret` helper land in one commit.

**Post-PR-2 D11 count:** 9 − 9 = **0**. Bucket C closed.

## 5 — Tests

Add to `packages/gateway/src/connectors/connector-vault.test.ts` (which already covers `readConnectorSecret` + `ConnectorSecretKeyOf` pinning from PR #146).

### 5.1 PR 1: `sharedOAuthKey` (3 cases)

```ts
describe("sharedOAuthKey", () => {
  test("returns google.oauth for google", () => {
    expect(sharedOAuthKey("google")).toBe("google.oauth");
  });

  test("returns microsoft.oauth for microsoft", () => {
    expect(sharedOAuthKey("microsoft")).toBe("microsoft.oauth");
  });

  test("compile-time: rejects non-provider strings", () => {
    // @ts-expect-error — SharedOAuthProvider is "google" | "microsoft" only.
    void sharedOAuthKey("github");
    expect(true).toBe(true);
  });
});
```

### 5.2 PR 1: lazy-mesh regression check

The existing `packages/gateway/src/connectors/lazy-mesh.test.ts` suite must pass unchanged. The two new typed methods are private and exercised through the existing public test paths. No new direct unit tests for the methods themselves — adding them would be YAGNI given they each wrap a `vault.get` + null-check.

### 5.3 PR 2: `writeConnectorSecret` (5 cases)

```ts
describe("writeConnectorSecret", () => {
  test("writes the value under the constructed key", async () => {
    const vault = createMemoryVault();
    await writeConnectorSecret(vault, "github", "pat", "ghp_test");
    expect(await vault.get("github.pat")).toBe("ghp_test");
  });

  test("overwrites an existing value at the same key", async () => {
    const vault = createMemoryVault();
    await vault.set("github.pat", "old");
    await writeConnectorSecret(vault, "github", "pat", "new");
    expect(await vault.get("github.pat")).toBe("new");
  });

  test("stores empty string and whitespace verbatim (no validation)", async () => {
    const vault = createMemoryVault();
    await writeConnectorSecret(vault, "slack", "oauth", "");
    expect(await vault.get("slack.oauth")).toBe("");
    await writeConnectorSecret(vault, "slack", "oauth", "  raw  ");
    expect(await vault.get("slack.oauth")).toBe("  raw  ");
  });

  test("multi-key services write to distinct vault keys", async () => {
    const vault = createMemoryVault();
    await writeConnectorSecret(vault, "datadog", "api_key", "API");
    await writeConnectorSecret(vault, "datadog", "app_key", "APP");
    expect(await vault.get("datadog.api_key")).toBe("API");
    expect(await vault.get("datadog.app_key")).toBe("APP");
  });

  test("compile-time: rejects non-manifested keys", () => {
    const vault = createMemoryVault();
    // @ts-expect-error — github manifest is ["github.pat"].
    void writeConnectorSecret(vault, "github", "oauth", "x");
    // @ts-expect-error — google_drive manifest is empty.
    void writeConnectorSecret(vault, "google_drive", "oauth", "x");
    expect(true).toBe(true);
  });
});
```

### 5.4 PR 2: type pins extension

Extend the `ConnectorSecretKeyOf — type pins` block (added in PR #146) with pins for `writeConnectorSecret`:

```ts
// writeConnectorSecret keyName must accept the same union as readConnectorSecret.
assertEq<Parameters<typeof writeConnectorSecret<"github">>[2], "pat">(true);
assertEq<Parameters<typeof writeConnectorSecret<"datadog">>[2], "api_key" | "app_key" | "site">(true);

// sharedOAuthKey signature pins.
assertEq<Parameters<typeof sharedOAuthKey>[0], "google" | "microsoft">(true);
assertEq<ReturnType<typeof sharedOAuthKey>, "google.oauth" | "microsoft.oauth">(true);
```

### 5.5 Coverage

`connector-vault.ts` is in the `engine` coverage gate (≥85%). New helpers are simple passthroughs; coverage stays above threshold without new gate rows.

## 6 — Acceptance criteria

### PR 1 (lazy-mesh reads)

- [ ] `sharedOAuthKey` and `SharedOAuthProvider` exported from `connector-vault.ts`.
- [ ] `LazyMcpMesh.ensureIfVaultKeyNonEmpty` removed; replaced by `ensureIfConnectorSecretSet<S>` and `ensureIfProviderOAuthSet`.
- [ ] `git grep ensureIfVaultKeyNonEmpty -- packages/` returns zero hits.
- [ ] All 12 sites in §3.3 routed through the new helpers/methods.
- [ ] `bun run audit:invariants 2>&1 | grep -c "D11"` reports **9** (Bucket C rpc-handlers only).
- [ ] `bun run audit:invariants 2>&1 | grep "lazy-mesh"` returns no output.
- [ ] `bun test packages/gateway/src/connectors/lazy-mesh.test.ts` passes (regression check).
- [ ] `bun test packages/gateway/src/connectors/connector-vault.test.ts` passes (sharedOAuthKey tests added).
- [ ] Whole-repo `bun run typecheck` clean.
- [ ] `bun run lint` clean.
- [ ] `bun run test:ci` clean (Ubuntu CI parity).
- [ ] `VAULT_KEY_ALLOW_LIST.length === 5` test still passes.

### PR 2 (rpc-handlers writes)

- [ ] `writeConnectorSecret` exported from `connector-vault.ts` with the typed signature in §4.1.
- [ ] All 9 sites in §4.2 routed through the new helpers.
- [ ] `bun run audit:invariants 2>&1 | grep -c "D11"` reports **0**.
- [ ] `bun run audit:invariants` exits 0. **D11 closed.**
- [ ] `connector-rpc-handlers` regression tests still pass (whatever the existing coverage path is — verify in implementation).
- [ ] `bun test packages/gateway/src/connectors/connector-vault.test.ts` passes (writeConnectorSecret tests added).
- [ ] Whole-repo `bun run typecheck` clean.
- [ ] `bun run lint` clean.
- [ ] `bun run test:ci` clean.
- [ ] `VAULT_KEY_ALLOW_LIST.length === 5` test still passes.
- [ ] Post-PR baseline update in `docs/structure-audit/baseline.md` recording D11 = 0.

## 7 — Rollout

**PR 1 first.** Smaller blast radius (lazy-mesh-only), all reads, no new write helpers. Branch: `dev/asafgolombek/d11-bucket-c-lazy-mesh`. PR title: `refactor(connectors): D11 Bucket C — route lazy-mesh reads through readConnectorSecret + sharedOAuthKey`.

**PR 2 after PR 1 merges.** Branch: `dev/asafgolombek/d11-bucket-c-rpc-handlers` opened against `main` (not stacked on PR 1's branch). PR title: `refactor(ipc): D11 Bucket C — add writeConnectorSecret + close D11 (0 violations)`. PR 2 depends on PR 1's `sharedOAuthKey` export landing on `main`.

Each PR is single-commit (atomic acceptance state) plus a follow-up baseline-refresh commit if `baseline.md` shifts from the migration. The baseline update for D11 = 0 lands in PR 2 (deferred from PR 1 because PR 1 ends at D11 = 9, an interim state).

## 8 — Out of scope, captured for future specs

- **`VAULT_KEY_RE` widening / manifest-derived audit pattern.** Lands as a separate spec → plan → PR after Bucket C closes. Open design dimensions: which suffixes count as "secret" (current regex omits `app_key`, `api_token`, `api_base`, `site`, `account_id`, `client_secret`, `email`, `base_url`, `username`, `app_password`, `kubeconfig`, `tenant_id`, etc.); manifest-derived (auto-extends per new connector) vs. enumerated (explicit list); should non-secret keys like `email` / `base_url` / `username` gate at all.
- **D4 splits of `lazy-mesh.ts` and `connector-rpc-handlers.ts`.** Both files exceed the 800-LOC threshold. Tracked as separate refactor candidates in `deferred-backlog.md`. Bucket C deliberately does not touch their structure.
- **Migration of `oauth-vault-tokens.ts` to use `sharedOAuthKey`.** That file is allow-listed (entry #4) for being the provider-shared OAuth canonical reader; routing its internal reads through `sharedOAuthKey` would be cosmetic. Not a Bucket C concern.

## 9 — Provenance

- Phase 2 ranking: [`docs/structure-audit/missed.md`](../../structure-audit/missed.md) "D11 Bucket C" rows (cost 3 each, score 1.33).
- Site list: [`docs/structure-audit/deferred-backlog.md`](../../structure-audit/deferred-backlog.md) "D11 — vault-key centralization (Bucket C)".
- Existing helpers (Bucket B): `readConnectorSecret`, `ConnectorSecretKeyOf`, `perServiceOAuthVaultKey`, `writePerServiceOAuthKey`, `clearOAuthVaultIfProviderUnused`, `migrateToPerServiceOAuthKeys` — all in `packages/gateway/src/connectors/connector-vault.ts`.
- Manifest: `packages/gateway/src/connectors/connector-secrets-manifest.ts` (`CONNECTOR_VAULT_SECRET_KEYS`).
- Audit script: `scripts/structure-audit/check-nimbus-invariants.ts` (`VAULT_KEY_ALLOW_LIST`, `checkVaultKeyAllowList`).
- Frozen-count test: `scripts/structure-audit/check-nimbus-invariants.test.ts`.
- Type-pinning suite: `packages/gateway/src/connectors/connector-vault.test.ts` (PR #146 — type pins describe block).
