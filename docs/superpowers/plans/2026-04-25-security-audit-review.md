# Review — Security audit (B1) implementation plan

**Reviewer:** Gemini CLI
**Date:** 2026-04-25
**Related Plan:** [2026-04-25-security-audit.md](./2026-04-25-security-audit.md)

---

## Open Questions

1. **Subagent Model Consistency:**
   - The plan uses `opus` for Task 2 (Threat Model) but switches to `sonnet` for all Phase 2 deep-dives (Tasks 3–10). Is `sonnet` sufficiently rigorous for high-stakes security analysis of surfaces like Surface 2 (Vault) or Surface 6 (Updater)?
   - *Rationale:* While Sonnet is faster and very capable, security audits often benefit from the higher reasoning and "paranoia" of larger models (Opus) to catch subtle logical flaws.

2. **Commit Message Metadata (placeholder?):**
   - The commit messages in the plan consistently include `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`. This version of Claude does not exist as of April 2026. Is this a template placeholder, or should it be updated to reflect the actual model used (e.g., `Claude 3.5 Sonnet` or `Claude 3 Opus`)?

3. **Rate Limiting on Subagent Dispatches:**
   - The plan dispatches 8 sequential subagents. Has the risk of API rate-limiting or session-length limits been considered?
   - *Rationale:* If the audit takes 6-12 hours of active subagent time, the controller session may timeout or hit context limits.

## Suggestions

1. **Phase 3 "Chain Analysis" Verification Step:**
   - **Suggestion:** In Task 11 (Cross-surface chain-attack analysis), add a step to *verify* the feasibility of a chain attack by performing a deep-read of the specific files where the surfaces intersect.
   - **Why:** Identifying a chain "mentally" is a good start, but verifying that data actually flows from Surface A's vulnerability into Surface B's trigger point is essential for high-confidence reporting.
   - **Supporting Info:** Chained vulnerabilities are the primary focus of Surface 8 (MCP), where untrusted data flows into internal engine logic.

2. **Standardizing "Finding" Description Length:**
   - **Suggestion:** In the subagent prompts (§5 of the design spec and Tasks 3–10), specify a *minimum* description length (e.g., "at least 150 words") for High and Critical findings.
   - **Why:** High-severity findings need exhaustive detail for effective triage. Brief descriptions often lead to "NEEDS_CONTEXT" follow-ups which delay fixes.

3. **Search for "Forbidden" Debugging Code:**
   - **Suggestion:** In Surface 2 (Vault) and Surface 4 (Tauri), add a specific sub-task to Grep for common "accidental disclosure" patterns like `TODO: remove before release`, `alert(JSON.stringify(config))`, or hardcoded test tokens.
   - **Why:** These are "human error" patterns that automated scanners like Gitleaks might miss if the strings don't look like standard API keys.

4. **Self-Review Checklist Enhancement (Task 12, Step 5):**
   - **Suggestion:** Add a check to confirm that no finding contains *actual* secrets discovered during the audit (e.g., if a developer left a real test key in a file, the audit results should redact it and point to the line only).
   - **Why:** The audit doc itself should not become a security risk.

---

## Claims & Supporting Info

- **STRIDE Methodology:** Correctly implemented in the plan's Task 2 prompt.
- **`gh issue create` syntax:** The shell script pattern in Task 13 is correct and uses standard GitHub CLI arguments.
- **Conventional Commits:** The plan follows the repo's `docs(specs):` and `ci:` prefix conventions appropriately.
- **Tauri 38-method allowlist:** Verified in the review phase against `packages/ui/src-tauri/src/gateway_bridge.rs`.
