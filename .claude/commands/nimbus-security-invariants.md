---
name: nimbus-security-invariants
description: >
  Authoritative reference for the Nimbus invariant triple rule and the security-defense
  lifecycle: production wiring + docs entry + enforcement test. Use this skill whenever
  you are adding, modifying, or auditing a structural security defense — HITL action types,
  extension integrity checks, Vault redaction rules, ALLOWED_METHODS bridge entries, or
  any new gating mechanism. Also trigger for questions like "is this defense real?",
  "how do I add a new HITL action?", "should this be in ALLOWED_METHODS?", or "why does
  the security-invariants test fail?". Consult before claiming a defense is active —
  the B1 audit found three defenses defined in code but never wired in production.
---

# Nimbus Security Invariants

## The Invariant Triple Rule

Every structural security defense in Nimbus must exist as **three things simultaneously** or it is not considered real:

1. **Production wiring site** — an actual call site in production code, not just a function definition.
2. **Entry in `docs/SECURITY-INVARIANTS.md`** — names the defense, its invariant ID (format `I<N>`), and the production wiring file and line.
3. **Assertion in `packages/gateway/src/security-invariants.test.ts`** — fails if the wiring is removed.

If any one of the three is missing, **do not claim the defense is active**. Search for all three before marking work done.

## The B1 Audit Lesson

The Phase 4 internal audit found three defenses (`extensionProcessEnv`, `checkLanMethodAllowed`, the `<tool_output>` envelope) that were **defined in code but had zero production callers**. The triple rule exists to prevent that failure mode. When adding a new defense, do all three of:

- `grep` for the function name across `packages/gateway/src/` to confirm it has at least one production caller.
- Add the `I<N>` row to `docs/SECURITY-INVARIANTS.md` with the wiring file:line.
- Add a test in `security-invariants.test.ts` that fails if the wiring is removed (e.g., asserts a specific source file imports/calls the defense).

## HITL Invariants

`HITL_REQUIRED` in `packages/gateway/src/engine/executor.ts` is a **module-level `ReadonlySet` frozen with `Object.freeze`**. Rules:

- Never populated from config files, IPC calls, or extension APIs at runtime.
- New action types are added by editing the static source declaration only.
- The corresponding test asserts that **every action type in the set triggers the consent channel** in `ToolExecutor.execute()`.
- The gate consults `action.type` only — **not** `payload.mcpToolId` or `resolvedToolId` (the set holds logical types, not MCP ids — invariant `I3`).
- `hitlStatus` is set only by the consent gate (invariant `I4`). Hardcoding `hitlStatus: "approved"` in any handler is a regression.

## Extension Integrity Invariants

Manifest SHA-256 is verified **twice**:

1. At Gateway startup via `verifyExtensionsBestEffort`.
2. **Immediately before each spawn** via `verifyOneExtensionStrict`.

Both wiring sites must be present. A defense that only verifies at startup is insufficient — it does not catch mutations between startup and spawn. When auditing, check both call sites exist; deleting either breaks the invariant.

## Vault Invariants

**No code path may** write a credential value to disk in plaintext, include it in a log line, or return it in an IPC response.

- The Pino logger `redact` config covers `*.token`, `*.secret`, and `oauth.*` patterns.
- When adding a new credential type, verify the field name matches one of these patterns or **add it explicitly to the redact list**.
- The structured logger redaction is enforced by a unit test that pipes a known-secret payload through the logger and asserts the secret never appears in output.

## ALLOWED_METHODS Invariant

The Rust bridge in `packages/ui/src-tauri/src/gateway_bridge.rs` maintains a **compile-time `ALLOWED_METHODS: &[&str]` array**. A `cargo test allowlist_exact_size` assertion verifies the count.

When adding new IPC methods accessible from the UI:

- Add them to `ALLOWED_METHODS` **alphabetically**.
- **Update the count assertion** in the test.
- Never expose `vault.*`, `db.*` writes, `updater.*`, or `lan.*` pairing methods through this surface — these are RCE-class or pairing-class methods that must remain Gateway-only.

## When to Create a New Invariant Entry

Add an invariant entry (`I<N>` row in `SECURITY-INVARIANTS.md` + test assertion) when you add:

- A new HITL action type.
- A new credential storage path.
- A new extension verification step.
- A new IPC method gating.
- A new prompt injection defense.

**Do not** add invariant entries for non-security behavior. The invariant table is a load-bearing contract, not a documentation index.

## Workflow Checklist

When introducing or modifying a structural defense:

- [ ] Production wiring site exists and has a real caller (`grep` to confirm).
- [ ] `docs/SECURITY-INVARIANTS.md` has an `I<N>` row naming the defense + wiring file:line.
- [ ] `packages/gateway/src/security-invariants.test.ts` has an assertion that fails if the wiring is removed.
- [ ] If the defense gates an IPC method exposed to the UI, the method is in `ALLOWED_METHODS` and the count assertion is updated.
- [ ] If the defense affects credentials, the field name matches the Pino `redact` patterns or is added explicitly.
- [ ] When changing a wiring site, update both the test and `SECURITY-INVARIANTS.md` in the same commit. When retiring an invariant, delete the row — never leave it as documentation drift.
