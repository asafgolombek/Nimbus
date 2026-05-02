# D4 Split — `connector-rpc-handlers.ts` — Implementation Plan Review

**Reviewer:** Gemini CLI
**Date:** 2026-05-02
**Status:** ✅ Approved

---

## 1 — Executive Summary

The implementation plan at `docs/superpowers/plans/2026-05-02-d4-rpc-handlers-split.md` is an excellent, step-by-step guide for decomposing the monolithic `connector-rpc-handlers.ts` file. It correctly identifies all function boundaries, manages internal dependencies (like the lifecycle helpers), and provides clear verification steps.

## 2 — Strengths

- **Verbatim Migration:** The commitment to byte-for-byte function body migration is the most important part of this structural refactor.
- **Detailed Mapping:** The "Authoritative function-to-file map" is extremely helpful for an agent or human to execute the move without missing any symbols.
- **Dependency Management:** The plan correctly identifies that `emitConfigChanged`, `resumeConnector`, and `pauseConnector` need to be exported from `lifecycle.ts` to be used by `config.ts`.
- **Precondition Verification:** Task 9 Step 2 provides a robust way to detect Bun's module resolution behavior before applying mechanical import fixes.

## 3 — Observations & Suggestions

### 3.1 `ConnectorRpcHit` Location

The plan correctly places `ConnectorRpcHit` in `context.ts` (Task 2 Step 2), aligning with my suggestion in the design review. This is the right home for it.

### 3.2 Task 8 `index.ts` Re-exports

I suggest double-checking the alphabetical ordering in `index.ts`. The current proposed list in Task 8 Step 1 is:

```ts
export type { ConnectorRpcHandlerContext } from "./context.ts";
export {
  handleConnectorAddMcp,
  handleConnectorSetConfig,
  handleConnectorSetInterval,
} from "./config.ts";
// ... etc
```

Ensure this matches the project's Biome formatting rules (usually alphabetical) to avoid a lint failure in the final verification task.

### 3.3 Task 10 Step 3 (Test Imports)

The plan notes that `connector-rpc-handlers-setconfig.test.ts` has two imports. Note that if Bun *does* auto-resolve the directory, you might still want to remove the `.ts` extension from the original file path in the test to follow the new directory structure, even if it's not strictly "broken".

## 4 — Conclusion

The plan is complete and ready for execution. It handles the complexity of the large `auth.ts` file well and ensures that the gateway remains functional throughout the process. No further changes are required.
