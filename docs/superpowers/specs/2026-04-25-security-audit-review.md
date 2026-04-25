# Review — Security audit (B1) design

**Reviewer:** Gemini CLI
**Date:** 2026-04-25
**Related Spec:** [2026-04-25-security-audit-design.md](./2026-04-25-security-audit-design.md)

---

## Open Questions

1. **Subagent Tool Constraints:**
   - The spec mandates that subagents read actual files/lines. Will they have access to a tool that verifies the *runtime* state (e.g., `run_shell_command`) to test proof-of-concepts, or is this a pure static-analysis audit? 
   - *Rationale:* Security bugs like race conditions or environment-variable leaking are often hard to confirm without execution.

2. **Cross-Service Side Channels:**
   - How does the audit handle vulnerabilities that span multiple surfaces (e.g., a bug in Surface 8 [MCP] that allows bypassing Surface 1 [HITL])?
   - *Rationale:* The design focuses on per-surface subagents, but the most dangerous bugs are often "chains" across trust boundaries.

3. **In-Memory Credential Scrubbing:**
   - Is reviewing Bun's heap/memory management for long-lived secrets in scope for Surface 2?
   - *Rationale:* `redactPayloadForConsentDisplay` (in `executor.ts`) redacts for logs/IPC, but the secrets remain in memory. If a subagent finds a way to dump memory (e.g., via an extension), this is a critical boundary breach.

4. **"Master Key" Lifecycle:**
   - Does Nimbus use a master key to wrap vault secrets, or does it rely solely on the OS-native keystore's per-key isolation?
   - *Rationale:* If there is a "session key" generated at startup, its derivation and storage (e.g., in a temporary file or memory) is a high-value target.

## Suggestions

### 1. Structure Phase 1 with STRIDE
- **Suggestion:** Mandate that the Phase 1 Threat Model uses the **STRIDE** (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege) methodology for *each* of the 8 surfaces.
- **Why:** The current spec asks for "specific systemic questions," which can be arbitrary. STRIDE ensures a baseline level of rigor. For example, Surface 3 (LAN) should be explicitly audited for "Spoofing" (pairing interception) and "Information Disclosure" (e-to-e encryption bypass).

### 2. Add "Indirect Execution" to Surface 1 (HITL)
- **Suggestion:** Surface 1 should explicitly hunt for "Read" tools that can be coerced into "Write" actions.
- **Why:** A tool like `github.get_workflow_run` might seem safe (read-only), but if its output is passed unvetted to another tool, it could be used for prompt injection or command execution. The audit must look for tools that act as "proxies" for destructive actions.
- **Supporting Info:** `packages/gateway/src/engine/executor.ts` relies on a hardcoded `HITL_REQUIRED` set. If an action is missing from this set but allows writing (e.g., a generic `mcp.call_tool` that isn't wrapped), the gate is bypassed.

### 3. Surface 4 (Tauri) Method-Level Parameter Audit
- **Suggestion:** Expand Surface 4 to include a review of parameter validation for *every* method in the `ALLOWED_METHODS` list in `gateway_bridge.rs`.
- **Why:** An allowlist prevents calling forbidden methods, but if an allowed method (like `config.set`) doesn't validate the *input* strictly, it could be used to overwrite security-critical settings (e.g., pointing `NIMBUS_UPDATER_URL` to a malicious host).
- **Supporting Info:** `packages/ui/src-tauri/src/gateway_bridge.rs` currently lists 38 allowed methods. The audit should check if these methods use strong typing or `unknown` with Zod validation at the Gateway side.

### 4. Surface 7 (Extension) "Local File Read" Hunt
- **Suggestion:** Surface 7 should specifically test if a sandboxed extension can read files outside its own directory (e.g., `~/.ssh/id_rsa` or the Nimbus SQLite DB).
- **Why:** The `SECURITY.md` admits that the current sandbox (process separation + env injection) does not prevent reading files the OS user can access. The audit should quantify *exactly* how much access an extension has and if any "low-hanging fruit" OS-level sandboxing (like `node --experimental-permission` or `bwrap` on Linux) could be implemented as a "Suggested fix."

### 5. Surface 6 (Updater) "Downgrade Attack" Verification
- **Suggestion:** Surface 6 must explicitly check for "Downgrade Attack" protection.
- **Why:** If the updater doesn't verify that the new version is *greater* than the current version (semver check), an attacker who compromises the manifest can force a rollback to an older, vulnerable version of Nimbus.
- **Supporting Info:** `packages/gateway/src/updater/updater.ts` should be checked for `semver.gt()` or `semver.satisfies()` logic before applying the binary.

### 6. "Finding Confidence" Calibration
- **Suggestion:** Add a "Reproduced" flag to the output format in §5.
- **Why:** A finding with "High" confidence but no reproduction steps is less actionable. Requiring the subagent to state "Reproduced via [script/manual check]" or "Theoretically identified via code path [A -> B]" clarifies the risk.

---

## Improvement Checklist for Claude (Subagent)

- [ ] Ensure Surface 8 (MCP) includes a check for "Connector Impersonation" (can one MCP server claim to be another to steal credentials?).
- [ ] Add `packages/gateway/src/ipc/lan-crypto.ts` to the "Must Read" list for Surface 3 to check for nonce reuse in `sealBoxFrame`.
- [ ] Explicitly check `packages/gateway/src/db/write.ts` for SQL injection patterns in Surface 5, even if the primary interface is `sqlite-vec`.
