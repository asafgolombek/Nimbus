# Review: Design — Structure / SOLID / duplication audit (B3)

**Review Date:** 2026-04-30  
**Status:** ✅ Approved with technical suggestions  
**Spec File:** `docs/superpowers/specs/2026-04-30-structure-audit-design.md`

## Summary
The design for B3 is well-structured and follows the successful pattern established by B1 (Security) and B2 (Performance). The "Spiral Guard" stop-rule is a critical inclusion to prevent refactor-bloat.

---

## Technical Observations & Suggestions

### 1. Ratchet Mechanism for D8 (`any` count)
**Observation:** The current plan locks the `MAX_ANY_COUNT` at the Phase 1 baseline. While this prevents regression, it doesn't encourage continuous improvement.  
**Suggestion:** Implement a "ratchet" in the CI gate. If a PR reduces the `any` count, the gate should ideally update the baseline (or the PR should be required to update the pinned count) so that future PRs cannot re-introduce those removed `any`s. This turns a "no-regression" gate into a "continuous-improvement" gate.

### 2. D11 Scope Clarification (Vault Keys)
**Observation:** D11 targets vault-key construction outside `connector-vault.ts`.  
**Question:** Does this rule account for `auth/google-access-token.ts` and `auth/oauth-vault-tokens.ts`? These files handle platform-level OAuth keys which are distinct from per-connector secrets. The audit script should likely have an allow-list for these foundational auth modules, or the rule should be refined to "Connector-specific vault keys".

### 3. Sourcing Churn Data (Impact Score 4)
**Observation:** The `structural_impact_score` of 4 relies on identifying "high-churn hot paths" (80th percentile of commits in 90 days).  
**Question:** Which tool or script will provide this git-churn metric? It isn't explicitly listed in § 4.5.  
**Suggestion:** Add a small helper to `scripts/structure-audit/` (e.g., `get-git-churn.ts`) that calls `git rev-list --count --since="90 days ago" -- <file>` to provide this data to the `audit-structure.ts` orchestrator.

### 4. D12 Output for Future Migration (S5-F4)
**Observation:** D12 is a precursor census for the roadmap's `db.run()` migration.  
**Suggestion:** Ensure `check-nimbus-invariants.ts --rule db-run` outputs in a structured format (JSON/CSV) that includes the file, line number, and a snippet of the call. This will directly serve as the "Work Items" list for the future S5-F4 design spec, saving research time later.

### 5. D4: LOC vs. SLOC
**Observation:** Dimension D4 uses "File LOC > 800".  
**Suggestion:** Clarify if this is raw Lines of Code (including comments/blanks) or Source Lines of Code (SLOC). SLOC is generally a better indicator of complexity. If using raw LOC, 800 might be too low for files with extensive JSDoc/TSDoc.

### 6. Knip False Positives
**Observation:** Knip is excluded from the CI gate due to false positives.  
**Suggestion:** To keep the `knip-report.json` actionable, encourage the use of `@knip-ignore` or the `ignore` field in `knip.json` during Phase 1 so that the baseline "misses" are as clean as possible.

---

## Open Questions for the Designer

1. **Rule D10 (Spawn):** The rule checks for `spawn` calls not routed through `extensionProcessEnv()`. Does this apply only to `packages/gateway/src/connectors/`? There might be legitimate system-level spawns in `platform/` or `updater/` that should be excluded from this specific invariant.
2. **D9 (Risky Assertions):** Since this is informational, will it be used to identify "Type Safety debt" in the deferred backlog? It might be worth ranking these by "Type Distance" (e.g., `as unknown as T` is riskier than `as BaseType`).

## Final Verdict
The plan is excellent. The emphasis on "binary rules" for the CI gate ensures that structural enforcement doesn't become a burden on developer velocity while still protecting the most critical architectural boundaries.
