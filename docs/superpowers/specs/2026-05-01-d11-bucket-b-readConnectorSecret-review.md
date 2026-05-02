# D11 Bucket B — `readConnectorSecret` Design Review Feedback

**Date:** 2026-05-01
**Reviewer:** Gemini CLI
**Target Spec:** [`2026-05-01-d11-bucket-b-readConnectorSecret-design.md`](./2026-05-01-d11-bucket-b-readConnectorSecret-design.md)

---

## 1 — Suggestions & Improvements

### 1.1 — Regex Hardening (Post-Migration)
The current `VAULT_KEY_RE` in `check-nimbus-invariants.ts` only flags four suffixes (`oauth|token|pat|api_key`). The spec correctly identifies that sibling keys like `app_key`, `api_token`, `api_base`, and `site` currently bypass the audit.

**Suggestion:** Once the migration is complete and these 11 files are "clean," we should update the regex to catch these additional suffixes. This prevents future regressions where someone might use `vault.get("datadog.app_key")` instead of the helper. Since all valid construction sites will be inside `connector-vault.ts` (which is allow-listed), a stricter regex won't cause false positives in production code.

### 1.2 — Optional Defaulting/Trimming
Many `vault.get` callers immediately follow with `?.trim() ?? ""`.

**Question:** Would adding an optional options object to `readConnectorSecret` improve call-site ergonomics without violating the "no semantic drift" goal?
```ts
export async function readConnectorSecret<S extends ConnectorServiceId>(
  vault: NimbusVault,
  serviceId: S,
  keyName: ConnectorSecretKeyOf<S>,
  options?: { trim?: boolean; fallback?: string }
): Promise<string | null> {
  let val = await vault.get(`${serviceId}.${keyName}`);
  if (options?.trim) val = val?.trim() ?? null;
  return val ?? options?.fallback ?? null;
}
```
If the user prefers strict parity, the current design is fine, but it forces every caller to repeat the same boilerplate.

### 1.3 — Audit Iterator Broadening
The decision to exclude `/testing/` from `iterateGlob` (§4.3) is noted as widening all structure audits (D8, D9, D10). 

**Observation:** While correct for D10 (spawns in tests are often necessary and don't need `extensionProcessEnv`), ensure that we don't accidentally lose visibility into "risky" patterns in test utilities if those utilities are ever used in a way that impacts production (unlikely in Nimbus given the package rules). The trade-off for a cleaner D11 signal seems worth it.

## 2 — Questions

### 2.1 — Handling of non-string values
`readConnectorSecret` returns `Promise<string | null>`. 
**Question:** Are there any connector secrets that are stored as JSON strings that need parsing, or are they all raw strings? `discord.enabled` in the manifest suggests a boolean-like string. If they are all strings, `string | null` is sufficient.

### 2.2 — Compile-time check for `google_drive`
The spec mentions `ConnectorSecretKeyOf<"google_drive">` resolves to `never`. 
**Verification:** Does `readConnectorSecret(vault, "google_drive", someVar)` fail gracefully if `someVar` is typed as `never`? Yes, but explicitly testing this in §6.3 is a good idea to ensure no one accidentally "satisfies" `never`.

---

## 3 — Technical Nitpicks

- **Type Helper:** The `infer K` logic is robust against union types in the manifest (e.g., `bitbucket`). 
- **Allow-list Comments:** Ensure the structural reasons in §4.2 are worded exactly as they should appear in the code to minimize "review-the-reviewer" churn during implementation.
