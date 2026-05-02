# D11 Bucket C — `writeConnectorSecret` + `sharedOAuthKey` — Design Review

**Reviewer:** Gemini CLI
**Date:** 2026-05-02
**Status:** ✅ Approved with minor suggestions

---

## 1 — Executive Summary

The proposed design for D11 Bucket C is technically sound and follows the established patterns from Bucket B ([#145](https://github.com/asafgolombek/Nimbus/pull/145)). It correctly identifies all remaining 21 D11 violation sites and provides a robust path to closing the D11 invariant entirely (0 violations).

## 2 — Strengths

- **Symmetry:** `writeConnectorSecret` perfectly mirrors `readConnectorSecret`, including the recursive `ConnectorSecretKeyOf<S>` type pinning.
- **Refinement in `LazyMcpMesh`:** Replacing the generic `ensureIfVaultKeyNonEmpty(string)` with typed `ensureIfConnectorSecretSet` and `ensureIfProviderOAuthSet` significantly improves type safety in one of the gateway's most sensitive components.
- **Atomic Rollout:** The two-PR strategy minimizes the "interim" state where the audit count is non-zero, and the post-PR-2 target of 0 is clear and verifiable.

## 3 — Suggestions & Improvements

### 3.1 Symmetry: `readSharedOAuth` and `writeSharedOAuth`

The spec currently leaves callers to compose `vault.get(sharedOAuthKey(provider))`. While functional, I suggest adding explicit reader/writer helpers for shared keys for better encapsulation:

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

This prevents callers from needing to know which `vault` method to use and keeps the string construction entirely internal to `connector-vault.ts`.

### 3.2 Tighter Return Type for `sharedOAuthKey`

The spec proposes returning `string`. I suggest returning the literal union:

```ts
export function sharedOAuthKey(provider: SharedOAuthProvider): `${SharedOAuthProvider}.oauth` {
  return `${provider}.oauth` as `${SharedOAuthProvider}.oauth`;
}
```

Since `vault.get`/`set` take `string`, no widening cast is required at the call site, but this provides better type information for any internal logic that might inspect these keys.

## 4 — Verification of Violation Sites

I have verified the sites mentioned in the spec against the current codebase:

- **`lazy-mesh.ts` (12 sites):** Confirmed 6 direct `vault.get` calls and 6 `ensureIfVaultKeyNonEmpty` calls (which themselves pass raw strings). Total 12 matches.
- **`connector-rpc-handlers.ts` (9 sites):** Confirmed 7 `vault.get/set` calls and 2 assignments to `sharedKey` (lines 1020, 1022). Total 9 matches.

The `sharedKey` local at `connector-rpc-handlers.ts:1018` is typed as `string | undefined`, so the proposed assignment `sharedKey = sharedOAuthKey("google");` is perfectly compatible.

## 5 — Questions

- **Q:** Should `SharedOAuthProvider` eventually be derived from the `CONNECTOR_VAULT_SECRET_KEYS` manifest?
  - **A:** Probably not, as `google.oauth` and `microsoft.oauth` are "provider-level" and the manifest is "service-level". The current manual enum in `connector-vault.ts` is the correct home for these.

## 6 — Conclusion

The design is ready for implementation. Closing D11 will be a major milestone for the B3 structure audit.
