# Feedback on `2026-05-02-d4-server-split.md` (Implementation Plan)

## 1 — Summary of Review

The implementation plan is technically sound, extremely detailed, and follows the proven patterns from previous D4 splits. It correctly identifies all 30+ symbols to be moved and handles the complex closure state of `createIpcServer` using a `ServerCtx` with getters for mutable handlers.

## 2 — Suggested Minor Improvements

### 2.1 Explicit `export` for `RpcMethodError` (Task 2)
As noted in the plan, `RpcMethodError` is currently not exported in `server.ts`. Since it will be the primary error type used across almost all sibling files in the new directory, adding the `export` is critical. The plan already captures this, but ensure that during execution, it is also imported by `server.ts` and others.

### 2.2 Reactivity of `agentInvokeHandler` in `dispatchEngineAskStream` (Task 7)
In the original code, the `handler` is captured at the start of the `engine.askStream` block:
```ts
const handler = agentInvokeHandler;
if (handler === undefined) { ... }
```
Then it is used inside the `void (async () => { ... })()` block. 
*   **Verification:** Ensure that `dispatchEngineAskStream` in `inline-handlers.ts` does the same:
    ```ts
    const handler = ctx.getAgentInvokeHandler();
    if (handler === undefined) { ... }
    // ... async block uses handler ...
    ```
    This ensures the handler is "locked in" for the duration of that specific stream, matching the original behavior.

### 2.3 `clientId` parameter consistency (Task 8)
Task 8 mentions that some dispatchers like `llm` or `voice` don't currently use `clientId`.
*   **Suggestion:** While not strictly necessary for a mechanical move, adding `clientId: string` to the signatures of all `tryDispatchXxxRpc` functions makes them uniform and easier to call from the `dispatchMethod` loop, potentially simplifying the `dispatchers.ts` orchestrators.

### 2.4 `winSockets` initialization (Task 9)
In Task 9, `winSockets` is initialized as `let winSockets: Set<net.Socket> = new Set();`.
*   **Note:** In `start()`, it is overwritten by `handle.winSockets`. Ensure that the `stop()` method correctly iterates over whichever `Set` is currently active (which it does in the plan).

## 3 — Technical Accuracy

*   **Closure state:** The `ServerCtx` getter pattern (`getAgentInvokeHandler: () => agentInvokeHandler`) is the most robust way to preserve the behavior of the public setters (`setAgentInvokeHandler`) across file boundaries.
*   **Path Resolution:** The `../../X` and `../Y` adjustments are correct for the new directory nesting level.
*   **Import Graph:** The plan correctly identifies the dependency of `dispatchers.ts` on `inline-handlers.ts` for the `workflow.run` route.
*   **Verification:** The use of `ipc.test.ts` as a primary verification gate is excellent, as it exercises the full server lifecycle including the dispatch paths that depend on the extracted logic.
