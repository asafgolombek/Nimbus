---
name: nimbus-extension-registry
description: >-
  Guides work on the Nimbus Extension Registry: extension manifest schema
  (nimbus.extension.json), SHA-256 hash verification at Gateway startup
  (verify-extensions.ts), scaffold CLI, install/list/enable/disable/remove
  commands, and extension sandbox hardening. Use when adding extension
  lifecycle features, changing manifest contracts, or working on sandbox
  isolation under packages/gateway/src/extensions/ or
  packages/cli/src/commands/extension.ts or scaffold.ts.
---

# Nimbus — Extension Registry work

## Security model — do not relax

- **Two SHA-256 hashes** are verified at Gateway startup: `manifest_hash` (hash of `nimbus.extension.json`) and `entry_hash` (hash of the compiled entry point). Either mismatch → extension disabled before process spawn, `ERROR` log entry.
- Extensions are **child processes** (`Bun.spawn`) with an explicit, scoped env object — only Vault credentials declared in the extension's manifest for its declared service are injected.
- Extensions cannot call `NimbusVault` directly — the Vault API is never exposed across the process boundary.
- Manifest `permissions` are immutable at runtime; changing them requires reinstall.
- `nimbus.extension.json` is the canonical manifest name. The gateway also accepts legacy `nimbus-extension.json` for backwards compat — do not remove that fallback.

## Key files

| File | Purpose |
|---|---|
| `packages/gateway/src/extensions/verify-extensions.ts` | SHA-256 manifest + entry hash verification at startup |
| `packages/gateway/src/extensions/` | Extension registry subsystem — spawn, lifecycle, registry store |
| `packages/cli/src/commands/scaffold.ts` | `nimbus scaffold extension` — emits manifest + entry template |
| `packages/cli/src/commands/extension.ts` | `nimbus extension install/list/enable/disable/remove` |
| `packages/sdk/src/index.ts` | Public SDK API extension authors depend on (MIT) |

## Manifest schema v1

At minimum, a manifest requires: `name`, `version`, `entry`, `service`, `permissions`. Always validate new required fields against:
1. The live schema in `packages/sdk/`.
2. The scaffold template in `packages/cli/src/commands/scaffold.ts` — keep them in sync.
3. The gateway validator in `packages/gateway/src/extensions/`.

Never add a new required manifest field without updating all three.

## Sandbox hardening — scope for Phase 3

- **Done**: env isolation via explicit `Bun.spawn` env object (no parent env bleed to child).
- **Partial**: network permissions declared in manifest are validated at install time but not enforced at the kernel/syscall level.
- **Planned Phase 5**: full kernel-level network isolation. Do not pull Phase 5 isolation work into Phase 3.

## Extension HITL

If an extension tool performs a user-visible write (create/update/delete/send), confirm it has a matching `action_type` in `HITL_REQUIRED` in `executor.ts` and the required unit tests. Follow `nimbus-engine-security-change` for any HITL additions.

## Verification

After extension registry, scaffold, or manifest changes:
1. `bun run typecheck`
2. `bun run lint`
3. `bun test` — unit tests for extensions
4. Manual smoke-test: `nimbus scaffold extension <name>` → inspect emitted `nimbus.extension.json` and entry file for correctness
5. Follow `nimbus-staged-verify` for integration depth if IPC or startup paths changed
