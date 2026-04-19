# WS5-B Manual Smoke Checklist

Run on Windows, macOS, and Linux before merging WS5-B to main.

## Preconditions

- Nimbus Gateway running (`nimbus start`).
- At least two connectors configured (e.g., filesystem + any cloud).
- Tauri UI in dev mode: `cd packages/ui && bunx tauri dev`.

## Dashboard

- [ ] Main window opens to Dashboard within 2 s.
- [ ] Metric strip shows non-zero values (items, embeddings, p95, size).
- [ ] Connector tiles render with a health dot and last-sync time.
- [ ] Hovering a degraded tile shows `degradationReason` in a tooltip.
- [ ] Audit feed lists recent entries, newest-first.
- [ ] Tab-switch away for 1 minute → no network activity; tab return → immediate refetch.
- [ ] Stop the Gateway → offline banner; Dashboard keeps last-known values with a "stale" chip.

## Tray

- [ ] Force a connector into `degraded` (misconfigure credentials) → tray icon turns amber within 30 s.
- [ ] Force a connector into `unauthenticated` → tray icon turns red.
- [ ] Tray menu shows a "Connectors ▸" submenu.
- [ ] Clicking a connector in the submenu opens Dashboard and flashes the matching tile for 1.5 s.

## HITL popup

- [ ] Trigger a consent-gated action via `nimbus ask` (e.g., "create a file called test.md"). Popup opens within 1 s.
- [ ] Popup window is frameless, 480×360, always-on-top, not in taskbar.
- [ ] Popup shows prompt + structured preview + Approve / Reject.
- [ ] Approve → Gateway proceeds; audit row appears in Dashboard feed within 10 s; popup closes.
- [ ] Trigger two consent requests rapidly. Popup shows "+1 more pending"; after first approve, second becomes head.
- [ ] Reject → action aborts; audit row shows `rejected`.
- [ ] Close popup (X) without responding → tray badge shows `1`; clicking tray "Pending actions" re-opens popup with the same request.
- [ ] Trigger a `file.delete` consent request → Approve does not receive initial focus.

## Regression checks (carried from WS5-A)

- [ ] Quick Query still opens with `Ctrl/Cmd+Shift+N` and streams.
- [ ] Onboarding wizard still completes first-run.
- [ ] macOS: app has no Dock icon; lives only in menu bar.
- [ ] Gateway offline banner still appears within 2 s of kill.
