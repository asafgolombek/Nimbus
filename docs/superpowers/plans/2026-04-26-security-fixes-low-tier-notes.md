# Implementation Notes & Improvements: Security Fixes — Low-tier

This document tracks refinements and open questions for the [Low-tier Security Fixes Plan](./2026-04-26-security-fixes-low-tier.md).

## 1. URL Redaction Robustness (G6)

**Observation:** The proposed regex `/[a-z]+:\/\/[^\s]*@[^\s]+/gi` for URL userinfo redaction might be too restrictive for certain protocol schemes (e.g., `git+https://`).

**Improvement:** Use a more inclusive protocol pattern and ensure it handles multiple `@` symbols correctly (the last `@` before the path usually separates userinfo from host).

**Suggested Regex:** `/[a-zA-Z0-9\+\-\.]+:\/\/[^\s/]+@[^\s/]+/gi`

## 2. DPAPI Entropy Loss Recovery (G2)

**Question:** If a user accidentally deletes the `<configDir>/vault/.entropy` file, they will lose access to their vault entries encrypted with entropy.
- **Risk:** High for user data loss.
- **Mitigation:** Should we store a backup of the entropy file? Or should we include the entropy in the `nimbus data export` bundle (protected by the export passphrase)?
- **Suggestion:** For this PR, we should at least ensure the file is marked as hidden/system on Windows to prevent accidental deletion.

## 3. `patchPerson` Atomicity (G4)

**Observation:** Converting `patchPerson` to discrete `dbRun` calls makes the operation non-atomic unless wrapped in an external transaction.
- **Action:** I should audit all `patchPerson` callers. If any caller updates more than 3 fields at once, they must be wrapped in `db.transaction(() => ...)` to avoid partial state updates and reduce I/O overhead.

## 4. Centralizing Timing-Safe Hex Comparison (G6/G7)

**Improvement:** The plan suggests creating `packages/gateway/src/util/hex-compare.ts`.
- **Suggestion:** Ensure this utility is also used by the extension installer and any future components dealing with hashes (e.g., download verification). We should verify if a similar utility already exists in a "crypto-utils" file to avoid duplication.

## 5. `stopExtensionClient` Coverage (G7)

**Question:** Does `stopExtensionClient` cover all process types an extension might spawn?
- **Investigation Needed:** Check if extensions can spawn "background watchers" or other auxiliary processes that aren't tracked in the standard MCP client slots. If so, `mesh.stopExtensionClient` needs to be exhaustive.

## 6. KDF Allowlist Future-Proofing (G2)

**Observation:** `ACCEPTED_KDF_PROFILES` is a hardcoded list.
- **Improvement:** When we eventually want to increase the Argon2id iterations or memory (e.g., for Phase 5), we must remember to update this allowlist *before* any client generates the new manifest, otherwise old versions won't be able to import their own exports.

## 7. `connector.startAuth` Deprecation (G9)

**Suggestion:** The `connector.startAuth` alias is good for compatibility, but we should add a `@deprecated` JSDoc tag and a warning log in the gateway to encourage the frontend to move to `connector.auth`.
