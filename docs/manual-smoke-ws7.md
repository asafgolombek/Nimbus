# WS7 Manual Smoke — VS Code Extension

> Run on every supported platform (Windows 11, macOS 14, Linux Ubuntu 22.04+) before tagging `vscode-v0.1.0`. One column per OS; tick on completion.

## Pre-flight

- [ ] `nimbus start` runs and prints "Gateway listening on …" — Win/macOS/Linux
- [ ] Extension `.vsix` builds via `cd packages/vscode-extension && bun run build && bunx vsce package --no-dependencies`

## Install + activation

| Step | Win | macOS | Linux |
|---|---|---|---|
| Install via `code --install-extension nimbus-<ver>.vsix` | ☐ | ☐ | ☐ |
| After 5 s, status bar shows `Nimbus: …` (any state) | ☐ | ☐ | ☐ |
| Output channel "Nimbus" exists with at least one log line | ☐ | ☐ | ☐ |

## Empty state

| Step | Win | macOS | Linux |
|---|---|---|---|
| With Gateway stopped, `Nimbus: Ask` opens panel showing "Gateway is not running" hero card with **Start Gateway** button | ☐ | ☐ | ☐ |
| Click **Start Gateway** — status bar transitions and chat becomes usable | ☐ | ☐ | ☐ |

## Streaming Ask (chat panel)

| Step | Win | macOS | Linux |
|---|---|---|---|
| `Nimbus: Ask` → type `tell me a haiku about the moon` → tokens stream live | ☐ | ☐ | ☐ |
| Stop button cancels mid-stream cleanly | ☐ | ☐ | ☐ |
| Asking again continues the same `sessionId` (Gateway audit log shows two turns) | ☐ | ☐ | ☐ |
| `Nimbus: New Conversation` clears transcript and resets session | ☐ | ☐ | ☐ |
| Reload Window restores transcript (rehydrates last 50 turns) | ☐ | ☐ | ☐ |

## Selection commands

| Step | Win | macOS | Linux |
|---|---|---|---|
| Select 5 lines in any open file → right-click → `Nimbus: Ask About Selection` → input pre-filled with file/lines/code fence | ☐ | ☐ | ☐ |
| `Nimbus: Search Selection` opens Quick Pick filtered by selection text | ☐ | ☐ | ☐ |

## Search command

| Step | Win | macOS | Linux |
|---|---|---|---|
| `Nimbus: Search` shows input box → results in Quick Pick | ☐ | ☐ | ☐ |
| Item with URL opens in default browser via `openExternal` | ☐ | ☐ | ☐ |
| Item with file path opens in editor via `openTextDocument` | ☐ | ☐ | ☐ |
| Item without URL/path opens via `nimbus-item:<id>` URI as read-only markdown | ☐ | ☐ | ☐ |

## Run Workflow

| Step | Win | macOS | Linux |
|---|---|---|---|
| `Nimbus: Run Workflow` Quick Pick lists workflows | ☐ | ☐ | ☐ |
| Selecting one fires toast with **Show Progress** button → focuses Output channel | ☐ | ☐ | ☐ |

## HITL routing

| Step | Win | macOS | Linux |
|---|---|---|---|
| Trigger HITL while chat panel is visible+focused → inline card appears in chat (no modal/toast) | ☐ | ☐ | ☐ |
| Switch to a code file, trigger HITL → non-modal toast with Approve/Reject/View Details | ☐ | ☐ | ☐ |
| Set `nimbus.hitlAlwaysModal: true` in settings, trigger HITL → blocking modal | ☐ | ☐ | ☐ |
| Status bar shows `⚠ N pending` when toast dismissed unanswered | ☐ | ☐ | ☐ |
| Click status-bar `N pending` → Quick Pick of pending requests; select one → resurfaces | ☐ | ☐ | ☐ |

## Theme syncing

| Step | Win | macOS | Linux |
|---|---|---|---|
| Switch to Light theme → chat panel re-themes without reload | ☐ | ☐ | ☐ |
| Switch to High Contrast → chat panel re-themes | ☐ | ☐ | ☐ |
| Switch to High Contrast Light → chat panel re-themes | ☐ | ☐ | ☐ |
| Capture one screenshot per theme; attach to PR | ☐ | ☐ | ☐ |

## Permission denied (Linux/macOS only)

| Step | macOS | Linux |
|---|---|---|
| `chmod 000 <socketPath>` while Gateway running | ☐ | ☐ |
| Status bar shows `Socket permission denied` (red), tooltip mentions path | ☐ | ☐ |
| `chmod 600 <socketPath>` restores normal connection | ☐ | ☐ |

## Memory

| Step | Win | macOS | Linux |
|---|---|---|---|
| Run a 100-turn scripted Ask session (e.g., 100 × `say hi`) | ☐ | ☐ | ☐ |
| `Developer: Open Process Explorer` — extension host RSS < 200 MB | ☐ | ☐ | ☐ |

## Cursor (one OS sufficient)

| Step | One OS |
|---|---|
| Install from Open VSX in Cursor → `Nimbus: Ask` works end-to-end | ☐ |

## Sign-off

- [ ] All boxes ticked, screenshots attached, no regressions noted in CHANGELOG.
- [ ] Author: __________  Reviewer: __________  Date: __________
