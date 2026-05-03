# Manual Smoke Checklist — v0.1.0

Run this end-to-end on **every supported platform** before pushing the `vscode-v0.1.0` and `v0.1.0` release tags. Anything blocking is a release-stopper.

This consolidates the four per-workstream checklists (WS5-A, WS5-B, WS5-C, WS6) and adds the WS7 VS Code extension section.

## Test environment

| Platform | Terminal / Shell | Build target |
|---|---|---|
| Windows 11 | Windows Terminal (PowerShell 7) | Tauri release build + headless gateway |
| macOS 13+ Apple Silicon | Terminal.app, iTerm2 | Tauri release build + headless gateway |
| macOS 13+ Intel | Terminal.app, iTerm2 | Tauri release build + headless gateway |
| Ubuntu 24.04+ | gnome-terminal | `.deb` install + headless gateway |
| Fedora 40+ (sanity-only) | gnome-terminal | tarball install |

Each platform runs every section. Record observations inline. Mark blocked items 🚧 with a tracking-issue link; mark passed-with-caveat items ⚠ and describe inline.

## Preconditions

- A clean OS user account (no prior `nimbus.toml`, no prior data dir) — at least one platform should run the **fresh install** path.
- Nimbus Gateway built and installed (`bun run build:release` or platform installer).
- Tauri desktop UI built (`cd packages/ui && bunx tauri build`) or running in dev (`bunx tauri dev`).
- VS Code 1.90+ available on at least one platform; Cursor available on one platform for Open VSX coverage.
- At least two connectors authenticated (e.g. filesystem + GitHub). One should be in a deliberately broken state to exercise degraded-health UI.
- A valid Nimbus backup `.tar.gz` from a previous export available for the import test.

---

## 1. App shell + onboarding (WS5-A)

### 1.1 First-run onboarding (fresh install)

- [ ] App opens to `/onboarding/welcome` when no `onboarding_completed` meta exists.
- [ ] Welcome page renders heading + Continue / Skip.
- [ ] **Skip** → navigates to `/`; relaunch does **not** show onboarding again.
- [ ] **Continue** → navigates to `/onboarding/connect` showing 6 connector cards (Google Drive, GitHub, Slack, Linear, Notion, Gmail).
- [ ] Clicking a card toggles selection highlight + checkmark.
- [ ] **Authenticate** is disabled with no selection; with ≥ 1 selected it shows "Authenticating…" per card.
- [ ] A connector that completes OAuth flips to "Connected"; once any connector connects, app navigates to `/onboarding/syncing`.
- [ ] Syncing page shows live item-count incrementing every ~5 s.
- [ ] **Open Dashboard** navigates to `/`.

### 1.2 Returning-user routing

- [ ] Relaunch with existing data → routes directly to `/`.
- [ ] Relaunch after Skip (meta set, zero items) → routes to `/`.

### 1.3 System tray

- [ ] Tray icon appears on launch.
- [ ] Right-click tray menu shows "Open Nimbus" + "Quit".
- [ ] "Open Nimbus" focuses the main window.
- [ ] "Quit" exits the app and the tray icon disappears.
- [ ] Icon style matches OS conventions (monochrome template on macOS).

### 1.4 Quick Query (global hotkey)

- [ ] `Ctrl+Shift+N` (Windows/Linux) or `Cmd+Shift+N` (macOS) opens the popup.
- [ ] Popup is frameless, ≈ 560×220, floats above other windows.
- [ ] Input auto-focused on open.
- [ ] Typing a prompt + Enter streams tokens into the response area.
- [ ] Model label appears bottom-right after stream completes.
- [ ] Popup auto-closes ≈ 2 s after stream finishes.
- [ ] `Esc` closes the popup immediately; clicking outside closes after 150 ms debounce.
- [ ] Pressing the hotkey while the popup is open **focuses** the existing popup (no second instance).

### 1.5 Gateway-offline + hotkey-conflict banners

- [ ] `nimbus stop` → "Gateway is offline" banner appears in the main window within 2 s.
- [ ] **Start Gateway** spawns `nimbus start`; banner clears on reconnect.
- [ ] When the global hotkey can't be registered (manual: bind `Ctrl+Shift+N` in another app first), the toolbar shows the conflict banner; **Dismiss** hides it for the session.

### 1.6 IPC method allowlist

- [ ] DevTools console: `window.__nimbus.call("admin.reset")` (or any unlisted method) → `MethodNotAllowedError`; no Rust panic.

### 1.7 macOS window chrome

- [ ] Main window uses transparent title bar with hidden title text.
- [ ] App does **not** appear in the Dock (accessory mode active).
- [ ] App appears in Cmd+Tab only when a window is visible.

---

## 2. Dashboard, tray health, HITL popup (WS5-B)

### 2.1 Dashboard

- [ ] Main window opens to Dashboard within 2 s.
- [ ] Metric strip shows non-zero values (items, embeddings, p95, size).
- [ ] Connector tiles render with health dot + last-sync time.
- [ ] Hovering a degraded tile shows `degradationReason` in a tooltip.
- [ ] Audit feed lists recent entries newest-first.
- [ ] Switching away for 1 minute → no network activity (verify in DevTools Network tab); return → immediate refetch.
- [ ] `nimbus stop` → offline banner; Dashboard keeps last-known values with a "stale" chip.

### 2.2 Aggregate-health tray

- [ ] Force a connector to `degraded` (revoke a credential) → tray icon turns amber within 30 s.
- [ ] Force a connector to `unauthenticated` → tray icon turns red.
- [ ] Tray menu shows a "Connectors ▸" submenu populated from `set_connectors_menu`.
- [ ] Clicking a connector in the submenu opens Dashboard and flashes the matching tile for 1.5 s.

### 2.3 HITL popup

- [ ] `nimbus ask "create a file called test.md"` (or any consent-gated action) → popup opens within 1 s.
- [ ] Popup window is frameless, 480×360, always-on-top, **not** in the taskbar.
- [ ] Popup shows prompt + structured preview + Approve / Reject.
- [ ] Approve → Gateway proceeds; audit row appears in Dashboard feed within 10 s; popup closes.
- [ ] Trigger two consent requests rapidly → popup shows "+1 more pending"; after the first approve, the second becomes head.
- [ ] Reject → action aborts; audit row shows `rejected`.
- [ ] Close popup (X) without responding → tray badge shows `1`; clicking tray "Pending actions" re-opens popup with the same request.
- [ ] Trigger a `file.delete` consent request → Approve does **not** receive initial focus (deny-list).

---

## 3. Settings panels (WS5-C / WS5-D)

### 3.1 Profiles panel

- [ ] Lists all profiles; active profile is highlighted.
- [ ] Create a new profile → appears in list immediately.
- [ ] Switch to new profile → UI reflects the switch; sidebar shows new active profile.
- [ ] Typed-name confirmation required before deleting.
- [ ] Delete profile → removed from list; active profile unchanged if different.

### 3.2 Telemetry panel

- [ ] Shows current status (enabled / disabled).
- [ ] Toggle off → status reflects change; no further data is sent.
- [ ] Toggle back on → counter cards and payload sample appear.
- [ ] Expanding the payload sample shows redacted-safe keys only.

### 3.3 Connectors panel

- [ ] Loads and lists all configured connectors.
- [ ] Edit sync interval → values below 60 s rejected inline; valid values save.
- [ ] Toggle depth selector → change saves; reflected after re-open.
- [ ] Toggle enable/disable → connector pauses or resumes syncing.
- [ ] `connector.configChanged` notification updates the row without page reload.
- [ ] Dashboard "Go to Connectors" deep-link highlights the matching tile.

### 3.4 Model panel

- [ ] Shows router decisions for each task type.
- [ ] Per-task default picker updates the router decision.
- [ ] Installed models list renders with correct provider badges.
- [ ] Pull dialog opens; provider radio is filtered by `llm.getStatus`.
- [ ] Cancel pull aborts cleanly; no stale progress bar remains.
- [ ] Re-opening Model panel during an in-flight pull re-attaches to the progress bar.

### 3.5 Audit panel

- [ ] Loads summary (counts by outcome and by service).
- [ ] **Verify chain** runs and reports success on an unmodified audit log.
- [ ] **Export CSV** opens a save dialog; resulting file has the 6-column header.
- [ ] **Export JSON** produces valid JSON with `rowHash` and `prevHash` fields.

### 3.6 Updates panel

- [ ] Shows current version and last-check time.
- [ ] **Check now** runs; either shows "Up to date" or an update-available banner.
- [ ] Rollback button is visible only after a rolled-back or failed update.
- [ ] During a download, progress bar animates; **Cancel** stops it.
- [ ] After applying an update, the restart overlay appears and the app relaunches.

### 3.7 Data panel — Export

- [ ] Renders three cards: Back up, Restore, Delete.
- [ ] While Gateway is offline, all three buttons are disabled with a stale chip.
- [ ] "Last export" shows "Never" on a fresh install, or a formatted timestamp after export.
- [ ] Index size and item count populate from preflight.
- [ ] **Export backup…** opens the ExportWizard.
- [ ] Passphrase gate: short / weak passwords keep **Next** disabled; "reasonably-strong-example-phrase!" enables it.
- [ ] Mismatched confirm keeps **Next** disabled.
- [ ] Save dialog defaults to `nimbus-backup-YYYY-MM-DD.tar.gz`.
- [ ] Choosing an existing file shows the overwrite sub-step; **Cancel** returns to destination; **Overwrite** proceeds; export progress bar animates.
- [ ] On first export: seed step shows mnemonic + warning; **Done** is gated on the checkbox.
- [ ] **Copy** copies the seed to clipboard; a 30 s countdown appears; seed is cleared from clipboard after 30 s.
- [ ] Closing the wizard mid-countdown clears the clipboard immediately.
- [ ] On re-export: seed step shows reminder card only, no mnemonic, **Done** enabled immediately.
- [ ] After export completes, "Last export" timestamp updates on the card.

### 3.8 Data panel — Import

- [ ] **Restore backup…** opens the ImportWizard.
- [ ] **Choose file** opens an open-file dialog filtered to `.tar.gz`.
- [ ] Passphrase auth: valid passphrase enables **Next**.
- [ ] Recovery-seed auth: filling all 12 words enables **Next**.
- [ ] Typed confirmation "replace my data" gates the **Replace my data** button.
- [ ] Wrong confirmation text keeps the button disabled.
- [ ] Successful import shows "Restore complete" and a reload countdown; after 3 s the window reloads automatically.
- [ ] If `oauthEntriesFlagged > 0`, the count is shown with re-auth instructions.
- [ ] `-32002` (decryption failed) shows passphrase-specific error + **Retry**.
- [ ] `-32002` with recovery seed shows seed-specific error copy.
- [ ] `-32010` archive_newer shows "newer Nimbus" copy + **Go to Updates** deep link.
- [ ] `-32010` archive_older_unsupported shows "older, unsupported" copy; no **Go to Updates**.

### 3.9 Data panel — Delete service data

- [ ] **Delete service…** opens the DeleteServiceDialog.
- [ ] Service dropdown lists all configured connectors.
- [ ] Selecting a service fetches preflight counts (items, embeddings, vault keys).
- [ ] Typed service-name confirmation gates **Delete** (case-sensitive).
- [ ] Wrong name keeps **Delete** disabled.
- [ ] **Delete** sends `data.delete` with `dryRun: false`.
- [ ] Success step shows the deleted item count and **Close**.
- [ ] After closing, the preflight data on the Export card refreshes.

### 3.10 Concurrency guard

- [ ] While Export is running, Import and Delete buttons are disabled.
- [ ] While Import is running, Export and Delete buttons are disabled.
- [ ] Dropping the Gateway connection while a flow is running triggers `markDisconnected`.

---

## 4. Rich TUI (WS6)

Each subsection below runs once on Windows + once on each macOS arch + once on each Linux distro listed in the test environment.

### 4.1 Launch

`nimbus start` then `nimbus tui`.

- [ ] Ink renders the 5-pane layout at default terminal size.
- [ ] No stack traces on stdout/stderr.
- [ ] `paths.logDir/cli-<date>.log` records `cli.invoke` with `argv=["nimbus","tui"]`. The log file contains **no raw ANSI escape sequences** (those go to the terminal only).

### 4.2 Streaming

Submit `summarize my week from the last 100 commits` (or any prompt that triggers ≥ 20 s generation).

- [ ] Tokens render continuously in `ResultStream` without flicker.
- [ ] Prior lines (e.g. the `nimbus> …` entry for this query) **do not re-render** mid-stream — cursor position of prior text stays stable.
- [ ] `engine.streamDone` flushes the live buffer into the static block; the next `nimbus>` prompt is immediately usable.

### 4.3 Inline HITL

Submit a query that triggers consent — e.g. `send a summary of my week to slack #general`.

- [ ] `──[ consent required ]──` banner appears mid-stream.
- [ ] Prompt changes to `nimbus[hitl]>` with the `[a]pprove [r]eject [d]etails [q]uit` hint.
- [ ] Pressing `a` advances; for a multi-action batch, `(2 of N)` counter updates.
- [ ] Outcome line (`✓ approved all` / `✗ rejected all` / `✓ approved N, ✗ rejected M`) prints and flushes into `<Static>`.
- [ ] `consent.respond` is called **once** per batch with the full decisions array.

### 4.4 Unsuitable-terminal fallback

Each variant prints the fallback notice and enters the REPL; terminal is left sane on REPL exit.

- [ ] `TERM=dumb nimbus tui`
- [ ] `NO_COLOR=1 nimbus tui`
- [ ] `nimbus tui < /dev/null` (non-TTY stdin)
- [ ] `CI=true nimbus tui`
- [ ] `stty rows 10 && nimbus tui` (then `stty rows 40` to restore)

### 4.5 Gateway death

Launch `nimbus tui` in one terminal; `nimbus stop` in another.

- [ ] Disconnect banner appears within ≤ 30 s (sub-second during active stream).
- [ ] Input dimmed + disabled; Ctrl+C still exits.
- [ ] `(stale)` marker on poll-data panes.
- [ ] After `nimbus start`: `✓ Reconnected` fade; input re-enables.

### 4.6 Layout adaptation

- [ ] Resize below 100 columns → layout collapses to single-column with status bar at the bottom; resize back → 5-pane split restored.
- [ ] Resize below 20 rows → one-line notice; Ink unmounts; exit code 0; terminal cursor + colors restored.

### 4.7 Cancel semantics

Submit a long query; when tokens start arriving:

- [ ] Single Ctrl+C → state flips to idle; `(canceled by user — LLM may continue in the background)` appended; `^C Press again within 2s to exit` hint visible ~ 1.5 s.
- [ ] Second Ctrl+C within 2 s → exits cleanly.
- [ ] Relaunch; idle Ctrl+C → hint visible; second Ctrl+C → exit.

### 4.8 Signal handling (Linux + macOS only)

Look up the PID, then in another terminal:

- [ ] `kill -INT <pid>` → terminal restored, exit code 130.
- [ ] Relaunch; `kill -TERM <pid>` → terminal restored, exit code 143.
- [ ] `paths.logDir/cli-<date>.log` flushed in both cases.

(Windows: SIGINT equivalent only via Ctrl+C — covered in §4.7.)

### 4.9 Paste safety

Paste a 5-paragraph prompt (~2 KB with newlines) into `QueryInput`.

- [ ] Input does not expand vertically; single-line with horizontal scroll remains visible.
- [ ] Right-column panes do not shift or misalign.
- [ ] Pressing Enter submits the full content; the `ResultStream` query-echo line shows the full text.

### 4.10 Low-color-terminal readability

`TERM=xterm nimbus tui` (forces 16-color).

- [ ] ●/◐/○ glyphs remain visible and distinguishable.
- [ ] Yellow banners (disconnect, HITL, cancel hint) render readably.
- [ ] `dimColor` text is still distinguishable from normal text.
- [ ] If readability is degraded, file a follow-up — do **not** block release.

---

## 5. VS Code extension (WS7)

Run on at least one Windows + one macOS + one Linux platform with VS Code 1.90+. Cursor coverage on one platform via the Open VSX install path.

### 5.1 Install (Marketplace)

- [ ] Open VS Code → Extensions → search `Nimbus`.
- [ ] The `nimbus-agent.nimbus` extension appears with the correct icon and publisher.
- [ ] Install completes without manual config; VS Code prompts a reload only if needed.
- [ ] Extension appears under Installed with the published version.

### 5.2 Install (Open VSX, Cursor)

- [ ] Open Cursor → Extensions → search `Nimbus`.
- [ ] The `nimbus-agent.nimbus` extension is found via Open VSX.
- [ ] Install completes; the chat side-panel command palette entries appear.

### 5.3 Activation + status bar

- [ ] On VS Code launch, the Nimbus output channel registers (View → Output → Nimbus) without spawning a webview yet.
- [ ] Status-bar item shows the connection state (`connecting…` → `connected` → `disconnected` on gateway stop).
- [ ] When the gateway is unreachable and `nimbus.autoStartGateway` is `true`, the extension spawns `nimbus start` and reconnects; status bar reflects the transition.

### 5.4 `Nimbus: Ask` end-to-end

- [ ] Command palette → **Nimbus: Ask** → input box appears.
- [ ] Submit `"Summarize the README"` → chat panel opens beside the editor.
- [ ] Tokens stream into the assistant turn in the panel; markdown renders progressively.
- [ ] After `done`, the streaming class is dropped; further follow-ups in the same panel use the same session.
- [ ] **Stop** button is enabled during streaming and disabled at idle; pressing it terminates the iterator.

### 5.5 `Nimbus: Ask About Selection` + `Nimbus: Search Selection`

- [ ] With no selection, the command shows an error and exits.
- [ ] Select a function in an open file → **Ask About Selection** prompts for a prefix; the selected text is appended and the question is asked.
- [ ] **Search Selection** delegates to **Nimbus: Search** (Quick Pick).

### 5.6 `Nimbus: Search`

- [ ] **Nimbus: Search** prompts for a query → executes `index.queryItems` against the running gateway.
- [ ] Quick Pick lists results with title / service / url; selecting a result is harmless (or opens the URL — current implementation no-ops).

### 5.7 `Nimbus: New Conversation`

- [ ] Resets the chat panel to the empty state.
- [ ] After **Ask**, the next message starts a fresh sessionId.

### 5.8 Inline HITL

Trigger a consent-gated action from the chat panel (e.g. ask the agent to delete a file).

- [ ] When the chat panel is **focused**, the HITL request renders as a card inline (with prompt + Approve + Reject).
- [ ] Approve → action proceeds; the card collapses to "Decision recorded: approved".
- [ ] Reject → action aborts; the card collapses to "Decision recorded: rejected".
- [ ] When the chat panel is **not focused** (or not visible), the HITL request falls back to a VS Code information-message toast with Approve / Reject buttons.
- [ ] Closing the chat panel mid-flight resolves any in-flight inline-HITL promise to `undefined` (the gateway-side request is left for the next surface to pick up; no extension hang).

### 5.9 Settings reactivity

- [ ] Change `nimbus.socketPath`, `nimbus.autoStartGateway`, or `nimbus.statusBarPollMs` in Settings → status bar repaints without restarting the extension host.
- [ ] Change `nimbus.askAgent` → next **Ask** invocation includes the new `agent` value in the streamed request.

### 5.10 Output channel + Open Logs

- [ ] **Nimbus: Open Logs** (or status-bar tooltip click in `permission-denied` state) reveals the Nimbus output channel.
- [ ] Levels respect `nimbus.logLevel`.

---

## Results matrix

Fill this in as each platform completes. Legend: ✅ passed · 🚧 blocked (link issue) · ⚠ passed with caveat (describe inline).

| Platform | 1. App shell | 2. Dashboard + HITL | 3. Settings | 4. TUI | 5. VS Code |
|---|---|---|---|---|---|
| Windows 11 | | | | | |
| macOS Apple Silicon | | | | | |
| macOS Intel | | | | | |
| Ubuntu 24.04 | | | | | |
| Fedora 40 | | | | | |

A platform is **release-ready** when every section in its row is ✅ or ⚠ (with the caveat documented). Any 🚧 is a release blocker — link the issue, do not flip.

## Release gate

When every row is ✅/⚠ across the matrix:

1. Push `vscode-v0.1.0` (publishes the VS Code extension to Marketplace + Open VSX + GitHub Release).
2. Push `v0.1.0` (publishes the Gateway + CLI binaries to GitHub Release).

If a regression is found after a tag push, do **not** delete the tag — issue a `v0.1.1` (or `vscode-v0.1.1`) with the fix and a release note describing the rollback path.
