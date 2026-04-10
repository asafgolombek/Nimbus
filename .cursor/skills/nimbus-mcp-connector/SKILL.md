---
name: nimbus-mcp-connector
description: >-
  Implements or modifies Nimbus MCP connector packages under
  packages/mcp-connectors/*. Enforces AGPL package license, workspace
  dependency on @nimbus-dev/sdk only (no gateway/cli/ui imports), MCP server
  process model, and tool contracts suitable for the gateway connector mesh.
  Use when adding a connector, changing connector tools, or when the user
  mentions mcp-connectors, MCP server, or connector mesh.
---

# Nimbus — MCP connector work

## Package boundaries

- Each connector lives under `packages/mcp-connectors/<name>/`.
- **`dependencies`**: `@nimbus-dev/sdk` (`workspace:*`), `@modelcontextprotocol/sdk`, and normal utilities (e.g. `zod`). **Do not** add `@nimbus/gateway`, `@nimbus/cli`, or `@nimbus/ui`.
- **`license`**: keep `"AGPL-3.0-only"` on connector `package.json` — do not switch to MIT (MIT is reserved for `packages/sdk/`).

## Architecture alignment

- Connectors are **MCP servers** (separate process). The gateway engine talks to them via MCP only — **no** direct cloud API calls from `packages/gateway/src/engine/`.
- Tool names, input shapes, and side effects should match how the gateway **dispatcher** lists and invokes tools (read existing connectors and `packages/gateway/src/connectors/` when changing contracts).

## HITL and destructive tools

- If a tool performs a user-visible write (send message, create/update/delete resources, etc.), assume it may need a matching **`action_type`** and entry in `HITL_REQUIRED` in `packages/gateway/src/engine/executor.ts`, plus the **HITL unit tests** described in the `nimbus-engine-security-change` skill. Confirm against the authoritative frozen set in `executor.ts`.

## Verification

From the connector directory (or root with filter), run typecheck, lint, and tests for that package. After gateway-side wiring changes, follow `nimbus-staged-verify` for the full matrix.
