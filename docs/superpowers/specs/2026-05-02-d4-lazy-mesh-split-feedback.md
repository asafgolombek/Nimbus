# Feedback on `2026-05-02-d4-lazy-mesh-split-design.md`

## 1 — Open Questions & Potential Issues

### 1.1 Path adjustment for `MCP_CONNECTORS_ROOT`
In `keys.ts`, the `MCP_CONNECTORS_ROOT` constant is currently defined as `join(_LAZY_MESH_DIR, "..", "..", "..", "mcp-connectors")`. Since the new directory `packages/gateway/src/connectors/lazy-mesh/` adds one level of nesting, this path will likely need an additional `..` segment to correctly resolve to `packages/mcp-connectors`.
*   **Recommendation:** Verify the path resolution and update it to `join(_LAZY_MESH_DIR, "..", "..", "..", "..", "mcp-connectors")` or equivalent.

### 1.2 `MeshLogger` and `healthDb` in `MeshSpawnContext`
The design suggests passing a "logger/healthDb tuple" to functions in `user-mcp.ts`. However, many of the `ensureXxxMcp` functions also benefit from logging or might eventually need health transition logic.
*   **Suggestion:** Add `readonly logger?: MeshLogger` and `readonly healthDb?: import("bun:sqlite").Database` to the `MeshSpawnContext` interface. This centralizes these dependencies and simplifies the function signatures in `user-mcp.ts`, `connector-spawns.ts`, etc.

### 1.3 `listUserMcpConnectors` in `MeshSpawnContext`
The orchestration logic for user MCPs (`ensureUserMcpConnectorsRunning`) depends on the `listUserMcpConnectors` callback.
*   **Suggestion:** Include `listUserMcpConnectors(): readonly UserMcpConnectorRow[]` in `MeshSpawnContext`. This allows the free functions in `user-mcp.ts` to be fully driven by the context without needing extra parameters.

## 2 — Suggested Improvements

### 2.1 Hoist and Export `ServerSpec`
The `ServerSpec` type (currently inline as `{ command: string; args: string[]; env: Record<string, string> }`) is used across multiple files (`phase3-config.ts`, `connector-spawns.ts`, `mesh.ts`).
*   **Recommendation:** Explicitly define and export `ServerSpec` from `slot.ts` or a new `types.ts` to avoid duplication and satisfy Biome linting.

### 2.2 Relocate `MeshLogger` Interface
The spec places `MeshLogger` in `tool-map.ts`. Since it's a general-purpose interface used for infrastructure (mesh, slots, failures) and not just tool listing, it might feel more at home in `keys.ts` or `slot.ts` (or `types.ts`).

### 2.3 Explicitly note `LazyMeshToolMap` as internal-but-exported
Ensure `LazyMeshToolMap` is exported from `tool-map.ts` so that `mesh.ts` and `user-mcp.ts` can use it, even if it's not re-exported from the public `index.ts`.

### 2.4 Auth and Utility Imports
The split functions in `connector-spawns.ts` and `credential-orchestration.ts` will need various imports currently at the top of `lazy-mesh.ts` (e.g., `anyGoogleOAuthVaultPresent`, `readConnectorSecret`, `randomUUID`). The plan should ensure these are distributed to the relevant sibling files.

## 3 — Technical Integrity

*   **Circular Dependencies:** The proposed DAG (`mesh.ts` -> `credential-orchestration.ts` -> `connector-spawns.ts` -> `slot.ts`) looks safe and avoids circularity by using the `MeshSpawnContext` interface.
*   **LOC Distribution:** The distribution looks excellent. Even the largest file (`connector-spawns.ts` at ~550 LOC) is well within the 800 LOC limit.
*   **Public API:** Re-exporting from `index.ts` correctly preserves the public surface for existing consumers.
