# Feedback on `2026-05-02-d4-lazy-mesh-split.md` (Implementation Plan)

## 1 — Summary of Review

The implementation plan is exceptionally thorough and correctly identifies the technical nuances of the split, particularly the `MCP_CONNECTORS_ROOT` path adjustment and the introduction of `MeshSpawnContext`. It also proactively addresses several feedback points raised on the design spec (e.g., adding `logger` and `healthDb` to the context).

## 2 — Suggested Minor Improvements

### 2.1 Explicit `export` for `LazyMeshToolMap` (Task 3)
In the original `lazy-mesh.ts`, `LazyMeshToolMap` is a private type. However, it will be needed by `mesh.ts` and potentially other sibling files.
*   **Suggestion:** In Task 3 Step 1, explicitly note that `export` should be added to the `LazyMeshToolMap` type definition when moving it to `tool-map.ts`.

### 2.2 Re-verify `ensureUserMcpConnectorsRunning` location (Task 8)
The plan correctly identifies in the "Note on Option A" that `ensureUserMcpConnectorsRunning` should stay on the class in `mesh.ts`. 
*   **Suggestion:** For clarity, remove the placeholder signature for `ensureUserMcpConnectorsRunning` in Task 8 Step 2 to avoid any confusion during execution about whether it should be lifted or not.

### 2.3 `MeshSpawnContext` in `credential-orchestration.ts` (Task 9)
Task 9 mentions that the 11 `ensureIfXxx` wrappers should take `(ctx: MeshSpawnContext)`.
*   **Suggestion:** Ensure that the plan explicitly mentions that these functions (which are currently `private` methods) should become either `export` or file-private `function`s in `credential-orchestration.ts`.

## 3 — Technical Accuracy

*   **Path Resolution:** The `..` count in `keys.ts` (4 segments) is technically correct for the new directory depth.
*   **`MeshSpawnContext` wiring:** The constructor wiring in `mesh.ts` (Task 11) correctly binds the class methods to the context object, preserving the existing slot state machine logic.
*   **Consumer Updates:** The list of 10 consumer files and the corresponding `sed` patterns are accurate and cover the entire workspace.
