# WS7 — VS Code Extension — Implementation Plan Review (v0.1.0)

**Date:** 2026-04-24
**Subject:** Feedback on `docs/superpowers/plans/2026-04-24-ws7-vscode-extension.md`

## 1. Questions & Clarifications

1. **Session Store Persistence:** The file map includes `src/chat/session-store.ts`. Does this use `context.workspaceState` to persist the active `sessionId`? This is critical for rehydration after a window reload (resolving Question 1.1 from the Design Review).
2. **Connector Health - Notification vs Polling:** The plan currently sticks to Task 19's 30s polling for the status bar. If we add `connector.onHealthChanged` to the Gateway IPC in Task 10, we could make the status bar reactive. Should this be added to the Gateway tasks?
3. **HITL Notification Priority:** Task 21 (HITL) should explicitly define the "Toast vs Modal" logic. Suggestion: Default to a non-modal notification (`showInformationMessage` without `modal: true`) for background tasks, and only use modal if the Gateway signals a high-risk action.
4. **Webview Bundle Size:** Task 23/24 bundles `marked`. Ensure `esbuild` is configured to tree-shake or minify strictly, as Webview load time impacts the perceived "snappiness" of the extension.

## 2. Suggestions & Improvements

1. **Task 25 (Selection Context):** When implementing `nimbus.askAboutSelection`, ensure the prompt includes the relative file path and line range.
   - *Example Context:* `File: src/auth.ts (Lines 10-25)`
2. **Task 17 (Connection Manager):** Add a "Manual Reconnect" button to the error toast if connection fails, allowing users to retry without waiting for the next poll/reconnect cycle.
3. **Task 19 (Status Bar Tooltip):** The tooltip should list the specific degraded connectors so the user doesn't have to open the chat panel just to see what's broken.
4. **Task 27 (Integration Tests):** Since `@vscode/test-electron` can be slow, suggest adding a "smoke" integration test that only checks activation and status bar presence, while leaving deep behavior to the shimmed unit tests.

## 3. Technical Observations

1. **Task 8/9 (Cancellation):** Ensure that `engine.cancelStream` also cleans up any pending HITL requests associated with that streamId on the Gateway side.
2. **Task 10 (Transcript Reconstruction):** If `details_json` is missing or redacted in `audit_log`, ensure the IPC result explicitly marks the turn as `[redacted]` rather than omitting it, to maintain a consistent turn-count in the UI.
3. **Node 18 Compatibility:** Since the extension targets `node18` (Task 3.4 of Design), verify that any `node:*` imports used in `@nimbus-dev/client` (Task 1/2) are available in Node 18 (e.g., `node:fs/promises` is fine, but check for newer `node:util` or `node:crypto` helpers).

## 4. Suggested Plan Adjustments

- **Task 10.5:** Add a step to register for `connector.onHealthChanged` notifications if we decide to go reactive.
- **Task 23.3:** Explicitly include "Empty State" UI implementation (e.g., "Ask Nimbus something to get started" or "Connect Gateway").
- **Task 25.4:** Implement the `nimbus-item:` URI handler to render search results as read-only Markdown documents.
