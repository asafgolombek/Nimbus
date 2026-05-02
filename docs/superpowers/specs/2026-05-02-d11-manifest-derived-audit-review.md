# D11 Manifest-Derived Audit + Migration — Design Review

**Reviewer:** Gemini CLI
**Date:** 2026-05-02
**Status:** ✅ Approved with minor suggestions

---

## 1 — Executive Summary

The proposed design to widen the D11 audit to be manifest-derived is a significant improvement in the structural integrity of the Nimbus project. By dynamicizing the `VAULT_KEY_RE` and centralizing vault access through typed helpers, we eliminate the risk of "config-shaped" keys (like `api_base` or `site`) drifting from the centralized access policy.

## 2 — Strengths

- **Dynamic Enforcement:** Deriving the audit regex from `CONNECTOR_VAULT_SECRET_KEYS` ensures that the audit automatically stays in sync as new connectors or keys are added.
- **Complete Coverage:** Including config-shaped keys (D11 widening) closes a major gap where non-secret but structurally identical keys were previously ungated.
- **Structural Alignment:** Adding `connector-secrets-manifest.ts` to the allow-list is correct; it is the *declaration* site, not a *construction* site, and its role is identical to `connector-vault.ts`.
- **Safe Transition:** The 4-PR sequencing (A-D) is excellent, ensuring CI remains green by migrating sites before the enforcement regex is widened.

## 3 — Suggestions & Improvements

### 3.1 Symmetry: `readSharedOAuth` and `writeSharedOAuth`

I reiterate my suggestion from the Bucket C review to add explicit reader/writer helpers for provider-shared keys:

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

This ensures that *all* vault interactions (per-service and shared) follow a consistent "named helper" pattern, making the codebase easier to audit and reducing the surface area of raw `vault.get/set` calls.

### 3.2 Enhanced Type Pinning for `deleteConnectorSecret`

In § 6.2, I suggest extending the pin to also verify the return type:

```ts
assertEq<Parameters<typeof deleteConnectorSecret<"github">>[2], "pat">(true);
assertEq<ReturnType<typeof deleteConnectorSecret>, Promise<void>>(true);
```

### 3.3 Audit Script Performance

Since `iterateSourceFiles()` is already async and expensive, building the regex once at startup is correct. However, ensure `escapeRegex` handles the full range of potential manifest characters (e.g., underscores, dots, and potentially dashes in the future).

```ts
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

## 4 — Verification of Scope

The estimated site counts for PRs A, B, and C seem reasonable given the number of connectors (27) and the variety of config keys (e.g., `api_base`, `site`, `region`, `account_id`) that are now being included in the audit.

The `sharedKey` assignments in `connector-rpc-handlers.ts` identified in the previous review (lines 1020, 1022) will be correctly handled by the `sharedOAuthKey` helper as proposed.

## 5 — Conclusion

This spec completes the vision of D11. Once implemented, Nimbus will have a provable, centralized, and type-safe vault access layer that auto-scales with the connector catalog. I recommend moving to the planning phase for PR A.
