# D4 Split — `connector-rpc-handlers.ts` — Design Review

**Reviewer:** Gemini CLI
**Date:** 2026-05-02
**Status:** ✅ Approved

---

## 1 — Executive Summary

The proposed design for splitting `connector-rpc-handlers.ts` is a textbook example of a clean D4 structural refactor. It correctly identifies the functional boundaries within the monolithic file and proposes a logical directory structure that brings the largest file in the IPC layer well under the 800-LOC threshold.

## 2 — Strengths

- **Functional Cohesion:** The grouping into `status`, `lifecycle`, `config`, `removal`, and `auth` perfectly maps to the responsibilities of the various IPC methods.
- **Minimum Churn:** The use of an `index.ts` re-export shim and the commitment to zero behavioral changes ensures that the impact on the rest of the codebase is negligible.
- **Type Safety:** Hoisting `ConnectorRpcHandlerContext` to a dedicated `context.ts` file provides a clean dependency base for all sibling files.

## 3 — Observations & Suggestions

### 3.1 `ConnectorRpcHit` Location

The `ConnectorRpcHit` type (line 89 of the current file) is the return type for all public handlers. I suggest moving it to `context.ts` along with `ConnectorRpcHandlerContext`, as every sibling file (except `index.ts`) will need it.

### 3.2 `VALID_DEPTHS` Location

The `VALID_DEPTHS` constant is currently used only in `handleConnectorSetConfig`. Moving it to `config.ts` as proposed is correct.

### 3.3 Handling of Internal Helpers

The plan correctly identifies that `resumeConnector`, `pauseConnector`, and `emitConfigChanged` are shared between `lifecycle.ts` and `config.ts`. Placing them in `lifecycle.ts` and importing them into `config.ts` is a clean one-way dependency.

### 3.4 Verification of Consumer Edits

In Task 3.5, the spec mentions three consumer files. I've verified their usage:
- `connector-rpc.ts`: Uses the public handlers for the JSON-RPC dispatcher.
- `assemble.ts`: Calls `resumePendingRemovals` during gateway boot.
- `connector-rpc-handlers-setconfig.test.ts`: Specifically tests the config logic.

If Bun's module resolution requires dropping the `.ts` extension for directory imports, this should be done consistently across these three files.

## 4 — Questions

- **Q:** Should `auth.ts` be further split given its size (~530 LOC)?
  - **A:** I agree with the spec's "No" for this phase. The 18 per-connector flows are highly repetitive and structurally similar; keeping them together makes it easier to apply cross-cutting changes (like the recent D11 widening).

## 5 — Conclusion

This split will significantly improve the maintainability of the connector IPC layer and successfully close one of the project's major D4 violations. The plan is ready for implementation.
