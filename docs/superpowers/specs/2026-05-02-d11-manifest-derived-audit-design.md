# D11 Manifest-Derived Audit + Migration

**Date:** 2026-05-02
**Phase:** Phase 4 / B3 structure audit — Phase 2 follow-up (post-Bucket-C)
**Source:** [`docs/structure-audit/missed.md`](../../structure-audit/missed.md) "D11 — VAULT_KEY_RE widening" (deferred from Bucket C); [`docs/structure-audit/deferred-backlog.md`](../../structure-audit/deferred-backlog.md)
**Predecessor specs:**
- [`2026-04-30-structure-audit-design.md`](./2026-04-30-structure-audit-design.md)
- [`2026-05-01-d11-bucket-b-readConnectorSecret-design.md`](./2026-05-01-d11-bucket-b-readConnectorSecret-design.md)
- [`2026-05-02-d11-bucket-c-design.md`](./2026-05-02-d11-bucket-c-design.md)
**Predecessor PRs:** [#145](https://github.com/asafgolombek/Nimbus/pull/145) (Bucket B), [#149](https://github.com/asafgolombek/Nimbus/pull/149) (Bucket C PR-1), [#151](https://github.com/asafgolombek/Nimbus/pull/151) (Bucket C PR-2)

---

## 1 — Goal

Widen the D11 audit so every vault-key literal (secret OR config) outside the allow-list is gated, by deriving the recognized key-set from `CONNECTOR_VAULT_SECRET_KEYS` itself. End state:

- The regex catches every entry in the manifest (currently 43 entries across 27 connectors), not just the 4-suffix subset (`oauth | token | pat | api_key`) it covers today.
- All current `vault.get` / `vault.set` / `vault.delete` of manifest-shaped keys flow through typed helpers (`readConnectorSecret` / `writeConnectorSecret` / `deleteConnectorSecret` / `sharedOAuthKey`).
- D11 stays at 0 violations under the broader pattern.
- The allow-list grows from 5 to **6 entries**, with `connector-secrets-manifest.ts` added as the canonical declaration site of vault keys.

The work ships as **4 PRs** sequenced as **migrate-first → widen-last**, so CI stays green at HEAD throughout.

## 2 — Non-goals

- **Renaming `readConnectorSecret` / `writeConnectorSecret` / `deleteConnectorSecret`.** Their `keyName` parameter is `ConnectorSecretKeyOf<S>`, which derives from the full manifest including config-shaped keys (`gitlab.api_base`, `jira.email`, `aws.default_region`, etc.). The names are slight misnomers (the helpers handle config too, not just "secrets"), but renaming touches every call site and the helpers' typing is correct as-is. Out of scope; deferred.
- **Stricter audit modes.** The manifest-derived regex covers string literals (`"foo.bar"`) plus the existing `${...}.suffix` template-literal pattern. Programmatic key construction via helpers other than the canonical readers/writers is not gated. Acceptable trade-off — the manifest IS the boundary.
- **Migration of `pkce.ts` reads through `sharedOAuthKey`.** That file is allow-listed (entry #3) for being the canonical Google PKCE writer. Routing its internal reads through `sharedOAuthKey` would be cosmetic. Same disposition as Bucket C § 8.
- **Manifest-drift detection.** A new connector whose keys are added to source but not to the manifest will be silently un-gated by the audit. The manifest is the source of truth; this is the intended behavior of manifest-derived. A separate spec could add a CI check that `CONNECTOR_VAULT_SECRET_KEYS` covers every `vault.get/set/delete` literal, but it is not part of this spec.
- **No new helper beyond `deleteConnectorSecret`.** Bulk delete (clearing all of a connector's keys at once) already has `clearConnectorVaultSecretKeys`. The new `deleteConnectorSecret` covers individual-key deletes. No third helper.

## 3 — Architecture changes

### 3.1 Audit script (`scripts/structure-audit/check-nimbus-invariants.ts`)

Replace the static `VAULT_KEY_RE` with a manifest-derived regex built once at script startup:

```ts
import { CONNECTOR_VAULT_SECRET_KEYS } from "../../packages/gateway/src/connectors/connector-secrets-manifest.ts";

function buildVaultKeyRegex(): RegExp {
  const keys = Object.values(CONNECTOR_VAULT_SECRET_KEYS).flat();
  // Suffixes derived from the manifest; used for the ${...}.suffix template form.
  const suffixes = Array.from(new Set(keys.map((k) => k.split(".")[1] ?? "")));
  const literalAlt = keys.map(escapeRegex).join("|");
  const suffixAlt = suffixes.map(escapeRegex).join("|");
  return new RegExp(`['"\`](${literalAlt})['"\`]|\\$\\{[^}]+\\}\\.(${suffixAlt})`);
}

const VAULT_KEY_RE = buildVaultKeyRegex();
```

(Plus a small `escapeRegex` helper that handles `.` and other meta-chars; trivial.)

### 3.2 Allow-list

`VAULT_KEY_ALLOW_LIST` grows from 5 to 6 entries by adding the manifest file:

```ts
export const VAULT_KEY_ALLOW_LIST = [
  "packages/gateway/src/connectors/connector-vault.ts",
  "packages/gateway/src/auth/google-access-token.ts",
  "packages/gateway/src/auth/pkce.ts",
  "packages/gateway/src/auth/oauth-vault-tokens.ts",
  "packages/gateway/src/embedding/create-embedding-runtime.ts",
  // Canonical declaration of per-connector vault keys; structurally equivalent
  // to connector-vault.ts (declaration site, not runtime construction).
  "packages/gateway/src/connectors/connector-secrets-manifest.ts",
];
```

The frozen-count test in `scripts/structure-audit/check-nimbus-invariants.test.ts` bumps from `length === 5` to `=== 6` with an updated inline justification.

The Bucket C spec (§ 2 non-goals) explicitly held the allow-list at 5 *for that scope*. This spec un-freezes for one structurally-justified addition: the manifest file is the canonical declaration of vault keys, identical in structural role to `connector-vault.ts` (entry #1). Allow-listing it is more correct than peppering 43 `audit-ignore-next-line` markers across the manifest body (the existing 7 markers become redundant and are removed in PR D).

### 3.3 New helper: `deleteConnectorSecret`

Append to `packages/gateway/src/connectors/connector-vault.ts`:

```ts
/**
 * Deletes a connector's secret from the Vault by structural key name.
 * Mirrors `readConnectorSecret`/`writeConnectorSecret` typing — `keyName`
 * is constrained to `ConnectorSecretKeyOf<S>`, so misspelled or
 * non-manifested keys fail at compile time. Returns `void` (mirrors
 * `vault.delete`).
 */
export async function deleteConnectorSecret<S extends ConnectorServiceId>(
  vault: NimbusVault,
  serviceId: S,
  keyName: ConnectorSecretKeyOf<S>,
): Promise<void> {
  const fullKey = `${serviceId}.${keyName}`;
  return vault.delete(fullKey);
}
```

Lands in PR A (the first PR that needs it — `connector-rpc-handlers.ts` has 3 individual `vault.delete` sites: `gitlab.api_base`, `newrelic.account_id`, `datadog.site`). Pre-PR-A counts will be confirmed live during plan execution.

### 3.4 Per-line audit-ignore cleanup

The existing `// audit-ignore-next-line D11-vault-key (manifest entry, not vault-key construction)` markers in `connector-secrets-manifest.ts` (~7 lines, one per pre-widening manifest entry whose suffix matched the old regex) become redundant once the file is allow-listed. They are removed in PR D as part of the widening commit.

## 4 — PR sequencing

Per-file split, matching the Bucket-B/C cadence. PRs A, B, C are independent of each other and can be merged in any order; PR D requires all three merged.

| PR | Branch | Scope | Estimated sites | Helper additions |
|---|---|---|---|---|
| **A** | `dev/asafgolombek/d11-widen-rpc-handlers` | `packages/gateway/src/ipc/connector-rpc-handlers.ts` migrations | ~30–40 (incl. 3 `vault.delete`) | `deleteConnectorSecret` + 5 tests + 1 type pin |
| **B** | `dev/asafgolombek/d11-widen-lazy-mesh` | `packages/gateway/src/connectors/lazy-mesh.ts` migrations | ~30–60 (Phase 3 spawn-config blocks) | none |
| **C** | `dev/asafgolombek/d11-widen-sync-files` | `packages/gateway/src/connectors/{aws,azure,gcp,jira,confluence,jenkins,circleci,pagerduty,grafana,sentry,discord,iac,kubernetes,bitbucket}-sync.ts` migrations | ~20–25 across ~12 files | none |
| **D** | `dev/asafgolombek/d11-widen-regex` | Audit script regex change + manifest allow-list + frozen-count bump (5→6) + audit-ignore-next-line cleanup in manifest + baseline refresh | ~30 LOC across 3 files | none |

Each migration PR keeps CI green at HEAD because the regex hasn't widened yet — the new helper calls are simply "more correct than the literal" without changing audit semantics until D. PR D is the only one that flips behavior, and by then the audit count is already 0 under the broader pattern.

**Pre-PR-A baseline (live verification during plan):** all manifest-shaped `vault.get/set/delete` literals in production code outside the existing allow-list. Each PR's plan will run a one-shot grep at Step 1 to confirm the count.

## 5 — Migration mechanics

Identical substitution patterns from Bucket B/C:

| Before | After |
|---|---|
| `vault.get("foo.bar")` | `readConnectorSecret(vault, "foo", "bar")` |
| `vault.set("foo.bar", v)` | `writeConnectorSecret(vault, "foo", "bar", v)` |
| `vault.delete("foo.bar")` | `deleteConnectorSecret(vault, "foo", "bar")` |
| `vault.get("google.oauth")` / `vault.get("microsoft.oauth")` | `vault.get(sharedOAuthKey("google" / "microsoft"))` |
| `vault.set("google.oauth", v)` / `vault.set("microsoft.oauth", v)` | `vault.set(sharedOAuthKey("google" / "microsoft"), v)` |

Surrounding `(await ...)?.trim() ?? ""` parenthesisation, null/empty checks, and call-site control flow stay byte-identical (same rule as Bucket C § 3.3).

**Discovery script.** Each migration PR's plan begins with a one-shot script (or grep) that enumerates manifest-shaped vault-key literals in the target file(s):

```bash
bun -e "
import { CONNECTOR_VAULT_SECRET_KEYS } from './packages/gateway/src/connectors/connector-secrets-manifest.ts';
const keys = Object.values(CONNECTOR_VAULT_SECRET_KEYS).flat();
const pat = keys.map(k => k.replace(/\./g, '\\\\.')).join('|');
console.log(pat);
" > /tmp/manifest-pat.txt
PAT=$(cat /tmp/manifest-pat.txt)
rg -n "['\"\`]($PAT)['\"\`]" <target-file>
```

The plan's Step 1 reports the expected count; subsequent steps migrate each site; final step re-runs the grep to confirm 0 hits.

## 6 — Tests

### 6.1 PR A: `deleteConnectorSecret` (5 cases)

Add to `packages/gateway/src/connectors/connector-vault.test.ts`:

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
    // @ts-expect-error — google_drive manifest is empty.
    await deleteConnectorSecret(vault, "google_drive", "oauth");
    expect(true).toBe(true);
  });
});
```

The negative-rejection test uses `await deleteConnectorSecret(...)` (not `void deleteConnectorSecret(...)`) to avoid SonarCloud's `typescript:S3735` "no `void` operator" rule, matching the Bucket C PR-2 pattern.

### 6.2 PR A: type-pin extension

Extend the existing `ConnectorSecretKeyOf — type pins` block with a parameter pin for `deleteConnectorSecret`:

```ts
assertEq<Parameters<typeof deleteConnectorSecret<"github">>[2], "pat">(true);
```

### 6.3 PRs B, C: regression checks

Each migration PR runs the existing test suite for the file it touches:

- PR B: `packages/gateway/src/connectors/lazy-mesh.test.ts` (and any other lazy-mesh-touching tests).
- PR C: per-connector integration / sync tests where they exist.

No new behavioral tests; the substitutions are mechanical and the existing tests cover the surface.

### 6.4 PR D: frozen-count + audit-script tests

- The frozen-count test in `check-nimbus-invariants.test.ts` updates from `length === 5` to `=== 6` with a one-line justification update (mention manifest-as-declaration).
- Add a small unit test for the manifest-derived `buildVaultKeyRegex` to confirm it matches representative manifest entries (e.g., `jira.api_token`, `aws.access_key_id`, `bitbucket.app_password`) and rejects non-manifest literals (e.g., `console.log`).

## 7 — Acceptance criteria

### PR A (rpc-handlers)

- [ ] `deleteConnectorSecret` exported from `connector-vault.ts` with the typed signature in § 3.3.
- [ ] All manifest-shaped `vault.get/set/delete` literals in `connector-rpc-handlers.ts` routed through helpers.
- [ ] Discovery grep on PR-A's target file reports 0 manifest-shaped literals after migration.
- [ ] `bun test packages/gateway/src/connectors/connector-vault.test.ts` — full suite + 5 new `deleteConnectorSecret` tests pass.
- [ ] `bun test packages/gateway/src/ipc/connector-rpc-handlers-setconfig.test.ts` — pass count unchanged.
- [ ] `bun run typecheck` clean.
- [ ] `bun run lint` clean.
- [ ] `bun run test:ci` clean (Ubuntu CI parity).
- [ ] D11 audit count under the **current** regex unchanged from main (helpers don't change the literal count for old-suffix sites).

### PR B (lazy-mesh)

- [ ] All manifest-shaped literals in `lazy-mesh.ts` routed through helpers.
- [ ] Discovery grep on `lazy-mesh.ts` reports 0 manifest-shaped literals after migration.
- [ ] `bun test packages/gateway/src/connectors/lazy-mesh.test.ts` — pass count unchanged.
- [ ] `bun run typecheck` / `bun run lint` / `bun run test:ci` clean.

### PR C (per-connector sync files)

- [ ] All manifest-shaped literals in the 14 listed sync files routed through helpers.
- [ ] Discovery grep on the listed files reports 0 manifest-shaped literals after migration.
- [ ] Existing per-connector tests pass.
- [ ] `bun run typecheck` / `bun run lint` / `bun run test:ci` clean.

### PR D (regex widening + manifest allow-list)

- [ ] `VAULT_KEY_RE` derived from `CONNECTOR_VAULT_SECRET_KEYS` per § 3.1.
- [ ] `connector-secrets-manifest.ts` added as the 6th allow-list entry.
- [ ] Frozen-count test updated to assert `length === 6` with updated justification.
- [ ] Redundant `audit-ignore-next-line` markers removed from `connector-secrets-manifest.ts`.
- [ ] `bun run audit:invariants` reports **0** D11 hits and exits 0 under the broader pattern.
- [ ] Audit-script unit test for `buildVaultKeyRegex` (per § 6.4) passes.
- [ ] `bun run typecheck` / `bun run lint` / `bun run test:ci` clean.
- [ ] `docs/structure-audit/baseline.md` updated: D11 row reflects the manifest-derived widening with a dated post-widening section appended (preserving the post-Bucket-C history).

## 8 — Rollout

- **PR A first.** Smaller blast radius (single file, ~30–40 sites) and introduces the new helper. Branch: `dev/asafgolombek/d11-widen-rpc-handlers`. Title: `refactor(ipc): D11 — route manifest-shaped vault-keys through helpers + add deleteConnectorSecret`.
- **PR B after PR A merges.** Branch: `dev/asafgolombek/d11-widen-lazy-mesh`. Title: `refactor(connectors): D11 — route lazy-mesh manifest-shaped vault-keys through helpers`. Independent of PR C.
- **PR C in parallel with PR B (or after).** Branch: `dev/asafgolombek/d11-widen-sync-files`. Title: `refactor(connectors): D11 — route per-connector sync-file vault-keys through helpers`.
- **PR D last.** Branch: `dev/asafgolombek/d11-widen-regex`. Title: `chore(audit): D11 — widen VAULT_KEY_RE to manifest-derived; allow-list manifest`. Requires A+B+C merged.

Each PR is single-commit (atomic acceptance state) plus a follow-up baseline-refresh commit if `baseline.md` shifts. PR D's baseline refresh is the final D11 closure note under the broader pattern.

## 9 — Out of scope, captured for future specs

- **Helper renaming (`*ConnectorSecret` → `*ConnectorVaultEntry` or similar).** Discussed in § 2; not worth touching every call site for naming clarity.
- **Manifest-coverage CI check.** A static check that every `vault.get/set/delete` literal in production code has its key in `CONNECTOR_VAULT_SECRET_KEYS` would close the manifest-drift gap noted in § 2. Lands as its own spec if drift becomes observable.
- **D4 splits of `lazy-mesh.ts` and `connector-rpc-handlers.ts`.** Both still flagged in `deferred-backlog.md`. The next sub-projects after this spec ships, per the user's prioritisation. The migration in this spec creates the cleanest possible state for those splits — no vault-key literals to relocate.

## 10 — Provenance

- Bucket C spec § 2 (Non-goals): "Widening `VAULT_KEY_RE` or making it manifest-derived. Deferred to its own follow-up spec after Bucket C closes." — fulfilled by this spec.
- Bucket C spec § 8 (Out of scope): enumerated the open design dimensions (which suffixes count as "secret"; manifest-derived vs enumerated; should non-secret keys gate at all). Resolved here.
- Existing helpers (Bucket B/C): `readConnectorSecret`, `writeConnectorSecret`, `sharedOAuthKey`, `ConnectorSecretKeyOf` in `packages/gateway/src/connectors/connector-vault.ts`.
- Manifest: `packages/gateway/src/connectors/connector-secrets-manifest.ts` (`CONNECTOR_VAULT_SECRET_KEYS`, 43 entries across 27 connectors).
- Audit script: `scripts/structure-audit/check-nimbus-invariants.ts` (`VAULT_KEY_RE`, `VAULT_KEY_ALLOW_LIST`, `checkVaultKeyAllowList`).
- Frozen-count test: `scripts/structure-audit/check-nimbus-invariants.test.ts`.
