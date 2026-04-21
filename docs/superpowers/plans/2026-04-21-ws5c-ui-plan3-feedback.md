# Feedback on WS5-C UI — Plan 3: Connectors panel + Model panel

## Questions & Clarifications

1. **`ConnectorsPanel` Polling Strategy:**
   - The "Pre-flight" section and the Plan summary mention that `ConnectorsPanel` uses `useIpcQuery` with a 30s cadence for live health updates.
   - However, the implementation in **Task 13** only uses a one-time `refresh()` in a `useEffect` on mount.
   - **Question:** Should `ConnectorsPanel` be updated to use `useIpcQuery` for periodic health updates? Notifications like `connector.configChanged` only cover configuration, not health state transitions (e.g., a connector becoming rate-limited or erroring out during background sync).

2. **Stall Detection on Re-attachment:**
   - In **Task 21**, the `PullDialog` starts a 15s stall timer when a `llm.pullProgress` notification arrives or when a pull is explicitly started.
   - **Scenario:** If a pull is active (persisted `activePullId`) and the user reloads the app or re-opens the `PullDialog` while the pull is *already* stalled (i.e., no notifications are flowing), the "Connecting..." state might not appear until a notification arrives (which it won't if it's stalled).
   - **Suggestion:** In the `PullDialog` `useEffect` that runs on mount/open, if `activePullId` is present, consider starting an initial stall timer to detect "dead-on-arrival" re-attachments.

3. **`ModelPanel` Busy State vs. Notifications:**
   - In **Task 24**, `onLoad`/`onUnload` uses a `busyKey` that is cleared immediately after the RPC returns.
   - The button label (Load/Unload) depends on `loadedKeys`, which is updated via `llm.modelLoaded`/`llm.modelUnloaded` notifications.
   - **Question:** Is there a risk of the button "flickering" if the RPC returns before the notification is processed? Usually, the gateway RPCs for load/unload wait for the operation to complete, so the notification should arrive nearly simultaneously, but it's worth confirming the expected ordering.

## Suggestions for Improvement

1. **Shared Health Dot Component:**
   - Both `ConnectorTile` (from WS5-B) and `ConnectorsPanel` (Task 13) implement `dotClass` / health color logic.
   - **Suggestion:** Extract a shared `ConnectorHealthDot` component or a `getHealthColor` utility. This ensures visual consistency across the Dashboard and Settings and reduces code duplication.

2. **`useIpcQuery` in `ModelPanel`:**
   - Like the Connectors panel, the Model panel might benefit from periodic refreshes of the `routerStatus` and model list to reflect background changes (e.g., the gateway auto-unloading a model due to inactivity).

3. **Validation UI in `ConnectorsPanel`:**
   - In **Task 13**, the `validationError` is shown next to the row.
   - **Suggestion:** For better accessibility and UX, consider highlighting the input border in red when `validationError` is present.

## Minor Notes

- **Task 11 (Tests):** The tests for `ConnectorsPanel` mock `connectorListStatusMock` correctly. If polling is added via `useIpcQuery`, ensure the tests account for the hook's behavior.
- **Task 24 (`ModelPanel`):** The `activePercent` memoization is a nice touch for performance during high-frequency progress updates.
