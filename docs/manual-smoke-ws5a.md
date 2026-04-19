# WS5-A Manual Smoke Checklist

Run this after a successful `cargo tauri dev` or installed build.

## Prerequisites

- Gateway running: `nimbus start`
- Desktop app launched (Nimbus.app / Nimbus.exe)

---

## 1. First-run onboarding (fresh install)

- [ ] App opens to `/onboarding/welcome` (no prior `onboarding_completed` meta)
- [ ] Welcome page renders heading and Continue / Skip buttons
- [ ] **Skip** → navigates to `/` (dashboard stub), does NOT show onboarding again on relaunch
- [ ] **Continue** → navigates to `/onboarding/connect`
- [ ] Connect page shows 6 connector cards (Google Drive, GitHub, Slack, Linear, Notion, Gmail)
- [ ] Clicking a card toggles selection highlight and checkmark
- [ ] **Authenticate** button is disabled when no card is selected
- [ ] Clicking **Authenticate** with ≥1 selected shows "Authenticating…" label on each card
- [ ] A connector that completes OAuth shows "Connected" label
- [ ] After any connector connects, app navigates to `/onboarding/syncing`
- [ ] Syncing page shows live item count incrementing every 5 s
- [ ] **Open Dashboard** on syncing page navigates to `/`

## 2. Returning-user routing

- [ ] Relaunch with existing data → app routes directly to `/` (no onboarding)
- [ ] Relaunch after Skip (meta set, zero items) → app routes to `/` (meta present = returning user)

## 3. System tray

- [ ] Tray icon appears in menu bar / system tray on launch
- [ ] Right-click tray → menu shows "Open Nimbus" and "Quit"
- [ ] "Open Nimbus" focuses the main window
- [ ] "Quit" exits the app and the tray icon disappears
- [ ] Tray icon style matches OS (monochrome template on macOS)

## 4. Global hotkey — Quick Query

- [ ] `Ctrl+Shift+N` (Windows/Linux) or `Cmd+Shift+N` (macOS) opens the Quick Query popup
- [ ] Popup is frameless, ~560×220, floats above other windows
- [ ] Input auto-focused on open
- [ ] Typing a prompt and pressing Enter streams tokens into the response area
- [ ] Model label appears bottom-right after stream completes
- [ ] Popup closes automatically ~2 s after stream finishes
- [ ] `Esc` closes the popup immediately
- [ ] Clicking outside the popup closes it (focus-loss handler fires after 150 ms debounce)
- [ ] Pressing hotkey again while popup is open focuses the existing popup (does not open a second one)

## 5. Gateway offline banner

- [ ] Disconnect gateway (`nimbus stop` or kill process)
- [ ] Banner "Gateway is offline" appears in the main window
- [ ] Clicking **Start Gateway** in the banner spawns `nimbus start` and banner disappears on reconnect

## 6. Hotkey conflict banner

- [ ] Simulate hotkey registration failure (or check system with conflicting shortcut)
- [ ] Banner "Global hotkey could not be registered" appears in the toolbar area
- [ ] Dismiss button hides the banner for the session

## 7. IPC method allowlist

- [ ] Attempt to call a non-allowlisted method (e.g., via DevTools console `window.__nimbus.call("admin.reset")`)
- [ ] Response is a `MethodNotAllowedError` — no crash, no panic on the Rust side

## 8. Window chrome (macOS)

- [ ] Main window uses transparent title bar with hidden title text
- [ ] App does NOT appear in the Dock (accessory mode active)
- [ ] App appears in Cmd+Tab only when a window is visible

## 9. UI component smoke

- [ ] Dashboard stub renders at `/`
- [ ] Settings stub renders at `/settings`
- [ ] Marketplace stub renders at `/marketplace`
- [ ] Watchers stub renders at `/watchers`
- [ ] Workflows stub renders at `/workflows`
- [ ] HITL stub renders at `/hitl`

---

## Known limitations (WS5-A scope)

- Dashboard, Settings, Marketplace, Watchers, Workflows, and HITL pages are stubs — no real content yet
- LAN sync, updater UI, and VS Code extension are out of scope for this sub-project
