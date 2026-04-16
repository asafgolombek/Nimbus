---
name: nimbus-phase-4
description: >
  Phase 4 (Presence) working reference for the Nimbus project. Use this skill whenever
  the user is planning, implementing, or scoping work on Phase 4 features: local LLM
  integration (Ollama, llama.cpp), multi-agent orchestration, voice interface, data
  export/import, GDPR deletion, tamper-evident audit log, release infrastructure (signing,
  auto-update, Plugin API v1), Tauri desktop UI, Rich TUI, or the VS Code extension.
  Also trigger for questions like "what's next?", "what workstream are we on?", "what are
  the acceptance criteria for X?", "can I start Y yet?", or any task that touches a Phase 4
  file or feature. Always consult this before starting new Phase 4 work to confirm sequencing
  and avoid cross-phase creep.
---

# Phase 4 — Presence: Working Reference

**Goal:** Give Nimbus a face, a local AI backbone that requires no cloud API key, and the trust foundations for a public `v0.1.0` release.

**Release gate:** `v0.1.0` does not ship until every acceptance criterion passes on **Windows, macOS, and Linux**. Ship when complete, not by a date.

**Rule:** Do not implement Phase 5+ features while Phase 4 is active.

---

## Workstream Execution Order

Dependencies are strict. Each workstream unlocks the next:

```
1. Local LLM & Multi-Agent     ← START HERE — all surfaces depend on this
2. Voice Interface             ← depends on WS1 (LLM router must exist)
3. Data Sovereignty            ← no UI dependency; can start after WS1
4. Release Infrastructure      ← signing + auto-update + Plugin API v1; gates v0.1.0
5. Tauri Desktop UI            ← depends on WS1–4 IPC stability
6. Rich TUI (Ink)              ← same IPC surface; can overlap with late WS5
7. VS Code Extension           ← depends on @nimbus-dev/client + stable IPC; last
```

**Automation & Graph Enhancements** (A.1 graph-aware watcher conditions, A.2 workflow branching, A.3 per-connector OAuth vault keys) are independent of the UI workstreams and can run in parallel with WS5 or WS6.

---

## Workstream 1 — Local LLM & Multi-Agent

### Key new files
| File | Purpose |
|---|---|
| `packages/gateway/src/llm/ollama-provider.ts` | Ollama HTTP API client, model discovery, pull streaming |
| `packages/gateway/src/llm/llamacpp-provider.ts` | llama.cpp GGUF server management |
| `packages/gateway/src/llm/router.ts` | Task-type routing: `classification`, `embedding`, `reasoning`, `generation` |
| `packages/gateway/src/llm/gpu-arbiter.ts` | `AsyncMutex` preventing Ollama + llama.cpp GPU contention |
| `packages/gateway/src/engine/coordinator.ts` | Decomposes intent → `SubTaskPlan`; manages parallel sub-agent execution |
| `packages/gateway/src/engine/sub-agent.ts` | Executes within a `toolScope`; cannot call tools outside it |

### Critical constraints
- **Air-gap mode:** `enforce_air_gap = true` in config → zero outbound HTTP during an `ask` round-trip
- **Loop protection:** `maxAgentDepth = 3` (sub-agent recursion limit); `maxToolCallsPerSession = 20` (total tool calls); exceeding fires `agent.gasLimitReached` and halts new decomposition
- **GPU arbitration:** Ollama and llama.cpp cannot both use the GPU simultaneously. The `AsyncMutex` timeout resets on each emitted token (activity-aware, not wall-clock)
- **HITL in multi-agent:** sub-agents never get individual consent. The coordinator consolidates all `hitlRequired` sub-tasks into one `agent.hitlBatch` notification. Partial approval: rejected action marks its transitive dependents as `skipped` (not `failed`)

### New DB migrations
- **N+1:** `llm_models` table + `last_error`, `bench_tps` columns
- **N+2:** `sub_task_results` table (status enum: `pending` | `running` | `completed` | `failed` | `hitl_paused` | `skipped`)

### New IPC methods
| Method | Type | Description |
|---|---|---|
| `llm.listModels` | request | Merged Ollama + llama.cpp model list |
| `llm.pullModel` | request | Triggers pull; streams `llm.pullProgress` notifications |
| `llm.loadModel` | request | Spawns llama-server for a GGUF |
| `llm.unloadModel` | request | Terminates llama-server |
| `llm.setDefault` | request | Sets default model |
| `llm.getRouterStatus` | request | Current routing decisions per task type |
| `agent.getSubTaskPlan` | request | Returns `SubTaskPlan` for a session |
| `agent.subTaskProgress` | notification | Per-sub-task status stream |
| `agent.hitlBatch` | notification | Consolidated HITL consent request |

### Acceptance criteria (all required)
- [ ] `nimbus ask "summarize my week"` runs via Ollama — no API key, no network — in < 30 s on a mid-range laptop (`NIMBUS_RUN_LOCAL_BENCH=1`)
- [ ] Same query works via llama.cpp GGUF (Ollama not required)
- [ ] 3 parallel sub-agents cannot bypass HITL on any write step — `multi-agent-hitl.e2e.test.ts`
- [ ] Rejected sub-task's transitive dependents → `skipped`, not `failed`
- [ ] `maxAgentDepth` and `maxToolCallsPerSession` guards verified — `loop-protection.test.ts`
- [ ] GPU arbitration: second caller waits; timeout resets on each token — `gpu-arbiter.test.ts` (must include explicit scenarios for the SIGKILL fallback when SIGTERM is ignored, and for the Ollama `keep_alive=0` eviction path — these are distinct from the basic mutex wait test)
- [ ] Decomposition quality gate (manual): 3B + 7B model each produce valid `SubTaskPlan` JSON for 3 standard prompts with `NIMBUS_LOG_SUBTASK_PLAN=1`
- [ ] `enforce_air_gap = true` → zero outbound HTTP — `air-gap-local-llm.e2e.test.ts`
- [ ] Coverage: `packages/gateway/src/llm/` ≥ 85%

---

## Workstream 2 — Voice Interface

### Key new files
| File | Purpose |
|---|---|
| `packages/gateway/src/voice/stt.ts` | Whisper.cpp STT — binary + GGML model management |
| `packages/gateway/src/voice/tts.ts` | Local TTS engine |
| `packages/gateway/src/voice/wake-word.ts` | Wake word detection |
| `packages/gateway/src/ipc/handlers/voice.ts` | Voice IPC handlers |

### Config keys
```toml
[voice]
whisperPath = ""      # override binary path; falls back to NIMBUS_WHISPER_PATH, then PATH
enabled = false
wakeWord = "hey nimbus"
```

### Acceptance criteria
- [ ] Voice push-to-talk query round-trip (STT → LLM → TTS) — all three platforms

---

## Workstream 3 — Data Sovereignty

### Key new files / commands
| File / Command | Purpose |
|---|---|
| `packages/gateway/src/commands/data-export.ts` | `nimbus data export --output <path.tar.gz> [--no-index]` |
| `nimbus data import <path.tar.gz>` | Restores full state; verifies BLAKE3 hashes |
| `nimbus data delete --service <n>` | GDPR deletion; writes signed deletion record |
| `packages/gateway/src/db/audit.ts` (modify) | Tamper-evident audit chain (BLAKE3 row hashes) |
| `nimbus audit verify` | Verifies chain integrity; incremental on startup |

### Export bundle contents
```
nimbus-backup-<timestamp>/
  manifest.json           -- bundle metadata + BLAKE3 integrity hashes
  index.db.gz             -- SQLite snapshot
  vault-manifest.json.enc -- credential keys re-encrypted with user passphrase (envelope encryption)
  watchers.json
  workflows.json
  extensions.json
  profiles.json
  audit-chain.json
```

### Vault passphrase encryption (envelope encryption)
- DEK (256-bit random) encrypts the vault manifest (AES-256-GCM)
- DEK wrapped twice: once with Argon2id(passphrase), once with Argon2id(BIP39 recovery seed)
- Recovery seed generated on first export, stored in Vault, displayed once — never re-displayed
- `nimbus data import --recovery-seed "<mnemonic>"` works without passphrase

### New DB migrations
- **N+3:** `ALTER TABLE audit_log ADD COLUMN row_hash TEXT` + `prev_hash TEXT`; backfill in batches of 1,000
- **N+5:** `_meta` row `audit_verified_through_id`

### Acceptance criteria
- [ ] Export → wipe → import restores full functionality on a fresh machine
- [ ] `--no-index` bundle accepted by import; index rebuilds via `nimbus connector sync`
- [ ] `--recovery-seed` decrypts vault manifest without original passphrase
- [ ] Tampered archive rejected on import (BLAKE3 mismatch)
- [ ] `nimbus data delete --dry-run` prints pre-flight summary, exits without modifying data
- [ ] `nimbus audit verify` detects manually introduced chain break at any row position
- [ ] Passphrase never appears in any file, log, or IPC payload
- [ ] Coverage: `data-*.ts` + audit chain paths ≥ 85%

---

## Workstream 4 — Release Infrastructure

### Key deliverables
| Item | Detail |
|---|---|
| macOS signing | Gatekeeper notarization via `codesign` + `notarytool` + `stapler` in `release.yml` |
| Windows signing | Authenticode via `signtool.exe` in `release.yml` |
| Linux signing | GPG detached signatures for `.deb` + AppImage |
| Auto-update | Tauri updater plugin; `updater.updateAvailable` notification on startup; user calls `updater.applyUpdate`; Ed25519 signature verified before apply; corrupted binary → rollback + `updater.rolledBack` |
| Plugin API v1 | All stable SDK exports documented in `packages/sdk/CHANGELOG.md`; `runContractTests()` passes |
| LAN remote access | NaCl box E2E encrypted; off by default; 5-min pairing window; 3 failed attempts/60 s → lockout; read-only by default; write requires `nimbus lan grant-write <peer-id>` |

### New DB migration
- **N+4:** `lan_peers` table

### Acceptance criteria
- [ ] macOS `.pkg` passes Gatekeeper without user override
- [ ] Windows installer passes SmartScreen without user override
- [ ] Linux `.deb` + AppImage ship with detached GPG signatures; `gpg --verify` passes
- [ ] `updater.applyUpdate` verifies Ed25519 signature; corrupted binary triggers rollback
- [ ] Plugin API v1 documented; `runContractTests()` passes — `plugin-api-v1.test.ts`
- [ ] LAN: pairing window closes after 5 min; lockout after 3 failed attempts; tampered ciphertext rejected — `lan-rpc.test.ts`

---

## Workstream 5 — Tauri Desktop UI

**Tech stack:** Tauri 2.0 + React 18 + TypeScript strict + Zustand + Tailwind CSS v4 + Radix UI

### Key new files
| File | Purpose |
|---|---|
| `packages/ui/src/ipc/client.ts` | Frontend JSON-RPC client (never opens socket directly — goes through Rust bridge) |
| `packages/ui/src-tauri/src/gateway_bridge.rs` | Thin Rust bridge; enforces `ALLOWED_METHODS` compile-time allowlist |
| `packages/ui/src/pages/Dashboard.tsx` | Connector health, index counts, agent actions, audit feed |
| `packages/ui/src/components/HitlDialog.tsx` | Structured action preview; diff view; approve/reject per action |
| `packages/ui/src/pages/Marketplace.tsx` | Browse/install/update extensions; sandboxing level badge |
| `packages/ui/src/pages/Watchers.tsx` | Watcher list, condition builder, history drawer |
| `packages/ui/src/pages/Workflows.tsx` | Visual step list editor, run history, dry-run toggle |
| `packages/ui/src/pages/Settings.tsx` | Model, Connectors, Profile, Vault, Audit, Data, Telemetry, Voice, Updates, Advanced |

### IPC security
- `gateway_bridge.rs` maintains `ALLOWED_METHODS: &[&str]` at compile time
- `vault.*` and `db.*` are NOT in the allowlist — never callable from the frontend
- Any method not in the allowlist → `ERR_METHOD_NOT_ALLOWED` before the request reaches the Gateway socket

### Gateway-offline state
- All panels → skeleton loading state (not a spinner)
- Amber banner: `"Gateway is not running. [Start Gateway]"`
- "Start Gateway" calls `shell.execute("nimbus start")`
- Auto-dismisses on reconnect
- Implemented in `GatewayConnectionProvider` React context wrapping the entire app

### Acceptance criteria (selection)
- [ ] System tray changes to amber/red on connector degradation — all three platforms
- [ ] HITL dialog: approving 1, rejecting 1 in a batch of 2 sends correct per-action decisions
- [ ] Gateway-offline banner appears within 2 s of Gateway kill; dismisses on reconnect
- [ ] `ERR_METHOD_NOT_ALLOWED` for any method not in `ALLOWED_METHODS` — `ipc-client.test.ts`
- [ ] Workflow dry-run: zero non-dry-run entries in audit log
- [ ] All Vitest UI component tests pass: `cd packages/ui && bunx vitest run`

---

## Workstream 6 — Rich TUI (Ink)

### Key new files
| File | Purpose |
|---|---|
| `packages/cli/src/tui/App.tsx` | 4-pane layout (Query Input, Result Stream, Connector Health, Sub-Task Progress) |
| `packages/cli/src/tui/QueryInput.tsx` | Text input; history (last 100 in `query_history.json`); inline HITL overlay |
| `packages/cli/src/tui/ConnectorHealth.tsx` | Polls `connector.list` every 30 s; coloured dot per service |
| `packages/cli/src/tui/WatcherPane.tsx` | Polls `watcher.list` every 30 s |
| `packages/cli/src/tui/SubTaskPane.tsx` | Subscribes to `agent.subTaskProgress`; progress bar per sub-task |

**SSH safety:** If `TERM=dumb` or `NO_COLOR` set → auto-fallback to Phase 3 REPL (no `--no-tui` flag needed).

**New IPC method:** `engine.askStream` → returns `{ streamId }` immediately; emits `engine.streamToken`, `engine.streamDone`, `engine.streamError` notifications.

### Acceptance criteria
- [ ] `nimbus tui` launches on all three platforms; result streams token-by-token
- [ ] HITL overlay appears mid-stream; approving resumes the stream
- [ ] `TERM=dumb nimbus tui` falls back to Phase 3 REPL without error
- [ ] `engine.askStream` coverage ≥ 80%

---

## Workstream 7 — VS Code Extension

**New package:** `packages/vscode-extension/`  
**Dependencies:** `@nimbus-dev/client` (Phase 3.5, published) + stable IPC (WS1–4) + Plugin API v1 (WS4)

### Key features
- `Nimbus: Ask` command → streaming Markdown result in editor tab
- `Nimbus: Search` → Quick Pick list from local index
- Inline HITL consent → VS Code notification (approve/reject)
- Status bar: active profile name + connector health dot

**Publishing:** `publish-vscode.yml` triggered on `vscode-v*` tag → VS Code Marketplace + Open VSX Registry

### Acceptance criteria
- [ ] `Nimbus: Ask` streams a result from the running Gateway
- [ ] Inline HITL consent approves correctly
- [ ] Status bar health dot updates on connector state change
- [ ] Installs from Open VSX without manual config on VS Code 1.90+ and Cursor

---

## v0.1.0 Release Gate Checklist

**Do not tag `v0.1.0` until every item is ticked on all three platforms.**

Each item tracks two states: `code` (implementation exists) and `verified` (manually confirmed on that platform).

| Check | Win | mac | Linux |
|---|---|---|---|
| `nimbus ask` via Ollama (no API key) | ☐/☐ | ☐/☐ | ☐/☐ |
| `nimbus ask` via llama.cpp GGUF | ☐/☐ | ☐/☐ | ☐/☐ |
| Voice push-to-talk round-trip | ☐/☐ | ☐/☐ | ☐/☐ |
| `nimbus data export` + `import` restores full state | ☐/☐ | ☐/☐ | ☐/☐ |
| `nimbus audit verify` passes (100+ rows) | ☐/☐ | ☐/☐ | ☐/☐ |
| Signed installer passes OS gatekeeper | ☐/☐ | ☐/☐ | ☐/☐ |
| Tauri UI: Dashboard + HITL dialog | ☐/☐ | ☐/☐ | ☐/☐ |
| `nimbus tui` launches + streams | ☐/☐ | ☐/☐ | ☐/☐ |
| VS Code extension connects + Ask works | ☐/☐ | ☐/☐ | ☐/☐ |

---

## Schema Migration Order (Phase 4)

Continuing from last Phase 3.5 migration number (N):

| # | Objects added | Workstream |
|---|---|---|
| N+1 | `llm_models` table | WS1 |
| N+2 | `sub_task_results` table | WS1 |
| N+3 | `audit_log.row_hash` + `prev_hash`; backfill in batches of 1,000 | WS3 |
| N+4 | `lan_peers` table | WS4 |
| N+5 | `_meta` row `audit_verified_through_id` | WS3 |

All migrations: numbered, append-only, single-transaction, pre-migration backup, rollback on failure.
