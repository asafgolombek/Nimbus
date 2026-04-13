---
name: nimbus-staged-verify
description: >-
  Runs the correct Nimbus verification commands before commit or PR based on
  changed paths (typecheck, Biome, unit tests, engine/vault coverage gates,
  integration/E2E when touched). Use when the user asks to verify changes,
  prep a PR, fix CI, or "run checks" after editing gateway, cli, ui, sdk, or
  mcp-connectors.
---

# Nimbus — staged verification

Assume the repo root is the cwd. Execute commands; do not only suggest them.

## Default (any code change)

1. `bun run typecheck`
2. `bun run lint`
3. `bun test`

## If `packages/gateway/src/engine/` changed

After the default block, run:

- `bun run test:coverage:engine` (gate ≥85% line coverage)

## If `packages/gateway/src/vault/` changed

After the default block, run:

- `bun run test:coverage:vault` (gate ≥90% line coverage)

## If `packages/gateway/src/extensions/` or `packages/gateway/src/automation/extension-store.ts` changed

After the default block, run:

- `bun run test:coverage:extensions` (gate ≥85% line coverage)

## If integration-sensitive areas changed

Use judgment: IPC contracts, SQLite migrations, subprocess/spawn behavior, connector wiring.

- `bun run test:integration`

## If CLI IPC or e2e flows changed

- `bun run test:e2e:cli`

## If `packages/ui/` changed

From `packages/ui`:

- `bunx vitest run`

## If only docs or markdown changed

Skip compile/test unless the user wants a full sweep; still run `bun run lint` if the diff touches files Biome lints.

## On failure

Fix forward in small steps. Re-run the minimal command that failed until green, then re-run the broader set once.
