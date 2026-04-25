# Design — Security audit (B1)

**Branch:** `dev/asafgolombek/security-audit`
**Date:** 2026-04-25
**Status:** Approved — ready for implementation plan
**Scope:** Second of three planned maintenance initiatives (toolchain refresh ✅ · this audit · later: B2 perf + B3 SOLID/duplication + B4 bug-hunt + third-party packages).

---

## 1. Goal

Produce a **prioritized findings list** for Nimbus across 8 trust boundaries, focused on issues that the existing automated security tooling does not catch. The output is a triaged worklist — this spec deliberately produces no fixes; each finding becomes a separate follow-up PR.

**Driver:** Phase 4 is approaching v0.1.0. Before the first signed release, a structured human review of the security-critical surfaces is needed to catch the categories of issue that automated tools miss systematically.

## 2. Methodology — threat-model-driven

Three sequential phases.

### Phase 1 — Threat model (~half day)

A single doc that, per trust boundary, enumerates:

- **Data crossing the boundary** (e.g., for IPC: JSON-RPC payloads carrying tool args, vault-resolved tokens, audit content)
- **Existing controls** (e.g., for vault: OS-native keystore + redaction in IPC client + 5-key forbidden-deep-scrub in Zustand persist)
- **Attacker capabilities at each side** (e.g., LAN peer = authenticated-but-untrusted-network)
- **Specific systemic questions to ask in deep-dive** (e.g., for HITL: "Does every code path that calls a connector tool first traverse the consent gate?")

Output: `docs/superpowers/specs/2026-04-25-security-audit-threat-model.md`.

### Phase 2 — Per-surface deep-dive (8 sequential subagents, ~3–6 hr each)

For each of the 8 surfaces, dispatch a fresh implementer subagent with:

- **Files to read** (the relevant source for that boundary, not the whole repo)
- **Threat-model excerpt** for that boundary
- **Specific security questions** to answer (drawn from the threat model)
- **Severity rubric** (see § 4)
- **Output format** (structured findings — see § 5)

Subagents run **sequentially**, not in parallel, so a finding from surface 2 (e.g., "vault-key strings appear in logs at line X") informs the search pattern for surfaces 5–8.

### Phase 3 — Consolidation (~half day)

- Dedupe cross-surface findings (the same root cause appearing in multiple surfaces consolidates to one entry, with all reproductions cited).
- Write the unified results doc.
- Open GitHub issues for every High and Medium finding with the `security` label, linking back to the results doc.
- Compute the summary table (counts per severity per surface).

## 3. The 8 surfaces

| # | Surface | Files (primary) |
|---|---|---|
| 1 | HITL enforcement | `packages/gateway/src/engine/executor.ts` and every caller |
| 2 | Vault credential surface | `packages/gateway/src/vault/*`, `packages/gateway/src/auth/*`, `packages/gateway/src/connectors/connector-vault.ts`, `packages/gateway/src/connectors/connector-secrets-manifest.ts` |
| 3 | LAN authorization | `packages/gateway/src/ipc/lan-server.ts`, `lan-rpc.ts`, `lan-pairing.ts`, `lan-rate-limit.ts`, `lan-crypto.ts` |
| 4 | Tauri allowlist | `packages/ui/src-tauri/src/gateway_bridge.rs` (38-method allowlist), `packages/ui/src-tauri/capabilities/default.json` |
| 5 | Raw SQL surface | `packages/cli/src/commands/query.ts` (`--sql` flag), `packages/gateway/src/db/verify.ts`, `packages/gateway/src/ipc/http-server.ts` (read-only API) |
| 6 | Updater pipeline | `packages/gateway/src/updater/updater.ts`, `manifest-fetcher.ts`, `signature-verifier.ts`, `public-key.ts` |
| 7 | Extension sandbox + manifest | `packages/gateway/src/extensions/*` (registry, manifest verify, child-process spawn) |
| 8 | MCP connector boundary | `packages/gateway/src/connectors/lazy-mesh.ts`, MCP response handling in engine, prompt-injection defenses |

Each surface gets its own subagent invocation in Phase 2.

## 4. Severity rubric

| Severity | Definition |
|---|---|
| **Critical** | Unauthenticated remote code execution. Credential disclosure to unauthorized party. Structural HITL bypass (action executed without consent gate firing). |
| **High** | Authenticated bypass of HITL/vault. Privilege escalation (e.g., LAN peer escalating from read to write without grant). Audit-chain integrity break (tamper-evident chain forgeable). Unsigned-code execution path (updater accepts unsigned binary). |
| **Medium** | Information disclosure via logs/IPC/error messages/audit body/telemetry. DoS (single peer can starve the gateway). Weak crypto choice (e.g., non-CSPRNG for security-critical randomness). Missing defense-in-depth where attacker is partly authenticated. |
| **Low** | Hardening / defense-in-depth gaps. Comment/doc inconsistencies that could mislead a future maintainer. Theoretical-only weaknesses with no realistic attack scenario. |

## 5. Subagent prompt template (per surface)

Each Phase 2 subagent prompt contains:

1. **Context & mandate** — "You are reviewing surface X of the Nimbus security audit. You have zero prior context."
2. **Files to read** (absolute paths) — only the relevant files for this surface.
3. **Threat-model excerpt for this boundary** — verbatim from Phase 1 doc.
4. **Specific security questions** to answer (5–15 per surface).
5. **Severity rubric** (verbatim from § 4 of this spec).
6. **Output format spec:**
   ```markdown
   ### Finding S{surface-num}-F{finding-num}: <short title>

   - **Severity:** Critical | High | Medium | Low
   - **File:** `path/to/file.ts:LINE`
   - **Description:** What the issue is, in one paragraph.
   - **Attack scenario:** Concrete steps an attacker would take.
   - **Existing controls that don't prevent it:** Why this slips past current defenses.
   - **Suggested fix:** Specific change needed (file + approach, not full code).
   - **Confidence:** High | Medium | Low (your confidence in the finding being a real issue, not a false positive).
   ```
7. **Verification rule:** Must read the actual file/line cited, not memory. False-positive findings (cannot reproduce by re-reading the code) get rejected during consolidation.
8. **Status format:** `DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`.

## 6. Output artifacts

| Artifact | Path | Phase |
|---|---|---|
| This design | `docs/superpowers/specs/2026-04-25-security-audit-design.md` | committed before plan |
| Implementation plan | `docs/superpowers/plans/2026-04-25-security-audit.md` | created by writing-plans skill after this spec |
| Threat model | `docs/superpowers/specs/2026-04-25-security-audit-threat-model.md` | Phase 1 |
| Consolidated findings | `docs/superpowers/specs/2026-04-25-security-audit-results.md` | Phase 3 |
| GitHub issues | `security` label, one per High/Medium finding | Phase 3 |

## 7. Out of scope

- **Fixing findings.** Each becomes its own follow-up PR; sequencing decided per-finding based on severity and Phase 4 workstream priority.
- **B2 (performance), B3 (SOLID/duplication/structure), B4 (bug-hunt).** Each gets its own spec.
- **Penetration testing / fuzzing.** Out of scope.
- **Cryptographic primitive review.** We accept NaCl box, Ed25519, BLAKE3, X25519 from their library implementations as trustworthy. Review covers only how we *use* them (key handling, mode of operation, IV/nonce reuse, constant-time comparisons).
- **Re-auditing what existing CI tools cover** — CVE scanning (Trivy / Cargo audit / Bun audit), secret-in-git detection (Gitleaks), CodeQL semantic vulnerabilities, SonarCloud rule violations, Scorecard supply-chain checks. We assume those passed; we focus on what they *don't* check.
- **Spec/plan/audit docs themselves.** They don't carry security risk.
- **Phase 5+ surfaces** (federation, P2P, mobile, hardware vault). Audit covers Phase 4 surfaces only.
- **macOS Keychain / Windows DPAPI / Linux libsecret implementations.** Library-level; reviewing the OS keystore behaviour is out of our control.

## 8. Verification & non-negotiables

- **Each subagent reads the actual cited file/line** to verify a finding exists. Memory-based findings rejected.
- **Cross-surface dedup happens during consolidation**, not by individual subagents.
- **No fix work during the review** — the moment a subagent or reviewer is tempted to propose code changes beyond the "Suggested fix" prose, that is scope creep.
- **Critical findings gate further work.** If Phase 2 surfaces any Critical, Phase 3 still produces the doc but the user is alerted explicitly so the Critical fix can leapfrog the rest of the worklist.
- **Confidence: Low findings are explicitly retained**, not auto-discarded. They become Low-priority discussion items in the doc rather than issues.

## 9. Acceptance criteria

The audit is complete when:

1. Threat-model doc covers all 8 boundaries with at least: data-flow summary + existing controls + 5+ specific questions per boundary.
2. Each surface has its findings section in the results doc.
3. All High and Medium findings have GitHub issues with the `security` label.
4. The results doc contains a summary table: 8 surfaces × 4 severities, count per cell.
5. The results doc contains a "Critical findings" section (empty if none).
6. A spec self-review pass on the results doc confirms: no placeholders, no duplicate findings across surfaces, no surface skipped, every cited file/line verifiably exists in the working tree at review time (i.e., re-`grep` the cited line as of consolidation; if the line moved due to interim refactor, update the citation or drop the finding).
7. The user reviews and approves the results doc before issues are filed.

## 10. Commit structure (for the planning phase)

This spec gets committed in one commit. The implementation plan gets committed in a second commit. Subsequent commits during execution:

1. `docs(specs): add security-audit threat model` (Phase 1)
2. `docs(specs): add per-surface findings for HITL enforcement` (Phase 2.1)
3. `docs(specs): add per-surface findings for vault credential surface` (Phase 2.2)
4. … one commit per surface (Phase 2.3 through 2.8)
5. `docs(specs): consolidate security-audit results` (Phase 3)

Issues are filed via `gh issue create` in Phase 3 — no commits associated with that step.

## 11. Branch and PR strategy

Working branch: `dev/asafgolombek/security-audit` (already created, branched from `main` after PR #99 merge).

Single PR at the end of Phase 3 containing:
- Threat-model doc
- Per-surface findings (one section per surface)
- Consolidated results doc

PR description summarizes findings counts and links to filed issues.

## 12. Follow-up specs

1. **`2026-??-??-security-audit-fixes-*-design.md`** — one or more specs that group findings into atomic fix PRs. Sequenced by severity.
2. **`2026-??-??-third-party-package-upgrades-design.md`** — npm + cargo crate upgrades, deferred from the toolchain refresh spec.
3. **`2026-??-??-perf-audit-design.md` (B2)** — performance review.
4. **`2026-??-??-structure-audit-design.md` (B3)** — SOLID / duplication / project structure.
5. **`2026-??-??-bug-hunt-design.md` (B4)** — open-ended bug review.

## 13. Sources

- [`docs/SECURITY.md`](../../SECURITY.md) — current security policy + boundary
- [`docs/security-hardening.md`](../../security-hardening.md) — current hardening guidance
- [`packages/gateway/src/engine/executor.ts`](../../../packages/gateway/src/engine/executor.ts) — HITL gate
- OWASP Top 10 (2024) — referenced for severity rubric calibration
- [STRIDE threat-modelling](https://learn.microsoft.com/en-us/azure/security/develop/threat-modeling-tool-threats) — referenced for trust-boundary enumeration
