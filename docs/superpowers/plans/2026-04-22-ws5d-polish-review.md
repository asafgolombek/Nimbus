# Review: WS5-D Polish Implementation Plan

## 1. Overall Assessment
The plan is exceptionally detailed and follows the Research -> Strategy -> Execution lifecycle rigorously. It maintains high standards for testing and architectural consistency with the existing Nimbus codebase.

## 2. Strengths
- **Layered Testing:** Includes tests at the DB migration, helper, IPC, and UI levels.
- **Data Integrity:** Correctly implements the BLAKE3-chained audit log entries for workflow completions, bridging operational history with the secure audit trail.
- **Resource Management:** Proactively includes a pruning strategy for the `workflow_run` table to prevent unbounded database growth.
- **Security:** Updates the Tauri `ALLOWED_METHODS` allowlist and maintains the alphabetization requirement.

## 3. Suggestions for Improvement

### A. Audit Page Deep-Linking (Task 14)
- **Observation:** The plan introduces a link to `#/settings/audit?runId=...`.
- **Suggestion:** Verify if `AuditPanel.tsx` currently supports the `runId` query parameter for filtering/highlighting. If not, a small task should be added to the Audit page to handle this parameter, otherwise the link will only lead to the general audit log.

### B. UI JSON UX (Task 15)
- **Observation:** `RunWithParamsDialog.tsx` uses a raw `textarea` for JSON overrides.
- **Improvement:** While sufficient for v0.1.0, adding a "Format JSON" button or auto-formatting on blur using `JSON.stringify(JSON.parse(json), null, 2)` would significantly improve the user experience and help catch syntax errors early.

### C. Watcher History Display (Task 13)
- **Observation:** The history drawer renders `conditionSnapshot` as a truncated string.
- **Improvement:** Some snapshots (especially graph predicates) can be large. Suggest adding a "Copy to Clipboard" icon or a "Click to Expand" modal for the snapshot/result JSON strings to avoid layout breaking or data loss in the UI.

### D. Pruning Performance (Task 9)
- **Observation:** Pruning is triggered on *every* workflow completion.
- **Question:** For workflows that fire frequently (e.g., every minute via a watcher), is the overhead of a `DELETE ... NOT IN (SELECT ...)` subquery acceptable?
- **Recommendation:** For v0.1.0 it is likely fine given the 100-row limit, but for Phase 5+, consider debouncing the prune or triggering it only when the count exceeds a "soft limit" (e.g., 120).

## 4. Open Questions
1. **Multi-Agent Progress:** Does the `WorkflowRunHistoryDrawer` need to surface the `sub_task_results` from the multi-agent coordinator, or is the top-level status enough for this view?
2. **Audit Link Persistence:** If a `workflow_run` row is pruned after 100 runs, the "View audit entry" link in the *Audit Log* (which is never pruned) will still work, but the run history itself will be gone. This is correct behavior, but worth noting in the docs.
