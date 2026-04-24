# WS7 — VS Code Extension — Design Spec (v0.1.0, Phase 4)

**Date:** 2026-04-24
**Authoritative source:** `docs/release/v0.1.0-finish-plan.md §4.4` + the WS7 section of the `nimbus-phase-4` skill. This spec folds those two sources into a single implementation-ready design and resolves eight scope questions raised during brainstorming.
**Phase placement:** Workstream 7 of Phase 4 (Presence). Sequentially after WS6 (Rich TUI, shipped) per the P2-track sequencing in the finish plan. WS7 is the last new-surface workstream before the v0.1.0 release-gate execution.
**Prior art:** WS5-A/B/C/D (Tauri UI) defined the gateway-offline UX, HITL dialog mental model, and IPC allowlist conventions this spec mirrors in an editor-extension surface. WS6 (Rich TUI) validated `engine.askStream` + `agent.subTaskProgress` + `agent.hitlBatch` end-to-end against a real Gateway — WS7 consumes the same surfaces.

---

## 1. Purpose & Motivation

Nimbus has a Tauri desktop UI (full-window experience) and a Rich TUI (split-pane terminal). It lacks an **in-editor surface** — the thing a developer keeps open in VS Code or Cursor while writing code, so they can ask questions about the file under the cursor, search the local index without leaving the editor, run workflows on the codebase they're staring at, and consent to HITL batches without alt-tabbing.

The goal is to be the editor-native interface to the same Gateway the CLI/TUI/Tauri UI already use. **The extension never imports Gateway source.** All behavior comes through `@nimbus-dev/client` (MIT) over JSON-RPC IPC, which means:

- The extension is a thin presentation layer; the architectural non-negotiables (HITL gate, Vault, MCP-only connectors) live behind the IPC boundary as before.
- The extension's published surface area on Open VSX / VS Code Marketplace is editor-quality polish and ergonomics, not new agent capability.
- Any future editor (JetBrains, Zed, Neovim plugin) can adopt the same `@nimbus-dev/client` surface and inherit feature parity.

The extension also **drives the long-overdue Node-compat refactor of `@nimbus-dev/client`**, which today uses `Bun.connect` for Unix sockets and is therefore unusable in any non-Bun runtime. The refactor unblocks not just WS7 but every future Node consumer (CI scripts, GitHub Actions, third-party editor extensions).

---

## 2. Scope

### 2.1 In scope

1. **New package `packages/vscode-extension/`** (MIT — matches `@nimbus-dev/client`, distinct from the AGPL Gateway and CLI). Built with esbuild, packaged with `vsce`, dual-published to VS Code Marketplace + Open VSX on `vscode-v*` git tags.
2. **`@nimbus-dev/client` v0.2.0 refactor** — dual-runtime IPC transport (Bun + Node), socket discovery moved into the package, new typed streaming API `NimbusClient.askStream()`, new `subscribeHitl()` helper, paths helper.
3. **One new Gateway IPC method:** `engine.getSessionTranscript({ sessionId, limit? })` — backs the chat-Webview rehydration path. No new table or migration; queries existing `audit_log`.
4. **One newly-exposed Gateway IPC method:** `engine.cancelStream({ streamId })` — already a partial primitive in the engine; promoted to a documented IPC method so `askStream().cancel()` and the chat panel's Stop button can use it.
5. **Three palette commands per finish-plan §4.4:** `Nimbus: Ask`, `Nimbus: Search`, `Nimbus: Run Workflow`.
6. **Two editor-context commands** (scope expansion over §4.4, accepted in brainstorming Q6): `Nimbus: Ask About Selection`, `Nimbus: Search Selection` — appear in the editor right-click menu when there is a selection.
7. **Two admin commands:** `Nimbus: Start Gateway` (always available; spawns `nimbus start` and waits for the socket) and `Nimbus: New Conversation` (cancels active stream, resets `sessionId`, clears Webview).
8. **Persistent chat Webview** — single panel, reused across Asks, theme-synced via VS Code CSS variables, transcripts rehydrated from the Gateway on workbench reload via `engine.getSessionTranscript`.
9. **Eager activation** (`onStartupFinished`) so the status bar is always visible.
10. **Status bar item** with combined state: profile name, connector-degradation count, HITL pending count. 30 s `connector.list` poll. Click action depends on most-urgent state.
11. **Context-sensitive HITL routing** — inline card in the chat Webview when the panel is visible+focused; modal `window.showInformationMessage({ modal: true })` otherwise. Status-bar count badge always reflects pending requests regardless of surface.
12. **Theme syncing** — chat Webview uses `--vscode-*` CSS variables; verified across Dark, Light, High Contrast, High Contrast Light.
13. **Node-compat test** for `@nimbus-dev/client` — `packages/client/test/node-compat.test.ts`, runs under `node --test` on all 3 OSes in CI.
14. **Coverage gate** ≥ 80 % lines / ≥ 75 % branches on `packages/vscode-extension/src/`, wired into `_test-suite.yml`.
15. **Manual smoke** in `docs/manual-smoke-ws7.md` covering 3 OSes × VS Code + 1 OS × Cursor.
16. **`publish-vscode.yml` GitHub workflow** — dual-publish to VS Code Marketplace (via `vsce`) and Open VSX (via `ovsx`); release-environment-gated; uploads `.vsix` to the GitHub Release.

### 2.2 Out of scope — deferred

- **Inline completions / Copilot-style ghost text.** Phase 5+; not the WS7 mandate.
- **Tree views** for connectors, watchers, workflows. Quick Pick + palette only for v0.1.0; tree views land if user feedback demands them.
- **"Save to Markdown note" button inside the Webview.** Finish-plan §8.4 documents it as a follow-up to the Webview-decision; explicitly post-v0.1.0.
- **Auto-installation of the Nimbus Gateway from within the extension.** User installs Nimbus via the headless installers (WS4); the extension only spawns `nimbus start` when permitted, never installs.
- **`@vscode/extension-telemetry` integration.** No telemetry from the extension. The Gateway's existing opt-in telemetry collector is the only data path.
- **SCM-aware behavior** (auto-include git diff, branch context, etc.). Out for v0.1.0; selection context covers the editor case.
- **Cursor-specific code paths.** Cursor is `vscode.*`-API-compatible; smoke-tested via Open VSX install. Anything Cursor-specific is a follow-up.
- **Status-bar Quick Pick for one-line Ask** (Q6 option C). Cmd+Shift+P → Nimbus: Ask is already two keystrokes; revisit if telemetry shows demand.

### 2.3 Non-goals (architectural)

- The extension does not bypass the HITL gate. Every consent surface (inline card, modal, multi-action diff Webview, status-bar Quick Pick) ultimately calls `consent.respond` exactly once per `requestId`.
- The extension does not store user content. No transcripts in `workspaceState`/`globalState`. The Gateway is the source of truth (machine-of-record principle, CLAUDE.md non-negotiable #1).
- The extension does not import Gateway source. IPC-only, per the package dependency rules.
- The extension does not log prompt or response content. The output channel records connection events, routing decisions, and errors — never message bodies.

---

## 3. Architecture

### 3.1 Layer diagram

```
                     ┌─────────────────────────────────────────────┐
                     │              VS Code / Cursor                │
                     │  ┌───────────────────────────────────────┐  │
                     │  │   Nimbus extension (Node, this PR)    │  │
                     │  │ ┌─────────────┐  ┌─────────────────┐  │  │
                     │  │ │ status bar  │  │  chat Webview   │  │  │
                     │  │ │ (always on) │  │  (persistent)   │  │  │
                     │  │ └─────────────┘  └─────────────────┘  │  │
                     │  │ ┌─────────────┐  ┌─────────────────┐  │  │
                     │  │ │ HITL router │  │ command palette │  │  │
                     │  │ └─────────────┘  └─────────────────┘  │  │
                     │  └──────────────────┬────────────────────┘  │
                     │                     │ imports                │
                     │                     ▼                        │
                     │  ┌───────────────────────────────────────┐  │
                     │  │  @nimbus-dev/client (refactored here) │  │
                     │  │  • dual-runtime transport (Bun/Node)  │  │
                     │  │  • NimbusClient.askStream()           │  │
                     │  │  • socket discovery (gateway.json)    │  │
                     │  │  • paths helper                       │  │
                     │  └──────────────────┬────────────────────┘  │
                     └─────────────────────┼────────────────────────┘
                                           │ JSON-RPC 2.0 over
                                           │ Unix socket / Named pipe
                                           ▼
                     ┌───────────────────────────────────────────────┐
                     │                   Gateway                     │
                     │  existing IPC surface +                       │
                     │  NEW: engine.getSessionTranscript(sessionId)  │
                     │  PROMOTED: engine.cancelStream(streamId)      │
                     └───────────────────────────────────────────────┘
```

### 3.2 Package boundaries

- `packages/vscode-extension/` — depends on `vscode` (peer, supplied by host) and `@nimbus-dev/client` (workspace dep). Bundled by esbuild; `vscode` marked external, everything else inlined.
- `packages/client/` — depends on `@nimbus-dev/sdk` (workspace dep, for shared types). Adds no runtime dependencies as part of WS7. Drops all `Bun.*` API usage in favor of `node:*` equivalents that work in both runtimes.
- `packages/gateway/` — adds two IPC handlers; touches `server.ts` to register them. Touches `audit_log` query layer (read-only for `getSessionTranscript`).
- `packages/ui/src-tauri/` — `gateway_bridge.rs` allowlist gains the two new methods so the Tauri UI can use them later (cheap, future-proof).

The CLI gets a small follow-up refactor to consume the moved `paths` and `discovery` helpers from `@nimbus-dev/client`. This is a non-blocking cleanup; both implementations can coexist during the transition.

### 3.3 Runtime model

**Activation.** `onStartupFinished` fires ~3 s after VS Code launches. `extension.ts:activate()` wires up:

1. `OutputChannel` ("Nimbus") via `vscode.window.createOutputChannel`.
2. `Settings` accessor (typed reads of `nimbus.*`).
3. `ConnectionManager` — owns the `NimbusClient` instance, attempts initial connect, runs reconnect loop on disconnect.
4. `StatusBarItem` — subscribes to `ConnectionManager` state and `HitlRouter` count; polls `connector.list` every `nimbus.statusBarPollMs` (default 30 s).
5. `HitlRouter` — subscribes to `agent.hitlBatch` via `client.subscribeHitl()`.
6. `ChatPanel` registry — lazy-created on first `nimbus.ask`; survives panel-hide via `retainContextWhenHidden: true`.
7. Command registrations (7 commands; see §6.1).

**Deactivation.** `extension.ts:deactivate()` disposes the panel, closes the client, cancels reconnect timers, disposes the status bar.

**State propagation.** `ConnectionManager` is an `EventEmitter`-style hub; `StatusBarItem`, `HitlRouter`, and `ChatController` subscribe. Single state owner avoids inconsistent UIs. `HitlRouter` exposes `subscribe(listener)` for the status bar's count badge.

### 3.4 Bundle layout

Two esbuild bundles, both produced by `bun run build`:

- `dist/extension.js` — Node CJS, target `node18`, `vscode` external, `@nimbus-dev/client` and its deps inlined. The extension host loads this.
- `media/webview.js` — IIFE, browser target, zero externals (the Webview's iframe is sandboxed; nothing is auto-injected). Bundles `marked` plus the chat-controller's browser-side counterpart.
- `media/webview.css` — bundled CSS using `--vscode-*` variables; loaded via `<link>` in the Webview HTML.

The `.vsix` (produced by `vsce package`) ships only `dist/`, `media/`, `package.json`, `README.md`, `CHANGELOG.md`, `LICENSE`, `icon.png`. `.vscodeignore` excludes everything else, including the entire `src/` and `test/` trees.

---

## 4. `@nimbus-dev/client` v0.2.0 refactor

### 4.1 Transport refactor

`packages/client/src/ipc-transport.ts` gets a runtime-detected dispatch for the Unix path. The Windows named-pipe path already uses `net.createConnection` and is unchanged.

```ts
const HAS_BUN = typeof globalThis.Bun !== "undefined";

private async connectUnix(): Promise<void> {
  if (HAS_BUN) {
    await this.connectUnixBun();    // existing Bun.connect — renamed
    return;
  }
  await this.connectUnixNode();      // NEW: net.createConnection({ path })
}
```

`connectUnixNode` is structurally identical to the existing `connectWindows` (`net.Socket` + `data` / `close` / `error` handlers); the two get factored into a shared `attachNetSocket(sock, resolve, reject)` helper. The `disconnect()` and `rawWrite()` paths already check `netSocket !== null` first, so the Node code path drops in cleanly. The Bun path stays untouched — zero behavior change for the existing CLI/TUI consumers running under Bun.

**Breaking-change risk:** zero. The protocol on the wire is identical, the public API is identical, and the runtime detection is one branch at module load time. Existing consumers see no diff.

### 4.2 New `askStream` API

```ts
export type StreamEvent =
  | { type: "token"; text: string }
  | { type: "subTaskProgress"; subTaskId: string; status: string; progress?: number }
  | { type: "hitlBatch"; requestId: string; prompt: string; details?: unknown }
  | { type: "done"; reply: string; sessionId: string }
  | { type: "error"; code: string; message: string };

export type AskStreamOptions = {
  sessionId?: string;
  agent?: string;
  signal?: AbortSignal;
};

export type AskStreamHandle = AsyncIterable<StreamEvent> & {
  readonly streamId: string;
  cancel(): Promise<void>;
};

class NimbusClient {
  askStream(input: string, opts?: AskStreamOptions): AskStreamHandle { /* ... */ }
}
```

**Mechanics.** `askStream` calls `engine.askStream` (request) → `{ streamId }`. It registers `onNotification` handlers for `engine.streamToken`, `engine.streamDone`, `engine.streamError`, `agent.subTaskProgress`, and `agent.hitlBatch`, filtering each by `streamId`. Filtered events go into a bounded queue (default 1024) feeding the async iterator. The iterator terminates on `done` or `error`; `cancel()` and `signal.abort()` both fire `engine.cancelStream({ streamId })` and unregister handlers. Handler cleanup runs in `finally` so a thrown consumer cannot leak listeners. `client.askStream` may be called multiple times concurrently; each gets its own `streamId` and its own handler set.

**Why a single iterator carries `hitlBatch` and `subTaskProgress`:** the Webview message pump in the extension is one-pipe (`webview.postMessage`); folding all stream-related events through one iterator reduces the extension to a `for await { switch (ev.type) }` loop. Background HITL events (workflow runs, watcher fires) — which aren't tied to a stream — flow through a separate `client.subscribeHitl(handler)` subscription on `NimbusClient` so the extension can route them to the modal path even when no stream is active.

### 4.3 `subscribeHitl` helper

```ts
class NimbusClient {
  subscribeHitl(handler: (req: HitlRequest) => void): { dispose(): void };
}
```

Registers an `onNotification("agent.hitlBatch", ...)` handler that delivers every batch — stream-tagged or not. The HitlRouter in the extension uses this; it deduplicates against the per-stream `hitlBatch` events the chat controller already sees, so a batch produced by an active stream is not double-handled.

### 4.4 Socket discovery

Two new files in `packages/client/src/`:

- **`paths.ts`** — `getNimbusPaths()` returns `{ configDir, dataDir, logDir, socketPath, extensionsDir }` per platform (Windows / macOS / Linux). Pure `node:os` + `node:path` + `process.env`. Drops the `Bun.env` usage of the CLI's copy. Honors `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_RUNTIME_DIR` on Linux; `APPDATA`, `LOCALAPPDATA` on Windows; `~/Library/Application Support/Nimbus` on macOS.
- **`discovery.ts`** — `readGatewayState(paths)` reads `paths.dataDir/gateway.json` via `node:fs.promises.readFile` + `JSON.parse` (no `Bun.file`). `discoverSocketPath(opts?: { override?: string }): Promise<{ socketPath, source: "override" | "stateFile" | "default", pid?: number }>` resolves precedence: explicit override → state-file value → platform default.

Both re-exported from `packages/client/src/index.ts`. The CLI's existing copies are not deleted in WS7; a follow-up consolidation issue migrates the CLI to consume from `@nimbus-dev/client`.

### 4.5 New IPC methods consumed

| Method | Role |
|---|---|
| `engine.getSessionTranscript({ sessionId, limit? })` | Webview rehydration on reload |
| `engine.cancelStream({ streamId })` | `askStream().cancel()` and Stop button |

Both added to the Tauri allowlist (`gateway_bridge.rs`); allowlist size becomes ~51 (verify exactly during impl). Both surface to `NimbusClient` as typed methods (`getSessionTranscript`, `cancelStream`). `cancelStream` is also called internally from the `askStream` iterator's cleanup path.

### 4.6 Node-compat test

`packages/client/test/node-compat.test.ts` runs under `node --test`, not `bun test`. Spawns a real Gateway subprocess (matching the fixture pattern in `packages/gateway/src/ipc/ipc.test.ts`) and exercises:

1. `NimbusClient.open()` succeeds on Unix socket / named pipe per platform.
2. `agentInvoke()` round-trips one turn against the real engine.
3. `askStream()` yields ≥ 1 token + a `done` event for a known-stable canned prompt.
4. `subscribeHitl()` delivers a synthetic `agent.hitlBatch`.
5. `cancel()` mid-stream terminates the iterator cleanly and produces an `engine.cancelStream` server-side audit event.
6. `disconnect()` closes the socket without leaking handles.

CI wiring: three new jobs in `.github/workflows/_test-suite.yml` — `client-node-compat-{ubuntu,macos,windows}` — each running `cd packages/client && node --test test/node-compat.test.ts`. This is the gate for the finish-plan acceptance criterion ("`@nimbus-dev/client` node-compat test passes on all three OSes under `node`, not just `bun`").

### 4.7 Test coverage

- Unit (under `bun test`, lives in `packages/client/test/`):
  - `ask-stream.test.ts` — iterator yields events in order; filter by streamId; cancel terminates; errors close iterator; bounded queue back-pressure.
  - `discovery.test.ts` — precedence (override > stateFile > default); missing/malformed state file falls through.
  - `paths.test.ts` — each platform branch (mocked `process.platform` + env).
- Integration: the node-compat test (above).
- The existing `mock-client.test.ts` is updated to surface `askStream` as well so MockClient can be used by Webview message-pump unit tests.

---

## 5. Gateway changes

### 5.1 `engine.getSessionTranscript`

```ts
type Params = { sessionId: string; limit?: number /* default 100, max 500 */ };
type Result = {
  sessionId: string;
  turns: Array<{
    role: "user" | "assistant";
    text: string;
    timestamp: number;
    auditLogId?: number;
  }>;
  hasMore: boolean;
};
```

Backed by a `SELECT` against the existing `audit_log` table filtered by `session_id`. No new table, no migration. `text` is reconstructed from the stored prompt/response text where available (audit_log already records these for `engine.askStream` exchanges per WS3); turns where text is unavailable are returned as `[redacted]` so the Webview always renders contiguous history.

`limit` is clamped server-side to `[1, 500]`. `hasMore` is `true` when more rows exist beyond the limit, allowing pagination from the Webview if needed (not implemented in v0.1.0; the default 100 turns covers far more than any chat session reasonably contains).

### 5.2 `engine.cancelStream`

Promotes an existing internal primitive. Params `{ streamId: string }`; idempotent (cancelling an unknown or already-finished stream returns `ok: true` without error). Audit-logs as `engine.streamCancelled` for traceability. Handler lives in `engine-cancel-stream.ts`; tests cover (a) cancellation of an active stream halts further token notifications, (b) cancellation of an unknown stream is a no-op success, (c) cancellation during a HITL pause wakes the await and resolves with cancelled status.

### 5.3 Tauri allowlist update

`packages/ui/src-tauri/src/gateway_bridge.rs`:

- Add `"engine.cancelStream"` and `"engine.getSessionTranscript"` to `ALLOWED_METHODS` (alphabetized).
- Update the `allowlist_exact_size` test to expect the new size (~51; verify during impl).
- These are not added to the LAN-forbidden list; both are read-side or stream-control, not write-side.

---

## 6. Extension package details

### 6.1 Commands

| Command ID | Title | Trigger | Behavior |
|---|---|---|---|
| `nimbus.ask` | Ask | palette, status-bar click (when healthy) | Reveal/create chat panel, focus input. If panel already has an active stream, blocked with toast: *"Stream in progress; click Stop or wait for it to finish."* |
| `nimbus.askAboutSelection` | Ask About Selection | editor right-click (`when: editorHasSelection`) | Same as `ask`, pre-fills input with `Context:\n\`\`\`<langId>\n<selection>\n\`\`\`\n\nQuestion: ` and places caret after `Question: `. Lang fence comes from `editor.document.languageId`. |
| `nimbus.search` | Search | palette | `vscode.window.showInputBox` for query → `index.queryItems({ query, limit: 50 })` → Quick Pick list (`title — service · type · sinceHuman`). Selecting an item with a URL runs `vscode.env.openExternal`; without a URL, opens a small read-only Webview showing the item's structured fields. |
| `nimbus.searchSelection` | Search Selection | editor right-click | As above with selection text pre-filled (no input box step). |
| `nimbus.runWorkflow` | Run Workflow | palette | Quick Pick over `workflow.list` → `workflow.run({ name })`. Streams `agent.subTaskProgress` into the "Nimbus" output channel. HITL batches go through the standard router. |
| `nimbus.newConversation` | New Conversation | palette | Cancels active stream if any (via `cancelStream`); resets `sessionId` to undefined; clears Webview transcript with a `{type:"reset"}` postMessage. |
| `nimbus.startGateway` | Start Gateway | palette | Always callable. Calls `AutoStarter.spawn()` and waits up to 10 s for the socket. Success → status bar flips green + toast confirms. Failure (binary not on PATH, spawn error, socket never appears) → error notification with "Open Logs" button that focuses the output channel. |

### 6.2 Settings (full schema)

| Key | Type | Default | Notes |
|---|---|---|---|
| `nimbus.socketPath` | string | `""` | Empty = auto-detect via `discoverSocketPath()`. Set to override (rare; air-gapped or non-standard installs). |
| `nimbus.autoStartGateway` | boolean | `false` | When true, Ask/Search/RunWorkflow first try to connect; if the socket isn't there, spawn `nimbus start` and retry once with a 5 s timeout. |
| `nimbus.statusBarPollMs` | number | `30000` | Connector-list poll cadence. Min 5 000 to defend against accidental DoS via misconfig. |
| `nimbus.transcriptHistoryLimit` | number | `50` | How many turns to rehydrate from `engine.getSessionTranscript` on Webview reload. Min 1, max 500 (matches server clamp). |
| `nimbus.askAgent` | string | `""` | Optional default agent name passed to `askStream({ agent })`. Blank = Gateway default. |
| `nimbus.logLevel` | enum `"error" \| "warn" \| "info" \| "debug"` | `"info"` | Output-channel verbosity. Stream-level errors always log at `error` regardless. |

No telemetry setting (none is sent). No auto-update setting (VS Code handles extension updates).

### 6.3 Status bar states

One status-bar item, left-aligned, priority `100`. Renders by precedence:

| State | Text | Background color | Click action |
|---|---|---|---|
| Connecting (initial) | `Nimbus: $(sync~spin) connecting…` | normal | no-op |
| Disconnected, autostart off | `Nimbus: $(circle-slash) Gateway not running` | warning | `nimbus.startGateway` |
| Disconnected, autostart on, retrying | `Nimbus: $(sync~spin) starting Gateway…` | normal | no-op |
| Connected, healthy | `Nimbus: $(circle-large-filled) <profile>` | normal | `nimbus.ask` |
| Connected, degraded connector(s) | `Nimbus: $(warning) <profile> · <n> degraded` | warning | `nimbus.ask` |
| Connected, HITL pending | `Nimbus: $(bell-dot) <profile> · <n> pending` | warning | opens HITL Quick Pick over pending requests |
| Connected, both degraded + HITL | merged: `Nimbus: $(bell-dot) <profile> · <n> degraded · <n> pending` | warning | HITL Quick Pick wins (more urgent) |

All icons are VS Code built-in codicons; no custom font.

### 6.4 Chat Webview UX

**Layout.** Single panel, opened to the side of the editor by default (`ViewColumn.Beside`). User can move it to a split or main column via the standard panel controls. `retainContextWhenHidden: true` keeps the in-memory transcript across panel-hide events.

**Markdown rendering.** `marked` library (~16 KB, MIT) bundled into `media/webview.js`. Streaming render = re-parse the running token buffer on every `requestAnimationFrame`. Code blocks render with a copy button (top-right; `navigator.clipboard.writeText`) and language label.

**Theme syncing.** Root element styles use `var(--vscode-editor-foreground)`, `var(--vscode-editor-background)`, `var(--vscode-textLink-foreground)`, `var(--vscode-textBlockQuote-border)`, etc. No JS theme detection — VS Code updates CSS variables when the theme changes. Verified across Dark, Light, High Contrast, High Contrast Light.

**HITL inline card.** Renders as a card after the in-progress assistant message. Diff actions render as pre-formatted text in a `<pre>` block with `+ ` / `- ` prefix lines colored via `--vscode-diffEditor-{insertedText,removedText}Background`. Approve / Reject buttons; both disabled while the response is in flight.

**Stop button.** Appears in the input area while a stream is active; click → `client.askStream(...).cancel()`.

**Reload safety.** On Webview re-creation after a `Developer: Reload Window`, the Webview posts `{type:"requestRehydrate", sessionId}` to the extension. The extension calls `engine.getSessionTranscript({ sessionId, limit: nimbus.transcriptHistoryLimit })` and posts `{type:"hydrate", turns}` back. Webview repaints in turn order.

### 6.5 HITL routing decision tree

```
                 ┌─────────────────────────────────┐
                 │  agent.hitlBatch notification   │
                 │  arrives at HitlRouter          │
                 └───────────────┬─────────────────┘
                                 ▼
                  ┌─────────────────────────────┐
                  │  Was this batch's requestId │
                  │  spawned by an active       │
                  │  ChatController stream?     │
                  └───────┬─────────────┬───────┘
                          │ yes         │ no
                          ▼             ▼
              ┌───────────────────┐  ┌──────────────────────┐
              │ chatPanel.visible │  │ Background:          │
              │ && .active?       │  │ workflow / watcher / │
              └───┬───────────┬───┘  │ scheduled task       │
                  │ yes       │ no   └──────────┬───────────┘
                  ▼           ▼                 ▼
        ┌────────────────┐  ┌────────────────────────────┐
        │ INLINE in chat │  │ MODAL info-message          │
        │ (Approve/      │  │ (Approve / Reject)          │
        │  Reject card,  │  │ Multi-action → side Webview │
        │  blocks stream)│  │ diff panel                  │
        └───────┬────────┘  └──────────┬─────────────────┘
                └──────────┬───────────┘
                           ▼
                ┌────────────────────────┐
                │ ALWAYS:                │
                │ statusBar.bumpHitl(+1) │
                │ on response/dismiss:   │
                │ statusBar.bumpHitl(-1) │
                └──────────┬─────────────┘
                           ▼
                ┌────────────────────────┐
                │ consent.respond({      │
                │   requestId,           │
                │   decisions: [...]     │
                │ }) — exactly once      │
                └────────────────────────┘
```

**Bookkeeping.** `ChatController` registers its `streamId` with `HitlRouter` on stream start and unregisters on stream end. `HitlRouter` keeps a `Map<streamId, ChatController>` so it can route per-stream batches inline; everything else routes modal.

**Debounce invariant.** Exactly one `consent.respond` per `requestId`. If both the inline card and the modal somehow co-render (panel becomes hidden mid-prompt and a modal then appears), the first response wins; the other surface is silently dismissed when the request resolves on the Gateway side.

**Background HITL surface.** Status-bar click on `Nimbus: ⚠ N pending` opens a Quick Pick of pending requests. Each entry opens its modal. No new IPC; just `HitlRouter.snapshot()`.

### 6.6 Streaming flow (happy path)

```
User runs nimbus.ask
  → ChatPanel.revealOrCreate()
  → ChatController.start(input, sessionId)
    → client.askStream(input, { sessionId })
      → engine.askStream (RPC) → { streamId }
      → registers handlers for engine.streamToken/Done/Error
                            and agent.subTaskProgress/hitlBatch
      → returns AskStreamHandle (AsyncIterable)
    → for await (const ev of handle) {
        switch (ev.type) {
          "token"           → webview.postMessage({type:"token", text})
          "subTaskProgress" → webview.postMessage({type:"subTask", ...})
          "hitlBatch"       → HitlRouter.handle(ev) (routes inline/modal)
          "done"            → webview.postMessage({type:"done", reply, sessionId})
                              ChatController.sessionId = sessionId
                              break
          "error"           → webview.postMessage({type:"error", message})
                              break
        }
      }
```

### 6.7 Cancellation + disconnection edge cases

| Trigger | ChatController | HitlRouter | Status bar |
|---|---|---|---|
| User clicks Stop in chat | `handle.cancel()` → `engine.cancelStream` | unchanged | unchanged |
| `ConnectionManager` loses socket mid-stream | iterator throws; renders error card; nulls handle | drops in-flight modals (request becomes stale on reconnect; Gateway will retry on next ask) | flips to `⊘ Gateway not running` |
| User reloads window (Webview destroyed) | extension disposes controller; on rehydrate calls `engine.getSessionTranscript(sessionId)` to repaint | clears in-flight inline cards (modal stays up if the user hadn't responded) | rehydrates from `connector.list` poll |
| `Nimbus: New Conversation` | sends `engine.cancelStream` if active; resets `sessionId`; clears Webview | cancels any inline cards tied to the old `sessionId`; modals untouched | unchanged |

### 6.8 The `vscode-shim.ts` testability boundary

Anything testable without spinning up the extension host accepts its `vscode` dependencies via constructor injection — narrow interfaces (`StatusBarItemHandle`, `WindowApi`, `WorkspaceApi`, `OutputChannelHandle`) defined in `src/vscode-shim.ts`. The real `vscode` adapters live in `extension.ts` only. This makes Vitest unit tests run in milliseconds, removes the need for `@vscode/test-electron` for ~80% of coverage, and produces a clean source-vs-host separation.

```ts
// src/vscode-shim.ts (excerpt)
export interface StatusBarItemHandle {
  text: string;
  tooltip: string | undefined;
  backgroundColor: ThemeColor | undefined;
  command: string | undefined;
  show(): void;
  hide(): void;
  dispose(): void;
}
export interface WindowApi {
  showInformationMessage<T extends string>(
    msg: string,
    opts: { modal?: boolean },
    ...items: T[]
  ): Thenable<T | undefined>;
  showErrorMessage(msg: string, ...items: string[]): Thenable<string | undefined>;
  createOutputChannel(name: string): OutputChannelHandle;
  // …
}
```

---

## 7. Package layout

```
packages/vscode-extension/
├── package.json                    # extension manifest (publisher, contributes, activationEvents)
├── tsconfig.json
├── biome.json                      # extends repo root
├── vitest.config.ts                # vitest unit tests (matches packages/ui)
├── README.md                       # marketplace listing copy
├── CHANGELOG.md                    # required by vsce; seed v0.1.0 entry
├── LICENSE                         # MIT
├── .vscodeignore                   # excludes test/, src/, *.test.ts from the .vsix
├── icon.png                        # 128×128 marketplace icon
├── src/
│   ├── extension.ts                # activate() / deactivate(); minimal — wires modules
│   ├── vscode-shim.ts              # narrow interfaces for testability (§6.8)
│   ├── connection/
│   │   ├── connection-manager.ts   # owns NimbusClient lifecycle + reconnect (3 s)
│   │   └── auto-start.ts           # spawn `nimbus start` (gated by setting + manual command)
│   ├── status-bar/
│   │   └── status-bar-item.ts      # state-table-driven (§6.3)
│   ├── chat/
│   │   ├── chat-panel.ts           # WebviewPanel singleton; retainContextWhenHidden
│   │   ├── chat-protocol.ts        # typed messages over webview.postMessage
│   │   ├── chat-controller.ts      # askStream → postMessage; HITL inline render
│   │   └── webview/                # bundled by esbuild into media/webview.js
│   │       ├── main.ts             # message pump; transcript renderer; theme listener
│   │       ├── markdown.ts         # streaming markdown renderer (uses `marked`)
│   │       ├── hitl-card.ts        # inline HITL card component
│   │       └── styles.css          # uses --vscode-* CSS variables
│   ├── commands/
│   │   ├── ask.ts                  # nimbus.ask + nimbus.askAboutSelection
│   │   ├── search.ts               # nimbus.search + nimbus.searchSelection
│   │   ├── run-workflow.ts         # nimbus.runWorkflow (Quick Pick)
│   │   ├── new-conversation.ts     # nimbus.newConversation
│   │   └── start-gateway.ts        # nimbus.startGateway
│   ├── hitl/
│   │   ├── hitl-router.ts          # context-sensitive routing (§6.5)
│   │   └── hitl-modal.ts           # modal info-message wrapper
│   ├── settings.ts                 # typed accessors for nimbus.* settings
│   └── logging.ts                  # OutputChannel adapter
├── media/                          # built artifacts go here (webview.js, webview.css)
└── test/
    ├── unit/                       # vitest, no `vscode` import in source-under-test
    │   ├── chat-controller.test.ts
    │   ├── hitl-router.test.ts
    │   ├── connection-manager.test.ts
    │   ├── status-bar-item.test.ts
    │   ├── auto-start.test.ts
    │   └── webview/
    │       ├── markdown.test.ts
    │       └── hitl-card.test.ts
    └── integration/                # @vscode/test-electron — full extension host
        └── ask-roundtrip.test.ts   # one happy-path stream end-to-end
```

---

## 8. Testing strategy

### 8.1 Layers

| Layer | Runner | Location | Purpose |
|---|---|---|---|
| Client unit | `bun test` | `packages/client/test/` | `askStream` event routing, `discoverSocketPath` precedence, `paths` per-OS |
| Client node-compat | `node --test` | `packages/client/test/node-compat.test.ts` | Real Gateway + Node runtime; Unix socket + named pipe |
| Extension unit | `vitest` | `packages/vscode-extension/test/unit/` | Pure modules — no `vscode` import allowed in source-under-test |
| Extension integration | `@vscode/test-electron` | `packages/vscode-extension/test/integration/` | Full extension host, real Webview, **mocked `NimbusClient`** |
| Webview client | `vitest` + JSDOM | `packages/vscode-extension/test/unit/webview/` | Markdown renderer, HITL card, message pump |
| Manual smoke | human | `docs/manual-smoke-ws7.md` | 3-OS install + Cursor smoke |

### 8.2 Coverage gate

**`packages/vscode-extension/src/`** — ≥ 80 % lines / ≥ 75 % branches. Wired into `_test-suite.yml` as `vscode-extension-coverage`:

```bash
cd packages/vscode-extension && bunx vitest run --coverage
```

The Webview client code (`src/chat/webview/*.ts`) is included in the report — still our code, just running in a browser context for production.

The integration test runs as separate jobs (`vscode-extension-integration-{ubuntu,macos,windows}`); it does NOT contribute to the coverage report (test-electron's coverage doesn't merge cleanly with vitest's). Its job is acceptance, not coverage.

### 8.3 What each layer specifically covers

**Client unit.**
- `askStream` happy path: receives N mock token events + done; iterator yields N+1 events in order.
- `askStream` error: error event terminates iterator, no further events delivered.
- `askStream` cancel: `handle.cancel()` triggers `engine.cancelStream` IPC; iterator closes.
- `askStream` notification filtering: events with mismatched `streamId` ignored.
- `discoverSocketPath`: override > stateFile > default precedence; missing/malformed stateFile falls through.
- `getNimbusPaths`: each platform branch (mocked `process.platform` + env).

**Extension unit.**
- `ConnectionManager`: connect → disconnect → reconnect; emits state events; debounces rapid socket flaps.
- `HitlRouter`: streamId-tagged batch routes inline when chat visible+focused; non-tagged routes modal; status bar always bumped; debounce on duplicate `requestId`.
- `StatusBarItem`: every row of the §6.3 state table produces correct text/color/command.
- `ChatController`: maps `StreamEvent` → `WebviewMessage` correctly; nulls handle on done/error; rejects new Ask while stream active.
- `AutoStarter`: spawn args correct per platform; PATH-not-found returns clean error; timeout after 10 s.

**Webview unit (JSDOM).**
- Markdown renderer: incremental token append produces correct DOM diff.
- HITL card: renders details; click events post correct messages; disabled while pending.
- Theme: CSS-variable-driven (no JS branching to assert).

**Integration (one test).**
- Activate extension in real VS Code → status bar shows `Gateway not running` → mock socket appears → status bar flips green → run `nimbus.ask` → Webview opens → mock stream produces 3 tokens → Webview DOM contains all 3.

**Manual smoke.**
- 3 OSes × VS Code: install `.vsix`, run Ask, see stream, trigger HITL (modal + inline routing), theme switch (Dark→Light→HC), reload window and see transcript rehydrate.
- 1 OS × Cursor: install from Open VSX, run Ask, confirm streams.

### 8.4 What's not tested automatically (acceptable)

- Marketplace listing rendering (visual; manual sanity-check pre-publish).
- Cursor-specific behavior (no programmatic test harness exists for Cursor extensions).
- Real Gateway integration through the extension host (covered by node-compat on the client side + unit-mocked extension; we do not spawn the Gateway from inside `@vscode/test-electron` because the test-electron sandbox's `child_process` is unreliable across platforms).

---

## 9. Publishing pipeline

### 9.1 Trigger

Push of a tag matching `vscode-v*` (e.g. `vscode-v0.1.0`). Independent from the main `v*` release tag — the VS Code extension can ship out-of-band with the Gateway since the IPC surface is stable.

### 9.2 Workflow

`.github/workflows/publish-vscode.yml`:

| Step | Tool | Detail |
|---|---|---|
| Checkout + Bun setup | actions/checkout, oven-sh/setup-bun | repo-root `bun install` |
| Build `@nimbus-dev/client` | `bun run --filter @nimbus-dev/client build` | produces `dist/` for the extension to bundle |
| Typecheck + lint extension | `bun run --filter @nimbus/vscode-extension typecheck lint` | gate before publish |
| Run extension unit tests | `bunx vitest run` (in package) | gate before publish |
| Build extension bundles | `bun run build` (esbuild × 2) | `dist/extension.js` + `media/webview.{js,css}` |
| Package `.vsix` | `bunx vsce package --no-dependencies` | produces `nimbus-<ver>.vsix` |
| Publish to VS Code Marketplace | `bunx vsce publish --packagePath nimbus-<ver>.vsix --pat $VSCE_PAT` | `VSCE_PAT` secret |
| Publish to Open VSX | `bunx ovsx publish nimbus-<ver>.vsix --pat $OVSX_PAT` | `OVSX_PAT` secret |
| Upload `.vsix` to GitHub Release | actions/upload-release-asset | so users on locked-down networks can `code --install-extension nimbus-<ver>.vsix` |

Concurrency lock: `concurrency: vscode-publish` to prevent simultaneous tags from racing. Environment gate: runs in the `release` GitHub Environment with required reviewers = maintainer.

### 9.3 Marketplace metadata

| Field | Value | Notes |
|---|---|---|
| `name` | `nimbus` | URL slug; lowercase, no spaces |
| `displayName` | `Nimbus` | Marketplace listing title |
| `publisher` | `nimbus-dev` | Must match Marketplace publisher account (procurement runbook §6) |
| `description` | "Local-first AI agent for the editor. Ask, search, and run workflows against your private Nimbus index." | ≤ 200 chars |
| `categories` | `["AI", "Other"]` | Drives marketplace filtering |
| `keywords` | `["ai","agent","local-first","nimbus","privacy","mcp"]` | search ranking |
| `repository.url` | `https://github.com/<org>/Nimbus` | enables Repository link |
| `bugs.url` | `https://github.com/<org>/Nimbus/issues` | required for listing |
| `homepage` | `https://nimbus.dev/vscode` | placeholder; update when docs site has the page |
| `license` | `MIT` | matches package |
| `icon` | `icon.png` | 128×128, no transparency around edge |
| `galleryBanner.color` | `#0E1116` | dark to match Nimbus brand; readable on both Marketplace themes |

`README.md` for marketplace: hero screenshot of chat panel mid-stream, three-line "what it does", install command for Open VSX (`ext install nimbus-dev.nimbus` or VSIX), link to docs site for everything else. Keep it under one screen.

### 9.4 Required secrets

| Secret | Source | Used in |
|---|---|---|
| `VSCE_PAT` | Azure DevOps PAT, "Marketplace · Manage" scope | `publish-vscode.yml` |
| `OVSX_PAT` | Eclipse Foundation account, Open VSX namespace `nimbus-dev` | `publish-vscode.yml` |

Both documented in `docs/release/v0.1.0-prerequisites.md` §6–§7. No new procurement.

---

## 10. File map

### 10.1 Create

`packages/vscode-extension/` — entire new package per §7.

`packages/client/src/`:
- `paths.ts` (lifted from CLI; Bun-free)
- `discovery.ts` (lifted from CLI; Bun-free; `discoverSocketPath`)
- `ask-stream.ts` (new — `AskStreamHandle` + `AskStreamOptions` + impl)
- `stream-events.ts` (new — `StreamEvent` discriminated union)

`packages/client/test/`:
- `node-compat.test.ts`
- `ask-stream.test.ts`
- `discovery.test.ts`
- `paths.test.ts`

`packages/gateway/src/ipc/`:
- `engine-get-session-transcript.ts` (new dispatcher; or extend an existing `engine-rpc.ts` if one exists — verify during impl)
- `engine-get-session-transcript.test.ts`
- `engine-cancel-stream.ts` (small — promotes existing primitive)
- `engine-cancel-stream.test.ts`

`docs/`:
- `manual-smoke-ws7.md`

`.github/workflows/`:
- `publish-vscode.yml`

### 10.2 Modify

- `packages/client/src/index.ts` — re-export new modules
- `packages/client/src/ipc-transport.ts` — Bun-vs-Node Unix dispatch
- `packages/client/src/nimbus-client.ts` — add `askStream()`, `subscribeHitl()`, `getSessionTranscript()`, `cancelStream()`
- `packages/client/src/mock-client.ts` — surface `askStream` for Webview unit tests
- `packages/client/package.json` — bump version to 0.2.0
- `packages/cli/src/lib/with-gateway-ipc.ts` + `gateway-process.ts` — non-blocking follow-up: refactor to consume from `@nimbus-dev/client`
- `packages/gateway/src/ipc/server.ts` — register two new method handlers
- `packages/ui/src-tauri/src/gateway_bridge.rs` — add `engine.cancelStream` + `engine.getSessionTranscript` to `ALLOWED_METHODS`; update `allowlist_exact_size` test
- `package.json` (root) — add `test:coverage:vscode-extension` script
- `.github/workflows/_test-suite.yml` — add `vscode-extension-coverage`, `vscode-extension-integration-{ubuntu,macos,windows}`, `client-node-compat-{ubuntu,macos,windows}` jobs
- `CLAUDE.md` — add Key File Locations rows; flip WS7 status; add commands section
- `GEMINI.md` — mirror `CLAUDE.md`
- `docs/roadmap.md` — flip WS7 row to `[x]`
- `docs/release/v0.1.0-finish-plan.md` §2 — flip WS7 status; tick §4.6 row when manual smoke passes

### 10.3 Delete

None. The CLI's `paths.ts` and `gateway-process.ts` stay in place during WS7; consolidation to `@nimbus-dev/client` is a follow-up tracked separately so the CLI continues to work without coordination.

---

## 11. Acceptance criteria

Reproducing the finish-plan §4.4 list with the design's specifics added:

- [ ] `Nimbus: Ask` streams a result from a running Gateway without manual configuration on VS Code 1.90+ and Cursor.
- [ ] Inline HITL surfaces in the chat panel when visible+focused; modal otherwise; `consent.respond` called exactly once per `requestId`.
- [ ] `Nimbus: Ask About Selection` from the editor right-click menu pre-fills with a fenced selection.
- [ ] `Nimbus: Run Workflow` runs a workflow and surfaces sub-task progress in the OutputChannel; HITL routes through the same router.
- [ ] Status-bar health dot changes within 30 s of a connector transitioning to `degraded`.
- [ ] Status-bar HITL count badge changes within 1 s of `agent.hitlBatch` arrival.
- [ ] `Nimbus: New Conversation` cancels active stream + resets `sessionId` + clears Webview.
- [ ] `Developer: Reload Window` repaints the chat transcript via `engine.getSessionTranscript`.
- [ ] Extension installs on Open VSX from a published `vscode-v0.1.0` tag (manual smoke).
- [ ] `@nimbus-dev/client` node-compat test passes on all three OSes under `node --test`.
- [ ] Webview theme matches VS Code theme on Dark / Light / HC / HC-Light (manual smoke screenshot).
- [ ] Coverage on `packages/vscode-extension/src/` ≥ 80 % lines / ≥ 75 % branches (CI gate).

---

## 12. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Bun→Node transport refactor breaks the just-shipped CLI/TUI under Bun | Low | Runtime detection means Bun consumers hit the same `Bun.connect` code as before. Existing `bun test` suite covers; no API change. |
| Node-compat test flakes on Windows named-pipe handshake (Bun and Node behave subtly differently on `\\.\pipe\` reconnect) | Medium | Reuse the existing CI fixture pattern from `ipc.test.ts`. If flake occurs, retry once before marking failure. |
| `@vscode/test-electron` integration test takes 3–5 min per OS, slowing CI | Medium | Limit to a single happy-path test; runs in parallel with unit tests; coverage gate doesn't depend on it. |
| Webview content-security-policy blocks `marked`-rendered `<script>` from user input | Low | `marked` configured with `sanitize: true`-equivalent setup (or via `DOMPurify`); CSP set to `default-src 'none'; script-src ${webview.cspSource}; style-src 'unsafe-inline' ${webview.cspSource}; img-src ${webview.cspSource} https: data:;`. |
| Cursor diverges from `vscode.*` API in a way that breaks `Nimbus: Ask` | Low | Cursor explicitly maintains VS Code API compat; manual smoke catches the divergence before publish. |
| `vsce publish` fails on first publish because `nimbus-dev` publisher account isn't created | Medium | Procurement runbook §6 covers; verify before tagging `vscode-v0.1.0`. |
| `marked` CVE between spec-write and ship | Low | Pin major version in `package.json`; `bun audit --audit-level high` in CI; swap to `markdown-it` if forced. |

---

## 13. Decisions recorded during brainstorming

All eight scope questions raised during brainstorming have been resolved:

1. **Bun→Node transport refactor structure** — Dual transport in `IPCClient`. `Bun.connect` under Bun, `net.createConnection` under Node. Zero behavior change for existing consumers; new path lights up for the extension. (§4.1)
2. **Streaming API surface** — Typed `askStream(input, opts) → AsyncIterable<StreamEvent>` in `NimbusClient`. Consolidated `hitlBatch` and `subTaskProgress` events through the same iterator; separate `subscribeHitl()` for non-stream HITL. (§4.2–§4.3)
3. **Gateway-not-running UX** — Hybrid: passive default + opt-in `nimbus.autoStartGateway` setting + explicit `Nimbus: Start Gateway` command. (§5.1, §6.1, §6.3)
4. **Chat Webview lifecycle** — Single persistent panel; reused across Asks; `retainContextWhenHidden`; transcripts rehydrated from the Gateway on reload. (§6.4)
5. **HITL routing** — Context-sensitive: inline in chat when panel visible+focused; modal otherwise; status-bar count badge always reflects pending. (§6.5)
6. **In-editor surfaces beyond §4.4** — Add right-click menu items (`Nimbus: Ask About Selection`, `Nimbus: Search Selection`). Reject status-bar Quick Pick for one-line Ask (revisit if telemetry shows demand). (§6.1)
7. **Activation strategy** — Eager `onStartupFinished` so the status bar is always visible; required for HITL count badge from background workflows. (§3.3)
8. **Transcript persistence** — Gateway-backed via new `engine.getSessionTranscript` IPC. No extension-side storage; respects the "machine is the source of truth" non-negotiable. (§5.1, §6.4)

Smaller decisions deferred to the implementation plan:

- `marked` vs `markdown-it` for streaming markdown. Default `marked`; benchmark on a 50-token burst.
- OutputChannel vs side Webview for workflow run progress. Default OutputChannel.
- Code copy-button location (top-right vs hover). Default top-right.
- Whether `Nimbus: Ask` accepts multi-line input via `showInputBox`. Decision: no — Ask opens the chat panel directly and focuses its input (which is multi-line capable as a Webview `<textarea>`).

---

## 14. Handoff

When this spec is approved by the user:

1. Run the spec self-review (placeholder/contradiction/scope/ambiguity scan); fix issues inline.
2. Commit the spec.
3. Invoke `superpowers:writing-plans` to produce the task-by-task implementation plan in `docs/superpowers/plans/2026-04-24-ws7-vscode-extension.md`.
4. Cross-reference the plan back to this spec in its header.
5. Implementation proceeds via TDD per the plan; each task is a small, reviewable diff.
6. On WS7 completion, tick the relevant rows in `docs/release/v0.1.0-finish-plan.md` §2 and §4.6.
