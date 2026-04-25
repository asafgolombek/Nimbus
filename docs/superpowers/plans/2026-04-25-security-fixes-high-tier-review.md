# Review — Security Fixes — High-tier (PR 1 of 3) Implementation Plan

**Reviewer:** Gemini CLI
**Date:** 2026-04-25
**Related Plan:** [2026-04-25-security-fixes-high-tier.md](./2026-04-25-security-fixes-high-tier.md)

---

## Open Questions

1. **`extensionProcessEnv` Consolidation (Task 2):**
   - The plan rewrites `packages/gateway/src/extensions/spawn-env.ts`. However, Task 3 then applies this to all MCP spawn sites in `lazy-mesh.ts`. Should we consider moving this logic to a more central location (e.g., `packages/gateway/src/platform/env-util.ts`) to avoid a dependency from `connectors` to `extensions`?
   - *Rationale:* Following the project's dependency rules, keeping core utilities in a shared location prevents circular dependencies and promotes reuse across different subsystems (Sync, Voice, etc.).

2. **Impact on Marketplace UI (Task 13):**
   - Removing `extension.install` from the Tauri allowlist will immediately break the current installation flow in the Marketplace UI. Is the "Tauri event flow with native dialog" mentioned in Task 13 intended to be implemented in a *separate* PR, or should it be part of this one?
   - *Rationale:* If not implemented together, the Marketplace will be non-functional for installs until the next PR lands.

3. **`data.delete` Preflight Timeout (Task 11):**
   - When threading the `ToolExecutor` into `data-rpc.ts`, should we add a timeout to the `prefetchDeleteStats` call?
   - *Rationale:* If the database is under heavy load or locked, a hanging preflight could block the IPC response indefinitely.

## Suggestions

1. **Baseline Keys Expansion (Task 2):**
   - **Suggestion:** Add `LANG` and `TZ` to the `BASELINE_KEYS` list in `spawn-env.ts`.
   - **Why:** Many CLI tools and runtimes (including `bun`) use these to set locale and timezone correctly. Without them, log timestamps or character encoding in child processes might drift from the host.
   - **Reference:** MCP SDK's `getDefaultEnvironment()` includes these by default on POSIX.

2. **Harden `public-key.ts` Guard (Task 22):**
   - **Suggestion:** Use a build-time constant (e.g., `process.env.BUILD_TYPE === 'official'`) instead of `NODE_ENV === 'production'` for the dev-key guard.
   - **Why:** `NODE_ENV` is easily spoofed. A build-time replacement that hardcodes the check into the binary is much harder to bypass.

3. **Unified Redaction Regex (Task 6):**
   - **Suggestion:** In `executor.ts`, consolidate the multiple keyword sets into a single `SENSITIVE_KEY_PATTERN` that is shared by the Audit, Consent, and Telemetry layers.
   - **Why:** The audit results (S2-F1/S7-F1/S8-F1) noted three independent redaction keyword sets existed. Standardizing this now prevents "leakage" where one layer redacts more than another.

4. **Verify `connector.addMcp` LAN Block (Task 15):**
   - **Suggestion:** Explicitly test that `connector.addMcp` is blocked even for peers with `writeAllowed: true`.
   - **Why:** Some mutating methods are allowed for write-peers, but `addMcp` (arbitrary binary execution) should be forbidden for *all* network-adjacent peers as a structural rule.

5. **`extensionProcessEnv` Array Filtering:**
   - **Suggestion:** In `spawn-env.ts`, ensure that if `extra` contains any keys that overlap with the gateway's sensitive keys (e.g., `ANTHROPIC_API_KEY`), the `extra` values are still used (as they are the "authorized" ones for that connector), but warn if they are identical to the host's values.
   - **Why:** This ensures the connector gets what it needs while preventing accidental host-env leakage.

---

## Technical Claims Verification

- **Tauri Allowlist Size:** The plan correctly identifies the need to update the length assertion (56 → 55) in `gateway_bridge.rs`.
- **`lan.bind` Default:** Verified that `"127.0.0.1"` is the correct target for loopback-only binding in `nimbus-toml.ts`.
- **`data.delete` HITL:** Verified that the plan removes the hardcoded `hitlStatus` in `data-delete.ts` and correctly shifts it to the `executor.gate()` path.
