# D11 Bucket B — `readConnectorSecret` helper

**Date:** 2026-05-01
**Phase:** Phase 4 / B3 structure audit — Phase 2 follow-up
**Source:** [`docs/structure-audit/missed.md`](../../structure-audit/missed.md) row "D11 Bucket B"; [`docs/structure-audit/deferred-backlog.md`](../../structure-audit/deferred-backlog.md) section "D11 — vault-key Bucket B"
**Predecessor specs:** [`2026-04-30-structure-audit-design.md`](./2026-04-30-structure-audit-design.md)

---

## 1 — Goal

Eliminate the Bucket-B vault-key-construction sites in production code by routing them through a typed `readConnectorSecret` helper co-located in `packages/gateway/src/connectors/connector-vault.ts` (already on the D11 allow-list).

**Pre-PR audit count (verified live with `bun run audit:invariants`):** 36 D11 violations.
- 11 sites flagged in 11 production files (Bucket B migration scope).
- 3 sites in 2 files become allow-list additions (`auth/oauth-vault-tokens.ts` × 2 + `embedding/create-embedding-runtime.ts` × 1).
- 1 site in `testing/bun-test-support.ts` (test infrastructure — fixed via iterator extension, not allow-list).
- 21 sites in `lazy-mesh.ts` + `connector-rpc-handlers.ts` (Bucket C, deferred — out of scope).

**Post-PR audit count target:** 21 (Bucket C only).

After this PR, the D11 audit signal collapses to **two sources only**:

1. The structurally-justified 5-entry `VAULT_KEY_ALLOW_LIST` (frozen at count 5 by a unit test).
2. Bucket C — 21 sites in `lazy-mesh.ts` + `connector-rpc-handlers.ts` (deferred to its own spec).

Adding a new connector to Nimbus no longer requires a `VAULT_KEY_ALLOW_LIST` bump — the new entry to `CONNECTOR_VAULT_SECRET_KEYS` is sufficient. This is the audit-signal-preservation outcome the deferred-backlog explicitly described.

## 2 — Non-goals

- **Bucket C** (21 sites in `lazy-mesh.ts` + `connector-rpc-handlers.ts`). Stays deferred. This PR introduces no `writeConnectorSecret` stub — adding a write helper without a production caller is YAGNI and forces test surface for unused code.
- **Provider-shared OAuth reads** (`microsoft.oauth` in `oauth-vault-tokens.ts`). The file is added to the allow-list with a structural reason: it is the canonical reader for the provider-shared Microsoft OAuth payload, mirroring `auth/google-access-token.ts`. It does not fit the per-service helper signature.
- **Embedding provider keys** (`openai.api_key` in `embedding/create-embedding-runtime.ts`). OpenAI is not a connector — there is no `ConnectorServiceId` for it, and the `CONNECTOR_VAULT_SECRET_KEYS` manifest does not (and should not) cover it. Add to allow-list.
- **No change to `vault.set` / `vault.delete` semantics, the `CONNECTOR_VAULT_SECRET_KEYS` manifest shape, or any caller's surrounding null/empty/trim guard logic.**

## 3 — Helper API

Co-located in `packages/gateway/src/connectors/connector-vault.ts` (no new file, no new allow-list entry). Two exports:

```ts
/**
 * Bare-key view derived from `CONNECTOR_VAULT_SECRET_KEYS`. For a service `S`,
 * extracts the suffix after the dot in each fully-qualified manifest entry.
 *
 * Services with an empty manifest array (e.g. `google_drive`) resolve to `never`,
 * which makes `readConnectorSecret(vault, "google_drive", ...)` uncallable —
 * those services use OAuth via `auth/google-access-token.ts`, not this helper.
 */
export type ConnectorSecretKeyOf<S extends ConnectorServiceId> =
  (typeof CONNECTOR_VAULT_SECRET_KEYS)[S][number] extends `${S}.${infer K}`
    ? K
    : never;

/**
 * Reads a connector's secret from the Vault by structural key name.
 * Returns the raw stored value (no trim, no default) — semantics match `vault.get`.
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

**Three guarantees:**

1. **Type-safe.** `readConnectorSecret(vault, "github", "oauth")` is a compile error (manifest has `github.pat`, not `github.oauth`). `readConnectorSecret(vault, "datadog", "api_key" | "app_key" | "site")` all typecheck.
2. **No semantic drift.** Returns `string | null` exactly like `vault.get`. Callers keep their existing `if (raw === null || raw === "")` and `?.trim() ?? ""` guards verbatim.
3. **Allow-list neutral.** The `${serviceId}.${keyName}` template literal lives inside `connector-vault.ts`, which is already entry #1 of the allow-list. No D11 violation introduced.

## 4 — Migration plan

### 4.1 Production files to migrate (11 files, 15 vault calls)

D11's regex `/['"`][a-z0-9_]*\.(oauth|token|pat|api_key)['"`]/` only flags four exact suffixes. Several files read additional secret keys whose suffixes (e.g., `app_key`, `api_token`, `api_base`, `site`) the regex does not match — those reads are not D11 violations today but **should still migrate** for code consistency: a function that calls `readConnectorSecret(...)` once and `vault.get("...")` once for sibling keys is worse code than today.

The migration target is **every `vault.get` / `ctx.vault.get` call in the listed files that reads a key declared in `CONNECTOR_VAULT_SECRET_KEYS`**. The D11-flagged column shows which call(s) currently fire the audit.

| # | File | All vault.get calls (post-migration target) | D11-flagged today |
|---|---|---|---|
| 1 | `packages/gateway/src/auth/notion-access-token.ts` | `notion.oauth` | yes (1) |
| 2 | `packages/gateway/src/auth/slack-access-token.ts` | `slack.oauth` | yes (1) |
| 3 | `packages/gateway/src/platform/assemble.ts` | `github.pat`, `circleci.api_token` | partial (only `.pat` matches regex) |
| 4 | `packages/gateway/src/connectors/datadog-sync.ts` | `datadog.api_key`, `datadog.app_key`, `datadog.site` | partial (only `.api_key` matches regex) |
| 5 | `packages/gateway/src/connectors/github-actions-sync.ts` | `github.pat` | yes (1) |
| 6 | `packages/gateway/src/connectors/github-sync.ts` | `github.pat` | yes (1) |
| 7 | `packages/gateway/src/connectors/gitlab-sync.ts` | `gitlab.pat`, `gitlab.api_base` | partial (only `.pat` matches regex) |
| 8 | `packages/gateway/src/connectors/linear-sync.ts` | `linear.api_key` | yes (1) |
| 9 | `packages/gateway/src/connectors/newrelic-sync.ts` | `newrelic.api_key` | yes (1) |
| 10 | `packages/gateway/src/connectors/notion-sync.ts` | `notion.oauth` | yes (1) |
| 11 | `packages/gateway/src/connectors/slack-sync.ts` | `slack.oauth` | yes (1) |

Migration shape per file: `await vault.get("github.pat")` becomes `await readConnectorSecret(vault, "github", "pat")`. Surrounding `if (raw === null || raw === "")`, `?.trim() ?? ""`, and noop-result branches are preserved verbatim — the helper has identical `string | null` semantics.

**Total D11 violations cleared from this section: 11** (the partial-fire files contribute one D11 site each; their unflagged sibling reads migrate alongside but don't count toward the audit reduction).

### 4.2 Allow-list additions (2)

These two files do **not** migrate to `readConnectorSecret`. They are added to `VAULT_KEY_ALLOW_LIST` with a structural reason recorded inline as a `// ` comment on the same line as the allow-list entry. Use **exactly** these comment strings to keep the wording stable across PR review:

```ts
const VAULT_KEY_ALLOW_LIST = [
  "packages/gateway/src/connectors/connector-vault.ts",
  "packages/gateway/src/auth/google-access-token.ts",
  "packages/gateway/src/auth/pkce.ts",
  // Provider-shared OAuth canonical reader (Microsoft); mirrors google-access-token.ts.
  "packages/gateway/src/auth/oauth-vault-tokens.ts",
  // OpenAI embedding provider — not a Nimbus connector; no ConnectorServiceId.
  "packages/gateway/src/embedding/create-embedding-runtime.ts",
];
```

### 4.3 Test infrastructure (extend iterator, do not migrate, do not allow-list)

`packages/gateway/src/testing/bun-test-support.ts:80` writes `google.oauth` / `microsoft.oauth` to a test fixture vault. **Currently flagged by D11** because `iterateSourceFiles()` in `scripts/structure-audit/lib.ts` does not exclude `/testing/` paths (it only excludes `.test.ts`, `-sql.ts`, `.d.ts`, `/__fixtures__/`, `/test/fixtures/`).

**Fix:** Add one line to `iterateGlob()` in `scripts/structure-audit/lib.ts`:

```ts
if (relPath.includes("/testing/")) continue;
```

This is consistent with the existing `/test/fixtures/` and `/__fixtures__/` rules and matches Nimbus's convention of putting shared test utilities under `*/src/testing/`. Affected files (verified):
- `packages/gateway/src/testing/bun-test-support.ts` — gateway test support (currently flagged)
- `packages/sdk/src/testing/index.ts` — SDK test helpers (public API for extension authors writing tests; appropriately excluded — extension test helpers should not be D11-gated)

**Why iterator extension over allow-list:** the audit's purpose is catching production runtime code that constructs vault keys. Test-support modules are tooling, not runtime. Extending the iterator preserves D11's strict "vault keys live in 5 named files" signal; adding test-support files to the allow-list would dilute that signal as more test utilities accumulate.

This iterator change also widens **all** structure audits (D8 any-count, D9 risky-assertions, D10 spawn). That widening is correct — none of those should gate on test tooling either. Implementation must re-run all audits after the change to capture any baseline shifts (`docs/structure-audit/{any-baseline.json,db-run-census.json,risky-assertions.json}` — record any deltas in the PR description).

### 4.4 Final allow-list (5 entries)

```ts
const VAULT_KEY_ALLOW_LIST = [
  "packages/gateway/src/connectors/connector-vault.ts",            // helper home + per-service OAuth helpers
  "packages/gateway/src/auth/google-access-token.ts",              // provider OAuth canonical reader (Google)
  "packages/gateway/src/auth/pkce.ts",                             // PKCE flow writer (provider OAuth)
  "packages/gateway/src/auth/oauth-vault-tokens.ts",               // provider-shared OAuth canonical reader (Microsoft)
  "packages/gateway/src/embedding/create-embedding-runtime.ts",    // OpenAI embedding provider (not a connector)
];
```

## 5 — CI gate

Add a unit test in `scripts/structure-audit/check-nimbus-invariants.test.ts`:

```ts
import { VAULT_KEY_ALLOW_LIST } from "./check-nimbus-invariants.ts";

test("VAULT_KEY_ALLOW_LIST is frozen at 5 structural entries", () => {
  // Each entry has a documented structural reason (see spec § 4.4).
  // Adding a 6th entry forces a PR-level discussion via this test edit.
  expect(VAULT_KEY_ALLOW_LIST).toHaveLength(5);
});
```

Requires changing `VAULT_KEY_ALLOW_LIST` in `check-nimbus-invariants.ts` from a module-private `const` to an `export const`. The existing `checkVaultKeyAllowList()` function already accepts an `allowList` parameter, so no production caller imports the constant — the export is for tests only.

**Why a count and not a string-equality snapshot.** The count is the durable invariant. If the helper file is renamed or `oauth-vault-tokens.ts` moves under a different folder, the test still passes. A string-equality snapshot would force every refactor to touch the test for no security benefit. The lightweight bar matches `any-baseline.json`'s single-number ratchet.

## 6 — Tests for the helper

New test cases in `packages/gateway/src/connectors/connector-vault.test.ts` (extend if it already exists; otherwise create). Three groups:

### 6.1 Behavioural parity with `vault.get`

- Returns the stored string when the key is set.
- Returns `null` when the key is absent.
- Does not trim, does not coerce empty string, does not throw — semantics are identical to `vault.get`.

### 6.2 Manifest-driven key resolution

- `readConnectorSecret(vault, "github", "pat")` reads `github.pat`.
- `readConnectorSecret(vault, "datadog", "api_key")` and `("datadog", "app_key")` resolve to distinct vault keys (proving the multi-key case is correct).
- `readConnectorSecret(vault, "gitlab", "api_base")` resolves to `gitlab.api_base` (covers the non-`pat`-shaped key on a service that also has `gitlab.pat`).

### 6.3 Type-level rejection (`@ts-expect-error`)

- `readConnectorSecret(vault, "github", "oauth")` is a compile error (github manifest is `["github.pat"]`).
- `readConnectorSecret(vault, "google_drive", "oauth")` is a compile error — `ConnectorSecretKeyOf<"google_drive">` resolves to `never` because the manifest array is empty.

Coverage: `connector-vault.ts` is already inside the gateway core covered by `bun run test:coverage:engine` (≥ 85%). No new coverage gate row needed.

## 7 — Acceptance criteria

All required:

- [ ] `readConnectorSecret` and `ConnectorSecretKeyOf` exist in `connector-vault.ts` with the signatures in §3.
- [ ] Every `vault.get` / `ctx.vault.get` call in the 11 files in §4.1 reads through `readConnectorSecret` (full file scope, including currently-unflagged sibling keys like `datadog.app_key`, `datadog.site`, `gitlab.api_base`, `circleci.api_token`). Verified by `git grep -n 'vault\.get\(' packages/gateway/src/{auth,connectors,platform}/` showing only `readConnectorSecret`-routed calls in the migrated files.
- [ ] `oauth-vault-tokens.ts` and `embedding/create-embedding-runtime.ts` are added to `VAULT_KEY_ALLOW_LIST` with their structural reasons recorded as inline comments in `check-nimbus-invariants.ts`.
- [ ] `iterateGlob()` in `scripts/structure-audit/lib.ts` excludes `/testing/` paths (one-line addition per §4.3).
- [ ] `bun run audit:invariants` exits 0. (Bucket A's 20 false-positives stay suppressed via existing `audit-ignore-next-line` markers; Bucket C's 21 sites remain — they are deferred and do not gate this PR. Bucket C site-counts are unaffected.)
- [ ] D11 violation count drops from **36 → 21** (Bucket C only). Recorded as a post-Phase-2 update line in `docs/structure-audit/baseline.md` with the new figure.
- [ ] The `VAULT_KEY_ALLOW_LIST.length === 5` test passes.
- [ ] All §6 tests pass: behavioural parity (3), manifest resolution (3), `@ts-expect-error` (2).
- [ ] Other audit baselines (`any-baseline.json`, `db-run-census.json`, `risky-assertions.json`) re-validated after the iterator change; any deltas are documented in the PR description (expected: zero or near-zero, since `bun-test-support.ts` is small and `sdk/src/testing/index.ts` is a thin re-export — but verify rather than assume).
- [ ] `bun run test:ci` clean on Ubuntu before pushing the PR (CI-parity preflight per the user's standing rule).
- [ ] `git diff` for each migrated file shows only the call shape changed; surrounding `if (raw === null || raw === "")`, `?.trim() ?? ""`, and noop-result branches are preserved verbatim.

## 8 — Rollout

Single PR. Estimated cost is the deferred-backlog's "~3" estimate plus a small bump for the iterator change:
- Helper + types in `connector-vault.ts`.
- 11 callers updated (15 vault.get calls across them).
- 2 allow-list additions in `check-nimbus-invariants.ts`.
- 1 frozen-count test in `check-nimbus-invariants.test.ts`.
- 1 iterator line in `scripts/structure-audit/lib.ts`.
- Helper tests in `connector-vault.test.ts`.
- Re-validation of other audit baselines (mechanical, may be a no-op).

Splitting per file would create churn without isolation benefit — the helper has no caller until the first migration site lands, so a stub-then-migrate split would mean the stub PR ships dead code.

**Branch name:** `dev/asafgolombek/d11-bucket-b-readConnectorSecret`

**PR title:** `refactor(structure-audit): D11 Bucket B — route 11 sites through readConnectorSecret`

## 9 — Out of scope, captured for future specs

- **Bucket C** (`lazy-mesh.ts` + `connector-rpc-handlers.ts`, 21 sites). Expected to extend the same `connector-vault.ts` module with `writeConnectorSecret(serviceId, value)` and `sharedOAuthKey(provider)` helpers. Will not require any further `VAULT_KEY_ALLOW_LIST` additions if the design holds.
- **`VAULT_KEY_RE` widening.** The current regex only matches four exact suffixes (`oauth|token|pat|api_key`). After Bucket B + Bucket C clear, the natural follow-up is to either extend the alternation to cover every secret-key suffix in the manifest (`app_key|api_token|api_base|site|account_id|client_secret|…`) or — better — derive the regex from `CONNECTOR_VAULT_SECRET_KEYS` at runtime so a new connector auto-extends the audit. **Out of scope here:** widening the regex while Bucket C still has live violations would re-fire D11 on lines that pass today (e.g., `lazy-mesh.ts:1238` reads `microsoft.oauth` and others), forcing more allow-list discussion mid-PR. Sequence it after Bucket C lands.
- **D5 (cognitive complexity)** is unaffected — no function in this PR exceeds the 15-threshold.
- **D7 (orphan files)** is unaffected — every export added has a caller.
- **D8 (any count)** is unaffected — no `any` introduced; baseline stays at 2.

## 10 — Provenance

- Phase 2 ranking: [`docs/structure-audit/missed.md`](../../structure-audit/missed.md) row "D11 Bucket B canonical-reader sites" (cost 2, score 1.5).
- Site list: [`docs/structure-audit/deferred-backlog.md`](../../structure-audit/deferred-backlog.md) "D11 — vault-key Bucket B".
- Existing helpers: `packages/gateway/src/connectors/connector-vault.ts` (`perServiceOAuthVaultKey`, `writePerServiceOAuthKey`, `clearOAuthVaultIfProviderUnused`, `migrateToPerServiceOAuthKeys`).
- Manifest: `packages/gateway/src/connectors/connector-secrets-manifest.ts` (`CONNECTOR_VAULT_SECRET_KEYS`).
- Audit script: `scripts/structure-audit/check-nimbus-invariants.ts` (`VAULT_KEY_ALLOW_LIST`, `checkVaultKeyAllowList`).
