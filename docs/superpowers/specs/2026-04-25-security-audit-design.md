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
- **STRIDE breakdown** (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege) — for each STRIDE category, what could go wrong on this boundary, what existing control mitigates it, and what residual risk remains. STRIDE is the structured baseline; arbitrary "specific systemic questions" augment it on top.
- **Specific systemic questions to ask in deep-dive** (e.g., for HITL: "Does every code path that calls a connector tool first traverse the consent gate?") — the per-surface focus areas in § 4 below contain the starter set; threat-model authors are expected to add more as they think through STRIDE.

Output: `docs/superpowers/specs/2026-04-25-security-audit-threat-model.md`.

### Phase 2 — Per-surface deep-dive (8 sequential subagents, ~3–6 hr each)

For each of the 8 surfaces, dispatch a fresh implementer subagent with:

- **Files to read** (the relevant source for that boundary, not the whole repo)
- **Threat-model excerpt + STRIDE breakdown** for that boundary
- **Per-surface focus areas** (see § 4 below)
- **Severity rubric** (see § 5)
- **Output format** (structured findings — see § 6)

Subagents run **sequentially**, not in parallel, so a finding from surface 2 (e.g., "vault-key strings appear in logs at line X") informs the search pattern for surfaces 5–8.

**Subagent tool access (clarification):** Subagents have **read-only static-analysis tools** (Read, Grep, Bash for inspection like `cat`, `git log`, `ls`). They do **not** execute the gateway, do not exploit vulnerabilities, and do not modify files. PoC validation for findings that need runtime confirmation is deferred to the fix-PR phase. This keeps the audit scope bounded and the findings reviewable without execution side-effects.

### Phase 3 — Consolidation + chain analysis (~half day)

- Dedupe cross-surface findings (the same root cause appearing in multiple surfaces consolidates to one entry, with all reproductions cited).
- **Chain-attack analysis pass:** Re-read the per-surface findings looking for compositions — e.g., a Medium info-disclosure on Surface 8 (MCP) that, combined with a Low hardening gap on Surface 1 (HITL), produces a High structural HITL bypass. Each chain becomes its own finding entry with severity = max(component severities) + 1 if the chain enables a qualitatively new attack class. Document the chain explicitly: "Finding S1-F3 + Finding S8-F2 → Composite C1 (High)."
- Write the unified results doc.
- Open GitHub issues for every High and Medium finding with the `security` label, linking back to the results doc. Composite chain findings get their own issue + reference the component findings.
- Compute the summary table (counts per severity per surface, plus a separate composite-chains row).

## 3. The 8 surfaces

| # | Surface | Files (primary) |
|---|---|---|
| 1 | HITL enforcement | `packages/gateway/src/engine/executor.ts` and every caller |
| 2 | Vault credential surface | `packages/gateway/src/vault/*`, `packages/gateway/src/auth/*`, `packages/gateway/src/connectors/connector-vault.ts`, `packages/gateway/src/connectors/connector-secrets-manifest.ts`, `packages/gateway/src/db/data-vault-crypto.ts` (passphrase-derived key wrap for export bundles) |
| 3 | LAN authorization | `packages/gateway/src/ipc/lan-server.ts`, `lan-rpc.ts`, `lan-pairing.ts`, `lan-rate-limit.ts`, `lan-crypto.ts` |
| 4 | Tauri allowlist | `packages/ui/src-tauri/src/gateway_bridge.rs` (38-method allowlist), `packages/ui/src-tauri/capabilities/default.json` |
| 5 | Raw SQL surface | `packages/cli/src/commands/query.ts` (`--sql` flag), `packages/gateway/src/db/verify.ts`, `packages/gateway/src/db/write.ts` (central write wrapper — verify SQLi patterns even though primary writes go through the schema), `packages/gateway/src/ipc/http-server.ts` (read-only API) |
| 6 | Updater pipeline | `packages/gateway/src/updater/updater.ts`, `manifest-fetcher.ts`, `signature-verifier.ts`, `public-key.ts` |
| 7 | Extension sandbox + manifest | `packages/gateway/src/extensions/*` (registry, manifest verify, child-process spawn) |
| 8 | MCP connector boundary | `packages/gateway/src/connectors/lazy-mesh.ts`, MCP response handling in engine, prompt-injection defenses |

Each surface gets its own subagent invocation in Phase 2.

## 4. Per-surface focus areas

These are the **specific** questions each subagent must answer in addition to the STRIDE breakdown from Phase 1. They are starter prompts; the subagent and threat-model author are expected to add more.

### Surface 1 — HITL enforcement
- Enumerate every tool exposed to the agent loop. For each, classify as: (a) explicitly read-only (no write side effect even with malicious args), (b) in `HITL_REQUIRED` set, (c) wrapped by a HITL-gated wrapper. Any tool not in (a)–(c) is a finding.
- **Indirect-execution / read-as-write hunt:** is there any "read" tool whose output flows unvetted into another tool's args, allowing a chained execution that was never gated? (Watch for: workflow runners, sub-agent coordinator, watcher engine.)
- Verify every code path that calls a connector tool first traverses `executor.executeAction()` — no direct `mcpClient.callTool()` shortcuts.
- Sub-agent gate: does `coordinator.ts` / `sub-agent.ts` enforce HITL on actions invoked by spawned sub-agents?
- LAN peer gate: does an LAN peer write call also fire HITL on the host?

### Surface 2 — Vault credential surface
- Trace every read path of vault entries. For each, verify no secret material reaches: logs (`pino`), IPC payloads, error messages, audit-log entry body, telemetry counters, LAN frame plaintext (before sealBox encryption).
- **Memory residence:** acknowledge JS string immutability; the question is whether the *boundary* holds (no extension reads gateway memory, no debug endpoint dumps process state). Fixing residence within Bun is largely outside our control and explicitly out of scope.
- **Master-key path:** OS-keystore-stored vault entries are *not* wrapped with a session key — each is a direct keystore entry. The exception is `data-vault-crypto.ts` which wraps export bundles with a passphrase-derived key. Verify (a) the KDF parameters (Argon2id / scrypt cost factors), (b) no leakage of passphrase or derived key in error/log paths, (c) recovery-seed handling matches the same hygiene.
- Per-service OAuth refresh: confirm refreshed tokens overwrite the old vault entry atomically (no plaintext window on disk).

### Surface 3 — LAN authorization
- Method allowlist: every method exposed to LAN peers must be defensible. Read `lan-rpc.ts` `checkLanMethodAllowed`; cross-reference against the full method registry; flag any write-class method that's allowed without the write-grant check.
- **Nonce reuse in `sealBoxFrame`:** verify `randomBytes(24)` is called per-frame (it is, line 20). Hunt for any path that could reuse a nonce — e.g., retry logic that re-sends the same frame without re-encrypting with a fresh nonce.
- Pairing-window expiry: confirm `PairingWindow` rejects pairing attempts after the 5-minute window even under clock-skew or replay.
- Rate-limit isolation: `LanRateLimiter` per-IP — verify a single peer can't exhaust a global resource (memory, connection count).
- Peer authentication: a paired peer's X25519 public key is the sole identity; verify the storage path (`lan_peers` table) can't be tampered with by another peer to assume their identity.

### Surface 4 — Tauri allowlist
- Read every method in `ALLOWED_METHODS` (38 entries). For each, document: parameter shape, server-side validation (Zod schema or otherwise), worst-case if frontend supplies malicious args.
- **Method-level parameter audit:** specifically flag any `config.set`, `connector.configure`, or similar setter that accepts a key+value pair where the key isn't whitelisted — frontend setting `NIMBUS_UPDATER_URL` to a malicious host is a code-execution vector.
- `NO_TIMEOUT_METHODS` list: does the absence of timeout open a DoS vector from the frontend?
- `GLOBAL_BROADCAST_METHODS`: does the broadcast leak any per-window state to other windows that shouldn't see it?
- `capabilities/default.json`: confirm `fs.allow`/`fs.deny`, `shell.allow`, etc. are minimal.

### Surface 5 — Raw SQL surface
- `nimbus query --sql` opens a connection — verify it's `SQLITE_OPEN_READONLY` and that the read-only flag actually prevents writes (test via attempted INSERT? — no, static check the code).
- **PRAGMA / ATTACH escape:** can the user-supplied SQL include `PRAGMA writable_schema = 1` or `ATTACH DATABASE` to escalate? bun:sqlite's read-only mode should prevent both, but verify.
- `db/write.ts` central wrapper: verify all writes use parameterized statements (`?` or named bindings), never string concatenation.
- `db/verify.ts` integrity checks: confirm they don't expose internals (e.g., dumping vault keys or audit content via verbose error messages).
- `ipc/http-server.ts` read-only API: confirm localhost-only binding is enforced and no path allows writes.

### Surface 6 — Updater pipeline
- **Signature verification correctness:** trace `verifyBinarySignature` (`signature-verifier.ts`) — Ed25519 over SHA-256 of binary, with the embedded public key from `public-key.ts`. Verify constant-time comparison, no early-return on mismatch.
- Manifest fetch: `manifest-fetcher.ts` uses `AbortController` timeout — confirm TLS verification is on, no insecure HTTP fallback.
- **Downgrade attack:** `semverGreater()` at `updater.ts:170` — verify it's strictly `>` and that an attacker controlling the manifest can't force a rollback to an older vulnerable version. (Any version-pinning floor that prevents downgrade-below-current.)
- Public key embedding: `public-key.ts` exports the trusted Ed25519 key. Confirm `NIMBUS_DEV_UPDATER_PUBLIC_KEY` env-var override is gated to dev/test builds and cannot be set by a non-admin user to inject a forged key.
- Rollback safety: if signature verify passes but install fails, does the previous binary remain intact?

### Surface 7 — Extension sandbox + manifest
- SHA-256 manifest verification: read the verifier — verify it compares the recorded hash against the actual file bytes, with constant-time comparison.
- Capability boundary: what *can't* an extension do that a regular Bun script can? (Spoiler: probably very little — extensions inherit OS user permissions.)
- **Local file read scope:** quantify what files an extension can read. Specifically: can it read `~/.ssh/id_rsa`, the Nimbus SQLite DB at the standard paths, the OS keystore via `secret-tool` / `security` / DPAPI? Note as findings, with severity proportional to user-data exposure.
- **Suggested-fix material (not in this audit's scope to implement):** `node --experimental-permission` (Node-side; not applicable to Bun?), `bwrap` on Linux, `sandbox-exec` on macOS, AppContainer on Windows.
- Child-process isolation: confirm the child can't `process.kill(parentPid)` or signal the gateway.
- MCP transport: extensions communicate over stdio — confirm no path lets an extension reach the IPC server directly (bypassing gateway-internal access controls).

### Surface 8 — MCP connector boundary
- **Connector impersonation:** can connector A claim to be connector B (e.g., by spoofing the `tool` name in MCP responses) to steal credentials destined for B? Verify the MCP client routes credentials by the connector identity it spawned, not by the tool name in the response.
- Prompt-injection defense: per `SECURITY.md`, "typed data blocks, never instructions." Verify MCP responses are wrapped in a `<data>` tag (or similar typed envelope) before being inserted into LLM context — never rendered as raw markdown that could include `Now ignore previous instructions and...`.
- MCP response → tool args: if a connector returns data that the agent then passes as args to another tool (the "indirect execution" pattern from Surface 1), verify the agent's tool-arg construction validates against expected schemas.
- Sandbox escape via crafted MCP responses: can a malicious connector reply (e.g., very large response, malformed JSON, recursive structures) crash the gateway or leak memory?
- Lazy-mesh spawn: `lazy-mesh.ts` spawns connector child processes on demand — verify the spawn args don't expose vault contents in `process.env` to other connectors (each connector should get only its own credentials).

## 5. Severity rubric

| Severity | Definition |
|---|---|
| **Critical** | Unauthenticated remote code execution. Credential disclosure to unauthorized party. Structural HITL bypass (action executed without consent gate firing). |
| **High** | Authenticated bypass of HITL/vault. Privilege escalation (e.g., LAN peer escalating from read to write without grant). Audit-chain integrity break (tamper-evident chain forgeable). Unsigned-code execution path (updater accepts unsigned binary). |
| **Medium** | Information disclosure via logs/IPC/error messages/audit body/telemetry. DoS (single peer can starve the gateway). Weak crypto choice (e.g., non-CSPRNG for security-critical randomness). Missing defense-in-depth where attacker is partly authenticated. |
| **Low** | Hardening / defense-in-depth gaps. Comment/doc inconsistencies that could mislead a future maintainer. Theoretical-only weaknesses with no realistic attack scenario. |

## 6. Subagent prompt template (per surface)

Each Phase 2 subagent prompt contains:

1. **Context & mandate** — "You are reviewing surface X of the Nimbus security audit. You have zero prior context."
2. **Files to read** (absolute paths) — only the relevant files for this surface.
3. **Threat-model excerpt for this boundary** — verbatim from Phase 1 doc.
4. **Specific security questions** to answer (5–15 per surface).
5. **Severity rubric** (verbatim from § 5 of this spec).
6. **Output format spec:**
   ```markdown
   ### Finding S{surface-num}-F{finding-num}: <short title>

   - **Severity:** Critical | High | Medium | Low
   - **File:** `path/to/file.ts:LINE`
   - **Description:** What the issue is, in one paragraph.
   - **Attack scenario:** Concrete steps an attacker would take.
   - **Existing controls that don't prevent it:** Why this slips past current defenses.
   - **Suggested fix:** Specific change needed (file + approach, not full code).
   - **Confidence:** High | Medium | Low (how confident the finding is real, not a false positive).
   - **Verification:** `code-trace` (followed the call graph by reading code, but no runtime check) | `runtime-verified` (PoC reproduced; reserve for fix-PR phase, not used in this audit) | `speculative` (pattern-matches a known issue class but couldn't fully confirm via static reading).
   ```
   For this audit's static-analysis phase, every finding must be either `code-trace` or `speculative`. `runtime-verified` is reserved for the fix-PR phase where the engineer reproduces the issue before patching.
7. **Verification rule:** Must read the actual file/line cited, not memory. False-positive findings (cannot reproduce by re-reading the code) get rejected during consolidation.
8. **Status format:** `DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`.

## 7. Output artifacts

| Artifact | Path | Phase |
|---|---|---|
| This design | `docs/superpowers/specs/2026-04-25-security-audit-design.md` | committed before plan |
| Implementation plan | `docs/superpowers/plans/2026-04-25-security-audit.md` | created by writing-plans skill after this spec |
| Threat model | `docs/superpowers/specs/2026-04-25-security-audit-threat-model.md` | Phase 1 |
| Consolidated findings | `docs/superpowers/specs/2026-04-25-security-audit-results.md` | Phase 3 |
| GitHub issues | `security` label, one per High/Medium finding | Phase 3 |

## 8. Out of scope

- **Fixing findings.** Each becomes its own follow-up PR; sequencing decided per-finding based on severity and Phase 4 workstream priority.
- **B2 (performance), B3 (SOLID/duplication/structure), B4 (bug-hunt).** Each gets its own spec.
- **Penetration testing / fuzzing.** Out of scope.
- **Cryptographic primitive review.** We accept NaCl box, Ed25519, BLAKE3, X25519 from their library implementations as trustworthy. Review covers only how we *use* them (key handling, mode of operation, IV/nonce reuse, constant-time comparisons).
- **Re-auditing what existing CI tools cover** — CVE scanning (Trivy / Cargo audit / Bun audit), secret-in-git detection (Gitleaks), CodeQL semantic vulnerabilities, SonarCloud rule violations, Scorecard supply-chain checks. We assume those passed; we focus on what they *don't* check.
- **Spec/plan/audit docs themselves.** They don't carry security risk.
- **Phase 5+ surfaces** (federation, P2P, mobile, hardware vault). Audit covers Phase 4 surfaces only.
- **macOS Keychain / Windows DPAPI / Linux libsecret implementations.** Library-level; reviewing the OS keystore behaviour is out of our control.

## 9. Verification & non-negotiables

- **Each subagent reads the actual cited file/line** to verify a finding exists. Memory-based findings rejected.
- **Cross-surface dedup happens during consolidation**, not by individual subagents.
- **No fix work during the review** — the moment a subagent or reviewer is tempted to propose code changes beyond the "Suggested fix" prose, that is scope creep.
- **Critical findings gate further work.** If Phase 2 surfaces any Critical, Phase 3 still produces the doc but the user is alerted explicitly so the Critical fix can leapfrog the rest of the worklist.
- **Confidence: Low findings are explicitly retained**, not auto-discarded. They become Low-priority discussion items in the doc rather than issues.

## 10. Acceptance criteria

The audit is complete when:

1. Threat-model doc covers all 8 boundaries with at least: data-flow summary + existing controls + 5+ specific questions per boundary.
2. Each surface has its findings section in the results doc.
3. All High and Medium findings have GitHub issues with the `security` label.
4. The results doc contains a summary table: 8 surfaces × 4 severities, count per cell.
5. The results doc contains a "Critical findings" section (empty if none).
6. A spec self-review pass on the results doc confirms: no placeholders, no duplicate findings across surfaces, no surface skipped, every cited file/line verifiably exists in the working tree at review time (i.e., re-`grep` the cited line as of consolidation; if the line moved due to interim refactor, update the citation or drop the finding).
7. The user reviews and approves the results doc before issues are filed.

## 11. Commit structure (for the planning phase)

This spec gets committed in one commit. The implementation plan gets committed in a second commit. Subsequent commits during execution:

1. `docs(specs): add security-audit threat model` (Phase 1)
2. `docs(specs): add per-surface findings for HITL enforcement` (Phase 2.1)
3. `docs(specs): add per-surface findings for vault credential surface` (Phase 2.2)
4. … one commit per surface (Phase 2.3 through 2.8)
5. `docs(specs): consolidate security-audit results` (Phase 3)

Issues are filed via `gh issue create` in Phase 3 — no commits associated with that step.

## 12. Branch and PR strategy

Working branch: `dev/asafgolombek/security-audit` (already created, branched from `main` after PR #99 merge).

Single PR at the end of Phase 3 containing:
- Threat-model doc
- Per-surface findings (one section per surface)
- Consolidated results doc

PR description summarizes findings counts and links to filed issues.

## 13. Follow-up specs

1. **`2026-??-??-security-audit-fixes-*-design.md`** — one or more specs that group findings into atomic fix PRs. Sequenced by severity.
2. **`2026-??-??-third-party-package-upgrades-design.md`** — npm + cargo crate upgrades, deferred from the toolchain refresh spec.
3. **`2026-??-??-perf-audit-design.md` (B2)** — performance review.
4. **`2026-??-??-structure-audit-design.md` (B3)** — SOLID / duplication / project structure.
5. **`2026-??-??-bug-hunt-design.md` (B4)** — open-ended bug review.

## 14. Sources

- [`docs/SECURITY.md`](../../SECURITY.md) — current security policy + boundary
- [`docs/security-hardening.md`](../../security-hardening.md) — current hardening guidance
- [`packages/gateway/src/engine/executor.ts`](../../../packages/gateway/src/engine/executor.ts) — HITL gate
- OWASP Top 10 (2024) — referenced for severity rubric calibration
- [STRIDE threat-modelling](https://learn.microsoft.com/en-us/azure/security/develop/threat-modeling-tool-threats) — referenced for trust-boundary enumeration
