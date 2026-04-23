# WS6 Manual Smoke — Rich TUI

**Executed on all three platforms before flipping WS6 to ✅ in `CLAUDE.md`.**

Record actual observations inline in each section. If a platform blocks on an item, link to the tracking issue and mark the row 🚧.

---

## Test environment

| Platform | Terminal | Notes |
|---|---|---|
| Windows 11 | Windows Terminal | |
| macOS (Intel + ARM) | Terminal.app, iTerm2 | |
| Linux (Ubuntu 22.04 + Fedora 40) | gnome-terminal, alacritty | |

Each platform runs through every section below.

---

## 1. Launch

Start a fresh gateway: `nimbus start`

Then: `nimbus tui`

- [ ] Ink renders the 5-pane layout at default terminal size.
- [ ] No stack traces on stdout/stderr.
- [ ] `paths.logDir/cli-<date>.log` records `cli.invoke` with `argv=["nimbus","tui"]`. The log file contains **no raw ANSI escape sequences or render fragments** (they must go only to the terminal, never to the file).

## 2. Streaming

Submit: `summarize my week from the last 100 commits` (or any prompt that triggers ≥ 20s generation).

- [ ] Tokens render continuously in `ResultStream` without flicker.
- [ ] Prior lines (e.g., the `nimbus> …` entry for this query) **do not re-render** mid-stream (observable: cursor position of prior text stays stable).
- [ ] `engine.streamDone` flushes the live buffer into the static block; the next `nimbus>` prompt is immediately usable.

## 3. Inline HITL

Submit a query that triggers consent — e.g., `send a summary of my week to slack #general` (configure a workflow that requires consent if one is not already present).

- [ ] `──[ consent required ]──` banner appears mid-stream.
- [ ] Prompt changes to `nimbus[hitl]>` with the `[a]pprove [r]eject [d]etails [q]uit` hint.
- [ ] Pressing `a` advances; for a multi-action batch, `(2 of N)` counter updates.
- [ ] Outcome line (`✓ approved all` / `✗ rejected all` / `✓ approved N, ✗ rejected M`) prints and flushes into `<Static>`.
- [ ] `consent.respond` is called **once** per batch with the full decisions array.

## 4. Unsuitable-terminal fallback

Each variant prints the fallback notice and enters the REPL; terminal is left sane on REPL exit.

- [ ] `TERM=dumb nimbus tui`
- [ ] `NO_COLOR=1 nimbus tui`
- [ ] `nimbus tui < /dev/null` (non-TTY stdin)
- [ ] `CI=true nimbus tui`
- [ ] `stty rows 10 && nimbus tui` (then `stty rows 40` to restore)

## 5. Gateway death

Launch `nimbus tui` in one terminal; `nimbus stop` in another.

- [ ] Disconnect banner appears within ≤ 30 s (sub-second during active stream).
- [ ] Input dimmed + disabled; Ctrl+C still exits.
- [ ] `(stale)` marker on poll-data panes.
- [ ] `nimbus start`, observe reconnect: `✓ Reconnected` fade; input re-enables.

## 6. Narrow-terminal collapse

Resize the terminal below 100 columns (e.g., `stty columns 80`) while TUI is running.

- [ ] Layout collapses to single-column with status bar at the bottom.
- [ ] Resize to 120: layout restores to the 5-pane split.

## 7. Short-terminal runtime drop

Resize the terminal to fewer than 20 rows while TUI is running.

- [ ] One-line notice prints; Ink unmounts; exit code 0.
- [ ] Terminal cursor/colors restored; prompt returns.

## 8. Cancel semantics

Submit a long query. When tokens start arriving:

- [ ] Single Ctrl+C → state flips to idle; `(canceled by user — LLM may continue in the background)` line appended; `^C Press again within 2s to exit` hint visible for ~1.5 s.
- [ ] Second Ctrl+C within 2 s → exits cleanly.
- [ ] Relaunch; idle Ctrl+C → hint visible; second Ctrl+C → exit.

## 9. Signal handling (Linux + macOS only)

In one terminal: `nimbus tui`. In another: look up PID then:

- [ ] `kill -INT <pid>` → terminal restored, exit code 130.
- [ ] Relaunch; `kill -TERM <pid>` → terminal restored, exit code 143.
- [ ] `paths.logDir/cli-<date>.log` flushed in both cases.

(Windows: SIGINT equivalent only via Ctrl+C — covered in §8.)

## 10. Paste safety

Paste a 5-paragraph prompt (~2 KB of text with newlines) into `QueryInput`.

- [ ] Input does not expand vertically; single-line with horizontal scroll remains visible.
- [ ] Right-column panes do not shift or misalign.
- [ ] Pressing Enter submits the full content; the `ResultStream` query-echo line shows the full text (even if only the current viewport scrolls within the input).
- [ ] Record the exact pasted-newline behavior from `ink-text-input` on each platform — this is a "document what happens" step, not a pass/fail.

## 11. Low-color-terminal readability

On Linux: `TERM=xterm nimbus tui` (forces 16-color). On macOS/Windows: equivalent minimal-TERM setting for your terminal.

- [ ] ●/◐/○ glyphs remain visible and distinguishable.
- [ ] Yellow banners (disconnect, HITL, cancel hint) render in a readable color (Ink maps `color="yellow"` to a 16-color palette entry).
- [ ] `dimColor` text is still distinguishable from normal text.
- [ ] If readability is noticeably degraded, file a follow-up issue — do NOT block WS6 on this. Spec §10 mitigation is a post-ship monochrome fallback if user feedback asks.

---

## Results

| Platform | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Windows 11 | | | | | | | | | n/a | | |
| macOS x64 | | | | | | | | | | | |
| macOS arm64 | | | | | | | | | | | |
| Linux (Ubuntu) | | | | | | | | | | | |
| Linux (Fedora) | | | | | | | | | | | |

Legend: ✅ passed, 🚧 blocked (link issue), ⚠ passed with caveat (describe inline).
