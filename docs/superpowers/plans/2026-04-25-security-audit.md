# Security Audit (B1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the 3-phase, threat-model-driven security audit defined in the design spec — produce a threat model, then 8 per-surface findings sections, then a consolidated results doc with GitHub issues for High/Medium findings.

**Architecture:** Three phases, all running on `dev/asafgolombek/security-audit`: (1) one subagent writes the threat model covering all 8 boundaries with STRIDE breakdowns, (2) eight sequential subagents perform per-surface deep-dive review and emit structured findings into a shared results doc, (3) the controller (this session) does cross-surface chain analysis, computes the summary table, and files GitHub issues. No production code is modified — output is documentation + issues only.

**Subagent model selection:** Phase 2 surfaces with high crypto/credential/data-flow stakes use `opus` (Surfaces 2, 3, 6, 8 — Vault, LAN, Updater, MCP). Surfaces with more mechanical review (Surfaces 1, 4, 5, 7 — HITL enumeration, Tauri parameter audit, SQL parameterization, capability quantification) use `sonnet`. Threat model (Task 2) uses `opus` for holistic synthesis. Rationale: per-surface focus areas already structure the work; sonnet is sufficient where the questions are well-bounded and the answers are checklist-style verifications. Opus is reserved for surfaces where subtle logic flaws are most likely.

**Context-management note:** Per-surface findings are durably written to the results doc *before* the controller marks the task complete. If the controller's session is restarted between Phase 2 tasks, no work is lost — Tasks 11 and 12 re-read the doc end-to-end. If your context is approaching limits after Phase 2, complete Phase 3 (Tasks 11–14) in a fresh session by re-reading the spec, plan, and results doc to rebuild context.

**Tech Stack:** Markdown documentation only. Read-only static-analysis tools (Read, Grep, Bash for inspection). `gh` CLI for issue filing. No tests, no builds, no runtime execution of the gateway.

**Spec:** [`docs/superpowers/specs/2026-04-25-security-audit-design.md`](../specs/2026-04-25-security-audit-design.md)
**Branch:** `dev/asafgolombek/security-audit` (already created from `main` after PR #99 merged)

---

## File map

Files created during execution (all docs, all on the audit branch):

| Path | Created in | Purpose |
|---|---|---|
| `docs/superpowers/specs/2026-04-25-security-audit-threat-model.md` | Task 2 | STRIDE-structured threat model for all 8 boundaries |
| `docs/superpowers/specs/2026-04-25-security-audit-results.md` | Tasks 3–12 (incrementally appended) | Per-surface findings + consolidated results + summary table |

GitHub issues filed in Task 13 — no associated file changes; only `gh issue create` invocations.

No production source files are read with the intent to modify. Reads are for analysis only.

---

## Task 1: Pre-flight verification

**Files:** none modified — branch state confirmation only.

- [ ] **Step 1: Confirm branch + clean working tree**

Run:
```bash
git status --short && git branch --show-current && git log --oneline -3
```
Expected:
- `git status --short` may show `.claude/settings.local.json` modified (harness state — ignore); no other modifications.
- `git branch --show-current` → `dev/asafgolombek/security-audit`
- `git log --oneline -3` first commit message starts with `docs(specs): apply security-audit design-review feedback` (commit `000df42` or whatever the head is after the design + review fold-in).

If anything is wrong, STOP and resolve before proceeding.

- [ ] **Step 2: Confirm the design spec is in place**

Run:
```bash
ls -1 docs/superpowers/specs/2026-04-25-security-audit-{design,review}.md
```
Expected: both files listed.

- [ ] **Step 3: No commit — purely confirmatory**

This task produces no commit. Proceed to Task 2.

---

## Task 2: Phase 1 — Write the threat model doc

**Files:**
- Create: `docs/superpowers/specs/2026-04-25-security-audit-threat-model.md`

**Approach:** Dispatch a fresh subagent that reads the design spec, then writes the threat model. Use **opus** because this is judgment-heavy work that requires holistic system understanding.

- [ ] **Step 1: Dispatch the threat-model subagent**

Send this prompt to a new general-purpose subagent (model: `opus`):

````markdown
You are the threat-model subagent for the Nimbus security audit. You have zero prior context — this prompt contains everything you need.

# Context

- Repo: `C:\gitrepo\Nimbus`
- Branch: `dev/asafgolombek/security-audit` (already checked out; clean working tree apart from `.claude/settings.local.json` which you should ignore)
- Platform: Windows 11; shell: bash (use Unix syntax)
- Tools available: Read, Grep, Bash for inspection (cat, ls, git log). Do NOT run the gateway. Do NOT modify any source code. Reading is only to understand the system; the only file you create is the threat model doc.

# Your task

Read the design spec at `docs/superpowers/specs/2026-04-25-security-audit-design.md` (especially §3 surface list and §4 per-surface focus areas). Then read enough of the actual code under `packages/gateway/src/`, `packages/cli/src/`, `packages/ui/src-tauri/src/` to produce an accurate threat model.

Write the threat model to `docs/superpowers/specs/2026-04-25-security-audit-threat-model.md` with this structure:

```markdown
# Threat model — Nimbus security audit (B1)

**Date:** 2026-04-25
**Related design:** [2026-04-25-security-audit-design.md](./2026-04-25-security-audit-design.md)
**Audit branch:** `dev/asafgolombek/security-audit`

---

## Overview

[2-3 paragraphs: what Nimbus is from a security-architecture perspective, the broad attacker model (untrusted network peer, untrusted MCP connector, untrusted extension, malicious frontend, malicious local user, etc.), and how the 8 trust boundaries fit together.]

---

## Trust boundary diagram

[Brief ASCII diagram or bullet hierarchy showing the boundaries and how data flows between them. Not required to be a full DFD — a clear ordered list with arrows is enough.]

---

## Surface 1 — HITL enforcement

### Data crossing the boundary
[What flows in: user intent → planned action; what flows out: consent verdict + executed-or-blocked status. Include audit log entry written before execution.]

### Existing controls
[List specific controls: HITL_REQUIRED frozen Set in executor.ts; structural enforcement (cannot be bypassed by config); audit-before-execute; etc. Cite file:line for each.]

### Attacker capabilities
[Who could attack this and how: malicious extension running with same-process privileges; LAN peer with write grant; sub-agent recursion; crafted workflow YAML; etc.]

### STRIDE
- **Spoofing:** [Can someone forge a HITL approval? Can a sub-agent claim to have already gated an action?]
- **Tampering:** [Can the HITL_REQUIRED set be modified at runtime? Can audit entries be retroactively altered?]
- **Repudiation:** [Can a user deny they approved an action? Is the audit log tamper-evident enough to prove non-repudiation?]
- **Information Disclosure:** [Does the HITL preview leak vault data? Does a rejected request still reveal the action's parameters?]
- **Denial of Service:** [Can an attacker spam HITL requests to drown legitimate ones?]
- **Elevation of Privilege:** [Read-tool-as-write-proxy patterns; sub-agent escalation; LAN-peer escalation; workflow-runner escalation.]

### Specific systemic questions for the deep-dive subagent
[5-15 concrete questions, building on the focus areas from §4 of the design spec but adding system-specific detail you discovered while reading. Each question is verifiable by static analysis.]

### Residual risks
[What we know we can't fix at this layer (e.g., "process-level memory access by malicious extension is outside HITL's scope; covered in Surface 7").]

---

## Surface 2 — Vault credential surface
[Same structure: data crossing, existing controls, attacker capabilities, STRIDE, specific questions, residual risks.]

---

## Surface 3 — LAN authorization
[Same structure.]

---

## Surface 4 — Tauri allowlist
[Same structure.]

---

## Surface 5 — Raw SQL surface
[Same structure.]

---

## Surface 6 — Updater pipeline
[Same structure.]

---

## Surface 7 — Extension sandbox + manifest
[Same structure.]

---

## Surface 8 — MCP connector boundary
[Same structure.]

---

## Cross-boundary observations

[Cross-cutting concerns the per-surface treatment doesn't capture: e.g., a single redaction utility used by multiple boundaries; consistent use of constant-time comparisons; environment-variable hygiene across child-process spawns. Things the chain-attack analysis in Phase 3 might focus on.]
```

# Constraints

- Read code to ground claims. No memory-based assertions about file contents — every cited file:line must be checked by Read or Grep first.
- Be specific. "Validate inputs" is not a control; "Zod schema at packages/gateway/src/ipc/handler.ts:42 validates input shape before dispatch" is.
- Each surface's STRIDE section needs at least one concrete sentence per category — not just "yes/no" but "the specific risk and what mitigates it."
- Each surface's "specific systemic questions" must be 5-15 questions a human reviewer could answer in 2-4 hours.
- Use direct citations: backtick-wrap file paths, include `:LINE` where useful.
- The doc should be skim-able. Use the structure exactly as shown above — Surface N section, then STRIDE table or bullets, then Specific Questions.

# Status

First line of your final message must be one of: `DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`.

In your final message, include:
1. The path of the file you wrote.
2. `wc -l` of the file (target: ~600-1200 lines for thorough coverage).
3. A one-sentence summary per surface of the dominant residual risk you identified.
4. Anything you couldn't determine from reading and want flagged for human review.

Do not commit. The controller will commit after reviewing.
````

- [ ] **Step 2: Review the threat model output**

When the subagent returns:
1. Read the produced file end-to-end. Verify each surface has all 5 sub-sections (Data, Controls, Attackers, STRIDE, Specific Questions, Residual risks).
2. Spot-check 3-5 cited file:lines via Grep to confirm they exist.
3. If a surface is shallow or missing structure, send the subagent a targeted follow-up requesting the gap to be filled. Re-review.

- [ ] **Step 3: Commit the threat model**

```bash
git add docs/superpowers/specs/2026-04-25-security-audit-threat-model.md
git commit -m "$(cat <<'EOF'
docs(specs): add security-audit threat model (Phase 1)

STRIDE-structured threat model covering all 8 trust boundaries:
HITL, vault, LAN, Tauri allowlist, raw SQL, updater, extensions, MCP.
Each surface documents data flow, existing controls, attacker
capabilities, per-STRIDE-category risk analysis, and 5-15 specific
systemic questions for the per-surface deep-dive subagents.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Phase 2.1 — Surface 1 deep-dive (HITL enforcement)

**Files:**
- Modify (append): `docs/superpowers/specs/2026-04-25-security-audit-results.md`

**Approach:** Dispatch a subagent that reads `executor.ts` + every caller, runs the per-surface focus areas + threat-model questions against the code, emits structured findings.

- [ ] **Step 1: Initialize the results doc if not present**

If `docs/superpowers/specs/2026-04-25-security-audit-results.md` does not exist yet, create it with:

```markdown
# Security audit (B1) — consolidated results

**Date:** 2026-04-25
**Related design:** [2026-04-25-security-audit-design.md](./2026-04-25-security-audit-design.md)
**Related threat model:** [2026-04-25-security-audit-threat-model.md](./2026-04-25-security-audit-threat-model.md)
**Audit branch:** `dev/asafgolombek/security-audit`
**Status:** in progress (per-surface deep-dives accumulating; consolidation in Phase 3)

---

## Summary

_Computed in Phase 3 — see § "Summary table" at the end of this doc._

## Critical findings

_None yet (Phase 3 will populate this section explicitly; an empty section here indicates no Critical findings discovered)._

---
```

This shell is committed in this task before the per-surface section is appended.

- [ ] **Step 2: Dispatch the Surface 1 subagent**

Send this prompt to a new general-purpose subagent (model: `sonnet` — judgment-heavy but well-bounded; opus is overkill for a single surface):

````markdown
You are the Surface 1 (HITL enforcement) deep-dive subagent for the Nimbus security audit. Zero prior context — this prompt contains everything you need.

# Context

- Repo: `C:\gitrepo\Nimbus`
- Branch: `dev/asafgolombek/security-audit`
- Platform: Windows 11; shell: bash
- Tools: Read, Grep, Bash for inspection ONLY. Do NOT run the gateway. Do NOT modify code. The only file you write to is `docs/superpowers/specs/2026-04-25-security-audit-results.md` (append a new section at the end).

# Mandate

Review Surface 1 (HITL enforcement) per the audit design. Your output is a structured findings section appended to the results doc.

# Files to read

Primary:
- `packages/gateway/src/engine/executor.ts` — HITL gate; HITL_REQUIRED frozen Set
- `packages/gateway/src/engine/coordinator.ts` — multi-agent sub-task orchestration
- `packages/gateway/src/engine/sub-agent.ts` — single sub-task executor
- `packages/gateway/src/automation/workflow-runner.ts` — workflow execution path
- `packages/gateway/src/automation/watcher-engine.ts` — watcher firing actions
- `packages/gateway/src/ipc/lan-rpc.ts` — LAN peer write-grant enforcement (intersection with HITL)
- `packages/gateway/src/ipc/lan-server.ts` — LAN server for context

Secondary (grep across as needed):
- Any file that calls `executor.executeAction()` or similar — find them via Grep
- `packages/gateway/src/connectors/*` — sample 2-3 connectors to confirm they reach the engine via the HITL path, not directly

# Threat model excerpt

Read the "Surface 1 — HITL enforcement" section of `docs/superpowers/specs/2026-04-25-security-audit-threat-model.md` (created in Task 2 of the plan). Use its STRIDE breakdown and specific systemic questions as your structured checklist.

# Per-surface focus areas (from design spec §4)

- Enumerate every tool exposed to the agent loop. For each, classify as: (a) explicitly read-only, (b) in `HITL_REQUIRED` set, (c) wrapped by a HITL-gated wrapper. Any tool not in (a)–(c) is a finding.
- **Indirect-execution / read-as-write hunt:** is there any "read" tool whose output flows unvetted into another tool's args, allowing a chained execution that was never gated?
- Verify every code path that calls a connector tool first traverses `executor.executeAction()` — no direct `mcpClient.callTool()` shortcuts.
- Sub-agent gate: does `coordinator.ts` / `sub-agent.ts` enforce HITL on actions invoked by spawned sub-agents?
- LAN peer gate: does an LAN peer write call also fire HITL on the host?

# Severity rubric

- **Critical:** Unauthenticated remote code execution. Credential disclosure to unauthorized party. Structural HITL bypass (action executed without consent gate firing).
- **High:** Authenticated bypass of HITL/vault. Privilege escalation. Audit-chain integrity break. Unsigned-code execution path.
- **Medium:** Information disclosure via logs/IPC/error/audit/telemetry. DoS. Weak crypto choice. Missing defense-in-depth where attacker is partly authenticated.
- **Low:** Hardening / defense-in-depth gaps. Comment/doc inconsistencies. Theoretical-only weaknesses.

# Output format — APPEND THIS SECTION to the results doc

Append (do not overwrite) at the end of `docs/superpowers/specs/2026-04-25-security-audit-results.md`:

```markdown
## Surface 1 — HITL enforcement

**Reviewer:** Surface-1 subagent
**Files audited:** [list the files you actually read, with line counts]

### Findings

[For each finding, use this exact entry format:]

#### Finding S1-F1: <short title>

- **Severity:** Critical | High | Medium | Low
- **File:** `path/to/file.ts:LINE`
- **Description:** What the issue is, in one paragraph.
- **Attack scenario:** Concrete steps an attacker would take.
- **Existing controls that don't prevent it:** Why this slips past current defenses.
- **Suggested fix:** Specific change needed (file + approach, not full code).
- **Confidence:** High | Medium | Low.
- **Verification:** `code-trace` (followed call graph by reading code) | `speculative` (pattern-matches a known issue class but couldn't fully confirm via static reading). NEVER use `runtime-verified` in this audit phase.

[... more findings ...]

### Per-tool HITL classification

[A table you produce by enumerating every tool. Columns: tool name | classification (read-only / in HITL_REQUIRED / HITL-wrapped / **GAP**) | file:line evidence.]

### Summary

[One paragraph: total findings, rough severity distribution, dominant pattern of issues.]

---
```

# Constraints

- Every finding must cite a real file:line. Read or Grep to verify before stating.
- No proposing code changes beyond the "Suggested fix" prose. No fixes.
- If you can't determine something via static analysis, say so — use `Verification: speculative` and state what would need runtime confirmation.
- Don't pad: if you find zero issues in a category, say so explicitly. Empty findings are valuable signal.
- Read the existing results doc shell first; append after the existing horizontal rule.

# Status

First line of your final message must be one of: `DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`.

In your final message, include:
1. Confirmation you appended (didn't overwrite) the section.
2. Counts: findings by severity (e.g., "0 Critical, 1 High, 3 Medium, 2 Low").
3. The per-tool HITL classification table count: total tools enumerated, count classified as GAP.
4. Anything you wanted to investigate but couldn't (for the chain-analysis pass to consider).

Do not commit. The controller will commit after reviewing.
````

- [ ] **Step 3: Review and verify subagent output**

When the subagent returns:
1. Open the results doc, confirm the Surface 1 section was appended (not overwriting earlier content).
2. Spot-check 3-5 finding citations via Grep — confirm the file:line exists and the issue is at least plausible from the cited code.
3. If a finding looks suspicious (high confidence but the cited line doesn't show the alleged pattern), mark it for re-investigation in Phase 3 chain analysis. Do not silently drop.
4. If output is incomplete (missing per-tool table, missing summary), re-dispatch with a targeted follow-up.

- [ ] **Step 4: Commit Surface 1 results**

```bash
git add docs/superpowers/specs/2026-04-25-security-audit-results.md
git commit -m "$(cat <<'EOF'
docs(specs): add Surface 1 (HITL enforcement) findings

Phase 2.1 of the security audit. Per-surface deep-dive into the HITL
gate, sub-agent coordinator, workflow runner, watcher engine, and LAN
peer write path. Includes per-tool HITL classification table.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Phase 2.2 — Surface 2 deep-dive (Vault credential surface)

**Files:**
- Modify (append): `docs/superpowers/specs/2026-04-25-security-audit-results.md`

- [ ] **Step 1: Dispatch the Surface 2 subagent**

Send this prompt to a new general-purpose subagent (model: `opus` — credential-flow surfaces are high-stakes and benefit from extra rigor):

````markdown
You are the Surface 2 (Vault credential surface) deep-dive subagent for the Nimbus security audit. Zero prior context.

# Context

- Repo: `C:\gitrepo\Nimbus`
- Branch: `dev/asafgolombek/security-audit`
- Platform: Windows 11; shell: bash
- Tools: Read, Grep, Bash for inspection ONLY. Do NOT run the gateway. Do NOT modify code. Append to `docs/superpowers/specs/2026-04-25-security-audit-results.md` only.

# Files to read

Primary:
- `packages/gateway/src/vault/index.ts` — `NimbusVault` interface
- `packages/gateway/src/vault/*.ts` — all platform impls (win32-vault, darwin-vault, linux-vault, in-memory-vault, etc.)
- `packages/gateway/src/auth/google-access-token.ts`, `microsoft-access-token.ts`, `notion-access-token.ts`, `slack-access-token.ts`, `oauth-vault-tokens.ts`, `pkce.ts`
- `packages/gateway/src/connectors/connector-vault.ts` — per-service OAuth vault key helpers
- `packages/gateway/src/connectors/connector-secrets-manifest.ts` — `CONNECTOR_VAULT_SECRET_KEYS`
- `packages/gateway/src/db/data-vault-crypto.ts` — passphrase-derived key wrap for export bundles
- `packages/gateway/src/commands/data-export.ts`, `data-import.ts` — passphrase + recovery-seed handling
- `packages/ui/src/ipc/client.ts` — frontend redaction utility (5 forbidden keys)
- `packages/ui/src/store/partialize.ts` — Zustand persist 5-key forbidden deep-scrub

Secondary (grep as needed):
- Anywhere a vault key is read — Grep for `vault.get`, `vault.read`, `getVaultKey`
- Any `pino` logger call that touches a vault-related variable (Grep for `logger.info`, `logger.error` in auth/* and vault/*)
- Any `console.log`, `console.error`, or unsanitized error rethrow that might include vault material

# Threat model excerpt

Read the "Surface 2 — Vault credential surface" section of `docs/superpowers/specs/2026-04-25-security-audit-threat-model.md`.

# Per-surface focus areas

- Trace every read path of vault entries. Verify no secret material reaches: logs (`pino`), IPC payloads, error messages, audit-log entry body, telemetry counters, LAN frame plaintext (before sealBox encryption).
- **Memory residence:** boundary-check only. Question is whether the boundary holds (no extension reads gateway memory, no debug endpoint dumps process state). Fixing JS string residence is largely outside our control and out of scope for Suggested-Fix proposals.
- **Master-key path:** OS-keystore-stored vault entries are *not* wrapped with a session key. The exception is `data-vault-crypto.ts`. Verify (a) the KDF parameters (Argon2id / scrypt cost factors), (b) no leakage of passphrase or derived key in error/log paths, (c) recovery-seed handling matches the same hygiene.
- Per-service OAuth refresh: confirm refreshed tokens overwrite the old vault entry atomically (no plaintext window on disk).
- **Forbidden debug-code patterns (vault context):** Grep across `packages/gateway/src/vault/`, `packages/gateway/src/auth/`, and `packages/gateway/src/connectors/` for these patterns. Each match in production code is a finding (severity High if a real secret is logged, Medium otherwise):
  - `console\.(log|error|warn|debug).*[Tt]oken`, `console\.(log|error|warn|debug).*[Ss]ecret`, `console\.(log|error|warn|debug).*[Pp]assword`, `console\.(log|error|warn|debug).*[Kk]ey` (cases where output isn't pre-redacted)
  - `JSON\.stringify.*token`, `JSON\.stringify.*credential`, `JSON\.stringify.*config` (full-object dumps in error/log paths)
  - `// TODO.*remove`, `// FIXME.*before.*release`, `// HACK`
  - Hardcoded test tokens — strings that look like real credentials (`sk-`, `ghp_`, `xoxb-`, `gho_`, `oauth2_`, `Bearer ` followed by a literal) outside `*.test.ts` files

# Severity rubric

[same as Surface 1; Critical / High / Medium / Low; copy verbatim from Task 3 prompt]

# Output format — APPEND to the results doc

```markdown
## Surface 2 — Vault credential surface

**Reviewer:** Surface-2 subagent
**Files audited:** [list]

### Findings

[Same finding entry format as Surface 1: severity, file, description, attack scenario, controls, suggested fix, confidence, verification.]

### Vault read-path matrix

[Table: read path | source file:line | sink (log/IPC/error/audit/telemetry/LAN) | redaction in place | notes.]

### KDF parameters review (data-vault-crypto.ts)

[Table: parameter | value | recommendation | finding ID if non-conformant.]

### Summary

[One paragraph.]

---
```

# Constraints

[Same as Surface 1: cite real file:lines, no fixes proposed beyond Suggested-Fix prose, append only, etc.]

# Status

First line: `DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`.

In your final message, include: append confirmation, severity counts, vault read-path matrix size, KDF parameters table summary.

Do not commit.
````

- [ ] **Step 2: Review subagent output**

Same as Task 3 Step 3 — open the results doc, confirm the Surface 2 section appended cleanly, spot-check 3-5 findings.

- [ ] **Step 3: Commit Surface 2 results**

```bash
git add docs/superpowers/specs/2026-04-25-security-audit-results.md
git commit -m "$(cat <<'EOF'
docs(specs): add Surface 2 (Vault credential surface) findings

Phase 2.2 of the security audit. Per-surface deep-dive into vault
read paths, OAuth token storage, data-vault-crypto KDF parameters,
and frontend/backend redaction utilities. Includes vault read-path
sink matrix.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Phase 2.3 — Surface 3 deep-dive (LAN authorization)

**Files:**
- Modify (append): `docs/superpowers/specs/2026-04-25-security-audit-results.md`

- [ ] **Step 1: Dispatch the Surface 3 subagent**

Send this prompt to a new general-purpose subagent (model: `opus` — LAN crypto + state machines + auth has subtle-flaw risk):

````markdown
You are the Surface 3 (LAN authorization) deep-dive subagent for the Nimbus security audit. Zero prior context.

# Context

- Repo: `C:\gitrepo\Nimbus`
- Branch: `dev/asafgolombek/security-audit`
- Tools: Read, Grep, Bash for inspection ONLY. Do NOT run the gateway. Do NOT modify code. Append to results doc only.

# Files to read

Primary:
- `packages/gateway/src/ipc/lan-server.ts` — `LanServer` Bun.listen TCP, length-framed encrypted RPC
- `packages/gateway/src/ipc/lan-rpc.ts` — `LanError`, `checkLanMethodAllowed`, write-grant enforcement
- `packages/gateway/src/ipc/lan-pairing.ts` — `PairingWindow`, base58 pairing code, 5-min expiry
- `packages/gateway/src/ipc/lan-rate-limit.ts` — `LanRateLimiter` per-IP sliding window
- `packages/gateway/src/ipc/lan-crypto.ts` — NaCl box keypair, `sealBoxFrame`, `openBoxFrame`
- `packages/gateway/src/index/lan-peers-v19-sql.ts` — `lan_peers` table schema

Secondary:
- Grep for every method registered in the IPC dispatcher and cross-reference against the LAN allowlist in `lan-rpc.ts`
- Tests under `packages/gateway/src/ipc/lan-*.test.ts` for behavior expectations

# Threat model excerpt

Read "Surface 3 — LAN authorization" section of the threat model doc.

# Per-surface focus areas

- Method allowlist: every method exposed to LAN peers must be defensible. Read `lan-rpc.ts` `checkLanMethodAllowed`; cross-reference against the full method registry; flag any write-class method that's allowed without the write-grant check.
- **Nonce reuse in `sealBoxFrame`:** `randomBytes(24)` is called per-frame at line 20. Hunt for any path that could reuse a nonce — e.g., retry logic that re-sends the same frame without re-encrypting with a fresh nonce.
- Pairing-window expiry: confirm `PairingWindow` rejects pairing attempts after the 5-minute window even under clock-skew or replay.
- Rate-limit isolation: `LanRateLimiter` per-IP — verify a single peer can't exhaust a global resource (memory, connection count).
- Peer authentication: a paired peer's X25519 public key is the sole identity; verify the storage path (`lan_peers` table) can't be tampered with by another peer to assume their identity.

# Severity rubric

[copy verbatim from Surface 1]

# Output format — APPEND to the results doc

```markdown
## Surface 3 — LAN authorization

**Reviewer:** Surface-3 subagent
**Files audited:** [list]

### Findings

[same finding entry format]

### LAN method allowlist audit

[Table: method name | classification (read / write / HITL-required) | listed in lan-rpc allowlist? | write-grant required? | finding ID if any.]

### Crypto correctness review

[Bullets: sealBoxFrame nonce uniqueness check; openBoxFrame failure handling; pairing handshake order; key storage; pair-then-revoke flows.]

### Summary

[One paragraph.]

---
```

# Constraints + Status

[Same as Surface 1.]
````

- [ ] **Step 2: Review subagent output**

Same review approach as Task 3 Step 3.

- [ ] **Step 3: Commit Surface 3 results**

```bash
git add docs/superpowers/specs/2026-04-25-security-audit-results.md
git commit -m "$(cat <<'EOF'
docs(specs): add Surface 3 (LAN authorization) findings

Phase 2.3 of the security audit. Per-surface deep-dive into the LAN
TCP server, method allowlist, write-grant enforcement, NaCl box
encryption, pairing window, and rate limiter. Includes method
allowlist audit table.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Phase 2.4 — Surface 4 deep-dive (Tauri allowlist)

**Files:**
- Modify (append): `docs/superpowers/specs/2026-04-25-security-audit-results.md`

- [ ] **Step 1: Dispatch the Surface 4 subagent**

Send this prompt to a new general-purpose subagent (model: `sonnet`):

````markdown
You are the Surface 4 (Tauri allowlist) deep-dive subagent for the Nimbus security audit. Zero prior context.

# Context

- Repo: `C:\gitrepo\Nimbus`
- Branch: `dev/asafgolombek/security-audit`
- Tools: Read, Grep, Bash for inspection ONLY. Do NOT run the gateway. Do NOT modify code.
- This surface spans Rust (Tauri shell) and TypeScript (Gateway IPC handlers). You'll need to read both.

# Files to read

Primary (Rust):
- `packages/ui/src-tauri/src/gateway_bridge.rs` — `ALLOWED_METHODS` (38), `NO_TIMEOUT_METHODS` (4), `GLOBAL_BROADCAST_METHODS` (`profile.switched`), `rpc_call`, reconnect loop
- `packages/ui/src-tauri/capabilities/default.json` — Tauri capability set (windows, permissions)
- `packages/ui/src-tauri/src/tray.rs`, `quick_query.rs`, `hitl_popup.rs`, `lib.rs` — for context

Primary (TypeScript IPC handlers — pick the ones referenced by ALLOWED_METHODS):
- For each method in ALLOWED_METHODS, find its handler in `packages/gateway/src/ipc/*.ts`. Use Grep on the method name (e.g., `"config.set"`) to find where it's dispatched + handled.

# Threat model excerpt

Read "Surface 4 — Tauri allowlist" section of the threat model doc.

# Per-surface focus areas

- Read every method in `ALLOWED_METHODS` (38 entries). For each, document: parameter shape, server-side validation (Zod schema or otherwise), worst-case if frontend supplies malicious args.
- **Method-level parameter audit:** specifically flag any `config.set`, `connector.configure`, or similar setter that accepts a key+value pair where the key isn't whitelisted — frontend setting `NIMBUS_UPDATER_URL` to a malicious host is a code-execution vector.
- `NO_TIMEOUT_METHODS` list: does the absence of timeout open a DoS vector from the frontend?
- `GLOBAL_BROADCAST_METHODS`: does the broadcast leak any per-window state to other windows that shouldn't see it?
- `capabilities/default.json`: confirm `fs.allow`/`fs.deny`, `shell.allow`, etc. are minimal.
- **Forbidden debug-code patterns (frontend/Tauri context):** Grep across `packages/ui/src/` and `packages/ui/src-tauri/src/` for these patterns. Each match is a finding (severity Medium normally, High if security-sensitive data flows in):
  - `alert\(.*\)`, `confirm\(.*\)`, `console\.log.*config`, `console\.log.*state` (UI debug aids that may leak state)
  - `eval\(`, `new Function\(`, `dangerouslySetInnerHTML` (XSS / code-execution risk in React)
  - `// TODO.*remove`, `// FIXME.*before.*release`, `// HACK`
  - `localStorage\.setItem.*token`, `sessionStorage\.setItem.*token` (frontend should never persist tokens; vault is gateway-side only)
  - Hardcoded URLs to non-localhost in dev/test paths that could leak in production builds

# Severity rubric

[copy verbatim from Surface 1]

# Output format — APPEND to the results doc

```markdown
## Surface 4 — Tauri allowlist

**Reviewer:** Surface-4 subagent
**Files audited:** [list]

### Findings

[same finding entry format]

### ALLOWED_METHODS table (38 methods)

[Table: method name | parameter shape | server-side validation (Zod/manual/none) | worst-case if frontend lies | finding ID if any.]

### NO_TIMEOUT_METHODS analysis

[For each of the 4: name | rationale for no timeout | DoS vector? | finding ID if any.]

### Tauri capabilities review

[Table: capability | scope | minimal? | finding ID if any.]

### Summary

[One paragraph.]

---
```

# Constraints + Status

[Same as Surface 1.]
````

- [ ] **Step 2: Review and commit**

Same review approach as Task 3.

```bash
git add docs/superpowers/specs/2026-04-25-security-audit-results.md
git commit -m "$(cat <<'EOF'
docs(specs): add Surface 4 (Tauri allowlist) findings

Phase 2.4 of the security audit. Per-surface deep-dive into the
Tauri-to-gateway bridge: 38 ALLOWED_METHODS parameter validation,
NO_TIMEOUT_METHODS DoS analysis, GLOBAL_BROADCAST_METHODS leakage,
and capabilities/default.json scope review.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Phase 2.5 — Surface 5 deep-dive (Raw SQL surface)

**Files:**
- Modify (append): `docs/superpowers/specs/2026-04-25-security-audit-results.md`

- [ ] **Step 1: Dispatch the Surface 5 subagent**

Send this prompt to a new general-purpose subagent (model: `sonnet`):

````markdown
You are the Surface 5 (Raw SQL surface) deep-dive subagent for the Nimbus security audit. Zero prior context.

# Context

- Repo: `C:\gitrepo\Nimbus`
- Branch: `dev/asafgolombek/security-audit`
- Tools: Read, Grep, Bash for inspection ONLY. Do NOT run the gateway. Do NOT modify code.

# Files to read

Primary:
- `packages/cli/src/commands/query.ts` — `nimbus query --sql` user-supplied SQL surface
- `packages/gateway/src/db/verify.ts` — non-destructive integrity checks (integrity_check, FTS5, vec rowid, FK, schema version)
- `packages/gateway/src/db/write.ts` — central DB write wrapper (catches SQLITE_FULL, re-throws DiskFullError)
- `packages/gateway/src/ipc/http-server.ts` — read-only local HTTP API (`SQLITE_OPEN_READONLY`)

Secondary:
- Grep for `bun:sqlite` usage; identify every `db.prepare()`, `db.run()`, `db.exec()` call site and check parameterization
- Grep for raw string concatenation in SQL contexts (`SELECT ... + var`, ``SELECT ${var}``)

# Threat model excerpt

Read "Surface 5 — Raw SQL surface" section of the threat model doc.

# Per-surface focus areas

- `nimbus query --sql` opens a connection — verify it's `SQLITE_OPEN_READONLY` and that the read-only flag actually prevents writes (static check, not runtime).
- **PRAGMA / ATTACH escape:** can the user-supplied SQL include `PRAGMA writable_schema = 1` or `ATTACH DATABASE` to escalate? bun:sqlite's read-only mode should prevent both, but verify by looking at how the connection is opened and what flags are set.
- `db/write.ts` central wrapper: verify all writes use parameterized statements (`?` or named bindings), never string concatenation.
- `db/verify.ts` integrity checks: confirm they don't expose internals (e.g., dumping vault keys or audit content via verbose error messages).
- `ipc/http-server.ts` read-only API: confirm localhost-only binding is enforced and no path allows writes.

# Severity rubric

[copy verbatim from Surface 1]

# Output format — APPEND to the results doc

```markdown
## Surface 5 — Raw SQL surface

**Reviewer:** Surface-5 subagent
**Files audited:** [list]

### Findings

[same finding entry format]

### SQL call-site inventory

[Table: file:line | call type (prepare/run/exec) | parameterized? | input source (constant/user/internal) | finding ID if any.]

### `nimbus query --sql` connection-flag audit

[Specific bullets: connection open mode, PRAGMA filtering (if any), ATTACH disabled? read-only verified at how many layers?]

### Summary

[One paragraph.]

---
```

# Constraints + Status

[Same as Surface 1.]
````

- [ ] **Step 2: Review and commit**

```bash
git add docs/superpowers/specs/2026-04-25-security-audit-results.md
git commit -m "$(cat <<'EOF'
docs(specs): add Surface 5 (Raw SQL surface) findings

Phase 2.5 of the security audit. Per-surface deep-dive into
nimbus query --sql, db/verify.ts, db/write.ts, and the read-only
HTTP API. Includes SQL call-site inventory and connection-flag
audit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Phase 2.6 — Surface 6 deep-dive (Updater pipeline)

**Files:**
- Modify (append): `docs/superpowers/specs/2026-04-25-security-audit-results.md`

- [ ] **Step 1: Dispatch the Surface 6 subagent**

Send this prompt to a new general-purpose subagent (model: `opus` — signature verification + downgrade-attack analysis is high-stakes crypto-correctness work):

````markdown
You are the Surface 6 (Updater pipeline) deep-dive subagent for the Nimbus security audit. Zero prior context.

# Context

- Repo: `C:\gitrepo\Nimbus`
- Branch: `dev/asafgolombek/security-audit`
- Tools: Read, Grep, Bash for inspection ONLY. Do NOT run the gateway. Do NOT modify code.

# Files to read

Primary:
- `packages/gateway/src/updater/updater.ts` — `Updater` state machine, `semverGreater()` at line 170, `updateAvailable` check at line 48
- `packages/gateway/src/updater/manifest-fetcher.ts` — typed manifest fetch with AbortController timeout
- `packages/gateway/src/updater/signature-verifier.ts` — `verifyBinarySignature` Ed25519 over SHA-256
- `packages/gateway/src/updater/public-key.ts` — embedded Ed25519 updater public key, `NIMBUS_DEV_UPDATER_PUBLIC_KEY` override
- `packages/gateway/src/updater/types.ts` — manifest type definitions
- `packages/gateway/src/ipc/updater-rpc.ts` — `updater.getStatus`, `updater.checkNow`, `updater.applyUpdate`, `updater.rollback`
- Tests under `packages/gateway/src/updater/*.test.ts`

# Threat model excerpt

Read "Surface 6 — Updater pipeline" section of the threat model doc.

# Per-surface focus areas

- **Signature verification correctness:** trace `verifyBinarySignature` — Ed25519 over SHA-256 of binary, embedded public key from `public-key.ts`. Verify constant-time comparison, no early-return on mismatch.
- Manifest fetch: `manifest-fetcher.ts` uses `AbortController` timeout — confirm TLS verification is on, no insecure HTTP fallback.
- **Downgrade attack:** `semverGreater()` at `updater.ts:170` — verify it's strictly `>` and that an attacker controlling the manifest can't force a rollback to an older vulnerable version.
- Public key embedding: `public-key.ts` exports the trusted Ed25519 key. Confirm `NIMBUS_DEV_UPDATER_PUBLIC_KEY` env-var override is gated to dev/test builds and cannot be set by a non-admin user to inject a forged key.
- Rollback safety: if signature verify passes but install fails, does the previous binary remain intact?

# Severity rubric

[copy verbatim from Surface 1]

# Output format — APPEND to the results doc

```markdown
## Surface 6 — Updater pipeline

**Reviewer:** Surface-6 subagent
**Files audited:** [list]

### Findings

[same finding entry format]

### Signature-verification trace

[Step-by-step: where the binary is fetched, where SHA-256 is computed, where Ed25519 verification runs, comparison primitive used, error-handling paths.]

### Downgrade-attack verification

[Specifically the semverGreater() function: comparison operator (verify '>' not '>='), edge cases (pre-release, equal versions), interaction with manifest version field.]

### NIMBUS_DEV_UPDATER_PUBLIC_KEY override audit

[Where the override is checked, whether it's gated by build flag / env detection, whether a normal end-user can set it.]

### Summary

[One paragraph.]

---
```

# Constraints + Status

[Same as Surface 1.]
````

- [ ] **Step 2: Review and commit**

```bash
git add docs/superpowers/specs/2026-04-25-security-audit-results.md
git commit -m "$(cat <<'EOF'
docs(specs): add Surface 6 (Updater pipeline) findings

Phase 2.6 of the security audit. Per-surface deep-dive into the
updater state machine: Ed25519 signature verification, manifest
fetch, downgrade-attack prevention via semverGreater(), and the
NIMBUS_DEV_UPDATER_PUBLIC_KEY override gating.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Phase 2.7 — Surface 7 deep-dive (Extension sandbox + manifest)

**Files:**
- Modify (append): `docs/superpowers/specs/2026-04-25-security-audit-results.md`

- [ ] **Step 1: Dispatch the Surface 7 subagent**

Send this prompt to a new general-purpose subagent (model: `sonnet`):

````markdown
You are the Surface 7 (Extension sandbox + manifest) deep-dive subagent for the Nimbus security audit. Zero prior context.

# Context

- Repo: `C:\gitrepo\Nimbus`
- Branch: `dev/asafgolombek/security-audit`
- Tools: Read, Grep, Bash for inspection ONLY. Do NOT run the gateway. Do NOT modify code.

# Files to read

Primary:
- All TypeScript under `packages/gateway/src/extensions/` — registry, manifest verifier, child-process spawner
- Grep for "extension" + "spawn" + "child_process" in `packages/gateway/src/`
- `packages/sdk/src/index.ts` — what the SDK exposes to extensions

Secondary:
- Sample 1-2 example extensions if any exist in the repo or under `packages/mcp-connectors/` (those are MCP, not extensions, but the spawn pattern is similar)

# Threat model excerpt

Read "Surface 7 — Extension sandbox + manifest" section of the threat model doc.

# Per-surface focus areas

- SHA-256 manifest verification: read the verifier — verify it compares the recorded hash against the actual file bytes, with constant-time comparison.
- Capability boundary: what *can't* an extension do that a regular Bun script can? (Spoiler: probably very little — extensions inherit OS user permissions.)
- **Local file read scope:** quantify what files an extension can read. Specifically: can it read `~/.ssh/id_rsa`, the Nimbus SQLite DB at the standard paths, the OS keystore via `secret-tool` / `security` / DPAPI? Note as findings, severity proportional to user-data exposure.
- **Suggested-fix material (not in this audit's scope to implement):** `node --experimental-permission` (Node-side; not applicable to Bun?), `bwrap` on Linux, `sandbox-exec` on macOS, AppContainer on Windows.
- Child-process isolation: confirm the child can't `process.kill(parentPid)` or signal the gateway.
- MCP transport: extensions communicate over stdio — confirm no path lets an extension reach the IPC server directly (bypassing gateway-internal access controls).

# Severity rubric

[copy verbatim from Surface 1]

# Output format — APPEND to the results doc

```markdown
## Surface 7 — Extension sandbox + manifest

**Reviewer:** Surface-7 subagent
**Files audited:** [list]

### Findings

[same finding entry format]

### Capability quantification

[Table: capability (read ~/.ssh, read SQLite DB, read keystore, spawn subprocess, network access, signal parent, etc.) | currently allowed? | should-be-restricted? | finding ID if any | sandboxing tool that would restrict (bwrap/sandbox-exec/AppContainer/N/A).]

### Manifest verification trace

[Where the SHA-256 is recorded, where it's checked at load time, comparison primitive (constant-time?), what happens on mismatch.]

### Summary

[One paragraph. Critical finding likely: the OS-process boundary is the only sandbox. Quantify what that costs.]

---
```

# Constraints + Status

[Same as Surface 1.]
````

- [ ] **Step 2: Review and commit**

```bash
git add docs/superpowers/specs/2026-04-25-security-audit-results.md
git commit -m "$(cat <<'EOF'
docs(specs): add Surface 7 (Extension sandbox + manifest) findings

Phase 2.7 of the security audit. Per-surface deep-dive into the
extension registry, SHA-256 manifest verification, child-process
isolation boundary, and capability quantification (what an extension
can/can't do at the OS layer).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Phase 2.8 — Surface 8 deep-dive (MCP connector boundary)

**Files:**
- Modify (append): `docs/superpowers/specs/2026-04-25-security-audit-results.md`

- [ ] **Step 1: Dispatch the Surface 8 subagent**

Send this prompt to a new general-purpose subagent (model: `opus` — prompt injection + complex MCP-response data flows benefit from deeper reasoning):

````markdown
You are the Surface 8 (MCP connector boundary) deep-dive subagent for the Nimbus security audit. Zero prior context.

# Context

- Repo: `C:\gitrepo\Nimbus`
- Branch: `dev/asafgolombek/security-audit`
- Tools: Read, Grep, Bash for inspection ONLY. Do NOT run the gateway. Do NOT modify code.

# Files to read

Primary:
- `packages/gateway/src/connectors/lazy-mesh.ts` — connector spawning + lifecycle
- `packages/gateway/src/connectors/health.ts` — connector health state machine
- `packages/gateway/src/connectors/connector-vault.ts` — per-service OAuth vault key helpers (already reviewed in Surface 2 from a vault perspective; here we look at the connector identity/credential routing)
- Engine code that processes MCP tool responses — Grep for `mcpClient.callTool`, `result.content`, `tool_use_id`, etc.
- Sample 2-3 MCP connectors under `packages/mcp-connectors/` for the response-shape patterns (e.g., `gmail`, `github`, `slack`)

Secondary:
- Anywhere "prompt" or "context" or "system message" is constructed from MCP responses — Grep for `system:`, `assistant:`, `messages.push`, etc. in `packages/gateway/src/engine/`

# Threat model excerpt

Read "Surface 8 — MCP connector boundary" section of the threat model doc.

# Per-surface focus areas

- **Connector impersonation:** can connector A claim to be connector B (e.g., by spoofing the `tool` name in MCP responses) to steal credentials destined for B? Verify the MCP client routes credentials by the connector identity it spawned, not by the tool name in the response.
- Prompt-injection defense: per `SECURITY.md`, "typed data blocks, never instructions." Verify MCP responses are wrapped in a `<data>` tag (or similar typed envelope) before being inserted into LLM context — never rendered as raw markdown that could include `Now ignore previous instructions and...`.
- MCP response → tool args: if a connector returns data that the agent then passes as args to another tool (the "indirect execution" pattern from Surface 1), verify the agent's tool-arg construction validates against expected schemas.
- Sandbox escape via crafted MCP responses: can a malicious connector reply (very large response, malformed JSON, recursive structures) crash the gateway or leak memory?
- Lazy-mesh spawn: `lazy-mesh.ts` spawns connector child processes on demand — verify the spawn args don't expose vault contents in `process.env` to other connectors (each connector should get only its own credentials).

# Severity rubric

[copy verbatim from Surface 1]

# Output format — APPEND to the results doc

```markdown
## Surface 8 — MCP connector boundary

**Reviewer:** Surface-8 subagent
**Files audited:** [list]

### Findings

[same finding entry format]

### Credential-routing audit

[Trace: where each spawned connector's env is constructed; whether vault entries are scoped per connector or shared; whether a connector can request credentials it shouldn't have.]

### Prompt-injection defense audit

[Trace: every place an MCP response flows into LLM context; whether it's typed-wrapped or raw-injected; what existing escape sequences would defeat the wrapping.]

### MCP response → tool-arg validation

[Trace: if MCP output of tool A becomes input to tool B, what validates the shape? Per-tool schema? `unknown` cast? Find the boundary.]

### Summary

[One paragraph.]

---
```

# Constraints + Status

[Same as Surface 1.]
````

- [ ] **Step 2: Review and commit**

```bash
git add docs/superpowers/specs/2026-04-25-security-audit-results.md
git commit -m "$(cat <<'EOF'
docs(specs): add Surface 8 (MCP connector boundary) findings

Phase 2.8 of the security audit. Per-surface deep-dive into the
MCP boundary: connector impersonation, prompt-injection defenses,
MCP-response-to-tool-arg validation, lazy-mesh credential routing,
and sandbox-escape via crafted responses.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Phase 3 — Cross-surface chain-attack analysis

**Files:**
- Modify (append): `docs/superpowers/specs/2026-04-25-security-audit-results.md`

**Approach:** Controller (this session) does this — not a subagent. Cross-surface analysis benefits from holistic context that a fresh subagent would lack. Re-read all 8 surface sections, look for findings that compose into chained attacks.

- [ ] **Step 1: Re-read every surface section in the results doc**

Run:
```bash
wc -l docs/superpowers/specs/2026-04-25-security-audit-results.md
```
Then Read the file end-to-end. Note the finding IDs in each surface (S1-F1, S1-F2, … S8-FN).

- [ ] **Step 2: Build a cross-surface findings inventory**

Mentally (or in a scratchpad) list every finding by ID. For each, ask: "If I compose this with finding X from another surface, do I get a qualitatively new attack class with higher severity than either alone?"

Common chain patterns to look for:
- **Disclosure → escalation:** info leak in one surface (Medium) + logic flaw in another (Low) = credential theft (High)
- **Bypass → execution:** validation gap in one surface (Low) + read-as-write proxy elsewhere (Low) = HITL bypass (High)
- **Persistence → impact:** weak crypto choice (Medium) + audit forgeable (Medium) = undetectable post-compromise persistence (High)

- [ ] **Step 2.5: Verify each candidate chain by re-reading the intersection code**

For every candidate chain identified in Step 2, before writing it up:

1. Re-read the file:line cited in each component finding (use Read tool — don't rely on memory).
2. Trace whether data flows from the "source" surface's vulnerability into the "trigger point" of the next surface. Specifically: is there a real call path from finding A's location to finding B's location, or is the chain only conceptual?
3. If the data flow can't be confirmed via static reading, demote the chain to "speculative" verification or drop it entirely.

This step prevents false-positive chain findings that look plausible at the abstraction level but don't actually exploit when the code is examined. Chains with `verification: speculative` are still recorded but flagged for runtime confirmation in the fix-PR phase.

- [ ] **Step 3: Append the chain-analysis section**

Append to the results doc:

```markdown
## Cross-surface chain-attack analysis (Phase 3)

[For each composite chain identified, use this entry format:]

### Composite C1: <short title>

- **Severity:** Critical | High | Medium (computed as max(component severities); +1 only if the composition enables a qualitatively new attack class)
- **Component findings:** S{X}-F{Y}, S{Z}-F{W}, ...
- **Chain attack scenario:** Step-by-step what an attacker does, naming each component finding's role.
- **Why severity is higher than components:** What new capability the composition unlocks.
- **Data-flow verification:** Confirmed via re-reading `path/to/A.ts:LINE` and `path/to/B.ts:LINE` — call path A → ... → B exists.
- **Verification:** `code-trace` (data flow confirmed via static reading) | `speculative` (composition plausible but couldn't fully confirm flow without runtime).
- **Suggested fix priority:** Which component finding to fix first to break the chain.

[If no composite chains found, state explicitly:]

> No cross-surface chain attacks identified during this pass. All findings are independent. (This does not mean none exist — only that none were apparent from the surface-level review of the per-surface deep-dives.)

---
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-04-25-security-audit-results.md
git commit -m "$(cat <<'EOF'
docs(specs): add cross-surface chain-attack analysis (Phase 3)

Phase 3 controller pass: re-read all 8 surface sections, identify
findings that compose into chained attacks with severity higher than
their components. Each composite chain documented with component
finding IDs, attack scenario, and priority for breaking the chain.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Phase 3 — Consolidate, summary table, Critical-findings section

**Files:**
- Modify (overwrite shell sections): `docs/superpowers/specs/2026-04-25-security-audit-results.md`

- [ ] **Step 1: Compute the summary table**

Re-read the results doc, count findings per (surface × severity). Build the table:

| Surface | Critical | High | Medium | Low | Total |
|---|---|---|---|---|---|
| S1 — HITL | _N_ | _N_ | _N_ | _N_ | _N_ |
| S2 — Vault | _N_ | _N_ | _N_ | _N_ | _N_ |
| S3 — LAN | _N_ | _N_ | _N_ | _N_ | _N_ |
| S4 — Tauri | _N_ | _N_ | _N_ | _N_ | _N_ |
| S5 — SQL | _N_ | _N_ | _N_ | _N_ | _N_ |
| S6 — Updater | _N_ | _N_ | _N_ | _N_ | _N_ |
| S7 — Extensions | _N_ | _N_ | _N_ | _N_ | _N_ |
| S8 — MCP | _N_ | _N_ | _N_ | _N_ | _N_ |
| Composite chains | _N_ | _N_ | _N_ | _N_ | _N_ |
| **Total** | **_N_** | **_N_** | **_N_** | **_N_** | **_N_** |

- [ ] **Step 2: Replace the "## Summary" placeholder section**

The doc currently has `_Computed in Phase 3 — see § "Summary table" at the end of this doc._`. Replace the entire `## Summary` section with the computed table from Step 1, plus a 1-paragraph qualitative summary (e.g., "Vault and LAN surfaces had the most findings — common theme is X. No Critical findings were discovered. Recommended fix order: …").

- [ ] **Step 3: Populate the "## Critical findings" section**

Replace `_None yet (Phase 3 will populate this section explicitly; an empty section here indicates no Critical findings discovered)._` with either:

- The actual list of Critical-severity finding IDs + 1-sentence-each summaries + their priority order, OR
- "**No Critical findings discovered.** This audit's static-analysis pass found zero issues meeting the Critical bar (unauthenticated remote code execution, credential disclosure to unauthorized party, structural HITL bypass)."

- [ ] **Step 4: Update the doc's status line**

Change `**Status:** in progress (per-surface deep-dives accumulating; consolidation in Phase 3)` to `**Status:** complete — ready for review and issue filing`.

- [ ] **Step 5: Self-review pass**

Re-read the doc with fresh eyes. Confirm:
- All 8 surface sections present.
- All cited file:lines verifiably exist (re-grep 5-10 randomly chosen citations).
- No placeholder text remaining.
- Summary table totals are arithmetically correct.
- Composite chains reference valid component finding IDs.
- **No real secret values appear in the audit doc.** If a finding cites a line containing what appears to be an actual credential (e.g., a developer left a real test token in source), the audit doc must redact the value to `<REDACTED>` and reference the file:line only — otherwise the audit doc itself becomes a credential-disclosure vector. Run a grep over the results doc for patterns matching: `sk-[A-Za-z0-9]{20,}`, `ghp_[A-Za-z0-9]{20,}`, `xoxb-[A-Za-z0-9-]{20,}`, `Bearer [A-Za-z0-9._-]{30,}`, `[A-Za-z0-9+/]{40,}={0,3}` (base64 ≥40 chars). Any hit that isn't `<REDACTED>` requires immediate redaction in the doc.
- **Every High and Critical finding's Suggested Fix has a concrete file:line target.** If the suggested fix says "review and refactor" or other vague language, send it back to the surface subagent for sharpening — High/Critical findings deserve actionable fixes, not just acknowledgment.

If issues: fix inline, no need to re-review.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-04-25-security-audit-results.md
git commit -m "$(cat <<'EOF'
docs(specs): consolidate security-audit results (Phase 3)

Phase 3 finalization: summary table (severity counts per surface +
composite chains), populated Critical-findings section, status flag
flipped to complete. Self-review pass confirmed no placeholders, all
cited file:lines verified, composite chain finding-ID references
valid.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Phase 3 — File GitHub issues for High and Medium findings

**Files:** none modified — `gh issue create` invocations only.

- [ ] **Step 1: Ensure the `security` label exists**

Run:
```bash
gh label list | grep -i security
```

If `security` label doesn't exist, create it:
```bash
gh label create "security" --color "B60205" --description "Security audit finding"
```

- [ ] **Step 2: Iterate over High and Medium findings**

For each High or Medium-severity finding in the results doc, create a GitHub issue. Use the loop pattern below — adapt the title and body per finding:

```bash
gh issue create \
  --title "[security] S1-F1: <short title from finding>" \
  --label "security" \
  --body "$(cat <<'EOF'
**Severity:** High
**Audit reference:** [Security audit B1, Surface 1 — HITL enforcement, Finding S1-F1](../blob/dev/asafgolombek/security-audit/docs/superpowers/specs/2026-04-25-security-audit-results.md#finding-s1-f1-...)

## Description

[paste from results doc]

## Attack scenario

[paste]

## Existing controls that don't prevent it

[paste]

## Suggested fix

[paste]

## Confidence + Verification

- Confidence: [High/Medium/Low]
- Verification: [code-trace/speculative]

---

🔒 Filed as part of B1 security audit. Triage and prioritization decided per the design spec § 12 follow-up workflow.
EOF
)"
```

Critical findings (if any) get the same treatment but with `--title "[security][CRITICAL] ..."` and a note in the body that the spec § 9 says Critical fixes leapfrog other work.

Low findings stay in the results doc only — no issues filed (per design spec § 6).

- [ ] **Step 3: Cross-link issues back into the results doc**

After all issues are filed, append to the results doc a "Filed issues" section listing each finding ID → issue number:

```markdown
## Filed issues

| Finding | Severity | Issue |
|---|---|---|
| S1-F1 | High | #100 |
| S2-F3 | High | #101 |
| ... | ... | ... |

(Low-severity findings remain in this doc only and have no corresponding issue.)
```

- [ ] **Step 4: Commit the cross-link addition**

```bash
git add docs/superpowers/specs/2026-04-25-security-audit-results.md
git commit -m "$(cat <<'EOF'
docs(specs): cross-link filed security issues to audit results

Maps each High/Medium finding to its GitHub issue number for
traceability. Low-severity findings remain in the results doc only.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Push branch + open PR

**Files:** none modified — git/gh operations only.

- [ ] **Step 1: Inspect the commit series before pushing**

Run:
```bash
git log --oneline origin/main..HEAD
```

Expected: ~12 commits (1 design spec + 1 review fold-in + 1 threat model + 8 surface deep-dives + 1 chain analysis + 1 consolidation + 1 issue cross-link = 14 total counting design phase). The exact count depends on whether T7's bun.lock no-op happened and other variance; the order should be: design → review → threat model → surfaces 1-8 → chain analysis → consolidation → cross-link.

- [ ] **Step 2: Push the branch**

```bash
git push -u origin dev/asafgolombek/security-audit
```

- [ ] **Step 3: Open the PR**

```bash
gh pr create --title "docs(security): B1 security audit results" --body "$(cat <<'EOF'
## Summary

B1 security audit (per the design spec at `docs/superpowers/specs/2026-04-25-security-audit-design.md`).

Three-phase, threat-model-driven audit across 8 trust boundaries:

1. **Threat model** — STRIDE-structured for HITL, Vault, LAN, Tauri, Raw SQL, Updater, Extensions, MCP.
2. **Per-surface deep-dive** — sequential subagent reviews emitting structured findings.
3. **Consolidation** — cross-surface chain-attack analysis, summary table, GitHub issues filed for High/Medium.

## Severity counts

[paste the Phase 3 summary table here verbatim]

## Critical findings

[paste the Critical findings section verbatim — either the list or the "no Critical findings" attestation]

## Filed issues

See [`docs/superpowers/specs/2026-04-25-security-audit-results.md`](../blob/dev/asafgolombek/security-audit/docs/superpowers/specs/2026-04-25-security-audit-results.md) "Filed issues" section.

## How this PR should be reviewed

- The audit doc itself (results doc) is the deliverable — review for accuracy, calibration of severity, and completeness.
- This PR introduces NO production-code changes. Findings are tracked as GitHub issues for follow-up.
- Each filed issue's fix is its own follow-up PR; sequencing decided per-finding by severity and Phase 4 workstream priority.

## Test plan

- [x] All 8 surfaces have a section in the results doc.
- [x] Cross-surface chain-attack analysis pass documented.
- [x] Summary table totals arithmetically correct.
- [x] All cited file:lines verifiably exist in the working tree.
- [x] Issues filed for every High/Medium finding with `security` label.
- [x] Critical findings section either lists Criticals or attests none.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Confirm PR opened**

Run:
```bash
gh pr view --json number,url -q '.number, .url'
```

Expected: PR number + URL. Print both for the user.

---

## Spec coverage check

| Spec § | Requirement | Task(s) |
|---|---|---|
| § 1 Goal | Produce prioritized findings list | All tasks |
| § 2 Phase 1 | Threat model | Task 2 |
| § 2 Phase 2 | 8 sequential per-surface deep-dives | Tasks 3-10 |
| § 2 Phase 3 | Consolidation + chain analysis | Tasks 11-13 |
| § 3 8 surfaces | Each surface gets its own subagent | Tasks 3-10 |
| § 4 Per-surface focus areas | Embedded in each subagent prompt | Tasks 3-10 |
| § 5 Severity rubric | Embedded in each subagent prompt | Tasks 3-10 |
| § 6 Subagent prompt template | Each task instantiates the template | Tasks 2-10 |
| § 7 Output artifacts | All 4 artifacts created | Tasks 2, 3-10, 12, 13 |
| § 8 Out of scope | No fixes during audit; no PoC | Respected (subagent prompts forbid modification) |
| § 9 Verification & non-negotiables | Subagents verify cites; chain analysis explicit | Tasks 3-10 (verify), 11 (chain), 12 (Critical) |
| § 10 Acceptance criteria | All 7 criteria checked | Task 12 self-review + Task 13 + Task 14 PR body |
| § 11 Commit structure | Per-task commits | Each task has commit step |
| § 12 Branch + PR | Single PR at end | Task 14 |
| § 13 Follow-up specs | Out of scope (correctly) | Not in plan |
| § 14 Sources | Referenced in design spec only | Not implemented separately |

No gaps.

## Placeholder scan

Scanned. The Critical-findings section has a clear pattern (either list or explicit "no Critical findings" attestation) — no `TBD`. Subagent prompts have all required content. Composite chains use placeholder `_N_` only inside the summary-table example, which is intentional (subagent fills with real numbers).

## Consistency check

- Surface numbering S1-S8 used consistently.
- Finding ID format `S{N}-F{N}` used consistently.
- Severity rubric (Critical/High/Medium/Low) consistent across all task subagent prompts (and matches design spec § 5).
- File paths spelled identically across tasks (e.g., `lan-rpc.ts` not `lan_rpc.ts`).
- `verification` field tristate values (`code-trace` / `runtime-verified` / `speculative`) consistent.
- `gh issue create` body template includes the same fields as the finding entry format.
