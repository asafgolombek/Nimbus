---
name: nimbus-ipc-contract
description: >-
  Guides JSON-RPC 2.0 IPC contract changes for the Nimbus gateway-CLI
  interface: adding new RPC methods, changing request/response shapes,
  updating the IPC client in the CLI, and keeping schema consistent between
  gateway and CLI. Use when adding or modifying IPC methods, or when the
  user mentions IPC, JSON-RPC, named pipe, domain socket, rpc-handler,
  or ipc-client.
---

# Nimbus — IPC contract changes

## Protocol constraints — do not change

- **Transport**: Unix domain socket (macOS/Linux) or Windows named pipe, resolved via `PlatformServices.ipcPath()`.
- **Wire protocol**: JSON-RPC 2.0 — requests `{ jsonrpc: "2.0", id, method, params }`, responses `{ jsonrpc: "2.0", id, result | error }`.
- **No cross-package imports**: the CLI and UI never import gateway TypeScript source. If the CLI needs new data, add an IPC method — do not expose internal gateway modules.

## Key files

| File | Purpose |
|---|---|
| `packages/gateway/src/ipc/` | IPC server — router, handlers, transport |
| `packages/cli/src/ipc-client/` | IPC client — typed wrappers, consent channel |
| `packages/cli/src/ipc-client/consent.ts` | Dedicated HITL consent channel (separate from regular RPC) |

## Adding a new IPC method

1. **Gateway** (`packages/gateway/src/ipc/`): register the method name in the router/handler. Validate params at the boundary using `unknown` + runtime checks — never `any`.
2. **CLI** (`packages/cli/src/ipc-client/`): add a typed wrapper that sends the JSON-RPC request and validates the response shape before returning.
3. **Method naming**: `<noun>.<verb>` pattern, consistent with existing methods — e.g. `extension.list`, `connector.auth`, `session.create`, `watcher.add`.
4. **Error codes**: reuse standard JSON-RPC codes (`-32600` invalid request, `-32601` method not found, `-32602` invalid params, `-32603` internal error) plus Nimbus-defined codes in the existing error enum — do not invent new codes arbitrarily.
5. **No silent breaking changes** to existing method signatures. If a shape must change, add a version discriminator or introduce a new method alongside the old one.

## Consent channel

The CLI has a **separate consent channel** for HITL prompts — do not route user-visible write confirmations through normal RPC replies. The HITL gate fires in `executor.ts`; the IPC consent channel lives in `packages/cli/src/ipc-client/`. New destructive actions must go through the frozen `HITL_REQUIRED` set and the consent channel, not through custom response fields.

## Testing IPC changes

- **Unit**: mock the socket in gateway IPC handler tests.
- **Integration** (real socket + real Gateway subprocess): `bun run test:integration`
- **E2E** (real Gateway + mock MCP servers, CLI exercises the new method): `bun run test:e2e:cli`

Follow `nimbus-staged-verify` to determine which test tiers are needed for the touched paths.
