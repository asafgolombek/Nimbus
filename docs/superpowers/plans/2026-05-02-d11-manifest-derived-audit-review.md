# D11 Manifest-Derived Audit — Implementation Plan Review

**Reviewer:** Gemini CLI
**Date:** 2026-05-02
**Status:** ✅ Approved with minor suggestions for encapsulation and verification

---

## 1 — Executive Summary

The implementation plan at `docs/superpowers/plans/2026-05-02-d11-manifest-derived-audit.md` is a comprehensive and well-sequenced roadmap to closing the D11 invariant under the broader manifest-derived pattern. The 4-PR strategy (A-D) minimizes risk and ensures a clean transition.

## 2 — Suggestions for Improvement

### 2.1 Shared OAuth Helpers (PRs A, B, and C)

As highlighted in the design reviews for Bucket C and the Manifest-Derived spec, I strongly recommend including the `readSharedOAuth` and `writeSharedOAuth` helpers in `connector-vault.ts` as part of **PR A**.

**Update to Task A.3 (Step 1):**
Add these helpers to `connector-vault.ts`.

```ts
/** Reads a provider-shared OAuth token (e.g. google.oauth). */
export async function readSharedOAuth(
  vault: NimbusVault,
  provider: SharedOAuthProvider
): Promise<string | null> {
  return vault.get(sharedOAuthKey(provider));
}

/** Writes a provider-shared OAuth token. */
export async function writeSharedOAuth(
  vault: NimbusVault,
  provider: SharedOAuthProvider,
  value: string
): Promise<void> {
  return vault.set(sharedOAuthKey(provider), value);
}
```

**Consequential Migrations:**
In PR A (Task A.5), PR B (Task B.2), and PR C, all sites currently using `vault.get(sharedOAuthKey(provider))` or `vault.set(sharedOAuthKey(provider), ...)` should be updated to use these helpers.

Example for `connector-rpc-handlers.ts:365`:
`return await readSharedOAuth(vault, "microsoft");`

### 2.2 Refined Discovery Script (Task A.1 Step 4 and others)

The `PAT` regex in the plan is excellent, but to be truly "manifest-derived" during discovery, the engineer can generate it on the fly:

```bash
# In Task A.1 Step 4
PAT=$(bun -e "import { CONNECTOR_VAULT_SECRET_KEYS } from './packages/gateway/src/connectors/connector-secrets-manifest.ts'; console.log(Object.values(CONNECTOR_VAULT_SECRET_KEYS).flat().map(k => k.replace(/\./g, '\\\\.')).join('|'))")
rg -c "['\"\`]($PAT)['\"\`]" packages/gateway/src/ipc/connector-rpc-handlers.ts
```

This reduces the chance of manual copy-paste errors for the long `PAT` string.

### 2.3 PR C Migration Detail

In `connector-rpc-shared.ts` (Task C.3), ensure the import of `writeConnectorSecret` is indeed alphabetical as stated.

### 2.4 PR D Baseline Update

In Task D.6 Step 1, ensure the exact replacement for the D11 line in `baseline.md` is:

```markdown
| D11 | F | Vault-key construction outside allow-list | 0 violations under manifest-derived regex (closed 2026-05-02) | `bun run audit:invariants` (binary) |
```

## 3 — Questions

- **Q:** In `lazy-mesh.ts` (PR B), why not use `deleteConnectorSecret` if any delete sites are found during discovery?
  - **A:** The spec and plan currently identify all sites in `lazy-mesh.ts` as reads. If a delete is found during discovery, the helper is already available from PR A, so it should be used.

## 4 — Conclusion

The plan is top-tier. Adding the shared OAuth helpers as the final touch will complete the centralization of vault access patterns, leaving no raw `vault.get/set` calls on manifest-shaped keys in the production codebase.
