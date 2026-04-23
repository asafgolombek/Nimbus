# WS6 — Rich TUI (Ink) — Design Spec (v0.1.0, Phase 4)

**Date:** 2026-04-23
**Authoritative source:** `docs/release/v0.1.0-finish-plan.md §4.3` + the WS6 section of the `nimbus-phase-4` skill. This spec folds those two sources into a single implementation-ready design and resolves eight scope questions raised during brainstorming.
**Phase placement:** Workstream 6 of Phase 4 (Presence). Sequentially after WS5-D (shipped) and alongside/after the signing-pipeline Phase-1 plan. WS7 (VS Code extension) follows WS6 per the P2-track sequencing.
**Prior art:** WS5-A/B/C/D (Tauri UI) defined the Gateway-offline handling and HITL dialog mental models this spec mirrors in a terminal surface.

---

## 1. Purpose & Motivation

Nimbus has a working CLI (`nimbus repl`, `nimbus ask`) and a Tauri desktop UI. It lacks a **rich terminal surface** — the thing a developer opens in a split pane alongside their editor to watch connector health, fire agentic queries with streaming output, consent to HITL actions inline, and see sub-task progress on multi-agent runs. WS6 delivers that surface.

The goal is not to replace the line-based `nimbus repl`. The REPL stays as-is for scripts, CI pipelines, and dumb-terminal environments (SSH sessions with `TERM=dumb`, Docker exec, `NO_COLOR` users). The TUI is the opt-in rich alternative for interactive sessions: always-visible connector health, streaming output, structured HITL consent, and live sub-task progress — none of which the REPL can render in place.

This spec delivers a five-pane Ink-based TUI launched via `nimbus tui`, with automatic fallback to the existing REPL on dumb terminals. No new IPC methods are required — every notification and poll surface WS6 needs already exists in the Gateway.

---

## 2. Scope

### 2.1 In scope

1. **New `nimbus tui` command** under `packages/cli/src/commands/tui.tsx`, wired into the CLI's command registry. Accepts no flags in v0.1.0 beyond `--help`.
2. **Five Ink panes** in the "classic split" layout (Option 1 from brainstorming Q2):
   - `QueryInput` (1-row top bar)
   - `ResultStream` (main area, full width minus right column)
   - `ConnectorHealth`, `WatcherPane`, `SubTaskPane` stacked in the right column
3. **Inline mid-stream HITL** (Q3 option B) — a `──[ consent required ]──` banner prints into the live buffer, the input prompt becomes `nimbus[hitl]>`, single-keystroke `a`/`r`/`d`/`q` response. Outcome line flushes into the scrollback transcript.
4. **Append + scrollback** result stream (Q5 option B) using Ink's `<Static>` to avoid re-diffing prior output. Current stream renders live below the static block; on `engine.streamDone`, the live buffer moves into `<Static>`.
5. **Input-only focus model** (Q6 option A) — `QueryInput` is always focused; status panes are passive live widgets. `Up`/`Down` cycles `tui-query-history.json` (last 100). `Ctrl+C` maps to cancel-stream-then-exit.
6. **Gateway-offline handling** (Q7 option B) — top-of-screen amber banner, exponential reconnect (2s → 4s → 8s → 16s → 30s cap), status panes show last-known data with `(stale)` marker while disconnected, input is dimmed + disabled, active stream is abandoned (no mid-stream resume).
7. **SubTaskPane persistence semantics** (Q8 option B) — the last run's progress bars persist in the pane until the next query submit; not auto-cleared on run completion, not a session-wide accumulation.
8. **Unsuitable-terminal fallback** — any of `TERM=dumb`, `NO_COLOR` set, `!process.stdout.isTTY`, `CI=true`, or `rows < MIN_HEIGHT_THRESHOLD` (20) → prints a one-line notice and invokes `runRepl(args)` from the existing REPL module. No Ink render attempted. Full trigger list in §3.1.
9. **Narrow-terminal collapse** — when `process.stdout.columns < NARROW_LAYOUT_COLUMN_THRESHOLD` (constant; initial value 100), App.tsx switches to a single-column layout: QueryInput / ResultStream / single bottom status bar. Crossing **below** `MIN_HEIGHT_THRESHOLD` mid-session exits Ink with a one-line notice (§3.3).
10. **Query history file** — `join(paths.cacheDir, "tui-query-history.json")` via `getCliPlatformPaths()`. Format `{ "entries": string[] }`, newest-last, max 100, dedup on repeat-of-last, corrupt file treated as empty.
11. **`ink-testing-library`-backed unit tests** for all six components + dumb-terminal fallback + query-history file semantics, under `bun test`. Coverage gate ≥ 80% lines / ≥ 75% branches on `packages/cli/src/tui/`, wired into `_test-suite.yml`.
12. **3-OS manual smoke** documented in `docs/manual-smoke-ws6.md`, covering launch, streaming, HITL, unsuitable-terminal fallback, gateway death, narrow-terminal collapse, short-terminal runtime drop, cancel semantics, signal handling, and paste safety (full list in §8.5).
13. **`nimbus repl` stays unchanged.** Both interactive surfaces ship in v0.1.0; help output documents both.

### 2.2 Out of scope — deferred

- **Multi-session management inside the TUI** (`--session` flag, session switcher). One session per process in v0.1.0; shell wrappers or multiple terminals serve the multi-session case.
- **Session-resume on relaunch** (load prior `session_chunks` into the scrollback on startup). Deferred pending user demand.
- **Tab-navigable focus** (Q6 option C) — let users `Tab` into status panes and scroll their contents. Deferred; input-only focus is the v0.1.0 contract.
- **Modal drill-down hotkeys** (Q6 option B — `Ctrl+T` for sub-task detail, `Ctrl+W` for watcher history, `Ctrl+H` for connector detail). Not in v0.1.0; Tauri UI already offers these surfaces.
- **Auto-start of the gateway** from inside the TUI (Q7 option C) — a hotkey to run `nimbus start`. Deferred (spawning a child process from Ink with terminal-handoff + signal-forwarding is fiddly).
- **Mouse support, window-title updates, clipboard integration, theming.** Terminals are diverse; v0.1.0 respects `NO_COLOR` and stops there.
- **E2E tests against a pseudo-terminal in CI.** 3-OS manual smoke is the cross-platform acceptance gate, consistent with WS5-A/B/C/D.

### 2.3 Explicit non-goals

- **No new IPC methods.** `engine.cancelStream` was verified absent during spec review; adding it is explicitly a post-v0.1.0 follow-up, not a WS6 task (§5.2, §11.1). Any other edge case requiring a new IPC method would justify a separate mini-spec.
- **No changes to the Gateway streaming protocol.** `engine.askStream` / `engine.streamToken` / `engine.streamDone` / `engine.streamError` / `agent.subTaskProgress` / `agent.hitlBatch` / `consent.respond` are all consumed as-is.
- **No replacement of `nimbus repl`.** Users keeping `nimbus repl` in muscle memory and in scripts are unaffected.

---

## 3. Architecture

### 3.1 Entry

`nimbus tui` is a single Node-side process that goes through this sequence on launch:

```
1. parse flags (only --help in v0.1.0)
2. read CLI platform paths via getCliPlatformPaths()
3. locate gateway socket via readGatewayState(paths)
   ├─ gateway not running → print "Gateway is not running. Start with: nimbus start"; exit 1
   └─ gateway running     → proceed
4. unsuitable-terminal check (any triggers fallback)
   ├─ TERM === "dumb"                              → fallback
   ├─ NO_COLOR is set (any truthy value)           → fallback
   ├─ !process.stdout.isTTY                        → fallback
   ├─ process.env.CI === "true"                    → fallback
   ├─ process.stdout.columns < NARROW_LAYOUT_COLUMN_THRESHOLD
   │                                               → render in collapsed single-column mode (§3.3)
   ├─ process.stdout.rows    < MIN_HEIGHT_THRESHOLD → fallback
   └─ otherwise                                    → proceed to render Ink
5. initialize pino file logger via createCliFileLogger(paths) — writes to
   paths.logDir/cli-<date>.log; NEVER to stdout/stderr (§3.2)
6. new IPCClient(socketPath); await client.connect()
7. registerInteractiveCliIpcHandlers(client)  (reused from repl.ts)
8. install SIGINT + SIGTERM + process.on("exit") handlers that:
     a. attempt client.disconnect() (best-effort, failures swallowed)
     b. Ink ink.unmount() to restore the terminal
     c. exit with the appropriate code (0 for user-triggered, 130 for SIGINT,
        143 for SIGTERM where permitted)
9. render(<App client={client} logger={logger} />)
10. await user-triggered exit (double Ctrl+C, `exit`/`quit` typed in QueryInput,
    or a terminal signal)
11. cleanup path runs (step 8 handlers converge here)
```

**Fallback output:**
```
Unsuitable terminal detected (TERM=dumb | NO_COLOR | non-TTY | CI=true | rows<N) — falling back to REPL.
```
Then invokes `runRepl(args)` and exits through the REPL path. Only one reason is printed — whichever matched first.

### 3.2 Runtime dependencies

- `ink` v5.x (React 18 compatible; ESM-only — CLI is already ESM).
- `ink-text-input` for the `QueryInput` component (single-line text input with readline-like key handling).
- `react` 18.x (workspace-level; already present indirectly via `packages/ui`).
- `ink-testing-library` (dev dep) for component unit tests.

No other new runtime deps. No native modules. The existing `@nimbus-dev/client` + `pino` cover IPC and logging.

**Logging discipline (critical).** Ink owns the stdout buffer while rendering — any `console.log` / `process.stdout.write` / pino-to-stdout call during an active render corrupts the display and causes "white-screen" or layout-crash symptoms. The TUI therefore:

- Uses `createCliFileLogger(paths)` from `packages/cli/src/lib/cli-logger.ts` as the single logging sink, writing to `paths.logDir/cli-<date>.log` (same file the REPL would use if it logged).
- Passes the returned `logger` to `App` via React context; every pane uses the context logger rather than `console.*`.
- Swallows stderr writes from dependencies via a one-time `process.stderr.write = noop` override, installed after Ink renders and removed during cleanup. Pino writes only to the file destination, not stderr, so this override is a safety net, not the primary defense.
- Biome lint rule `no-console` is already project-wide; this section makes the rationale explicit for future contributors.

Users debugging a "TUI rendered blank" issue are pointed at the log file in the help output and in `docs/manual-smoke-ws6.md`.

### 3.3 Layout — Option 1 "classic split"

```
┌──────────────────────────────────────────────────────┐
│ nimbus> _                                            │  ← QueryInput (1 row)
├────────────────────────────────────┬─────────────────┤
│                                    │ Connectors      │
│  ResultStream                      │ ● github ● gdrv │
│  (prior Q&A via <Static>,          │ ○ slack  ● jira │
│   current stream live below)       ├─────────────────┤
│                                    │ Watchers        │
│                                    │ 3 active, 1 fire│
│                                    ├─────────────────┤
│                                    │ Sub-Tasks       │
│                                    │ [===-] planner  │
│                                    │ [===] github-mcp│
└────────────────────────────────────┴─────────────────┘
```

**Narrow-terminal collapse** (below `NARROW_LAYOUT_COLUMN_THRESHOLD = 100` columns):

```
┌──────────────────────────────────────────────────────┐
│ nimbus> _                                            │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ResultStream (full width)                           │
│                                                      │
├──────────────────────────────────────────────────────┤
│ connectors: 7 ok, 1 warn │ watchers: 3 │ subtasks: 2 │  ← collapsed status bar
└──────────────────────────────────────────────────────┘
```

Right-column pane detail unavailable below the threshold. Threshold is a named constant so spec review catches changes.

**Short-terminal fallback** (below `MIN_HEIGHT_THRESHOLD = 20` rows): the TUI falls back to the REPL rather than attempting a further-collapsed layout. Rationale: with fewer than ~20 rows, even the collapsed single-column layout crowds out ResultStream to the point of unusability (input + scrollback + status bar leaves ≤ 15 rows of actual output, cut further when HITL banners appear). A `nimbus repl` line-loop is a more honest experience in that envelope. Threshold is a named constant; tunable during manual smoke.

**Runtime resize.** Both thresholds are re-evaluated on every `process.stdout.resize` event via Ink's `useStdout` hook. Crossing the width threshold swaps the layout in place. Crossing the height threshold **downward** prints a one-line notice and exits the Ink render (the user is directed to `nimbus repl` rather than auto-forking a REPL mid-session — session state is process-local in v0.1.0 and cannot be transferred). Crossing the height threshold **upward** from a process already in REPL fallback does nothing — relaunch is on the user.

### 3.4 Component breakdown

Six files under `packages/cli/src/tui/`, each single-purpose for isolated testing:

| File | Responsibility |
|---|---|
| `App.tsx` | Root. Composes panes in the Option-1 layout via `<Box flexDirection>`. Owns the top-level state machine: `idle` \| `streaming` \| `awaiting-hitl` \| `disconnected`. Exposes the `IPCClient` via React context. |
| `QueryInput.tsx` | `ink-text-input`-backed prompt (`nimbus>`), **single-line with horizontal scrolling** — long queries scroll the visible window rather than wrapping to multiple rows (keeps the 1-row layout stable in short terminals). Up/Down cycles `tui-query-history.json`. Enter submits. Dimmed + disabled during `streaming`. On `awaiting-hitl`, prompt becomes `nimbus[hitl]>` in single-keystroke mode. |
| `ResultStream.tsx` | Prior Q&A rendered via `<Static>`. Current tokens render in a live `<Text>` below. On `engine.streamDone`, live buffer flushes into `<Static>`. On `engine.streamError`, an `❌` line appends and flushes. |
| `ConnectorHealth.tsx` | `useIpcPoll("connector.list", 30_000)`. Renders ●/○/◐ dots with a 1-line label per connector. Degraded connectors prefixed `⚠`. Paused while `disconnected`. |
| `WatcherPane.tsx` | `useIpcPoll("watcher.list", 30_000)`. Renders `N watchers, M firing` + up to 5 most-recently-firing names. Silent truncation beyond 5. |
| `SubTaskPane.tsx` | Subscribes to `agent.subTaskProgress`. Maintains per-run map keyed by `subTaskId`. Renders progress bars (`[====-]` 5-char fill) + status glyphs. **Starts empty on every TUI launch** — does NOT hydrate from the `sub_task_results` table. Session-resume-lite is explicitly out of scope per §2.2; a fresh process shows "No active sub-tasks" until the user submits a query. Clears only on next query submit (per Q8) within a single process lifetime. |

**Shared state.** `App.tsx` owns a reducer for the top-level state machine. Panes read slices via context. Pattern consistent with `packages/ui`'s Zustand slices to keep future code-reading predictable. No Zustand dependency added — a plain `useReducer` hook is sufficient for this scope.

### 3.5 Files that are not new

- `packages/cli/src/commands/repl.ts` — unchanged. The TUI's dumb-terminal fallback imports `runRepl` from this file.
- `packages/cli/src/lib/interactive-ipc-handlers.ts` — reused unchanged for the HITL notification plumbing on the client side.
- `packages/cli/src/paths.ts` — `cacheDir` already returns the correct per-OS location for `tui-query-history.json`.

---

## 4. File Map

### 4.1 Create

- `packages/cli/src/commands/tui.tsx` — command entry; orchestrates gateway state check, dumb-terminal guard, Ink render, cleanup.
- `packages/cli/src/tui/App.tsx` — root component; state machine; layout switch at narrow-terminal threshold.
- `packages/cli/src/tui/QueryInput.tsx` — input prompt, history cycling, HITL single-keystroke mode.
- `packages/cli/src/tui/ResultStream.tsx` — `<Static>` transcript + live stream buffer; HITL banner rendering.
- `packages/cli/src/tui/ConnectorHealth.tsx` — connector status pane.
- `packages/cli/src/tui/WatcherPane.tsx` — watcher status pane.
- `packages/cli/src/tui/SubTaskPane.tsx` — sub-task progress pane.
- `packages/cli/src/tui/useIpcPoll.ts` — shared polling hook (pauses on disconnected).
- `packages/cli/src/tui/query-history.ts` — read/write/dedup logic for `tui-query-history.json`.
- `packages/cli/src/tui/state.ts` — reducer + action types for the top-level state machine.
- `packages/cli/src/tui/constants.ts` — `NARROW_LAYOUT_COLUMN_THRESHOLD`, `MIN_HEIGHT_THRESHOLD`, poll intervals, history cap, double-Ctrl+C window, cancel-hint duration.
- `packages/cli/src/tui/App.test.tsx` — state-machine transitions.
- `packages/cli/src/tui/QueryInput.test.tsx` — input, history, HITL, Ctrl+C.
- `packages/cli/src/tui/ResultStream.test.tsx` — streaming, HITL banner, error line.
- `packages/cli/src/tui/ConnectorHealth.test.tsx` — polling + stale marker.
- `packages/cli/src/tui/WatcherPane.test.tsx` — polling + truncation.
- `packages/cli/src/tui/SubTaskPane.test.tsx` — progress bars + clear-on-next-submit.
- `packages/cli/src/tui/dumb-terminal.test.ts` — fallback path for each trigger condition.
- `packages/cli/src/tui/query-history.test.ts` — read/write/corrupt/cap/dedup.
- `docs/manual-smoke-ws6.md` — 3-OS manual verification checklist.

### 4.2 Modify

- `packages/cli/src/commands/index.ts` — register the `tui` command.
- `packages/cli/src/commands/help.ts` — add one-line `tui` entry in the command list.
- `packages/cli/package.json` — add `ink`, `ink-text-input`, `react` to dependencies; `ink-testing-library`, `@types/react` to devDependencies.
- `package.json` (root) — add `test:coverage:tui` script mirroring the existing coverage-gate scripts.
- `.github/workflows/_test-suite.yml` — add a `test:coverage:tui` row to the coverage-gate matrix.
- `CLAUDE.md` — add three rows to the "Key File Locations" table (`App.tsx`, `useIpcPoll.ts`, `query-history.ts`); flip WS6 to `🔵 In progress` then `✅` on completion; add `test:coverage:tui` to the commands list.
- `GEMINI.md` — mirror the `CLAUDE.md` changes.
- `docs/roadmap.md` — WS6 row(s) flip to `[x]`.

### 4.3 Delete

- None. `nimbus repl` stays per §2.1.

---

## 5. Data Flow

### 5.1 Query submit

```
User types "summarize my week" → Enter
   │
   ▼
QueryInput → dispatch({ type: "submit", query })
   │
   ├─ push to tui-query-history.json (cap 100, dedup-on-repeat-of-last)
   ├─ clear SubTaskPane (per Q8)
   ├─ state := "streaming"
   │
   ▼
client.call("engine.askStream", { input: q }) → returns { streamId }
   │
   ▼
Notifications arrive (via interactive-ipc-handlers plumbing):
   ├─ engine.streamToken { streamId, text }    → ResultStream.appendLive
   ├─ agent.subTaskProgress { subTaskId, ... } → SubTaskPane.update
   ├─ agent.hitlBatch { batchId, requests }    → dispatch({ type: "hitl-requested", batchId, requests })
   ├─ engine.streamDone { streamId }           → dispatch({ type: "stream-done" }); flush live buffer into <Static>; state := "idle"
   └─ engine.streamError { streamId, error }   → dispatch({ type: "stream-error", error }); append ❌ line + flush; state := "idle"
```

### 5.2 Cancel semantics

**Verified during spec review**: `engine.cancelStream` is **not implemented** in the Gateway (confirmed via grep of `packages/gateway/src/ipc/server.ts` — `streamId` is generated at line 939 but no cancel handler exists). Full-fidelity cancellation is a post-v0.1.0 Gateway addition (see §11 Open Items). The TUI therefore ships with a **local-only cancel** in v0.1.0:

- **Ctrl+C while `streaming`** (first press):
  - Local state flips `streaming` → `idle` immediately.
  - Remaining tokens from the abandoned stream are ignored by the client (detected by `streamId` mismatch with the now-cleared active stream).
  - Append line reads `(canceled by user — LLM may continue in the background)`.
  - A brief hint renders in the live buffer for 1.5 s: `^C Press again within 2s to exit`. The hint flushes into `<Static>` on timeout or on the next token so it becomes part of the transcript.
  - **Background cost caveat**: local LLMs (Ollama, llama.cpp) continue generating until the engine's own timeout or the sub-task completes — burning local CPU/GPU. Future remote providers would continue consuming token/quota budget. This caveat is surfaced in the help output and in `docs/manual-smoke-ws6.md`.
- **Ctrl+C within 2 s of the previous Ctrl+C** (regardless of state) → exit the TUI: run the cleanup path (IPC disconnect, Ink unmount, logger flush), exit 0.
- **Ctrl+C while `idle`** → render `^C Press again within 2s to exit` hint; second press exits.
- **Ctrl+C while `disconnected`** → exit immediately (no stream or session to protect; waiting is pointless). Hint is not shown.
- **Ctrl+C while `awaiting-hitl`** → reject the entire batch + exit (per §6 "Keyboard trap"). No hint — HITL abort is an intentional, deliberate action; showing a warning dilutes it.

**Signal handling path.** The SIGINT handler installed in §3.1 step 8 fires on Ctrl+C in environments where Ink does not already capture it (e.g., on non-TTY fallback paths, or if Ink unmounts mid-render). Ink's raw-mode input handler captures Ctrl+C when the render is live; the signal handler is a belt-and-braces safety net.

### 5.3 Polling paths

Two status panes share `useIpcPoll(method, intervalMs)`, a CLI-local mirror of the Tauri `useIpcQuery` hook:

- Fires once immediately on mount.
- Refires on `intervalMs` (30 000 ms for both `connector.list` and `watcher.list`).
- Pauses while state is `disconnected`.
- On error (IPC call throws), dispatches `{ type: "disconnected" }` to the App reducer and holds the last-known data for display.
- On reconnect, resumes from its next scheduled tick (not immediately — avoids thundering-herd on reconnect).

`SubTaskPane` does **not** use `useIpcPoll`. It is event-driven via `agent.subTaskProgress` notifications registered once on mount.

### 5.4 Query history file

- **Path:** `join(paths.cacheDir, "tui-query-history.json")` — per-OS correct via `getCliPlatformPaths()`.
- **Format:** `{ "entries": string[] }`, newest-last.
- **Cap:** 100 entries (constant in `constants.ts`).
- **Dedup:** a submitted query identical to the last entry does not create a new entry.
- **Writes:** fire-and-forget after each submit. Failures logged at `DEBUG` via pino, do not block submit.
- **Reads:** once on mount.
- **Corruption:** JSON parse failure → treat as empty + overwrite on next write. No crash, no user-visible error.
- **Separate from `nimbus repl`'s history** (if REPL gains a history file later). v0.1.0: TUI-specific file.

### 5.5 IPC client lifecycle

- One `IPCClient` per TUI process, created in `tui.tsx`, passed via React context.
- Closed in a unified cleanup path wired to three triggers: `process.on("SIGINT")`, `process.on("SIGTERM")`, and `process.on("exit")` (see §3.1 step 8). Each trigger runs at most once — a flag guards against double-unmount from the overlap between the signal handler and Node's normal exit sequence.
- Best-effort `client.disconnect()` — failures are swallowed and logged at `DEBUG` (the gateway may already be gone, in which case the disconnect attempt will throw; shutdown proceeds regardless).
- Ink's `ink.unmount()` runs before `exit()` to restore the terminal (clear alternate-buffer, show cursor, reset ANSI colors). Without this step, a SIGTERM during render leaves the user's terminal in raw mode.
- No per-pane reconnect logic. All reconnects centralize in the App reducer's `disconnected` state handler (§7).

---

## 6. Inline HITL Protocol

Triggered when `agent.hitlBatch { batchId, requests }` arrives during `streaming`. Matches Q3 option B.

### 6.1 User experience

```
nimbus> summarize my week and send the summary to Slack #general
(tokens stream here...)
Your week had 12 commits across 3 repos, 4 PRs, 2 meetings with ...

──[ consent required ]──────────────────────────────────────────
Action: slack.postMessage
  channel: "#general"
  text: "Your week had 12 commits across 3 repos, 4 PRs..."
  (1 of 1 pending)

[a]pprove  [r]eject  [d]etails  [q]uit
nimbus[hitl]> _
```

### 6.2 Rendering rules

- The banner prints **into the live buffer** — on batch resolution, it flushes into `<Static>` along with the outcome line, becoming part of the scrollback transcript (consistent with Q5 append-scrollback).
- `QueryInput`'s prompt changes from `nimbus>` to `nimbus[hitl]>`. Single-keystroke mode is active: no Enter required.
- The structured action body is JSON-pretty, indented, truncated at the pane width minus 2.
- Multi-action batches: after each decision, the banner advances `(2 of 3 pending)`. The decisions array is collected and sent in **one** `consent.respond` call at the end of the batch, not per-action.

### 6.3 Key mapping (single-keystroke)

| Key | Effect |
|---|---|
| `a` | Approve current action; advance to next if any, else resolve batch. |
| `r` | Reject current action; advance to next if any, else resolve batch. |
| `d` | Expand current action — render the full structured payload (JSON-pretty). Any other keystroke returns to the decision prompt. |
| `q` | Reject all remaining actions in the batch + exit the TUI. |
| `Ctrl+C` | Same as `q` — reject + exit (keyboard trap described in §6.5). |

### 6.4 Outcome

On batch resolution:

```
consent.respond({ batchId, decisions: [{ actionId, approved: boolean }, ...] })
```

Outcome line printed into the live buffer before flush:

- All approved → `✓ approved all`
- All rejected → `✗ rejected all`
- Mixed → `✓ approved N, ✗ rejected M`

Then the live buffer flushes into `<Static>`. State returns to `streaming` (engine continues) or `idle` (engine had nothing left).

### 6.5 Keyboard trap during `awaiting-hitl`

- Text input is fully captured by the HITL single-keystroke handler. Characters other than `a`/`r`/`d`/`q`/`Ctrl+C` are ignored (no bell, no error).
- `Ctrl+C` maps to "reject all + exit" — not cancel-stream-then-exit — because the cancellation happens via the consent mechanism, not the stream-cancel path.
- Gateway-offline mid-HITL → banner wiped, state → `disconnected`, any in-flight consent is rejected on the engine side when the socket drops. Documented, not a bug we fix in the TUI.

---

## 7. Gateway-offline Handling

Matches Q7 option B. Mirrors the Tauri UI's `GatewayConnectionProvider` mental model.

### 7.1 Detection

Two channels, either triggers transition to `disconnected`:

1. **Call failure.** `client.call()` throws `ECONNRESET` / `ENOENT` / similar. Caught in a top-level IPC helper wrapper; dispatches `{ type: "disconnected" }`.
2. **Heartbeat loss via poll hooks.** The 30s `connector.list` / `watcher.list` polls throw on a dead socket. Same dispatch path.

No separate heartbeat ping — the polls serve that purpose. Nominal detection latency: up to 30s in the absence of an active user query, sub-second during one.

### 7.2 UI while disconnected

- **Top banner** (amber): `⚠ Gateway disconnected — reconnecting…  (press Ctrl+C to exit)`.
- `QueryInput` dimmed + disabled; typed keys ignored except Ctrl+C.
- Status panes show last-known data with a `(stale)` suffix on the pane title.
- Active stream (if any) is abandoned — no mid-stream resume protocol exists. User resubmits on reconnect if they want.
- In-flight HITL batch is abandoned symmetrically.

### 7.3 Reconnect loop

`setTimeout`-driven, exponential with a 30s cap:

```
2s → 4s → 8s → 16s → 30s → 30s → 30s → …
```

On `client.connect()` success:

- Dispatch `{ type: "reconnected" }`.
- State returns to `idle`.
- Banner replaced by a 3s-fade success line: `✓ Reconnected`.
- Poll hooks resume from their next scheduled tick.

No jitter on the exponential — a single TUI doesn't create a thundering-herd risk.

### 7.4 Exit while disconnected

Single Ctrl+C exits immediately: attempt a best-effort `client.disconnect()` (failures ignored), unmount Ink, exit 0. No "cancel stream" phase because there is no stream.

### 7.5 No auto-start

We do not spawn `nimbus start` from the TUI in v0.1.0. Users open another terminal. The banner's `(press Ctrl+C to exit)` hint is the only action available in-TUI.

---

## 8. Testing Strategy

### 8.1 Runner

`bun test` for all TUI tests. `packages/cli` already uses bun test; adding a second runner for one package would be churn.

### 8.2 Ink-specific tool

`ink-testing-library` (official) — works under `bun test` since it's plain React test infrastructure. Standard pattern:

```tsx
const { lastFrame, stdin, rerender } = render(<App client={stubClient} />);
expect(lastFrame()).toContain("nimbus> ");
stdin.write("hello\n");
rerender(<App client={stubClient} />);
expect(lastFrame()).toContain("streaming");
```

Added to `packages/cli/devDependencies`.

### 8.3 Test files

| File | Covers |
|---|---|
| `App.test.tsx` | State-machine transitions: idle → streaming → idle; streaming → awaiting-hitl → streaming; any → disconnected → idle. Uses a stub `IPCClient` implementing `call` + `on`, with helpers to push synthetic notifications. |
| `QueryInput.test.tsx` | History cycling (Up/Down) **with explicit boundary cases**: Up at the top of history holds the oldest entry; Down at the bottom returns to the empty draft and does not go past it; cycling does not mutate the history file. Submit on Enter. Double-Ctrl+C exit timing. Single Ctrl+C during `streaming` → `^C Press again within 2s to exit` hint renders then clears after 1.5 s. Dimmed+disabled during stream. Single-keystroke HITL mode captures `a`/`r`/`d`/`q` (and only those — other keys no-op). Horizontal-scroll behavior on a 200-char input in an 80-col terminal. |
| `ResultStream.test.tsx` | Tokens accumulate in live buffer; `streamDone` flushes to `<Static>`; `streamError` renders `❌` line; HITL banner block renders inside live buffer. |
| `ConnectorHealth.test.tsx` | Poll interval, paused while `disconnected`, `(stale)` marker on reconnect, dot color mapping for ok/degraded/down. |
| `WatcherPane.test.tsx` | Same shape as ConnectorHealth — truncation beyond 5 names, `N watchers, M firing` rendering. |
| `SubTaskPane.test.tsx` | Progress-bar render, clear-on-next-submit semantics (Q8), event-driven update path from `agent.subTaskProgress`. |
| `dumb-terminal.test.ts` | Command-entry fallback for each trigger: `TERM=dumb`, `NO_COLOR` set, non-TTY stdout, `CI=true`, and `rows < MIN_HEIGHT_THRESHOLD`. Asserts `runRepl` is invoked in each case and Ink is not rendered. Also asserts only one reason is printed (first-match wins). |
| `query-history.test.ts` | Read/write round-trip, 100-entry cap, dedup-on-repeat-of-last, corrupt-file recovery. |

### 8.4 Coverage gate

New script in root `package.json`:

```
test:coverage:tui -- runs bun test --coverage on packages/cli/src/tui/
  threshold: ≥ 80% lines, ≥ 75% branches
```

Added to `.github/workflows/_test-suite.yml` as a row in the coverage-gate matrix. Failing coverage fails CI.

### 8.5 Manual smoke — 3-OS

New file `docs/manual-smoke-ws6.md` covering:

1. **Launch**: `nimbus tui` launches on Windows Terminal, macOS Terminal.app, macOS iTerm2, Linux gnome-terminal, Linux alacritty. No Ink stack traces; layout renders correctly at default terminal size. The pino log file at `paths.logDir/cli-<date>.log` records startup with no errors and **contains zero stdout/stderr corruption markers** (no raw JSON blobs interleaved with render output).
2. **Streaming**: submit a query that triggers a 20-second generation. Tokens render continuously without flicker. Prior lines in `<Static>` do not re-render (observable: no cursor flicker on prior text).
3. **Inline HITL**: trigger a workflow that requires consent mid-stream. Banner appears; approve path resumes the stream and prints `✓ approved all` in the transcript; reject path terminates the stream with `✗ rejected all`; multi-action batch sequences correctly.
4. **Unsuitable-terminal fallback**: `TERM=dumb nimbus tui`, `NO_COLOR=1 nimbus tui`, `nimbus tui < /dev/null` (non-TTY stdin), `CI=true nimbus tui`, and `stty rows 10 && nimbus tui` each print the fallback notice and enter REPL. Terminal is left in a sane state on REPL exit in every case.
5. **Gateway death**: kill the gateway mid-session. Banner appears within 2 s (during active stream) or ≤ 30 s (idle). Restart the gateway. Reconnect banner fades within 30 s. Input re-enables.
6. **Narrow-terminal collapse**: resize the terminal below 100 columns while the TUI is running. Layout collapses to single-column; status bar replaces right column. Resize above 100 columns: layout restores.
7. **Short-terminal runtime drop**: resize the terminal to < 20 rows while the TUI is running. The one-line notice `Terminal too short — exiting; relaunch after resizing or use nimbus repl` prints; Ink unmounts; exit code 0; terminal is restored.
8. **Cancel semantics**: submit a long query; press Ctrl+C once. `(canceled by user — LLM may continue in the background)` prints; `^C Press again within 2s to exit` hint renders and clears. Press Ctrl+C within 2 s → exit. Relaunch; press single Ctrl+C while idle → exit hint renders; press again within 2 s → exit.
9. **Signal handling**: while the TUI is rendering, from another terminal run `kill -TERM <pid>` and `kill -INT <pid>` (separate sessions). Both restore the terminal cleanly (no stuck raw mode, no missing cursor, no leftover colors); both flush the pino log file.
10. **Paste safety**: paste a 5-paragraph prompt (~2 KB of text with newlines) into `QueryInput`. The input does not expand vertically (single-line, horizontal-scroll), does not break the right-column layout, and submits correctly on Enter. Pasted newlines within the prompt are handled consistently with `ink-text-input`'s documented behavior (record actual behavior in the smoke doc for the implementation plan to reference).

Results recorded inline in the file and in the release-gate checklist execution (finish-plan §4.6).

### 8.6 No E2E

The TUI against a real Gateway is a terminal UI; we do not automate pseudo-terminal testing in CI. The manual smoke is the authoritative cross-platform acceptance gate, consistent with how WS5-A/B/C/D handled Tauri UI testing.

### 8.7 Coverage on non-TUI code

No gateway, SDK, or UI source is modified. Existing coverage gates (`CLAUDE.md` commands list) are untouched.

---

## 9. Acceptance Criteria

Copy forward into the implementation plan's Final Verification section and into `finish-plan §4.3`.

- [ ] `nimbus tui` launches cleanly on Windows Terminal, macOS Terminal.app, macOS iTerm2, Linux gnome-terminal, Linux alacritty. No Ink stack traces; no ANSI leakage into fallback paths.
- [ ] Token-by-token stream renders continuously without flicker on a 20-second generation. `<Static>`-backed scrollback means prior lines never re-render (observable via cursor-position stability).
- [ ] Inline HITL banner appears mid-stream. Approving resumes the stream and prints the outcome line. Rejecting terminates the stream. Multi-action batches sequence correctly. `consent.respond` is called once per batch with the full decisions array.
- [ ] Unsuitable-terminal fallback: each of `TERM=dumb`, `NO_COLOR`, non-TTY stdout, `CI=true`, and `rows < MIN_HEIGHT_THRESHOLD` invokes `runRepl` without rendering Ink. Only one reason prints (first-match wins).
- [ ] `nimbus repl` remains working and unchanged in behavior. Both commands appear in `nimbus --help`.
- [ ] Gateway-offline banner appears within ≤ 30 s of gateway kill (sub-second during an active stream). Exponential reconnect succeeds on gateway restart. `(stale)` marker on poll data during disconnect. `✓ Reconnected` fade on recovery.
- [ ] Narrow-terminal collapse (< `NARROW_LAYOUT_COLUMN_THRESHOLD` cols) switches to single-column layout without crash. Resize above threshold restores the 5-pane layout. Runtime drop below `MIN_HEIGHT_THRESHOLD` rows exits Ink cleanly with a one-line notice.
- [ ] Cancel semantics: single Ctrl+C during streaming flips state to `idle`, prints `(canceled by user — LLM may continue in the background)`, renders the `^C Press again within 2s to exit` hint for 1.5 s. Double Ctrl+C within 2 s exits. Single Ctrl+C while idle shows the hint; second press exits. Ctrl+C while `awaiting-hitl` rejects the batch + exits. Ctrl+C while `disconnected` exits immediately.
- [ ] `tui-query-history.json` stored in per-OS `cacheDir`, capped at 100 entries, deduped on repeat-of-last, corrupt-file recovery does not crash.
- [ ] Logging: pino writes only to `paths.logDir/cli-<date>.log`; stdout and stderr contain zero corruption markers during a full session (verified by manual smoke step 1).
- [ ] Signal handling: SIGINT and SIGTERM both run the unified cleanup (IPC disconnect, Ink unmount, logger flush) and leave the terminal in a restored state.
- [ ] Coverage on `packages/cli/src/tui/` ≥ 80% lines / ≥ 75% branches. `bun run test:coverage:tui` wired into `_test-suite.yml`.
- [ ] `docs/manual-smoke-ws6.md` committed with 3-OS verification results (or links to a tracking issue if any platform is blocked).
- [ ] `CLAUDE.md` + `GEMINI.md` updated: WS6 status, new file-location rows, `test:coverage:tui` command entry.

---

## 10. Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Ink's `<Static>` re-renders on certain terminal resizes, causing flicker | Low–Medium | Manual smoke explicitly tests resize behavior; if flicker observed, pin Ink patch version and document minimum terminal requirement. `<Static>` is the documented Ink pattern for exactly this use case. |
| `engine.cancelStream` does not exist — cancel is local-only | Accepted (verified absent) | Documented in §5.2 and §11.1 as the v0.1.0 contract. Help output + manual smoke surface the background-continuation caveat to users. Follow-up Gateway work is scoped post-v0.1.0. |
| Ink ESM-only conflicts with CLI bundling via `bun build --compile` | Low | `bun build` has native ESM support; existing CLI is ESM. If an unexpected bundle failure surfaces, pin Ink version and document in plan. |
| Sub-task pane clutters on runs with > 20 sub-tasks | Low | Silent truncation at pane height; "…N more" line if truncated. Tunable constant. |
| Ink render performance on a fast token stream (1 kHz+ notifications) | Low | Batch token appends at 60 fps via `requestAnimationFrame`-equivalent (setImmediate) in the `ResultStream` live-buffer path. Add only if the 20-second smoke shows stutter. |
| Terminal color degradation on low-color terminals despite not being dumb | Low | Detect via `process.stdout.getColorDepth()` — fall back to monochrome glyphs (● → `*`, ○ → `.`) but keep the 5-pane layout. One-constant change if ever needed. |
| Windows Terminal width reporting differs mid-resize | Low | The narrow-terminal detection polls `process.stdout.columns` via Ink's `useStdout`; Ink handles resize events on Windows. Manual smoke verifies. |
| HITL keyboard trap locks the user out if the batch handler hangs | Medium | `q` and `Ctrl+C` always resolve the batch (as reject-all) and return the user to idle. A hang on `consent.respond` itself surfaces as a disconnect per §7. |
| Users expect `nimbus repl` behavior and are confused by `nimbus tui` | Low | Help output clearly distinguishes the two. `nimbus tui --help` recommends `nimbus repl` for scripts / dumb terminals. |
| `ink-text-input` unmaintained / incompatible | Low | Package is a thin wrapper over Ink's stdin handling; if it breaks, we can inline a 40-line replacement. Track in Open Items. |

---

## 11. Open Items Deferred to the Implementation Plan

Small enough to resolve during TDD cycles; none affect architecture.

1. **`engine.cancelStream` is confirmed absent (grep of `packages/gateway/src/ipc/server.ts`).** v0.1.0 ships with the local-only cancel documented in §5.2. A **post-v0.1.0 follow-up issue** should add a Gateway `engine.cancelStream` handler that tracks active `agent.invoke` promises by `streamId` and aborts them via `AbortController` — the existing pattern in `packages/gateway/src/ipc/llm-rpc.ts:17` (`activePulls = new Map<string, AbortController>()`) is the reference implementation. Once the Gateway handler exists, the TUI's `handleCancel` swaps one call site from "flip local state" to "call the RPC and wait for `engine.streamError`"; no TUI architecture change.
2. **Ink + React version pins.** Latest stable at plan-writing time. Record in `packages/cli/package.json`; regenerate lockfile.
3. **`ink-testing-library` version pin.** Same — latest stable.
4. **Narrow-terminal threshold value (100 cols).** Reasonable default; tune during manual smoke if 5-pane layout cramps before 100 or wastes space beyond it.
5. **Pane height ratios in the right column.** Default: 1/3 each for Connectors / Watchers / SubTasks. Tunable constant. Sub-task pane may need more when active; deferred to real-usage tuning.
6. **Reconnect backoff schedule.** 2s → 4s → 8s → 16s → 30s is a starting point. Tune if manual smoke reveals annoyance on brief gateway hiccups.
7. **`ink-text-input` vs. inline replacement.** If dependency is flagged by `bun audit` during implementation, swap for the 40-line inline version. Not a spec-level decision.
8. **HITL outcome line wording.** `✓ approved all` / `✗ rejected all` / `✓ approved N, ✗ rejected M` are reasonable; can be tightened after manual smoke.
9. **Progress-bar glyphs.** `[====-]` (5-char fill) vs. Unicode `▰▱▰▰▰`. Both work; pick during TDD for best cross-terminal rendering.

---

## 12. Handoff

This spec is the authoritative input to the WS6 implementation plan. Next step: invoke `superpowers:writing-plans` to turn this into a task-by-task TDD plan at `docs/superpowers/plans/2026-04-23-ws6-rich-tui.md`.

**Sequence relative to other v0.1.0 work:**

- Phase-1 signing pipeline plan (`docs/superpowers/plans/2026-04-23-signing-pipeline.md`) is independent — WS6 does not block on it, and vice versa. Both can execute in parallel if desired, though solo-dev sequencing is recommended per `finish-plan §3` parallelism rules.
- WS7 (VS Code extension) follows WS6 per `finish-plan §3`. The Phase 3.5 `@nimbus-dev/client` surface that WS7 consumes is also consumed by `packages/cli/src/ipc-client/index.ts` — shaking out any client issues via WS6 work de-risks WS7.
- Voice 3-platform verification (`finish-plan §4.5`) runs after WS6 lands, not before — voice paths surface through the TUI's HITL overlay too (voice-triggered consent is a v0.1.1 concern but the overlay plumbing must not regress).

---

## 13. Review Responses (Gemini CLI review, 2026-04-23)

Reviewer feedback from `docs/superpowers/specs/2026-04-23-ws6-rich-tui-review.md`. Each point is classified as **fixed inline** (with a pointer to the section that changed), **already addressed** (reinforced by review, no new change), or **pushed back** (with reasoning). The design above was revised to absorb every accepted fix before writing the implementation plan.

### Fixed inline

- **1.1 (`engine.cancelStream` missing).** Verified via grep of `packages/gateway/src/ipc/server.ts` — `streamId` is generated but no cancel handler exists. §5.2 rewritten to document the v0.1.0 local-only cancel behavior explicitly, including the background-token-consumption caveat the reviewer flagged. §11 Open Item 1 upgraded from "confirm existence" to a concrete post-v0.1.0 follow-up that mirrors the existing `AbortController` pattern in `packages/gateway/src/ipc/llm-rpc.ts:17`. Help output and manual smoke (§8.5 step 8) surface the caveat to users.

- **1.2 (SubTaskPane startup state).** §3.4 SubTaskPane row now states explicitly: "Starts empty on every TUI launch — does NOT hydrate from the `sub_task_results` table. Session-resume-lite is explicitly out of scope per §2.2." Reviewer's suggested simplification adopted.

- **1.3 (terminal height constraints).** §3.3 gains a `MIN_HEIGHT_THRESHOLD = 20` short-terminal fallback. §3.1 step 4 lists it as a launch-time trigger; §3.3 "Runtime resize" paragraph handles downward crossings mid-session (Ink unmounts with a one-line notice rather than attempting a further-collapsed layout). §4.1 constants file adds the new constant. §8.3 `dumb-terminal.test.ts` adds a row-based fallback test. §8.5 manual smoke step 7 verifies runtime behavior.

- **2.1 (visual feedback for double-Ctrl+C).** §5.2 adds the `^C Press again within 2s to exit` hint, rendered into the live buffer, auto-clearing after 1.5 s and flushing into `<Static>` on timeout or on next token. `awaiting-hitl` and `disconnected` intentionally suppress the hint (HITL abort is deliberate; disconnected has nothing to preserve). §8.3 `QueryInput.test.tsx` adds explicit coverage.

- **2.2 (TUI logging strategy).** §3.2 new paragraph "Logging discipline (critical)" mandates `createCliFileLogger(paths)` as the single sink (reusing the existing helper at `packages/cli/src/lib/cli-logger.ts`), a `process.stderr.write = noop` safety net during Ink render, and the project-wide `no-console` Biome rule. §3.1 step 5 wires the logger into the launch sequence. §8.5 step 1 adds a no-stdout-corruption check to manual smoke.

- **2.3 (extended dumb-terminal triggers — `CI=true`).** §3.1 step 4 adds `process.env.CI === "true"` as a fallback trigger. §8.3 `dumb-terminal.test.ts` covers it.

- **2.4 (signal handling — SIGTERM).** §3.1 step 8 now installs SIGINT + SIGTERM + `process.on("exit")` handlers that run a single idempotent cleanup (IPC disconnect, Ink unmount, logger flush). §5.5 rewritten around this unified lifecycle. §8.5 step 9 verifies both signals in manual smoke.

- **2.5 (query input wrapping).** §3.4 QueryInput row pins behavior to single-line horizontal scroll. Rationale (layout stability in short terminals) recorded in the row. §8.3 `QueryInput.test.tsx` adds a 200-char-in-80-col test. §8.5 step 10 adds a paste-safety verification.

- **3.1 (`ink-text-input` history edge cases).** §8.3 `QueryInput.test.tsx` now explicitly lists boundary cases: Up at top of history holds oldest; Down at bottom returns to empty draft and stops; cycling does not mutate the file.

- **4.2 (paste test in manual smoke).** §8.5 step 10 added.

### Already addressed in the original spec (reviewer reinforced, no new change)

- **3.2 (notification batching for high-velocity streams).** §10 Risks already documents the `requestAnimationFrame`-equivalent batching approach with "add only if the 20-second smoke shows stutter" trigger. Reviewer's 16 ms (60 fps) debounce concurs with what's there.

- **4.1 (CLAUDE.md / GEMINI.md updates).** §4.2 already lists both files for modification including `test:coverage:tui`. Reviewer's reinforcement accepted, no new edit needed.

### Pushed back — none

All reviewer points were either accepted as-is or matched what the spec already said. No pushback on this round.

### Meta

The review caught two real design gaps (terminal height, TUI logging discipline) and several meaningful hardening nudges (signal handling, CI=true trigger, paste safety, history boundary tests, cancel-hint visual feedback). The `engine.cancelStream` verification is load-bearing — confirming absence before drafting the plan prevents the plan from committing to a behavior we can't honor. Net: +75 lines of spec, significantly tighter v0.1.0 contract. Worth the read.
