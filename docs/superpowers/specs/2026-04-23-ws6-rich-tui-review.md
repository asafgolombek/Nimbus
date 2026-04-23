# WS6 — Rich TUI (Ink) — Design Spec Review

**Date:** 2026-04-23
**Reviewer:** Gemini CLI
**Target Spec:** `docs/superpowers/specs/2026-04-23-ws6-rich-tui-design.md`

## 1. Open Questions & Verifications

1.  **Confirmed: `engine.cancelStream` is missing.** A grep of `packages/gateway/src/ipc/server.ts` confirms that the Gateway does not currently implement a `cancelStream` RPC method.
    *   **Recommendation:** If "full-fidelity" cancellation is a requirement for v0.1.0, the Gateway must be updated to track active `agent.invoke` promises by `streamId` and provide a way to abort them (e.g., via `AbortController`).
    *   **Fallback:** If not implemented, the "local state reset" fallback mentioned in §11.1 should be the explicit plan, with a note that the LLM may continue generating and consuming tokens/quota in the background.

2.  **SubTaskPane Startup State.** The spec states "Session-resume on relaunch" is out of scope (§2.2), but also that the pane clears "only on next query submit" (§2.1.7).
    *   **Question:** On a fresh `nimbus tui` launch, should the `SubTaskPane` be empty, or should it query the Gateway for the most recent run's sub-task results (available via `sub_task_results` table)?
    *   **Suggestion:** Start empty for v0.1.0 to keep logic simple, but clarify this in §3.4.

3.  **Terminal Height Constraints.** While narrow-terminal (width) collapse is defined (§3.3), terminal *height* is not addressed.
    *   **Question:** What happens if the terminal has fewer than 10-15 rows? The status panes and query input could easily crowd out the `ResultStream`.
    *   **Suggestion:** Define a `MIN_HEIGHT_THRESHOLD`. If below this, either switch to a "compact" mode (ResultStream only) or fall back to the REPL.

## 2. Suggestions for Improvement

1.  **Visual Feedback for Double-Ctrl+C.**
    *   **Suggestion:** When the first Ctrl+C is received in a state that doesn't immediately exit (like `idle` or `streaming`), render a brief amber hint in the status bar or query prompt: `^C Press again to exit`. This prevents user confusion when the first press doesn't close the window.

2.  **TUI Logging Strategy.**
    *   **Issue:** Ink TUIs cannot log to `stdout` or `stderr` without corrupting the display.
    *   **Suggestion:** Explicitly specify that `pino` should be configured to write to a file (e.g., `join(paths.logDir, "nimbus-tui.log")`) rather than the console. This is critical for debugging "white-screen" or layout-crash issues.

3.  **Extended Dumb-Terminal Triggers.**
    *   **Suggestion:** Add `process.env.CI === 'true'` to the fallback triggers in §3.1.4. While `!process.stdout.isTTY` covers most CI cases, some environments (like GitHub Actions with certain runners) might mimic a TTY while still being unsuitable for an interactive TUI.

4.  **Signal Handling (SIGTERM).**
    *   **Suggestion:** Explicitly mention handling `SIGTERM` (e.g., from `kill` or a parent process) to ensure `client.disconnect()` is called and the terminal is restored to a clean state.

5.  **Query Input Wrapping.**
    *   **Question:** Does the `QueryInput` bar scroll horizontally for long queries, or does it expand to multiple rows?
    *   **Suggestion:** For v0.1.0, horizontal scrolling is safer for layout stability. If it expands, it might push the `ResultStream` off-screen in short terminals.

## 3. Technical Observations

1.  **`ink-text-input` History.** This component is excellent but occasionally has issues with `Up`/`Down` event bubbling if not wrapped carefully. Ensure the `QueryInput.test.tsx` covers edge cases like "Up at the top of history" and "Down at the bottom".
2.  **Notification Batching.** For high-velocity streams (e.g., local LLMs running at 100+ tokens/sec), React/Ink's re-render cycle might struggle.
    *   **Strategy:** The spec mentions `Static` for scrollback (§2.1.4), which is the right move. If performance issues arise, consider a 16ms (60fps) debounce on the live token buffer updates.

## 4. Documentation & Metadata

1.  **`CLAUDE.md` / `GEMINI.md` updates.** Ensure the `test:coverage:tui` command is added to the "Commands" section of these files so agents know how to verify the TUI logic.
2.  **Manual Smoke Checklist.** Suggest adding a "Copy-Paste" test to `docs/manual-smoke-ws6.md`. Ensure that pasting a 5-paragraph prompt into the TUI doesn't break the single-line input or cause layout overflows.
