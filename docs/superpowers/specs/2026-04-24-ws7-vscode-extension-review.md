# WS7 — VS Code Extension — Design Review (v0.1.0)

**Date:** 2026-04-24
**Subject:** Feedback on `docs/superpowers/specs/2026-04-24-ws7-vscode-extension-design.md`

## 1. Questions & Clarifications

1. **Session ID Persistence:** In §2.3 and §6.4, the spec says the extension doesn't store user content or transcripts. However, in §6.4, it mentions rehydrating on reload via `sessionId`. If VS Code is restarted or the window reloads, how does the extension know which `sessionId` to request from the Gateway if it isn't stored in `workspaceState`? Does the Gateway have a concept of an "active session" per client, or should the `sessionId` be persisted in `workspaceState` (which is just a metadata ID, not content)?
2. **Connector Health Polling:** §6.3 mentions a 30s poll for connector health. Since the Gateway already has a health state machine (WS3.5), could we add a `connector.onHealthChanged` notification to the IPC surface instead of polling? This would make the status bar reactive instead of lagging.
3. **Search Results UX:** §6.1 says items without a URL open in a "small read-only Webview". Creating another Webview type adds complexity. Could we instead render the item details as a temporary Markdown document in the editor (using a custom `nimbus-item:` URI scheme) or append it as a "context card" in the chat panel?
4. **Auto-Start Default:** `nimbus.autoStartGateway` is `false` by default. For a better "it just works" experience, should we consider making it `true` or showing a very prominent "Start Nimbus" button in the empty Chat Webview state?

## 2. Suggestions & Improvements

1. **Selection Context Enhancement:** For `nimbus.askAboutSelection`, consider including the file path and line numbers in the context block. This helps the LLM provide more precise answers (e.g., "In `src/auth.ts` on line 42...").
2. **Workflow Output:** §6.1 streams workflow progress to the Output Channel. Since we have a Chat Webview, would it be better to stream progress there as well (if open), or provide a "Show Progress" link in the success toast that focuses the Output Channel?
3. **HITL Interruption:** §6.5 routes background HITL (watchers/workflows) to a modal. Modals in VS Code are quite disruptive (they take focus). Suggest using a non-modal notification with "Approve" / "Reject" / "View Details" buttons first, only falling back to modal if the action is destructive or high-risk.
4. **Theme Consistency:** While CSS variables cover colors, consider if any custom icons are needed for the Webview (e.g., service icons for GitHub/Jira). Using `@vscode/codicons` (the library) in the Webview ensures icon consistency with the rest of the editor.

## 3. Technical Observations

1. **Node Transport:** The transition to `net.createConnection` for Unix sockets is a great move for Node/VS Code compatibility. Ensure the `discovery.ts` logic correctly handles permissions on the socket file when spawned by a different user/context.
2. **Cancellation Idempotency:** The spec mentions `engine.cancelStream` is idempotent. This is critical. Ensure that if a client disconnects and reconnects, it can still cancel an "orphaned" stream if it has the `streamId`.
3. **Memory/Performance:** `retainContextWhenHidden: true` is correct for UX, but we should monitor memory usage if the transcript grows very large. The 100-turn limit in `getSessionTranscript` is a good safeguard.

## 4. Suggested Additions to Design Doc

- Add a section on **"Empty State"** for the Webview (when no Gateway is connected or no chat has started).
- Define the **"Multi-action diff Webview"** mentioned in §6.5 — is this a separate panel or a temporary overlay? VS Code's built-in `vscode.diff` command might be usable for single-file diffs without a custom Webview.
