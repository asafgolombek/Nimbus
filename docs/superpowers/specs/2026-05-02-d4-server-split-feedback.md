# Feedback on `2026-05-02-d4-server-split-design.md`

## 1 — Open Questions & Potential Issues

### 1.1 `ToolExecutor` and `bindConsentChannel` boilerplate
The dispatchers for `reindex`, `data`, `connector`, and the `vault` fallback all instantiate a `ToolExecutor` which requires `bindConsentChannel(ctx.consentImpl, clientId)`. This boilerplate is repeated 4 times in the current `server.ts`.
*   **Suggestion:** Consider adding a small helper in `context.ts` or `dispatchers.ts` like `createIpcToolExecutor(ctx, clientId)` to deduplicate this setup.

### 1.2 `requireNonEmptyRpcString` placement
The spec notes that `requireNonEmptyRpcString` is used by both `inline-handlers.ts` and `dispatchers.ts`.
*   **Suggestion:** Ensure it's exported from wherever it lands (e.g., `inline-handlers.ts`) or consider a small `utils.ts` if more shared helpers emerge.

### 1.3 `dispatchEngineAskStream` extraction
The `engine.askStream` handler is currently a large block of code inside the `dispatchMethod` switch (lines 1357–1402). It uses `session.writeNotification` and `agentInvokeHandler`.
*   **Improvement:** When extracting it to `inline-handlers.ts`, ensure it correctly takes `session` as a parameter and uses `ctx.getAgentInvokeHandler()` to maintain the reactive behavior of the setter.

### 1.4 `Symbol` sentinels
The spec correctly identifies the need for internal skip-symbols.
*   **Suggestion:** Ensure all `diagnosticsRpcSkipped` is also included in the `context.ts` list of exported symbols (the spec text mentions it in § 3.1 but it should be explicitly in the implementation list).

## 2 — Suggested Improvements

### 2.1 Hoist `VaultDispatchOutcome` and related types
The types `VaultDispatchHit`, `VaultDispatchMiss`, and `VaultDispatchOutcome` are used in `vault-dispatch.ts`.
*   **Recommendation:** Keep them in `vault-dispatch.ts` as they are internal to that logic, but ensure they are exported if `server.ts` needs to reference the outcome shape (which it does in `rpcVaultOrMethodNotFound`).

### 2.2 Re-verify `AgentRequestContext` usage
`dispatchAgentInvoke`, `dispatchWorkflowRunRpc`, and `dispatchEngineAskStream` all wrap their execution in `agentRequestContext.run(...)`.
*   **Note:** This works fine with the `ServerCtx` approach, but the plan should ensure the `import { agentRequestContext } from "../engine/agent-request-context.ts"` is present in `inline-handlers.ts`.

### 2.3 `clientId` consistency
Ensure that all `tryDispatchXxxRpc` functions in `dispatchers.ts` that *might* need `clientId` (for `ToolExecutor` or logging) have it in their signature, even if some (like `llm` or `voice`) don't use it yet. This keeps the dispatcher signatures more uniform.

## 3 — Technical Integrity

*   **Closure Reactivity:** The use of getters for `agentInvokeHandler` and `workflowRunHandler` in `ServerCtx` is the correct way to handle the mutable closure state from `createIpcServer`.
*   **File Size:** The estimated LOC distribution is well balanced. `dispatchers.ts` (~580 LOC) is the largest but remains well below the D4 threshold.
*   **Circular Dependencies:** The hierarchy `server.ts` -> `dispatchers.ts`/`inline-handlers.ts` -> `context.ts`/`rpc-error.ts` is unidirectional and should not cause issues.
