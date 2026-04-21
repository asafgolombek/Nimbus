# Feedback on WS5-C UI — Plan 4: Audit panel + Updates panel

## Questions & Clarifications

1. **`AuditEntry` Type Mismatch:**
   - There is a significant discrepancy between the `AuditEntry` interface defined in `packages/ui/src/ipc/types.ts` (used by the Dashboard's `AuditFeed`) and the actual shape returned by the Gateway's `audit.list`.
   - **Gateway returns:** `{ id, actionType, hitlStatus, actionJson, timestamp }`.
   - **UI `AuditEntry` expects:** `{ id, ts, action, outcome, subject, hitlRejectReason }`.
   - While `AuditPanel.tsx` (Task 10) correctly defines a local interface and maps the rows, the global `AuditEntry` type remains incorrect, and the Dashboard's `AuditFeed` component is likely broken (reading `undefined` for `ts`, `action`, and `outcome`).
   - **Suggestion:** Use this plan to update the global `AuditEntry` type in `packages/ui/src/ipc/types.ts` to match the Gateway and update `AuditFeed.tsx` to handle the mapping/display logic.

2. **Audit Outcome Consistency:**
   - The database and Gateway use `'not_required'` for automated actions.
   - The global `AuditEntry` in `packages/ui/src/ipc/types.ts` currently uses `'auto'`.
   - Plan 4 uses `'not_required'` (e.g., in `AuditOutcomeFilter`).
   - **Suggestion:** Align all UI code and types to use `'not_required'` to match the source of truth.

3. **Restart Overlay Scope & Persistence:**
   - In **Task 18**, `RestartOverlay` and the `useEffect` monitoring the `reconnecting` state (including the 2-minute timeout and the `updater://restart-complete` subscription) are located inside the `UpdatesPanel` component.
   - **Issue:** If the user navigates away from the Updates panel while an update is being applied (e.g., clicking a sidebar link), the overlay will unmount, and the monitoring logic will stop. This means the automatic success check (`diag.getVersion`) and the timeout won't fire unless the user stays on the page.
   - **Suggestion:** Consider moving the `RestartOverlay` and its associated state machine listeners to a more persistent location (e.g., `App.tsx` or a top-level Layout component) if the overlay is intended to be truly "full-window" and block interaction until the gateway is back.

4. **Tauri FS Permissions:**
   - The plan uses `fs:allow-write-text-file` in `capabilities/default.json`.
   - **Clarification:** Verify if the permission should be prefixed with the plugin name or if it's the exact identifier for `writeTextFile` in Tauri v2 `plugin-fs`. (Usually it is `fs:allow-write-text-file` if the plugin is initialized as `fs`).

## Suggestions for Improvement

1. **Virtual List Row Height:**
   - `ROW_HEIGHT` is set to 32px. Ensure this provides enough vertical space for the text and potential font-size variations without clipping.

2. **CSV Export Header:**
   - The `rowsToCsv` helper (Task 8) is great. Ensure that the column order matches the expectations of common spreadsheet tools (e.g., ISO dates usually work well, but some tools prefer specific formats). The current ISO string implementation is safe.

3. **Rollback UI:**
   - The Rollback button is surfaced if the state is `rolled_back` or `failed`.
   - **Suggestion:** Add a small "info" icon or tooltip next to the Rollback button explaining that it reverts to the previous version and why it might be needed.

## Minor Notes

- **Task 10 (`AuditPanel`):** The `untilMs + 86_399_000` logic for inclusive end-of-day is a good catch.
- **Task 15 (`updater.rs`):** The use of `AtomicBool` and `Ordering::SeqCst` is correct for the process-global tracker.
- **Task 18 (`UpdatesPanel`):** The `useCallback` for `onRestartComplete` uses `useNimbusStore.getState().updaterRestarting` to avoid stale closures, which is excellent practice.
