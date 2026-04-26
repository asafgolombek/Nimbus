# Nimbus Security Invariants

Canonical list of structural defenses Nimbus relies on. Each invariant names the defense, points to the production wiring that makes it active (not just defined), and lists the anti-pattern that would regress it. The B1 audit ([`superpowers/specs/2026-04-25-security-audit-results.md`](./superpowers/specs/2026-04-25-security-audit-results.md)) found that several of these defenses *existed* in the codebase but had **zero production callers** — the most common root cause of High-severity findings. This file exists so that gap is impossible to re-introduce silently.

**The rule:** every invariant below has at least one enforcement test in [`packages/gateway/src/security-invariants.test.ts`](../packages/gateway/src/security-invariants.test.ts). If you change the wiring, the test must be updated in the same commit; if you remove the defense, the test must fail.

Companion files:
- [`SECURITY.md`](./SECURITY.md) — public-facing security model and reporting policy
- [`architecture.md`](./architecture.md) §Security Model — threat-to-mitigation table
- [`CLAUDE.md`](../CLAUDE.md) / [`GEMINI.md`](../GEMINI.md) — compact summary table for AI assistants

---

## I1 — Child-process environment scoping

**Defense:** `extensionProcessEnv()` in `packages/gateway/src/extensions/spawn-env.ts` returns a curated, audited set of env vars; gateway-private secrets (LLM provider API keys, OAuth client secrets, updater overrides) are stripped before any child process inherits them.

**Wired at:** all 30+ MCP / extension spawn sites in `packages/gateway/src/connectors/lazy-mesh.ts` (every `spawn()` call sets `env: extensionProcessEnv(...)`).

**Anti-pattern:** `spawn(..., { env: { ...process.env, EXTRA: ... } })`. Any literal `{ ...process.env }` spread inside `packages/gateway/src/connectors/` re-introduces the S2-F1 / S7-F1 / S8-F1 leak that powered chains C1, C2, and C3.

**How to comply:** when adding a new MCP child spawn, import `extensionProcessEnv` and pass the connector-specific extras as the argument. Never spread `process.env` into a child env directly.

---

## I2 — HITL frozen-set membership

**Defense:** `HITL_REQUIRED` in `packages/gateway/src/engine/executor.ts` is a frozen façade over a module-private `Set` (`HITL_REQUIRED_BACKING`). The façade exposes `has`, iteration, and `forEach` but no mutators; an attempt to call `.add` on the cast type is a no-op or throws.

**Wired at:** `executor.ts:192` — every action passes `HITL_REQUIRED.has(action.type)` before dispatch; covered by the "every HITL_REQUIRED action type triggers the consent channel" test in `engine.test.ts`.

**Anti-pattern:** mutating `HITL_REQUIRED` at runtime, declaring a new "destructive" action without adding it to `HITL_REQUIRED_BACKING`, or routing destructive work around `ToolExecutor` entirely. S1-F1 / S1-F7 / C6 all stemmed from destructive RPCs (`data.delete`, `connector.remove`, `connector.reindex`) that bypassed the executor.

**How to comply:** every new IPC method that mutates state outside the index, deletes data, or reaches the network on the user's behalf is added to `HITL_REQUIRED_BACKING` *and* dispatched through `ToolExecutor`. There is no "trusted caller" exception.

---

## I3 — HITL gate consults `action.type`, not `payload.mcpToolId`

**Defense:** the executor calls `HITL_REQUIRED.has(action.type)` exactly. `HITL_REQUIRED_BACKING` stores **logical action types** (`file.move`, `email.send`, `repo.pr.merge`, …) — not connector-specific MCP tool ids (`filesystem_move_file`, `gmail_gmail_message_send`). The dispatcher uses `payload.mcpToolId` as a routing-only hint to pick the right MCP tool inside the matched action class.

**Wired at:** `executor.ts:192` — `HITL_REQUIRED.has(action.type)`. The earlier fix `ae27fe9` resolved `mcpToolId ?? action.type` and looked it up in `HITL_REQUIRED`; that opened a *new* bypass (since the set holds action types, not MCP ids, every `mcpToolId`-bearing action skipped the gate). Reverted in `2c9ff06`.

**Anti-pattern:** any code that gates on `payload.mcpToolId`, `resolvedToolId`, or any other dispatch hint. The chain-C4 risk (planner emits `{ type: "files.list", payload: { mcpToolId: "github_repo_pr_merge" } }`) is *not* closed at the executor layer; it is mitigated by trusting the planner to emit the correct `action.type` and by the `<tool_output>` envelope (I11) on the LLM-facing path. A future fix that closes C4 structurally must add a parallel `HITL_REQUIRED_MCP_IDS` set or change `HITL_REQUIRED` to hold both classes — the test in this file enforces today's design and must be updated alongside any such change.

**How to comply:** when adding a new destructive action class, add the **logical type string** to `HITL_REQUIRED_BACKING`. Do not add MCP tool ids to that set; do not gate on `mcpToolId` anywhere.

---

## I4 — `hitlStatus` is consent-output-only

**Defense:** the `hitlStatus` field on audit rows (`approved` / `rejected` / `not_required`) is set exclusively by the consent gate in `executor.ts` after the user responds. `not_required` is the correct value when the action is not in `HITL_REQUIRED`; `approved` may only appear after a real consent decision.

**Wired at:** `executor.ts:194-210` is the only production assignment site outside test fixtures.

**Anti-pattern:** writing `hitlStatus: "approved"` at any non-test call site. S1-F5 / chain C6 (`data.delete` hardcoding the field) created a forged audit trail that survived `nimbus audit verify`.

**How to comply:** new RPC handlers that record audit rows must let `ToolExecutor` populate `hitlStatus`; never set it inline.

---

## I5 — LAN method allowlist is intrinsic to the LAN server

**Defense:** `checkLanMethodAllowed(method, peer)` in `packages/gateway/src/ipc/lan-rpc.ts` enforces both the namespace deny-list (`vault.*`, `consent.*`, `audit.*`, `data.*`, `updater.*`, `lan.*`, `profile.*`) and the per-peer write grant.

**Wired at:** `lan-server.ts:242` — called inside `handleEncryptedMessage` *before* `this.opts.onMessage`, so the gate cannot be bypassed by upstream wiring.

**Anti-pattern:** moving the allowlist check into the dispatcher, the IPC server, or any caller — anywhere outside the LAN server itself. S1-F2 / S3-F1 / chains C3 and C5 were a dead-code defense: the function existed but was never called from `LanServer` in production.

**How to comply:** when adding a new LAN-reachable method, update `WRITE_METHODS` and/or `FORBIDDEN_OVER_LAN` in `lan-rpc.ts`. Do not add a second enforcement path; extend the existing one.

---

## I6 — LAN bind defaults to loopback

**Defense:** `DEFAULT_NIMBUS_LAN_TOML.bind = "127.0.0.1"`. Wide-area exposure is an explicit opt-in (`[lan] bind = "0.0.0.0"`), not the default.

**Wired at:** `packages/gateway/src/config/nimbus-toml.ts` (default), enforced by `_test-suite.yml` config defaults test.

**Anti-pattern:** changing the default to `"0.0.0.0"`, or auto-binding to all interfaces when an env var is set. S3-F7 / chain C3 was a `0.0.0.0` default that turned LAN access into unintended internet exposure on public Wi-Fi.

**How to comply:** new transports default to loopback. Public-interface binding requires both an explicit user config value *and* a startup log line announcing the binding.

---

## I7 — Tauri allowlist sync

**Defense:** `ALLOWED_METHODS` in `packages/ui/src-tauri/src/gateway_bridge.rs` is the union of every IPC method the renderer is permitted to call. Every entry must (a) have a gateway handler and (b) be classified as read-only or HITL-gated. `extension.install`, `connector.addMcp`, and any other code-execution-class surface is **not** in the renderer-callable allowlist; those are reachable only via Rust-native dialogs that prevent renderer-controlled paths.

**Wired at:** `gateway_bridge.rs` `ALLOWED_METHODS` array; cross-checked by the Rust-side allowlist test (G9).

**Anti-pattern:** adding a write/RCE-class method to the allowlist without a corresponding HITL gate, or shipping an entry whose gateway handler does not exist (`connector.startAuth` had no handler — S4-F2). S7-F2 / chain C1 (`extension.install` allowlisted with no HITL) was the chain that turned a renderer XSS into full credential exfiltration.

**How to comply:** when adding to `ALLOWED_METHODS`, verify the gateway handler exists, route any write through `HITL_REQUIRED`, and update the allowlist test that asserts every entry resolves to a real handler.

---

## I8 — Tauri renderer Content Security Policy is restrictive

**Defense:** `tauri.conf.json` sets `"csp": "default-src 'self'; script-src 'self'"` (or stricter). Inline scripts and remote origins are blocked.

**Wired at:** `packages/ui/src-tauri/tauri.conf.json`.

**Anti-pattern:** `"csp": null` (S4-F4 / chain C1 entry point — allowed prompt-injected content from any indexed connector to execute as renderer-trust-level script). Loosening to `'unsafe-inline'` for convenience is the same regression in disguise.

**How to comply:** new renderer features that need a wider CSP must add the *minimum* directive needed and document the rationale. `unsafe-inline` and `unsafe-eval` are forbidden.

---

## I9 — SQL parameter binding only

**Defense:** every SQLite query uses bound parameters via the typed `dbRun` / `dbExec` wrappers in `packages/gateway/src/db/write.ts`. Identifier-class values that cannot be parameter-bound (table/column names from a finite allowlist) go through `escapeIdentifier` with a null-byte / empty-name guard.

**Wired at:** `db/write.ts`, `db/repair.ts` (`escapeIdentifier`), `people/person-store.ts` (per-field parameter binding after S5-F5 fix).

**Anti-pattern:** template-literal SQL on caller-supplied data (`db.run(\`UPDATE ... SET ${field} = ${value}\`)`). S5-F5 was a `sets.join()` template in `patchPerson` that built SQL from caller-supplied field names.

**How to comply:** read S5-F5 before adding any new SQL. Identifier-shaped inputs go through `escapeIdentifier`; everything else binds. There is no "internal callers are trusted" carve-out.

---

## I10 — Constant-time comparison for security-sensitive byte strings

**Defense:** every comparison of a hash, signature, MAC, or pairing code uses `crypto.timingSafeEqual` (Node) or the Bun equivalent — never `===` or `!==`.

**Wired at:** `packages/gateway/src/extensions/verify-extensions.ts`, `packages/gateway/src/extensions/install-from-local.ts`, `packages/gateway/src/updater/updater.ts` (SHA-256 compare), `packages/gateway/src/ipc/lan-pairing.ts` (pairing code).

**Anti-pattern:** `if (computed === expected)` for any value that an attacker can probe by timing. S6-F10 / S7-F8 were short-circuit equality on hashes.

**How to comply:** new hash/signature/MAC checks call `timingSafeEqual` on Buffers of equal length; reject before the call if lengths differ.

---

## I11 — Tool-result envelope on the LLM-facing path

**Defense:** every tool result that flows into an LLM context is wrapped in a textual `<tool_output service="..." tool="...">…</tool_output>` envelope by `wrapToolOutput` in `packages/gateway/src/engine/tool-output-envelope.ts`. Literal `</tool_output>` substrings inside the body are escaped to `<\/tool_output>` so attacker-controlled content cannot terminate the envelope and re-enter "instruction mode".

**Wired at:** the agent's tool wrapper in `packages/gateway/src/engine/agent.ts`. The planner-side `ConnectorDispatcher` returns the bare result on its own path (gated by HITL); the envelope is applied at the LLM-facing boundary only.

**Anti-pattern:** building a new agent surface that calls a tool and feeds the raw result to the LLM. S8-F3 / chain C4 documented exactly this (no envelope present despite the doc claim) — the prompt-injection defense was a soft barrier (LLM-SDK message typing) only.

**How to comply:** any new LLM-facing tool result goes through `wrapToolOutput`. The HITL gate is the structural defense for destructive actions; the envelope raises the bar against prompt injection on read-only and conversational paths.

---

## I12 — DPAPI optional entropy on Windows vault entries

**Defense:** the Windows vault implementation (`packages/gateway/src/vault/win32.ts`) loads a per-install entropy blob from `<configDir>/vault/.entropy` (created on first use) and passes it as `pOptionalEntropy` to every `CryptProtectData` / `CryptUnprotectData` call. Other same-uid processes cannot decrypt Nimbus vault blobs without also reading the entropy file.

**Wired at:** `vault/win32.ts` `protect` / `unprotect` paths; legacy entries without entropy are migrated on first read.

**Anti-pattern:** dropping the entropy parameter "for compatibility", or storing the entropy alongside the ciphertext in a way that defeats it. S2-F4 was the original gap (no entropy, any same-uid process could decrypt).

**How to comply:** the entropy blob lives only at `<configDir>/vault/.entropy`; do not mirror it into config files, logs, or IPC responses.

---

## How a new invariant is added

1. The defense ships with at least one production caller — never an orphan helper function.
2. An entry is added here naming the defense, the wiring site, and the anti-pattern.
3. An assertion is added to [`security-invariants.test.ts`](../packages/gateway/src/security-invariants.test.ts) that fails if the wiring is removed (typically a grep against the production source tree).
4. The compact summary in `CLAUDE.md` and `GEMINI.md` is updated.

## How an invariant is retired

If a future architectural change makes an invariant obsolete (e.g. moving to a different IPC framework supersedes I7), the entry is **deleted in the same commit** as the architectural change — never left in place as documentation drift. The audit trail is the git history of this file.
