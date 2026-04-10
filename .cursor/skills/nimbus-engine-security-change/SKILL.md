---
name: nimbus-engine-security-change
description: >-
  Checklist for edits to Nimbus HITL consent gate, executor tool dispatch,
  audit logging, or Vault. Ensures structural rules, required tests, and
  MCP-only external access. Use when changing packages/gateway/src/engine/
  (especially executor.ts), packages/gateway/src/vault/, or adding HITL
  actions; or when the user mentions consent gate, HITL_REQUIRED, or audit
  before execution.
---

# Nimbus — engine, HITL, and Vault changes

## Non-negotiables (do not "optimize away")

- `HITL_REQUIRED` in `packages/gateway/src/engine/executor.ts` is a frozen `ReadonlySet` at module load — not runtime-configurable, not bypassable via prompt.
- Audit log is written **before** execution, not after.
- Engine code must **not** call cloud APIs directly; external work goes through MCP connectors only.
- Secrets: Vault only; `NimbusVault.get()` returns `string | null` (no throw on miss); never log or surface secret values.

## When adding or changing an HITL-gated action type

1. Update the frozen set in `executor.ts` (authoritative list).
2. Add or extend **unit tests** that prove:
   - consent is requested **before** any connector runs;
   - rejected consent → **no** connector call;
   - rejected consent → audit entry with `hitlStatus: "rejected"`.
3. Run `bun run test:coverage:engine` and keep engine line coverage ≥85%.

## When changing Vault behavior or PAL-backed storage

1. Extend **vault** tests: missing key → `null`, no secret in errors/messages, `listKeys()` returns names only.
2. Run `bun run test:coverage:vault` (gate ≥90%).

## Platform note

PAL-specific fixes belong under `packages/gateway/src/platform/` behind `PlatformServices`, not in business logic importing `win32`/`darwin`/`linux` directly.
