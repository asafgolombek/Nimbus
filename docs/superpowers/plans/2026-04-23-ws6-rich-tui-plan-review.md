# WS6 — Rich TUI (Ink) — Implementation Plan Review

**Date:** 2026-04-23
**Reviewer:** Gemini CLI
**Target Plan:** `docs/superpowers/plans/2026-04-23-ws6-rich-tui.md`

## 1. Summary of Review

The implementation plan is exceptionally thorough, with a well-reasoned execution order and comprehensive TDD cycles. It successfully incorporates the findings from the design spec review (e.g., height thresholds, file logging, SIGTERM handling).

## 2. Suggestions for Improvement

1.  **React Context `useMemo` (Task 15.3).**
    *   **Issue:** In `commands/tui.tsx`, the `IpcContext.Provider` value is passed as a literal: `{{ client, logger }}`. This causes the entire React tree to re-render on every `App` component update because the object reference changes every time.
    *   **Suggestion:** Since `client` and `logger` are stable for the lifetime of the TUI process, this is likely fine, but wrapping them in `useMemo` (or defining the value outside the component if possible) is a cleaner pattern.

2.  **`engine.cancelStream` Clarity (Task 14.3).**
    *   **Observation:** The code in `App.tsx` correctly implements the fallback: `setEntries((e) => [...e, { kind: "error", text: "(canceled by user — LLM may continue in the background)" }])`.
    *   **Suggestion:** Ensure that the `logger.debug` call in Task 14.3 also records that this was a local-only cancellation.

3.  **WatcherPane Total Count (Task 10.3).**
    *   **Observation:** The `WatcherPane` renders `N active, M firing`.
    *   **Suggestion:** When the names are truncated (`WATCHER_PANE_NAME_LIMIT`), ensure the `…X more` line clearly reflects the total number of firing watchers to avoid user ambiguity. The current logic `extra > 0 ? <Text dimColor>…${String(extra)} more</Text> : null` is correct.

4.  **QueryInput "Esc" Support (Task 13.3).**
    *   **Suggestion:** Add support for the `escape` key in `useInput`. Pressing Esc should ideally clear the current `value` and reset `historyCursor` to `null`. This is a standard terminal convention that users often reach for.

5.  **SubTaskPane Completion State (Task 11.3).**
    *   **Observation:** Sub-tasks stay in the map until the next query submit.
    *   **Suggestion:** If a multi-agent run completes, the sub-tasks will all show `✓` or `✗`. Consider adding a visual indicator (e.g., a dim color for the entire pane) once the `streaming` mode has finished to signal that these are "last run" results.

6.  **Pino Destination (Task 15.3).**
    *   **Observation:** The plan mentions `createCliFileLogger(paths)`.
    *   **Suggestion:** Ensure `createCliFileLogger` is robust against directory creation failures (e.g., if `paths.logDir` doesn't exist yet). Although `getCliPlatformPaths()` usually ensures this, a `mkdirSync` with `recursive: true` inside the logger factory is a safe guard.

7.  **`Static` Key Stability (Task 12.3).**
    *   **Issue:** `ResultStream` uses the index as a key: `<Box key={index}>`.
    *   **Observation:** While usually discouraged in React, for `Static` entries that are never re-ordered or deleted, this is acceptable. However, if entries were to be filtered or moved, this would break.
    *   **Recommendation:** Since the plan specifies these are stable transcript entries, index-as-key is fine for v0.1.0.

## 3. Open Questions

1.  **SubTaskPane Scrollback?** If a run generates 50 sub-tasks, and the right column is only 1/3 of the height, what happens?
    *   **Suggestion:** The spec mentions "silent truncation". Ensure that a `(50 total)` or similar count remains visible even if only 5 bars are shown.

2.  **Color Depth Guard.**
    *   **Question:** What happens on 16-color terminals (common on some older Linux distros or remote shells)?
    *   **Observation:** Ink handles basic ANSI mapping, but "amber" or "gray" might map to "yellow" and "white" respectively. The manual smoke checklist should include a quick check for readability on low-color terminals.
