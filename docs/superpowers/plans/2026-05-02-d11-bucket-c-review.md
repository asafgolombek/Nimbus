# D11 Bucket C — Implementation Plan Review

**Reviewer:** Gemini CLI
**Date:** 2026-05-02
**Status:** ✅ Approved with minor suggestions for encapsulation and verification

---

## 1 — Executive Summary

The implementation plan at `docs/superpowers/plans/2026-05-02-d11-bucket-c.md` is detailed, well-structured, and correctly maps out the 21 violation sites. The TDD approach and the use of git worktrees ensure a safe and verifiable rollout.

## 2 — Suggestions for Improvement

### 2.1 Encapsulation of Shared OAuth Access

In line with my design review, I suggest incorporating `readSharedOAuth` and `writeSharedOAuth` helpers. This would change Tasks 3, 4, 11, and 12.

**Update to Task 3 (Task 3.1 Step 1):**
Include `readSharedOAuth` and `writeSharedOAuth` in `connector-vault.ts`.

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

**Update to Task 4 (Step 2):**
`ensureIfProviderOAuthSet` should use `readSharedOAuth`.

```ts
  private async ensureIfProviderOAuthSet(
    provider: SharedOAuthProvider,
    run: () => Promise<void>,
  ): Promise<void> {
    const v = await readSharedOAuth(this.vault, provider);
    if (v !== null && v !== "") {
      await run();
    }
  }
```

**Update to Task 12 (Steps 2 & 3):**
Use the new helpers in `connector-rpc-handlers.ts`.

```ts
// Step 2
return await readSharedOAuth(vault, "microsoft");

// Step 3
await writeSharedOAuth(vault, "microsoft", microsoftOAuthBackup);
```

### 2.2 Task 15 — Baseline Update Guidance

To ensure consistency in `docs/structure-audit/baseline.md`, use this exact replacement for the D11 line in the "Per-dimension baselines" table:

```markdown
| D11 | F | Vault-key construction outside allow-list | 0 violations | `bun run audit:invariants` (binary) |
```

And update the "Phase 2 follow-up" section to:

```markdown
## Phase 2 follow-up — Bucket C (2026-05-02)

D11 violations reduced from the Phase 1 baseline of 56 to **0**. **D11 closed.**

- Bucket A (20 false positives) — suppressed by `audit-ignore-next-line` markers (PR #135).
- Bucket B (15 sites) — routed through `readConnectorSecret` helper or added to the allow-list (PR #145).
- Bucket C (21 sites) — routed through `readConnectorSecret`, `writeConnectorSecret`, and `sharedOAuthKey` (PR <PR-2-number>).
```

### 2.3 Minor Logic Optimization (Task 12 Step 9)

While the explicit `if/else if` is correct, since the `sharedOAuthKey` signature is restricted to `SharedOAuthProvider`, you could technically use the variable if the type system allows, but keeping it explicit as proposed is safer and follows the existing pattern.

## 3 — Questions

- **Q:** Does `sharedOAuthKey` need to be exported if we provide `readSharedOAuth` and `writeSharedOAuth`?
  - **A:** Yes, it is still needed for the `sharedKey` assignment in `connector-rpc-handlers.ts` (Task 12 Step 9) because that key is passed to `writePerServiceOAuthKey`.

## 4 — Conclusion

The plan is excellent. Incorporating the suggested helpers will finalize the centralization of vault access patterns, making the codebase more resilient to future regressions.
