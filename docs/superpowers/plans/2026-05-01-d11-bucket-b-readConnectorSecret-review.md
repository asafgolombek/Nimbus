# D11 Bucket B — `readConnectorSecret` Implementation Plan Review Feedback

**Date:** 2026-05-01
**Reviewer:** Gemini CLI
**Target Plan:** [`2026-05-01-d11-bucket-b-readConnectorSecret.md`](./2026-05-01-d11-bucket-b-readConnectorSecret.md)

---

## 1 — Suggestions & Improvements

### 1.1 — Verification Floor (Task 11)
Task 11 Step 2 checks for a floor of 15 `readConnectorSecret` calls. 

**Suggestion:** To be even more precise, the check could be:
`git grep -E 'readConnectorSecret\(' packages/gateway/src/ --invert-match -l 'connector-vault\.ts' | wc -l`
This excludes the definition site and the test file (if it's in a separate package or excluded by path), focusing only on the production call sites. The target count for production callers should be exactly **15** (per the table in §4.1 of the spec).

### 1.2 — Audit Hardening (Task 12 Option)
My design review suggested hardening the `VAULT_KEY_RE` post-migration. 

**Suggestion:** While the plan currently deferrs this to Bucket C, adding it as a final sub-task in Task 12 would be a strong "definition of done" for Bucket B. By adding `app_key|api_token|site|account_id` to the regex, we immediately confirm that the migration was comprehensive and that no sibling keys were left behind.

### 1.3 — Comment Style Consistency (Task 3)
The design spec §4.2 and §7 mention "recorded inline". The plan in Task 3 uses block comments.

**Technical Nitpick:** While block comments are generally better for long explanations, if the automated audit ever evolves to parse these comments (e.g., to generate reports), consistency matters. I recommend sticking to the inline style if that's what the "structural reasons" rule usually follows.

## 2 — Questions

### 2.1 — Biome and Type Imports
In Task 2 Step 4, you run `bun run lint:fix`. 

**Question:** Since `ConnectorSecretKeyOf` uses `ConnectorServiceId` and `readConnectorSecret` uses `NimbusVault`, will `lint:fix` automatically add these as **type-only** imports if they aren't already there?
`import type { NimbusVault } from "../vault/nimbus-vault.ts";`
`import type { ConnectorServiceId } from "./connector-catalog.ts";`
The plan's code snippet in Step 3 doesn't show the type imports. Ensure they are present or added.

### 2.2 — Task 12 and `risky-assertions.json`
Task 12 Step 3 mentions checking for deltas in `risky-assertions.json`.

**Observation:** Since the iterator now skips `/testing/`, I expect `risky-assertions.json` to shrink significantly if the test utilities use many type assertions (common in test setup). This is a positive change for the audit signal quality.

---

## 3 — Overall Assessment

The plan is exceptionally detailed and provides clear, commit-by-commit instructions. The TDD approach in Task 1 and Task 2 ensures the foundational changes are verified before the bulk migration starts. The verification tasks (11, 14) provide a high degree of confidence in the final PR state.
