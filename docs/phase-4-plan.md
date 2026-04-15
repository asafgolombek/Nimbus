# Phase 4 — Detailed Implementation Plan

> **Theme:** Presence  
> **Goal:** Give Nimbus a face, a local AI backbone that requires no cloud API key, and the trust foundations needed for a public `v0.1.0` release.  
> **Constraint:** Solo developer — workstreams are sequential unless explicitly noted as parallelisable.  
> **Release gate:** `v0.1.0` does not ship until every acceptance criterion in this document passes on Windows, macOS, and Linux. Release timeline is intentionally unconstrained — ship when complete, not by a date.

---

## Execution Order

Dependencies drive the sequence. Each pillar unlocks the next:

```
1. Local LLM & Multi-Agent           (engine backbone — all UI and TUI surfaces depend on local model routing)
2. Voice Interface                   (depends on local STT/TTS; self-contained after LLM pillar)
3. Data Sovereignty                  (export/import/GDPR/audit chain — release prerequisite; no UI dependency)
4. Release Infrastructure            (signing + auto-update + Plugin API v1; gates v0.1.0 tag)
5. Tauri Desktop UI                  (scaffold exists; depends on Gateway IPC stability from pillars 1–4)
6. Rich TUI                          (Ink; depends on same IPC surface; can overlap with Tauri late stages)
7. VS Code Extension                 (new package; depends on @nimbus-dev/client + stable IPC; last pillar)
```

Within each pillar the sub-tasks are ordered by dependency. Cross-pillar parallelism is called out explicitly where possible.

---

## Workstream 1 — Local LLM & Multi-Agent

**Why first:** Every later surface (Tauri, TUI, VS Code) needs the model routing layer to exist before it can render results. Multi-agent orchestration is a Gateway-internal concern with no UI dependency and should be proven correct before any visual surface is built on top of it.

### 1.1 Ollama Integration

**New file:** `packages/gateway/src/llm/ollama-provider.ts`

Ollama is the primary local model backend. The Gateway talks to the Ollama HTTP API over localhost — no subprocess management required (Ollama manages its own daemon).

#### 1.1.1 Model discovery

`GET http://localhost:11434/api/tags` returns the list of installed models. The Gateway caches this list in memory (TTL 60 s) and exposes it via a new IPC method `llm.listModels`.

Response shape (partial):
```ts
interface OllamaModel {
  name: string;          // e.g. "llama3.2:3b"
  size: number;          // bytes
  digest: string;
  details: { family: string; parameter_size: string; quantization_level: string };
}
```

#### 1.1.2 Model pull

`POST http://localhost:11434/api/pull` with `{ "name": "<model>" }` streams progress. The Gateway:
1. Streams progress events over IPC as `llm.pullProgress` notifications (JSON-RPC notification, not a response)
2. Stores final pull state in `llm_models` SQLite table (see 1.1.4)
3. Emits `llm.modelReady` notification on completion

#### 1.1.3 Model load / unload

Ollama auto-loads on first generation request and unloads after `keep_alive` window. The Gateway honours this — no explicit load/unload IPC unless the UI needs to pre-warm (see Settings panel, Workstream 5).

**VRAM pre-flight check:** Before the first generation call for a new model, the router queries `GET /api/show` (Ollama model info endpoint) for the model's `parameter_size` and quantization level, then queries the GPU arbitration layer (1.3.4) to confirm sufficient VRAM headroom exists. If Ollama reports an OOM error (`error` field in the NDJSON response contains `"out of memory"` or HTTP 500), the router:
1. Marks the model as `oom_failed` in `llm_models` (new column `last_error TEXT`)
2. Falls back to the next available model per the routing table (1.3.1)
3. Emits `llm.modelOom { modelId, requiredBytes, availableBytes }` IPC notification so the UI can prompt the user to unload other models or choose a smaller quantization

#### 1.1.4 `llm_models` SQLite table

New schema migration (migration N+1):

```sql
CREATE TABLE llm_models (
  id          TEXT PRIMARY KEY,          -- "ollama:llama3.2:3b"
  backend     TEXT NOT NULL,             -- "ollama" | "llamacpp"
  model_name  TEXT NOT NULL,
  size_bytes  INTEGER,
  pulled_at   TEXT,
  last_used   TEXT,
  is_default  INTEGER NOT NULL DEFAULT 0
);
```

`is_default` is an app-level flag. Only one row may have `is_default = 1` at a time, enforced by two triggers:
- `BEFORE INSERT` — zeros `is_default` on all existing rows before the new row is written
- `BEFORE UPDATE OF is_default` — zeros `is_default` on all other rows when an existing row is toggled to default via the Settings UI or `llm.setDefault` IPC

Both triggers are required. Without the `BEFORE UPDATE` trigger, using `llm.setDefault` on an already-stored model (the common Settings-panel path) would not clear the previous default row.

**Test:** `packages/gateway/test/unit/llm/ollama-provider.test.ts` — mock the Ollama HTTP server; assert tag list parsing, pull progress streaming, model table writes.

---

#### 1.1.5 Generation API

`packages/gateway/src/llm/ollama-provider.ts` exports:

```ts
interface GenerateOptions {
  model: string;
  prompt: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
  stream: boolean;
}

interface LLMProvider {
  generate(opts: GenerateOptions): Promise<string>;
  generateStream(opts: GenerateOptions): AsyncIterable<string>;
  isAvailable(): Promise<boolean>;
}
```

`POST http://localhost:11434/api/generate` for non-chat single-turn; `POST http://localhost:11434/api/chat` for multi-turn sessions. The streaming path uses the NDJSON response body.

**Error handling:** If Ollama is not running, `isAvailable()` returns `false`; the router (1.3) falls back transparently to the remote model. No error surfaces to the user unless both backends are unavailable.

---

### 1.2 llama.cpp Integration

**New file:** `packages/gateway/src/llm/llamacpp-provider.ts`

llama.cpp is the fallback for users who cannot or do not want to run the Ollama daemon. The Gateway spawns `llama-server` (the llama.cpp HTTP server binary) as a child process and talks to it over the same REST API shape as Ollama where possible.

#### 1.2.1 Binary discovery

Resolution order:
1. `config.llm.llamacpp.serverPath` (TOML config key) — explicit override
2. `NIMBUS_LLAMACPP_PATH` env variable
3. Platform PATH: `llama-server` (Linux/macOS) / `llama-server.exe` (Windows)
4. Bundled binary under `<appDir>/bin/llama-server[.exe]` — set by the headless package script

**Test:** `packages/gateway/test/unit/llm/llamacpp-discovery.test.ts` — assert resolution order using temp dirs.

#### 1.2.2 GGUF model file management

- Model files live under `<dataDir>/models/` by default; overridable via `config.llm.modelDir`
- `llm.listLocalModels` IPC scans `<modelDir>` **recursively** (subdirectories included) for `*.gguf` files, following symlinks; returns `{ path, name, sizeBytes }`. Symlinks are resolved to their canonical path before deduplication — a symlink and its target are not listed twice.
- `llm.loadModel` IPC spawns `llama-server --model <path> --port <ephemeral>` and writes the PID + port to `llm_models`
- `llm.unloadModel` IPC sends `SIGTERM` to the stored PID; cleans up the `llm_models` row

**VRAM pre-flight for llama.cpp:** Before spawning `llama-server`, the Gateway reads the GGUF file header (first 256 bytes) to extract `n_params` and `quantization_type`, then consults the GPU arbitration layer (1.3.4). If the estimated VRAM requirement exceeds available headroom, `llm.loadModel` returns an error (`LLM_INSUFFICIENT_VRAM`) before any process is spawned.

**Process lifecycle:** the Gateway registers an `onExit` handler that terminates all llama-server child processes on Gateway shutdown. On Windows, use `taskkill /PID <pid> /F` instead of `SIGTERM`.

#### 1.2.3 Generation API

`LLMProvider` implementation identical in interface to the Ollama provider. llama.cpp's `llama-server` exposes `/completion` and `/v1/chat/completions` (OpenAI-compatible). Use `/v1/chat/completions` for parity.

**Test:** `packages/gateway/test/unit/llm/llamacpp-provider.test.ts` — mock the llama-server HTTP endpoints; assert streaming chunks, process lifecycle, model file scanning.

---

### 1.3 Model Router

**New file:** `packages/gateway/src/llm/router.ts`

The router selects the provider and model for each inference call based on task type. This is the single entry point — callers never reference `ollama-provider` or `llamacpp-provider` directly.

#### 1.3.1 Task routing table

| Task type | Default model | Routing logic |
|---|---|---|
| `classification` | Fastest available local model | Ollama if running, llama.cpp if loaded, remote fallback |
| `embedding` | Unchanged — existing embedding pipeline | Never routed through the LLM router |
| `reasoning` | Configured remote model (default) | Local if `config.llm.preferLocal = true` and a capable model is loaded |
| `summarisation` | Local model (default) | Any loaded local model |
| `agent_step` | Configured remote or local | Per-task config; coordinator respects the same routing |

**"Fastest available local model" definition:** Fastest is determined by a static heuristic — the loaded model with the lowest estimated parameter count (derived from the model name or GGUF header) is selected first, as smaller models have lower per-token latency. No background benchmark is run at startup. An optional benchmark can be triggered via `NIMBUS_RUN_LLM_BENCH=1` (similar to the query bench gate) which measures tokens/sec for each loaded model and stores the result in `llm_models.bench_tps`; if `bench_tps` is populated it is used instead of the static heuristic.

#### 1.3.2 Config keys

New TOML section:

```toml
[llm]
prefer_local = false          # true → use local models for all tasks where capable
remote_model = "claude-sonnet-4-6"  # fallback model identifier
local_model = ""              # explicit local model override; empty = auto-select from loaded models
llamacpp_server_path = ""     # override binary path

[llm.task_overrides]
classification = "ollama:qwen2.5:0.5b"    # example: pin a specific model for a task
```

#### 1.3.3 `llm.*` IPC methods

| Method | Description |
|---|---|
| `llm.listModels` | Returns all models from Ollama tags + llm_models table |
| `llm.pullModel` | Triggers Ollama pull; streams `llm.pullProgress` notifications |
| `llm.loadModel` | Spawns llama-server for a GGUF file |
| `llm.unloadModel` | Terminates the llama-server process for a model |
| `llm.setDefault` | Sets `is_default = 1` for a model id |
| `llm.getRouterStatus` | Returns current routing decisions for each task type |
| `llm.listLocalModels` | Scans `<modelDir>` for GGUF files |

**Test:** `packages/gateway/test/unit/llm/router.test.ts` — assert routing decisions for each task type under all combinations of: Ollama available/unavailable, llama.cpp loaded/not loaded, `prefer_local` true/false.

#### 1.3.4 GPU Arbitration

**New file:** `packages/gateway/src/llm/gpu-arbiter.ts`

When both Ollama and llama.cpp are configured, they must not compete for the same GPU simultaneously — this causes OOM errors and model-load failures that are hard to diagnose.

The GPU arbiter maintains a single `AsyncMutex` that both backends acquire before loading or running a model. The mutex is:
- Acquired by Ollama on first generation call; released after the response completes (streaming or not)
- Acquired by llama.cpp at `llm.loadModel` time and held until `llm.unloadModel`
- Subject to an **activity-aware timeout**: the timeout clock is `config.llm.gpuLockTimeoutMs` (default: 120 000 ms) of **inactivity**, not total hold time. Each token emitted by a streaming generation resets the inactivity timer. This prevents the timeout from cutting off a slow but actively-producing model while still acting if generation truly stalls.

**Timeout action — active VRAM reclamation:** Releasing the software lock alone does not free physical VRAM. When the inactivity timer fires, the arbiter must actively unload the idle model before releasing the lock:
- If the lock was held by **llama.cpp**: send `SIGTERM` to the stored llama-server PID (same as `llm.unloadModel`); wait up to 5 s for the process to exit; if it does not exit, send `SIGKILL` / `taskkill /F`; clean up the `llm_models` row
- If the lock was held by **Ollama**: call `POST /api/generate` with `{ "model": "<name>", "keep_alive": 0 }` which instructs Ollama to evict the model from VRAM immediately; do not rely on Ollama's internal keepalive timer as it may be misconfigured

After the unload completes the arbiter emits `llm.gpuLockTimeout { backend, modelId }` and releases the lock so the waiting caller can proceed.

If only CPU is in use (`llama-server --no-gpu` flag or no GPU detected), the arbiter is a no-op and skips locking.

**Test:** `packages/gateway/test/unit/llm/gpu-arbiter.test.ts` — simulate concurrent Ollama + llama.cpp calls; assert only one runs at a time; assert timeout triggers active model unload (SIGTERM for llama.cpp, `keep_alive=0` POST for Ollama) before releasing the lock; assert `llm.gpuLockTimeout` notification carries the correct `backend` and `modelId`.

---

### 1.4 Air-Gapped Operation

When a local model is loaded and `prefer_local = true`, the Gateway must complete an `ask` round-trip without any outbound network call.

#### 1.4.1 Air-gap verification mode

`config.llm.enforceAirGap = false` (default). When `true`:
- The router throws if the selected provider requires a remote call
- `nimbus ask` surfaces this as a user-visible error: `"Air-gap mode is active and no local model is available for this task type."`

**Test:** `packages/gateway/test/e2e/scenarios/air-gap-local-llm.e2e.test.ts` — start Gateway with `prefer_local = true` and a mock llama-server; run `nimbus ask "summarize my last 5 commits"`; assert zero outbound HTTP calls using a network intercept.

---

### 1.5 Multi-Agent Orchestration

**Modify:** `packages/gateway/src/engine/`

Multi-agent is a Gateway-internal concern. No new IPC surface beyond what is needed to surface sub-task progress to the UI.

#### 1.5.1 Coordinator agent

**New file:** `packages/gateway/src/engine/coordinator.ts`

The coordinator receives a complex user intent and decomposes it into a `SubTaskPlan`:

```ts
interface SubTask {
  id: string;
  description: string;
  toolScope: string[];          // connector + tool IDs this sub-agent may call
  dependsOn: string[];          // sub-task IDs that must complete before this one starts
  hitlRequired: boolean;        // pre-computed from executor HITL_REQUIRED set
}

interface SubTaskPlan {
  intent: string;
  subTasks: SubTask[];
}
```

Decomposition is performed by the LLM router (task type `reasoning`). The prompt includes the full tool catalog scoped to the user's connected services.

#### 1.5.2 Sub-agent execution

**New file:** `packages/gateway/src/engine/sub-agent.ts`

Each sub-agent:
- Receives its `toolScope` and cannot call tools outside it — enforced at the dispatcher level, not prompt level
- Writes its result to `sub_task_results` SQLite table
- Emits `agent.subTaskProgress` IPC notifications (for UI streaming)
- **Cannot approve HITL on behalf of the user** — if a sub-task requires HITL, the coordinator pauses all dependent sub-tasks and surfaces a single consolidated consent request to the user

Independent sub-tasks (no `dependsOn`) run in parallel using `Promise.all`. Dependent tasks queue until their predecessors complete.

**Loop protection:** Sub-agent recursion (a sub-agent spawning further sub-agents) is limited by two guards:
1. `config.llm.maxAgentDepth` (default: 3) — maximum nesting depth; a sub-agent at depth 3 cannot decompose further; attempting to do so logs a warning and treats the sub-task as a leaf tool-call task
2. `config.llm.maxToolCallsPerSession` (default: 20) — total tool calls across all sub-agents in a session; exceeding this causes the coordinator to surface an `agent.gasLimitReached` IPC notification and halt further decomposition; already-running sub-tasks complete, no new ones are started

Both limits are configurable and emit audit log entries when triggered.

**Per-service write serialisation:** If two or more parallel sub-agents attempt write operations against the same service (e.g. two sub-agents both writing to GitHub), they are serialised via a per-service `AsyncMutex` in the dispatcher. Read-only tool calls are not serialised. This prevents API-level race conditions and rate-limit collisions from parallel sub-agents. The existing per-provider rate limiter (Phase 2) still applies on top of this — the mutex prevents concurrent write dispatches, the rate limiter enforces token-bucket spacing for all calls. The mutex is held inside a `try/finally` block in the dispatcher — it is released unconditionally whether the tool call succeeds, throws, or times out, preventing a failed sub-agent from starving all subsequent writes to that service.

#### 1.5.3 `sub_task_results` SQLite table

New migration:

```sql
CREATE TABLE sub_task_results (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL,
  description   TEXT NOT NULL,
  status        TEXT NOT NULL CHECK(status IN ('pending','running','completed','failed','hitl_paused','skipped')),
  tool_scope    TEXT NOT NULL,  -- JSON array
  result        TEXT,           -- JSON result payload
  error         TEXT,
  started_at    TEXT,
  completed_at  TEXT
);
```

#### 1.5.4 HITL consolidation

When the coordinator collects HITL-required sub-tasks:
1. All sub-tasks whose `hitlRequired = true` are presented in a single consolidated consent request: `agent.hitlBatch`
2. The user approves or rejects each action individually within the batch
3. Partial approval is allowed — approved actions proceed, rejected ones are marked `failed`
4. The coordinator cannot re-submit a rejected HITL action in the same session

**Dependency propagation on partial rejection:** When a user rejects action A:
- Sub-tasks whose `dependsOn` includes A's sub-task ID are marked `skipped` with `reason = "dependency_rejected"` — they do not become `failed`
- Sub-tasks with no dependency on A are unaffected and continue executing
- The `skipped` status is surfaced in `agent.subTaskProgress` notifications so the UI can distinguish "failed" (error during execution) from "skipped" (dependency chain broken by user choice)
- "Soft" transitive dependencies (sub-task B depends on A, sub-task C depends on B) propagate the `skipped` status recursively — C is also marked `skipped`

**Test:** `packages/gateway/test/e2e/scenarios/multi-agent-hitl.e2e.test.ts` — decompose a task into 3 parallel sub-tasks where 2 require HITL; verify that neither executes before user approval; verify that rejecting one does not block the other; verify the coordinator never auto-approves; verify that a sub-task with a transitive dependency on a rejected action is marked `skipped`, not `failed`.

#### 1.5.5 IPC additions

| Method | Description |
|---|---|
| `agent.getSubTaskPlan` | Returns the current `SubTaskPlan` for a session |
| `agent.subTaskProgress` (notification) | Streams status updates for each sub-task |
| `agent.hitlBatch` (notification) | Consolidated HITL consent request for multiple sub-tasks |

---

### Workstream 1 Acceptance Criteria

- [ ] `nimbus ask "summarize everything across my projects this week"` runs fully locally via Ollama — no API key, no network call — in under 30 s on a mid-range laptop (`NIMBUS_RUN_LOCAL_BENCH=1` gate)
- [ ] Same query works with a GGUF model loaded via llama.cpp (Ollama not required)
- [ ] Multi-agent: a task decomposed into 3 parallel sub-agents cannot bypass HITL on any write step — verified by `multi-agent-hitl.e2e.test.ts`
- [ ] Partial HITL rejection: a rejected sub-task's transitive dependents are marked `skipped`, not `failed` — verified by `multi-agent-hitl.e2e.test.ts`
- [ ] Loop protection: a sub-agent that attempts to recurse beyond `maxAgentDepth = 3` is treated as a leaf task; `agent.gasLimitReached` fires when `maxToolCallsPerSession` is exceeded — verified by `packages/gateway/test/unit/engine/loop-protection.test.ts`
- [ ] GPU arbitration: Ollama and llama.cpp cannot both use the GPU simultaneously; second caller waits for the lock; timeout resets on each emitted token — verified by `gpu-arbiter.test.ts`
- [ ] **Decomposition quality gate (manual):** a local 3B model and a local 7B model must each produce a syntactically valid `SubTaskPlan` JSON object (parseable, all required fields present, `dependsOn` references only real sub-task IDs) for at least these three prompts: (1) "find all my open PRs and post a summary to Slack", (2) "create a Linear ticket for each failing CI job on main", (3) "export all emails from Alice this week to a markdown file". Verified by running `nimbus ask <prompt>` with `NIMBUS_LOG_SUBTASK_PLAN=1` and inspecting the printed plan.
- [ ] Air-gap mode (`enforce_air_gap = true`) prevents any outbound HTTP during an `ask` round-trip when a local model is loaded
- [ ] `llm.listModels` returns correct merged list when both Ollama and llama.cpp models are present; GGUF files in subdirectories and symlinks are included
- [ ] Coverage: `packages/gateway/src/llm/` ≥ 85%

---

## Workstream 2 — Voice Interface

**Why second:** Voice is self-contained after the LLM router exists (STT produces text → LLM processes it → TTS speaks the result). No UI dependency — voice works headlessly before the Tauri app is built.

### 2.1 Local STT — Whisper.cpp

**New file:** `packages/gateway/src/voice/stt.ts`

#### 2.1.1 Binary and model management

Whisper.cpp is bundled as a native binary (`whisper-cli` / `whisper-cli.exe`). Model files are GGML format.

Resolution order for the binary (same pattern as llama.cpp):
1. `config.voice.whisperPath` TOML key
2. `NIMBUS_WHISPER_PATH` env variable
3. Platform PATH
4. `<appDir>/bin/whisper-cli[.exe]`

Default model: `whisper-base.en` (~142 MB). Model path: `<dataDir>/models/whisper-base.en.bin`.

New IPC methods:
- `voice.listSttModels` — scans `<dataDir>/models/` for `whisper-*.bin`
- `voice.setSttModel` — sets `config.voice.sttModel`

#### 2.1.2 Transcription

The STT module receives a PCM audio buffer (16 kHz, 16-bit mono — the format Whisper expects) and returns a transcript string.

```ts
interface SttProvider {
  transcribe(pcm: Buffer): Promise<string>;
  isAvailable(): Promise<boolean>;
}
```

Implementation: write PCM buffer to a temp `.wav` file named `stt-<uuid>.wav` (UUID v4 generated per call) → invoke `whisper-cli --model <path> --file <wav> --output-txt` → read stdout → delete temp file. Using a UUID per call rather than a fixed name ensures concurrent transcription requests (e.g. wake-word detection running alongside a push-to-talk call) do not collide on the same temp file path.

**Temp file security:** The temp `.wav` file is written to `<dataDir>/tmp/` (not the OS-global temp directory) with mode `0600` on POSIX. The `unlink` call is in a `finally` block — the file is deleted whether transcription succeeds or fails. The PCM buffer itself is held in memory only for the duration of the `transcribe()` call and is not persisted beyond the temp file. On Windows, the file is opened with `FILE_ATTRIBUTE_TEMPORARY` and `FILE_FLAG_DELETE_ON_CLOSE` flags for equivalent protection.

**Never stream audio to a remote endpoint.** The `isAvailable()` check verifies the binary path exists and the model file is present.

**Test:** `packages/gateway/test/unit/voice/stt.test.ts` — mock the whisper-cli subprocess; assert temp file creation/deletion in `<dataDir>/tmp/`, stdout parsing, error propagation; assert temp file is deleted even when whisper-cli exits non-zero.

---

### 2.2 Local TTS

**New file:** `packages/gateway/src/voice/tts.ts`

Platform-native TTS — no binary to bundle:

| Platform | Backend | Command |
|---|---|---|
| macOS | `say` CLI | `say -v <voice> "<text>"` |
| Windows | SAPI via PowerShell | `Add-Type -AssemblyName System.Speech; ...SpeakAsync(...)` |
| Linux | `pyttsx3` CLI wrapper | `python3 -c "import pyttsx3; e=pyttsx3.init(); e.say('...'); e.runAndWait()"` |

```ts
interface TtsProvider {
  speak(text: string): Promise<void>;
  isAvailable(): Promise<boolean>;
}
```

The `speak()` call is fire-and-forget for the UI layer (IPC method `voice.speak` returns immediately; audio plays async). A `voice.speakDone` notification is emitted when playback ends.

**Fallback:** if TTS is unavailable (Linux without pyttsx3), `voice.speak` silently no-ops and logs a warning — text response is still returned via IPC.

**Test:** `packages/gateway/test/unit/voice/tts.test.ts` — mock the platform subprocess; assert correct command construction per platform; assert `voice.speakDone` notification timing.

---

### 2.3 Voice Query Flow

**Modify:** `packages/gateway/src/ipc/handlers/voice.ts` (new file)

End-to-end flow for a push-to-talk voice query:

```
Client sends: voice.startQuery { audioChunks: Buffer[] }
Gateway:
  1. Concatenate chunks into a single PCM buffer
  2. stt.transcribe(pcm) → transcript string
  3. Emit voice.transcriptReady { transcript } notification (so UI can show what was heard)
  4. Route transcript through the streaming ask pipeline (engine.askStream)
  5. As LLM tokens arrive, buffer into sentence-length chunks using the `sbd` (Sentence Boundary Detection) library, which handles abbreviations (Mr., Dr., e.g., 1., 2.) and avoids the false positives produced by a naive split on '.', '!', '?', '\n'
  6. As each sentence-length chunk is ready, call tts.speak(chunk) — streaming TTS
     so audio playback begins before the LLM finishes generating
  7. Return voice.queryResult { transcript, result } when all tokens and all TTS chunks are done
```

**Latency budget:** Target silence-to-first-audio ≤ 3 s on a mid-range laptop using `whisper-base.en` + a local 3B parameter model. Breakdown: STT ≈ 0.8 s, first LLM sentence ≈ 1.2 s, TTS for first sentence ≈ 0.6 s, IPC overhead ≈ 0.2 s. Streaming TTS (step 6) is the key mechanism — the user hears the first sentence while the LLM is still generating subsequent content.

The client may also send a raw text string for TTS-only (for result readback without a query).

**IPC methods:**

| Method | Description |
|---|---|
| `voice.startQuery` | Full STT → ask → TTS flow |
| `voice.speak` | TTS-only for a given text string |
| `voice.transcriptReady` (notification) | Emitted after STT, before LLM processing |
| `voice.speakDone` (notification) | Emitted when TTS audio finishes |
| `voice.getSttStatus` | Returns STT availability + active model |
| `voice.getTtsStatus` | Returns TTS availability + platform backend |

---

### 2.4 Wake Word (opt-in, off by default)

**New file:** `packages/gateway/src/voice/wake-word.ts`

#### 2.4.1 Backend choice

Two backends are supported; the active backend is selected via `config.voice.wake_word_backend`:

| Backend | Privacy | Offline | Account required | Keyword customisation |
|---|---|---|---|---|
| **openWakeWord** (default) | 100% offline, no account, MIT licence | ✅ | None | Custom `.onnx` model files |
| **Porcupine** | Offline detection; access key validated at init (one-time network call to Picovoice servers, not on each wake) | After init | Free tier requires account + access key | Pre-built keywords or custom `.ppn` files |

**Default backend is openWakeWord** — it requires no account and has no init-time network call. Porcupine is available as an opt-in for users who need a larger keyword library or custom `.ppn` models. The Porcupine access key is stored in the Vault (key: `voice.porcupine_key`) and never written to the TOML file; `nimbus config get voice.porcupine_key` shows `[vault]`.

**Headless bundling for openWakeWord:** openWakeWord runs via the ONNX Runtime. For the headless binary bundle (`scripts/package-headless-bundle.ts`), the Gateway ships a self-contained `openwakeword-runner` binary (a small ONNX-Runtime-based Node.js native addon or a pre-compiled standalone CLI) alongside the bundled `hey_nimbus.onnx` model file. The `openwakeword-runner` binary is resolved using the same discovery chain as `whisper-cli` (config key → env var → PATH → `<appDir>/bin/`). The bundled model is ~7 MB. Users who want a custom wake word can supply their own `.onnx` file via `wake_word_model_path`.

Config:
```toml
[voice]
wake_word_enabled = false
wake_word_keyword = "hey nimbus"        # keyword name; backend-specific
wake_word_backend = "openwakeword"      # "openwakeword" | "porcupine"
wake_word_model_path = ""               # path to custom .onnx or .ppn model file; empty = bundled default
```

#### 2.4.2 Privacy guarantee

Microphone is only active when `wake_word_enabled = true` AND the Gateway is running. A `voice.microphoneActive` IPC notification is emitted whenever the mic opens or closes. The system tray badge (Workstream 5) reflects the active state with a distinct microphone icon.

**Test:** `packages/gateway/test/unit/voice/wake-word.test.ts` — stub both backends; assert mic lifecycle events; assert `microphoneActive` notification fires on open and close; assert wake word does not activate when `wake_word_enabled = false`; assert Porcupine backend is not initialised when `wake_word_backend = "openwakeword"`.

---

### Workstream 2 Acceptance Criteria

- [ ] Push-to-talk voice query (`voice.startQuery`) delivers first audio within 3 s (silence-to-first-audio) on macOS and Windows using `whisper-base.en` + a 3B local model; streaming TTS confirmed by `voice.speakDone` notification arriving before `voice.queryResult`
- [ ] Audio never leaves the machine — verified by network intercept in `voice-air-gap.e2e.test.ts`
- [ ] TTS works on macOS (`say`), Windows (SAPI), and Linux (pyttsx3); graceful no-op when unavailable
- [ ] Wake word does not start until explicitly enabled; `voice.microphoneActive` notification fires on every mic state change
- [ ] Coverage: `packages/gateway/src/voice/` ≥ 80%

---

## Workstream 3 — Data Sovereignty

**Why third:** Export/import/deletion and the tamper-evident audit log are release prerequisites independent of any UI. They must be verifiable by automated tests on all three platforms before `v0.1.0` is tagged.

### 3.1 `nimbus data export`

**New file:** `packages/gateway/src/commands/data-export.ts`  
**New CLI command:** `nimbus data export --output <path.tar.gz> [--no-index]`

`--no-index` skips `index.db.gz`. Use this for large indices (multi-GB) when only configuration and credentials need to be migrated; the index can be rebuilt by re-running `nimbus connector sync` on the target machine. When `--no-index` is passed, `manifest.json` records `"index_included": false` and `nimbus data import` skips the index restore step without error.

#### 3.1.1 Export bundle contents

The archive is a gzipped tarball with the following structure:

```
nimbus-backup-<timestamp>/
  manifest.json           -- bundle metadata + integrity hashes
  index.db.gz             -- SQLite snapshot (same as nimbus db snapshot output)
  vault-manifest.json.enc -- credential manifest re-encrypted with user passphrase (see 3.1.2)
  watchers.json           -- all watcher definitions (exported from watcher store)
  workflows.json          -- all workflow pipeline definitions
  extensions.json         -- list of installed extensions (id, version, source URL)
  profiles.json           -- all named profile configs (no secrets)
  audit-chain.json        -- full audit log with BLAKE3 chain (see 3.4)
```

`manifest.json` shape:
```json
{
  "version": 1,
  "nimbus_version": "0.1.0",
  "created_at": "<ISO8601>",
  "platform": "win32|darwin|linux",
  "contents": {
    "index_rows": 12345,
    "vault_entries": 8,
    "watchers": 3,
    "workflows": 2,
    "extensions": 5,
    "profiles": 2
  },
  "hashes": {
    "index.db.gz": "<blake3-hex>",
    "vault-manifest.json.enc": "<blake3-hex>",
    "watchers.json": "<blake3-hex>",
    "workflows.json": "<blake3-hex>"
  }
}
```

#### 3.1.2 Vault credential manifest

The Vault manifest contains connector credential identifiers only — not raw secret values. The format:

```json
[
  { "key": "google.drive.oauth", "service": "google", "connector": "drive", "type": "oauth_token" },
  { "key": "github.pat", "service": "github", "connector": "github", "type": "pat" }
]
```

On export the vault manifest is encrypted using **envelope encryption** so that both the user passphrase and the recovery seed (3.1.2) can independently decrypt it:

1. Generate a random 256-bit **Data Encryption Key (DEK)**
2. Encrypt the vault manifest JSON with the DEK (AES-256-GCM; random 96-bit IV)
3. Derive **Wrapped DEK (passphrase)**: Argon2id(passphrase, random salt, 3 iterations, 64 MB) → 256-bit key → AES-256-GCM wrap of DEK
4. Derive **Wrapped DEK (seed)**: Argon2id(recovery seed mnemonic as UTF-8, separate random salt, same parameters) → 256-bit key → AES-256-GCM wrap of DEK
5. Store the ciphertext + IV, both wrapped DEKs, and both salts in `vault-manifest.json.enc`

On import, the user supplies either the passphrase or `--recovery-seed`; the corresponding wrapped DEK is unwrapped to recover the DEK, then the DEK decrypts the manifest. Neither key can derive the other. The DEK itself is never stored or logged.

**Recovery seed:** On the first `nimbus data export`, the Gateway generates a BIP39 24-word mnemonic recovery seed and stores it in the Vault under `backup.recovery_seed`. The seed is derived independently from the Vault master key and can decrypt `vault-manifest.json.enc` if the user's passphrase is lost. The recovery seed is displayed once in the terminal after the first export (`nimbus data export` prints: `"Recovery seed (store offline): word1 word2 ... word24"`) and is never re-displayed automatically. `nimbus data import --recovery-seed "<mnemonic>"` accepts the seed in place of a passphrase.

On a machine that already has the credentials, the vault manifest is used to verify which connectors need re-authentication after import.

**Test:** `packages/gateway/test/unit/data/export.test.ts` — run export to a temp dir; assert all expected files exist; verify BLAKE3 hashes in manifest match actual content; verify vault manifest contains only key names, not raw secrets.

---

### 3.2 `nimbus data import`

**New CLI command:** `nimbus data import <path.tar.gz>`

Import flow:
1. Validate tarball structure — all expected files present; reject if any required file is missing
2. Verify BLAKE3 hashes from `manifest.json` for each content file — reject on mismatch
3. Prompt for vault passphrase (interactive; `--passphrase` flag for non-interactive)
4. Decrypt `vault-manifest.json.enc` → for each entry, attempt to re-seal the credential into the target machine's native Vault via `NimbusVault.set(key, decryptedValue)`
5. Restore SQLite index from `index.db.gz` (decompress + copy to `<dataDir>/nimbus.db`, overwriting existing after backup)
6. Re-register extensions from `extensions.json` — `ExtensionRegistry.install(source)` for each entry; skip if already installed at same version
7. Restore profile configs from `profiles.json`
8. Restore watcher definitions and workflow pipelines
9. Emit structured import report (counts restored per category, credential re-seal results, extensions skipped/installed)
10. Instruct user to run `nimbus connector auth <name>` for any credential entry that could not be re-sealed (e.g. OAuth tokens that expired during export)

**Test:** `packages/gateway/test/integration/data/import.test.ts` — export from a seeded test Gateway; clear the Gateway state; import; assert item counts match, watcher definitions restored, extensions re-registered; use the real SQLite layer (no mocks at the DB layer per testing philosophy).

---

### 3.3 `nimbus data delete`

**New CLI command:** `nimbus data delete --service <name> [--dry-run] [--yes]`

Before any deletion, the command always prints a pre-flight summary:

```
Service:        github
Items to delete:          1,243
Vec rows to delete:         987
Sync tokens to delete:        1
Vault entries to delete:      2 (github.pat, github.oauth)
People unlinked:             18 (person rows with no other service handles)
```

With `--dry-run`, the command exits after printing this summary and makes no changes. Without `--dry-run`, the summary is printed and the command prompts for confirmation (`Delete? [y/N]`) unless `--yes` is passed.

Deletion steps (executed only after confirmation):
1. `DELETE FROM items WHERE service = ?`
2. `DELETE FROM vec_items_384 WHERE rowid IN (SELECT rowid FROM items WHERE service = ?)` (rowids captured before step 1)
3. `DELETE FROM sync_state WHERE connector_id LIKE ?` (service prefix match)
4. `DELETE FROM people WHERE ...` (unlink handles for this service from `person_handles` join table; delete `person` rows with no remaining handles)
5. Remove all Vault entries for the service via `NimbusVault.delete(key)` for each matched key prefix
6. FTS5 targeted deletion: `DELETE FROM items_fts WHERE rowid IN (<rowids captured in step 1>)` — deletes only the FTS entries for the removed items. A full `VALUES('rebuild')` is **not used here** because it scans and rewrites the entire FTS5 index, which is an O(total index size) blocking operation that can take minutes on a multi-GB index. Targeted row deletion is O(deleted items) and does not block other reads.
7. Write signed deletion record to `audit_log` with `action = 'data.delete'`, `payload = { service, items_deleted, vault_entries_deleted }`

**Test:** `packages/gateway/test/unit/data/delete.test.ts` — seed items for two services; delete one; assert all rows, vec entries, sync tokens, vault entries for the deleted service are gone; assert the other service's data is untouched; assert audit log entry written.

---

### 3.4 Tamper-Evident Audit Log

**Modify:** `packages/gateway/src/db/audit.ts`

#### 3.4.1 BLAKE3 chaining

Each audit log row gains two new columns (new migration):

```sql
ALTER TABLE audit_log ADD COLUMN row_hash TEXT;
ALTER TABLE audit_log ADD COLUMN prev_hash TEXT;
```

On every audit log write:
1. Compute `prev_hash`: read the `row_hash` of the most recent row (or a genesis constant `"0000...0000"` for the first row)
2. Compute `row_hash`: BLAKE3 over `prev_hash || action || payload_json || timestamp`
3. Write both columns atomically with the rest of the row

The chain is append-only. Existing rows are never modified.

**Migration:** The migration runner computes `row_hash` and `prev_hash` retroactively for all existing rows ordered by the `id` primary key (not `created_at` — timestamps can collide if two rows are written in the same millisecond, which would produce a non-deterministic chain order). `id` is a monotonically-increasing integer (SQLite rowid alias) and is unambiguous. This is a one-time backfill inside the migration transaction, processed in batches of 1 000 rows.

#### 3.4.2 `nimbus audit verify`

**New CLI command:** `nimbus audit verify [--from-row <n>]`

**`nimbus audit verify` is not a startup check** — it is an on-demand command only. Running it at every Gateway startup on a large log would add unacceptable latency. Instead, the Gateway maintains an incremental verification cursor:

- A `_meta` table row (`key = 'audit_verified_through_id'`) stores the `id` of the last row that was successfully verified
- On each Gateway startup, only rows newer than `audit_verified_through_id` are re-verified (incremental mode)
- `nimbus audit verify` without flags runs full verification from the beginning and updates the cursor on success
- `nimbus audit verify --from-row <n>` starts from row `n` (useful for large logs after a known-good checkpoint)

Performance: BLAKE3 is extremely fast (~3 GB/s on a single core). At 100k rows with ~200 bytes of payload each, a full verify completes in under 1 s. At 1M rows it completes in under 10 s. The incremental path (startup check) touches only new rows and is always sub-millisecond for normal operation.

Walks audit log rows in insertion order and verifies:
- Each `row_hash` matches the recomputed hash of that row's data
- Each `row_hash` is referenced as `prev_hash` by the following row

Output:
```
[ok]   chain integrity — 1,243 rows verified (843 already verified, 400 new)
[FAIL] chain break at row 847: expected prev_hash abc123..., got def456...
```

Exit codes: `0` = intact, `1` = break detected.

#### 3.4.3 Audit log export

`nimbus audit export --output audit.json` writes all rows including chain fields to a JSON file for offline verification or compliance submission.

**Test:** `packages/gateway/test/unit/db/audit-chain.test.ts` — write 10 rows; verify chain; tamper with row 5's payload directly in SQLite; run verify; assert break detected at row 5; assert row 6 also fails (cascade detection stops at first break, report shows first break only).

---

### Workstream 3 Acceptance Criteria

- [ ] `nimbus data export` → wipe index and Vault → `nimbus data import` restores full functionality on a fresh machine with all connectors re-authenticated — verified in `import.test.ts` integration test
- [ ] `nimbus data export --no-index` produces a valid bundle accepted by `nimbus data import` (index restore skipped, sync can rebuild the index)
- [ ] Recovery seed: `nimbus data import --recovery-seed "<mnemonic>"` decrypts vault-manifest without the original passphrase — verified in `export.test.ts`
- [ ] Export bundle BLAKE3 hashes verified; a tampered archive is rejected on import
- [ ] `nimbus data delete --dry-run --service github` prints a pre-flight summary and exits without modifying any data
- [ ] `nimbus data delete --service github` removes all items, vec rows, vault entries for GitHub and writes a signed deletion record; verified on all three platforms
- [ ] `nimbus audit verify` detects a manually-introduced chain break at any row position; incremental mode on startup verifies only new rows
- [ ] Vault passphrase is never written to any file, log, or IPC payload during export or import
- [ ] Coverage: `packages/gateway/src/commands/data-*.ts` + `packages/gateway/src/db/audit.ts` chain paths ≥ 85%

---

## Workstream 4 — Release Infrastructure

**Why fourth:** Signing, auto-update, and Plugin API v1 must be in place before the release build step. The Extension Marketplace (Workstream 5) depends on Plugin API v1 being stable.

### 4.1 Code Signing

**New file:** `packages/gateway/src/scripts/sign.ts` (build-time helper)

#### 4.1.1 macOS — Gatekeeper Notarization

Prerequisites (out-of-band — not automated by this plan):
- Apple Developer ID Application certificate installed in CI keychain
- App-specific password for notarytool stored in CI secrets as `APPLE_NOTARIZE_PASSWORD`
- Team ID stored as `APPLE_TEAM_ID`

CI step (`.github/workflows/release.yml`):
```
codesign --deep --force --options runtime \
  --sign "Developer ID Application: <team>" \
  dist/Nimbus.app

xcrun notarytool submit dist/Nimbus.app.zip \
  --apple-id <ci-secret> \
  --password $APPLE_NOTARIZE_PASSWORD \
  --team-id $APPLE_TEAM_ID \
  --wait

xcrun stapler staple dist/Nimbus.app
```

#### 4.1.2 Windows — Authenticode

Prerequisites:
- Code signing certificate (EV or OV) + private key stored in CI secrets
- `signtool.exe` available on the Windows runner

CI step:
```
signtool sign /fd SHA256 /td SHA256 \
  /tr http://timestamp.digicert.com \
  /f cert.pfx /p $WIN_CERT_PASSWORD \
  dist/Nimbus-Setup.exe
```

#### 4.1.3 Linux — GPG signing

Prerequisites:
- GPG key pair; public key published to `keyserver.ubuntu.com` and documented in release notes
- Private key + passphrase stored in CI secrets

CI step:
```
gpg --batch --yes --passphrase $GPG_PASSPHRASE \
  --detach-sign --armor dist/nimbus_0.1.0_amd64.deb
gpg --batch --yes --passphrase $GPG_PASSPHRASE \
  --detach-sign --armor dist/nimbus-0.1.0-x86_64.AppImage
```

**New GitHub Actions workflow:** `.github/workflows/release.yml` — triggered on `git tag v*`; builds all three platform installers; runs signing steps; uploads artifacts; creates a GitHub Release draft with changelog.

---

### 4.2 Auto-Update

**New file:** `packages/gateway/src/updater/index.ts`

The auto-updater uses Tauri's built-in updater plugin with a self-hosted update server.

#### 4.2.1 Update server manifest format

The self-hosted server (GitHub Releases JSON endpoint or a simple static file) serves:

```json
{
  "version": "0.1.1",
  "notes": "Bug fixes and performance improvements",
  "pub_date": "2026-05-01T00:00:00Z",
  "platforms": {
    "darwin-x86_64":  { "url": "...", "signature": "..." },
    "darwin-aarch64": { "url": "...", "signature": "..." },
    "linux-x86_64":   { "url": "...", "signature": "..." },
    "windows-x86_64": { "url": "...", "signature": "..." }
  }
}
```

#### 4.2.2 Gateway update check

On Gateway startup (after IPC server is ready), check for updates:
1. `GET <update_server_url>` — resolve from `config.updater.url` (default: the release manifest URL)
2. Compare `version` field against `process.env.NIMBUS_VERSION` (injected at build time)
3. If newer version available: emit `updater.updateAvailable { version, notes }` IPC notification
4. **Do not auto-apply.** User must explicitly call `updater.applyUpdate` IPC method

`updater.applyUpdate` flow:
1. Download the platform-specific installer to a temp directory
2. Verify the Tauri-generated Ed25519 signature — abort if verification fails, delete the downloaded file
3. Back up the current Gateway binary to `<dataDir>/backups/gateway-prev[.exe]`
4. On macOS/Linux: shell out to the installer; on Windows: launch the NSIS installer silently
5. Gateway emits `updater.restarting` notification then exits — Tauri restart handles re-launch

**Rollback:** If the new binary fails to start (checked by the Tauri app via a watchdog on re-launch — it waits up to 15 s for the Gateway IPC socket to become ready), the Tauri app:
1. Restores `gateway-prev[.exe]` to the binary path
2. Emits `updater.rolledBack { fromVersion, toVersion, reason }` notification
3. Logs the failure to the audit log with `action = 'updater.rollback'`

`updater.rollback` IPC method triggers the rollback manually. There is no auto-apply-on-startup loop — a failed update stays rolled back until the user explicitly tries again.

Config:
```toml
[updater]
enabled = true
url = "https://releases.nimbus.dev/latest.json"
check_on_startup = true
```

**Test:** `packages/gateway/test/unit/updater/updater.test.ts` — mock the update server; assert `updateAvailable` notification fires when version is newer; assert no notification when version matches; assert `applyUpdate` downloads and verifies before executing.

---

### 4.3 Plugin API v1

**Modify:** `packages/sdk/src/index.ts`  
**Modify:** `packages/gateway/src/connectors/extension-registry.ts`

Plugin API v1 freezes the public surface that third-party connector authors depend on. Breaking changes after this point require a major version bump.

#### 4.3.1 Stable surface (frozen at v1)

| Export | Status |
|---|---|
| `NimbusExtensionManifest` | ✅ Stable |
| `NimbusTool` | ✅ Stable |
| `NimbusToolHandler` | ✅ Stable |
| `runContractTests()` | ✅ Stable |
| `McpServerBuilder` | ✅ Stable |
| `ItemSchema` | ✅ Stable |
| `PersonSchema` | ✅ Stable |
| `AuditLogger` | ✅ Stable — new in v1, was internal |
| `HitlRequest` | ✅ Stable — new in v1, was internal |

#### 4.3.2 New v1 additions

**`AuditLogger`** — extensions may write entries to the Gateway audit log (scoped to their extension ID):
```ts
interface AuditLogger {
  log(action: string, payload: Record<string, unknown>): Promise<void>;
}
```
The extension ID is automatically prefixed to `action` — an extension cannot write audit log entries outside its own scope.

**`HitlRequest`** — extensions may declare that a tool requires HITL confirmation:
```ts
interface HitlRequest {
  actionId: string;         // must match an entry in the extension manifest's `hitl_actions` list
  summary: string;          // human-readable action description
  diff?: string;            // optional before/after diff for the consent UI
}
```

#### 4.3.3 Changelog and migration guide

New file: `packages/sdk/CHANGELOG.md` — documents v1 as the stable baseline. Any future breaking change increments the semver major.

**Test:** `packages/sdk/test/plugin-api-v1.test.ts` — import every stable export; assert no TypeScript errors; assert `runContractTests()` passes against a minimal test extension that uses all stable exports.

---

### 4.4 Optional Encrypted LAN Remote Access

**New file:** `packages/gateway/src/ipc/lan-server.ts`

Read-only by default; write operations require a separate HITL approval on the host machine. The LAN server is off by default.

#### 4.4.1 Transport

NaCl box (X25519 Diffie-Hellman + XSalsa20-Poly1305 via [tweetnacl-js](https://github.com/dchest/tweetnacl-js)) provides E2E encryption with no relay server. Each Gateway generates an ephemeral X25519 keypair on startup.

Pairing flow:
1. Host runs `nimbus lan enable --allow-pairing` — opens a 5-minute pairing window; Gateway prints a 20-character base58 pairing code (truncated SHA-256 of the public key, 120 bits of entropy). The window closes automatically after 5 minutes or after the first successful pair, whichever comes first. `nimbus lan enable` without `--allow-pairing` starts the LAN server but accepts connections from already-paired peers only.
2. Client runs `nimbus lan pair <host-ip> <pairing-code>`; performs key exchange; stores peer public key in a `lan_peers` SQLite table
3. All subsequent JSON-RPC messages are NaCl box-encrypted; unrecognised public keys are rejected

**Brute-force protection:** The pairing endpoint enforces a rate limit of 3 failed attempts per 60 s per source IP; exceeding this causes a 60 s lockout and logs a warning. The 20-character code (120 bits) makes online brute-force infeasible even without this limit, but the rate limit provides defence-in-depth.

#### 4.4.2 Permission model

- Read-only methods (`index.*`, `connector.list`, `status.*`, `diag.*`) are available to any paired peer
- Write methods and HITL methods require an explicit `lan_peer_write_allowed = true` flag in the `lan_peers` row — set via `nimbus lan grant-write <peer-id>`
- HITL consent dialogs on the host always show the originating peer ID

Config:
```toml
[lan]
enabled = false
port = 7475
```

**Test:** `packages/gateway/test/integration/lan/lan-rpc.test.ts` — start two Gateway instances in-process with loopback; pair them; verify read methods succeed; verify write method is rejected without `grant-write`; verify a tampered ciphertext is rejected.

---

### Workstream 4 Acceptance Criteria

- [ ] `v0.1.0` installer passes Gatekeeper on macOS (no user override) — verified on macOS CI runner
- [ ] `v0.1.0` installer passes SmartScreen on Windows (no user override) — verified on Windows CI runner
- [ ] Linux `.deb` and AppImage ship with detached GPG signatures; `gpg --verify` passes
- [ ] `updater.updateAvailable` notification fires when a mock update server reports a newer version; `applyUpdate` verifies the Ed25519 signature before executing; a simulated corrupted binary triggers automatic rollback and `updater.rolledBack` notification
- [ ] Plugin API v1 is documented in `packages/sdk/CHANGELOG.md`; `runContractTests()` passes against a test extension using all v1 stable exports
- [ ] LAN server: `--allow-pairing` window closes after 5 minutes; 3 failed attempts per 60 s triggers lockout; paired peer can read index; write is rejected without explicit `grant-write`; tampered ciphertext rejected — `lan-rpc.test.ts`

---

## Workstream 5 — Tauri Desktop Application

**Why fifth:** All Gateway IPC APIs are stable after Workstreams 1–4. The UI is a pure consumer of IPC — it never imports Gateway source. The Tauri scaffold (`packages/ui/`) exists but is empty.

**Tech stack:** Tauri 2.0 + React 18 + TypeScript strict. State management: Zustand. Styling: Tailwind CSS v4. Component library: Radix UI primitives (accessible, unstyled). Build: Vite (already configured in `packages/ui/vite.config.ts`).

### 5.1 IPC Client Layer

**New file:** `packages/ui/src/ipc/client.ts`

The UI uses `@tauri-apps/api/core` `invoke` for Tauri commands and a WebSocket or named-pipe connection for JSON-RPC notifications. Since Tauri 2.0 exposes `tauri::ipc`, the UI communicates with the **running Gateway** via the same domain socket / named pipe used by the CLI.

Architecture: the Tauri Rust backend (`src-tauri/`) acts as a thin bridge — it opens the Gateway socket, forwards JSON-RPC requests from the frontend, and streams notifications back. The frontend never opens the socket directly.

**New Rust file:** `packages/ui/src-tauri/src/gateway_bridge.rs`

```rust
// Opens the Gateway IPC socket and exposes two Tauri commands:
// - rpc_call(method: String, params: serde_json::Value) -> Result<serde_json::Value, String>
// - subscribe_notifications() -> channel that emits JSON-RPC notifications
```

**Method allowlist:** `gateway_bridge.rs` maintains a compile-time `ALLOWED_METHODS: &[&str]` set of every RPC method the frontend is permitted to call. Any `rpc_call` invocation for a method not in this set is rejected with `ERR_METHOD_NOT_ALLOWED` before the request reaches the Gateway socket. This prevents a compromised frontend (e.g. via a malicious extension that injects into the webview) from calling sensitive internal Gateway methods like `vault.*` or raw `db.*` operations. The allowlist is the single source of truth for the frontend's IPC surface — new UI features must add their methods to `ALLOWED_METHODS` explicitly.

**Gateway-offline state:** If the Gateway socket connection fails or is lost while the UI is open:
- All panels enter a skeleton loading state (not a spinner — a static placeholder layout with greyed content)
- A dismissible amber banner appears at the top: `"Gateway is not running. [Start Gateway]"`
- The "Start Gateway" button calls the Tauri `shell.execute("nimbus start")` command
- Once the socket reconnects, the banner dismisses automatically and panels re-fetch their data
- This state is implemented in a `GatewayConnectionProvider` React context that wraps the entire app

**Test:** `packages/ui/test/ipc-client.test.ts` (Vitest) — mock the Tauri `invoke` bridge; assert request serialisation, response deserialisation, notification dispatch; assert `ERR_METHOD_NOT_ALLOWED` is returned for a method not in the allowlist; assert `GatewayConnectionProvider` enters offline state on socket close and recovers on reconnect.

---

### 5.2 System Tray

**Modify:** `packages/ui/src-tauri/src/lib.rs`

The system tray is a Tauri 2.0 `SystemTray` with:

- **Icon variants:** normal (all connectors healthy), amber dot (at least one connector degraded), red dot (at least one connector in error/unauthenticated state)
- **Quick-query popup:** activatable via configurable hotkey (default: `Ctrl+Shift+N` / `Cmd+Shift+N`); a floating mini-window with a single text input; submits to `engine.ask` and streams the result; closes on `Escape` or focus loss
- **Badge:** integer count of pending HITL actions; shown when > 0; clicking the badge opens the Dashboard HITL queue

Tray menu items:
```
Nimbus  [icon]
──────────────
Open Dashboard
Quick Query     Ctrl+Shift+N
──────────────
Connectors      → submenu: list of connectors with health dot
──────────────
Settings
──────────────
Quit
```

**Test:** Tauri system tray is not unit-testable in isolation — covered by manual smoke test checklist in the acceptance criteria section.

---

### 5.3 Dashboard

**New file:** `packages/ui/src/pages/Dashboard.tsx`

Panels (left-to-right, top-to-bottom layout):

**Connector Status Panel**
- One card per connected service; shows health state badge (healthy / degraded / error / rate_limited / unauthenticated / paused)
- Click → connector detail drawer (last sync time, item count, health history sparkline, re-auth button if unauthenticated)
- Data source: `connector.list` IPC (poll every 30 s or on `connector.healthChanged` notification)

**Index Summary Panel**
- Total items, embedding coverage %, per-service item count table
- p95 query latency (from `diag.snapshot`)
- "Last sync" timestamp per connector
- Data source: `diag.snapshot` IPC

**Recent Agent Actions Panel**
- Last 20 entries from `audit_log` where `action` starts with `agent.` or `hitl.`
- Expandable row shows full payload
- Data source: `index.auditLog` IPC (paginated)

**Active Watchers Panel**
- List of enabled watchers with last-fired timestamp and status
- Data source: `watcher.list` IPC

**CLI-UI state sync:** The Gateway emits `index.changed { source, affectedServices }` IPC notifications whenever the index is modified by an external agent (CLI command, sync cycle, watcher fire). The Dashboard subscribes to this notification and triggers a re-poll of the affected panels. This ensures the UI stays consistent when a user runs `nimbus connector sync github` in a terminal while the Dashboard is open. The `source` field (`"cli"`, `"sync"`, `"watcher"`, `"api"`) is shown as a subtle "Updated by CLI" toast.

---

### 5.4 HITL Consent Dialogs

**New file:** `packages/ui/src/components/HitlDialog.tsx`

Triggered by `agent.hitlBatch` IPC notification. The dialog:

- Shows a modal overlay (cannot be dismissed without approving or rejecting)
- Lists each action in the batch with:
  - Action type and target resource
  - Human-readable summary string (from `HitlRequest.summary`)
  - If `diff` is present: a two-pane before/after diff rendered with syntax highlighting (Shiki)
  - Per-action Approve / Reject toggle
- "Approve Selected" button — sends `hitl.respond` IPC with per-action decisions
- "Reject All" shortcut button
- The dialog cannot be minimised while actions are pending

**Test:** `packages/ui/test/HitlDialog.test.tsx` (Vitest + Testing Library) — render with a mock batch of 3 actions; assert all three are shown; simulate approving 2 and rejecting 1; assert `hitl.respond` called with correct payload.

---

### 5.5 Extension Marketplace Panel

**New file:** `packages/ui/src/pages/Marketplace.tsx`

Requires a Marketplace backend (a static JSON manifest hosted alongside the release artifacts). The manifest format:

```json
{
  "extensions": [
    {
      "id": "nimbus-dev/github-extra",
      "name": "GitHub Extra",
      "description": "...",
      "version": "1.2.0",
      "author": "nimbus-dev",
      "verified": true,
      "rating": 4.7,
      "downloads": 1200,
      "changelog_url": "...",
      "source_url": "..."
    }
  ]
}
```

UI features:
- Search / filter by name or tag
- Install button → calls `extension.install` IPC → shows progress notification
- Installed extensions show version + Update Available badge (if newer version in manifest)
- Auto-update toggle per extension
- Verified publisher badge (gold checkmark)
- **Sandboxing level badge:** each extension card shows the current sandbox level — `"Process + env isolation"` (Phase 3/4 level, what is active) or `"Full syscall isolation"` (Phase 5, not yet active). This is honest about the current security posture rather than implying full sandboxing. The badge is informational; it does not block installation.

**Test:** `packages/ui/test/Marketplace.test.tsx` — mock the manifest fetch; assert install button calls `extension.install`; assert "Update Available" badge shown when manifest version > installed version; assert sandboxing level badge shows correct text for each sandbox level value.

---

### 5.6 Watcher Management UI

**New file:** `packages/ui/src/pages/Watchers.tsx`

Features:
- List of all watchers with enabled/paused toggle, last-fired timestamp, fire count
- "New Watcher" form: name, trigger condition (service + event type), action (workflow to run or custom command), notification channel
- Condition builder: dropdowns for service → event type → field comparators — no raw JSON editing required
- History drawer per watcher: timeline of past fires with payload preview
- Delete with confirmation dialog

Data sources: `watcher.list`, `watcher.create`, `watcher.update`, `watcher.delete`, `watcher.history` IPC.

---

### 5.7 Workflow Pipeline Editor

**New file:** `packages/ui/src/pages/Workflows.tsx`

Features:
- List of saved workflows with last-run status badge
- Visual step list editor (ordered list, not a graph — matching the Phase 3 linear + Phase 4 branching DSL)
- Step types: tool call, condition (`if`/`else`/`switch`), parallel branch group, delay
- Step inspector: configure tool, input parameters, output binding
- Run history table with per-step status and duration
- "Re-run from step N" action — calls `workflow.rerun` IPC with `fromStep` parameter
- Parameter override panel before run (pre-flight form)
- Dry-run toggle

Data sources: `workflow.list`, `workflow.create`, `workflow.update`, `workflow.delete`, `workflow.run`, `workflow.history` IPC.

---

### 5.8 Settings Panel

**New file:** `packages/ui/src/pages/Settings.tsx`

Sections:

| Section | Controls |
|---|---|
| Model | Cloud vs local toggle; local model dropdown (from `llm.listModels`); pull button; per-task routing table |
| Connectors | Sync interval slider per connector; pause/resume toggle |
| Profile | Profile switcher dropdown; create/delete profile |
| Vault | Key listing — names only, no values shown; "Re-authenticate" button per key |
| Audit Log | Paginated table; export button (`nimbus audit export` via IPC) |
| Data | Export button; Import button (file picker); Delete service picker |
| Telemetry | Opt-in toggle; preview current payload button |
| Voice | STT model selector; TTS voice selector; wake word toggle + keyword config |
| Updates | Current version; "Check for updates" button; auto-update toggle |
| Advanced | Air-gap mode toggle; LAN remote access toggle + peer list |

---

### Workstream 5 Acceptance Criteria

- [ ] System tray icon changes to amber/red when a connector transitions to degraded/error — verified manually on all three platforms
- [ ] Quick-query popup opens on hotkey; submits a query; streams the result; closes on Escape — all three platforms
- [ ] HITL consent dialog appears for a write action; approving 1 and rejecting 1 in a batch of 2 sends correct per-action decisions to the Gateway
- [ ] Gateway-offline banner appears within 2 s of the Gateway process being killed while the UI is open; disappears automatically on reconnect
- [ ] RPC method not in `ALLOWED_METHODS` is rejected by the Rust bridge with `ERR_METHOD_NOT_ALLOWED` — verified in `ipc-client.test.ts`
- [ ] Dashboard re-fetches affected panels within 2 s of receiving an `index.changed` notification from a CLI-triggered sync
- [ ] Extension Marketplace installs an extension from the manifest and shows "Installed" state without a page reload; sandboxing level badge shows correct text
- [ ] Watcher condition builder creates a valid watcher that fires in the next sync cycle after creation
- [ ] Workflow dry-run executes without dispatching any real tool calls — verified via Gateway audit log showing zero non-dry-run entries
- [ ] Settings → Model: switching to a local Ollama model and running a query confirms the router used the local model (`llm.getRouterStatus`)
- [ ] All Vitest UI component tests pass (`cd packages/ui && bunx vitest run`)
- [ ] `v0.1.0` installer launches without Terminal prompt on macOS and without SmartScreen block on Windows

---

## Workstream 6 — Rich TUI (Ink)

**Why sixth:** The TUI is a CLI-layer concern. It builds on the same IPC surface as the Tauri UI but has no Rust dependency. Can begin once Workstreams 1–4 are stable.

### 6.1 Package Setup

**Modify:** `packages/cli/package.json` — add `ink` and `react` as dependencies (Ink renders React to a terminal).

No new package needed — the TUI lives inside `packages/cli/src/tui/`.

### 6.2 Layout

**New file:** `packages/cli/src/tui/App.tsx`

Pane layout (vertical split, keyboard-resizable):

```
┌─────────────────────────────────┬──────────────────────┐
│  Query Input                    │  Connector Health    │
│  ─────────────────────────────  │  ────────────────    │
│  Result Stream                  │  ● google       ok   │
│                                 │  ● github       ok   │
│                                 │  ● slack    degrad.  │
├─────────────────────────────────┼──────────────────────┤
│  Active Watchers                │  Sub-Task Progress   │
│  watcher-1  fired 2m ago        │  [▓▓▓░░░] step 2/5  │
└─────────────────────────────────┴──────────────────────┘
```

Keyboard navigation:
- `Tab` / `Shift+Tab` — cycle focus between panes
- `↑` / `↓` — scroll within the focused pane
- `Ctrl+L` — clear result stream
- `Ctrl+C` — quit (with confirmation if a query is in flight)
- `?` — show keybind help overlay

### 6.3 Query Input Pane

**New file:** `packages/cli/src/tui/QueryInput.tsx`

- Single-line text input (Ink `TextInput`)
- Enter submits to `engine.ask` via IPC
- Results stream token-by-token into the Result Stream pane via `engine.askStream` (new streaming IPC method — see 6.5)
- History: `↑` / `↓` in an empty input field scrolls through query history (stored in `<dataDir>/query_history.json`, last 100 entries)
- Real-time inline HITL: if a `agent.hitlBatch` notification arrives during streaming, the result stream pauses and a consent panel overlays the query input; user approves/rejects with `y`/`n` per action; streaming resumes after response

### 6.4 Connector Health Sidebar

**New file:** `packages/cli/src/tui/ConnectorHealth.tsx`

- Polls `connector.list` every 30 s (or on `connector.healthChanged` notification)
- One line per connector: coloured dot (green/amber/red/grey) + service name + state label
- `Enter` on a highlighted connector opens a detail overlay with the last 5 health transitions

### 6.5 `engine.askStream` IPC Method

**Modify:** `packages/gateway/src/ipc/handlers/engine.ts`

Existing `engine.ask` returns a complete string result. The TUI and voice query flow require a streaming variant:

`engine.askStream` is a JSON-RPC method that streams token notifications:
- Returns immediately with `{ streamId: string }`
- Emits `engine.streamToken { streamId, token }` notifications as the LLM produces tokens
- Emits `engine.streamDone { streamId, result }` when the stream is complete
- Emits `engine.streamError { streamId, error }` on failure

The existing `engine.ask` path is unchanged — it continues to collect all tokens internally before returning.

**Test:** `packages/gateway/test/unit/ipc/engine-stream.test.ts` — mock the LLM router to emit 5 tokens; assert 5 `streamToken` notifications followed by 1 `streamDone`; assert `streamId` is consistent across all notifications.

### 6.6 Active Watchers Pane and Sub-Task Progress Pane

**New file:** `packages/cli/src/tui/WatcherPane.tsx`  
**New file:** `packages/cli/src/tui/SubTaskPane.tsx`

- Watcher pane: polling `watcher.list` every 30 s; shows name + time since last fire
- Sub-task pane: subscribes to `agent.subTaskProgress` notifications; renders a progress bar per sub-task; clears when the coordinator session ends

### 6.7 SSH Safety

Ink renders using ANSI escape codes. To remain SSH-safe:
- Check `TERM` and `NO_COLOR` at startup; if either indicates a dumb terminal, fall back to the existing Phase 3 REPL (`nimbus` with no args, non-Ink path)
- The fallback is automatic — no `--no-tui` flag needed

### 6.8 `nimbus tui` Command

**Modify:** `packages/cli/src/index.ts` — add `tui` subcommand that launches `packages/cli/src/tui/App.tsx`.

Also launchable from system tray "Open TUI" menu item (Workstream 5.2).

---

### Workstream 6 Acceptance Criteria

- [ ] `nimbus tui` launches on all three platforms; query input accepts text; result streams token-by-token
- [ ] HITL consent overlay appears mid-stream when a write action is triggered; approving resumes the stream
- [ ] Connector health sidebar updates within 30 s of a connector transitioning to degraded
- [ ] Sub-task progress pane shows parallel sub-tasks advancing independently
- [ ] `TERM=dumb nimbus tui` falls back to the Phase 3 REPL without error
- [ ] `engine.askStream` coverage ≥ 80% (`packages/gateway/src/ipc/handlers/engine.ts` streaming path)

---

## Workstream 7 — VS Code Extension

**Why last:** Depends on `@nimbus-dev/client` (Phase 3.5, published), stable IPC surface (Workstreams 1–4), and Plugin API v1 (Workstream 4.3). No Rust required.

### 7.1 Package Bootstrap

**New package:** `packages/vscode-extension/`

```
packages/vscode-extension/
  package.json           -- publisher, engines.vscode, contributes
  tsconfig.json          -- target: ES2020, module: CommonJS (VS Code host requirement)
  src/
    extension.ts         -- activate() / deactivate()
    gateway-client.ts    -- @nimbus-dev/client wrapper for the Node.js IPC transport
    commands/
      ask.ts
      search.ts
      run-workflow.ts
    hitl/
      consent-ui.ts      -- VS Code notification + diff provider
    statusbar/
      item.ts
  test/
    extension.test.ts    -- vscode-test harness
```

`package.json` key fields:
```json
{
  "publisher": "nimbus-dev",
  "name": "nimbus",
  "engines": { "vscode": "^1.90.0" },
  "main": "./dist/extension.js",
  "dependencies": { "@nimbus-dev/client": "*" },
  "devDependencies": { "@types/vscode": "^1.90.0", "@vscode/test-cli": "*" }
}
```

The extension depends on `@nimbus-dev/client` only — it never imports Gateway TypeScript source (package dependency rule).

### 7.2 Gateway Connection

**New file:** `packages/vscode-extension/src/gateway-client.ts`

`@nimbus-dev/client` (`NimbusClient`) connects over the domain socket / named pipe using Node.js `net.Socket`. The VS Code extension environment is Node.js, not Bun — the client must work in both runtimes (this is a pre-existing requirement of `@nimbus-dev/client`'s design; verify during implementation).

On `activate()`:
1. Attempt to connect to the Gateway socket path (resolved from `nimbus.gatewaySocket` VS Code setting, defaulting to the platform default path)
2. If connection fails: status bar shows "Nimbus: not running" with a "Start" button that shells out to `nimbus start`
3. Subscribe to `connector.healthChanged` and `agent.hitlBatch` notifications

**Remote-SSH and WSL:** These environments run VS Code's extension host inside a remote Linux process while the Gateway typically runs on the Windows host. Socket forwarding is not automatic. **v0.1.0 scope:** the extension supports local connections only (extension host and Gateway on the same machine). Remote-SSH and WSL are explicitly out of scope for v0.1.0 and are documented as a known limitation in the extension's README. The `nimbus.gatewaySocket` setting accepts a TCP address (`127.0.0.1:7474`) as well as a socket path — users who manually set up SSH port forwarding can use this to connect across the boundary, but it is not a supported configuration. Full Remote-SSH/WSL support is deferred to a post-v0.1.0 patch.

### 7.3 Commands Palette

**New file:** `packages/vscode-extension/src/commands/ask.ts`

`Nimbus: Ask` command:
1. Opens a VS Code Quick Pick input box
2. Opens a new read-only virtual document (`vscode.workspace.openTextDocument({ content: '', language: 'markdown' })`) and shows it in the editor
3. Subscribes to `engine.askStream` (6.5) for the query
4. On each `engine.streamToken` notification, appends the token via `WorkspaceEdit.insert(endOfDocumentPosition, token)` — an O(1) delta append. Full-document replacement on every token is **not used** because replacing a growing buffer 10–20 times per second causes measurable CPU overhead and UI stutter in the VS Code extension host for long responses. `endOfDocumentPosition` is resolved once per notification by reading `document.lineCount` and `document.lineAt(last).range.end`.
5. On `engine.streamDone`, marks the document as finalised (title changes from `"Nimbus: Answering..."` to `"Nimbus: <first 50 chars of query>"`)

The virtual document approach avoids the limitations of VS Code's `OutputChannel` (no Markdown rendering) and avoids the complexity of a Webview for a plain text stream.

`Nimbus: Search` command:
1. Opens a Quick Pick input
2. Sends `index.search` IPC
3. Results shown in a Quick Pick list; selecting an item opens it in the editor (if it's a file path) or opens a preview tab (for non-file items)

`Nimbus: Run Workflow` command:
1. Fetches `workflow.list` and shows workflows in a Quick Pick
2. Prompts for any parameter overrides
3. Calls `workflow.run` IPC
4. Progress shown in VS Code's Progress API (bottom-right notification)

### 7.4 Inline HITL Consent UI

**New file:** `packages/vscode-extension/src/hitl/consent-ui.ts`

Triggered by `agent.hitlBatch` notification:
1. For each action in the batch, show a VS Code `window.showInformationMessage` with Approve / Reject buttons
2. If `diff` is present, open a diff editor tab (VS Code `vscode.diff` command) before showing the message
3. Collect all responses and call `hitl.respond` IPC with the consolidated decisions

For batches > 3 actions: open a Webview panel with the full consent form (reuses the HitlDialog React component compiled for WebView context).

### 7.5 Status Bar Item

**New file:** `packages/vscode-extension/src/statusbar/item.ts`

```
$(nimbus-icon) Nimbus: work  [health dot]
```

- Shows the active profile name
- Health dot colour: green / amber / red (same logic as tray icon)
- Click → runs `Nimbus: Ask`
- Tooltip: Gateway version, connected services count, index item count

### 7.6 Compatible Hosts

The extension uses only stable VS Code API (`vscode.window`, `vscode.commands`, `vscode.workspace`) with no Electron-specific calls. Verified compatible with:
- VS Code 1.90+
- Cursor
- Windsurf
- VSCodium
- Gitpod (browser-hosted)

### 7.7 Publishing

**New workflow:** `.github/workflows/publish-vscode.yml` — triggered on `git tag vscode-v*`.

Steps:
1. `cd packages/vscode-extension && npm run compile`
2. `bunx @vscode/vsce package` — generates `.vsix`
3. `bunx @vscode/vsce publish` — publishes to VS Code Marketplace (`VSCE_TOKEN` CI secret)
4. `bunx ovsx publish` — publishes to Open VSX Registry (`OVSX_TOKEN` CI secret)
5. Upload `.vsix` as a GitHub Release artifact

**Test:** `packages/vscode-extension/test/extension.test.ts` — use `@vscode/test-cli`; mock the `NimbusClient`; assert `Nimbus: Ask` command opens an editor tab; assert status bar item shows "not running" when client connection fails.

---

### Workstream 7 Acceptance Criteria

- [ ] `Nimbus: Ask` opens a streaming Markdown tab and returns a result from the running Gateway
- [ ] `Nimbus: Search` returns results from the local index in a Quick Pick list
- [ ] Inline HITL consent appears as a VS Code notification; approving sends the correct response to the Gateway
- [ ] Status bar shows active profile name and updates health dot when a connector transitions
- [ ] Extension installs from Open VSX without any manual configuration and connects to a running Gateway — verified on VS Code 1.90+ and Cursor
- [ ] Published to both VS Code Marketplace and Open VSX Registry via the `vscode-v*` tag workflow

---

## Automation & Graph Enhancements

These items extend Phase 3 primitives and are independent of the UI workstreams. They can be completed in parallel with Workstream 5 or 6.

### A.1 Graph-Aware Watcher Conditions

**Modify:** `packages/gateway/src/watchers/condition-evaluator.ts`

New condition types (all additive, backwards-compatible with Phase 3 linear conditions):

| Condition type | Parameters | Description |
|---|---|---|
| `graph.has_relation` | `from_entity_id`, `relation_type`, `to_entity_type` | True if a directed relation of the given type exists between the entity and any entity of the target type |
| `graph.path_exists` | `from_entity_id`, `to_entity_id`, `max_hops` | True if a path exists between two entities within the hop limit |
| `graph.neighbor_count` | `entity_id`, `relation_type`, `op`, `value` | True if the count of neighbours satisfies the comparison (e.g. `>= 3`) |

Implementation uses `traverseGraph` from the Phase 3 relationship graph substrate — no new graph query engine required.

**Test:** `packages/gateway/test/unit/watchers/graph-conditions.test.ts` — seed a graph; assert each condition type evaluates correctly; assert backwards compatibility with existing Phase 3 condition definitions.

---

### A.2 Workflow Branching and Conditionals

**Modify:** `packages/gateway/src/workflows/runner.ts`  
**Modify:** `packages/gateway/src/workflows/dsl.ts`

New step types (additive to Phase 3 linear step list):

```ts
type Step =
  | ToolCallStep          // Phase 3 — unchanged
  | IfStep                // new: { condition: Expr; then: Step[]; else?: Step[] }
  | SwitchStep            // new: { on: Expr; cases: { value: unknown; steps: Step[] }[] }
  | ParallelStep          // new: { branches: Step[][] } — independent branches run concurrently
  | DelayStep             // new: { durationMs: number }
```

Condition expressions can reference:
- Step outputs: `$steps.<stepId>.output`
- Index query results: `$index.query(<filter>).count`
- Watcher event payload fields: `$event.<field>`

**Expression evaluator safety:** `Expr` values are evaluated using [`json-logic-js`](https://github.com/jwadhams/json-logic-js) — a declarative, data-driven rule format with no access to the JavaScript runtime. `eval()`, `new Function()`, and any other string-execution mechanism are explicitly forbidden in the condition evaluator. `json-logic-js` rules are pure JSON objects (e.g. `{ ">": [{ "var": "$steps.fetch.output.count" }, 0] }`), so they are safely serialisable to the workflow DSL file and cannot execute arbitrary code. A custom `var` resolver maps the `$steps.*`, `$index.*`, and `$event.*` path prefixes to their runtime values before passing the resolved data object to `json_logic.apply()`.

Parallel branches execute via `Promise.all`; any branch containing a HITL step pauses the entire parallel group until consent is received (same consolidation logic as 1.5.4).

DSL backwards-compatibility: Phase 3 linear pipelines (arrays of `ToolCallStep`) remain valid without modification.

**Test:** `packages/gateway/test/unit/workflows/branching.test.ts` — assert `if/else` evaluates both branches; assert `switch` routes correctly; assert parallel branches advance independently; assert a HITL step in one parallel branch pauses sibling branches until consent; assert Phase 3 linear pipeline still runs unchanged; assert that an `Expr` containing a `$steps.*` path with no matching step resolves to `null` without throwing; assert that attempting to pass a raw JavaScript string expression (not a `json-logic` object) is rejected with a validation error at workflow-load time.

---

### A.3 Per-Connector OAuth Vault Keys

**Modify:** `packages/gateway/src/connectors/` (individual connector files)  
**New migration**

Migrate shared family vault keys to per-connector scoped keys:

| Old key | New key |
|---|---|
| `google.oauth` | `google.drive.oauth`, `google.gmail.oauth`, `google.photos.oauth` |
| `microsoft.oauth` | `microsoft.onedrive.oauth`, `microsoft.outlook.oauth`, `microsoft.teams.oauth` |

Migration strategy:
1. On `nimbus connector auth <name>` for any Google/Microsoft connector: write the new scoped key, read from old key as fallback if new key absent
2. `nimbus migrate-vault-keys` CLI command (one-time, idempotent): reads the old key, copies value to each new scoped key, deletes the old key, writes a migration record to the audit log
3. The migration is transparent — no re-authentication required if the old key is still valid
4. Old key is deleted only after all scoped keys are successfully written

**Test:** `packages/gateway/test/unit/vault/key-migration.test.ts` — assert scoped key is written; assert old key is read as fallback when scoped key absent; assert old key is deleted after migration; assert audit log entry written.

---

## Schema Migration Ordering

All Phase 4 schema changes are append-only to the `_schema_migrations` ledger. The migrations must be applied in this order (continuing from the last Phase 3.5 migration number, denoted here as N):

| Migration | New objects | Workstream |
|---|---|---|
| N+1 | `llm_models` table; add `last_error`, `bench_tps` columns | 1.1.4 |
| N+2 | `sub_task_results` table | 1.5.3 |
| N+3 | `ALTER TABLE audit_log ADD COLUMN row_hash TEXT`; `ALTER TABLE audit_log ADD COLUMN prev_hash TEXT`; backfill existing rows | 3.4.1 |
| N+4 | `lan_peers` table | 4.4.1 |
| N+5 | `_meta` table row `audit_verified_through_id` (initial value: null) | 3.4.2 |

**Migration N+3 (audit chain backfill)** is the only migration with a non-trivial runtime cost. For large existing audit logs it processes rows in batches of 1,000 inside the single migration transaction. The migration runner's pre-migration backup (Phase 3.5) applies before this runs.

Each migration follows the existing runner contract: numbered, append-only, single-transaction, pre-migration backup, rollback on failure.

---

## Consolidated Acceptance Criteria

The following checklist is the `v0.1.0` release gate. **Do not tag `v0.1.0` until every item is ticked on Windows, macOS, and Linux.**

Use `[x] code` when the implementation exists. Use `[x] verified` only after manual verification on the target platform — not when the code alone exists.

### Platform: Windows

- [ ] code / [ ] verified — `nimbus ask "summarize my week"` runs via Ollama (no API key)
- [ ] code / [ ] verified — `nimbus ask` runs via llama.cpp GGUF (no Ollama)
- [ ] code / [ ] verified — Voice push-to-talk query round-trip (STT → LLM → TTS)
- [ ] code / [ ] verified — `nimbus data export` + `nimbus data import` restores full state
- [ ] code / [ ] verified — `nimbus audit verify` passes on a fresh Gateway with 100+ audit rows
- [ ] code / [ ] verified — Authenticode-signed installer passes SmartScreen without user override
- [ ] code / [ ] verified — Tauri UI launches; Dashboard shows connector health; HITL dialog fires for a write action
- [ ] code / [ ] verified — `nimbus tui` launches; query input accepts text; result streams
- [ ] code / [ ] verified — VS Code extension connects to Gateway; `Nimbus: Ask` works

### Platform: macOS

- [ ] code / [ ] verified — `nimbus ask "summarize my week"` runs via Ollama (no API key)
- [ ] code / [ ] verified — `nimbus ask` runs via llama.cpp GGUF (no Ollama)
- [ ] code / [ ] verified — Voice push-to-talk query round-trip (STT → LLM → TTS)
- [ ] code / [ ] verified — `nimbus data export` + `nimbus data import` restores full state
- [ ] code / [ ] verified — `nimbus audit verify` passes on a fresh Gateway with 100+ audit rows
- [ ] code / [ ] verified — Gatekeeper-notarized `.pkg` passes without user override
- [ ] code / [ ] verified — Tauri UI launches; Dashboard shows connector health; HITL dialog fires for a write action
- [ ] code / [ ] verified — `nimbus tui` launches; query input accepts text; result streams
- [ ] code / [ ] verified — VS Code extension connects to Gateway; `Nimbus: Ask` works

### Platform: Linux

- [ ] code / [ ] verified — `nimbus ask "summarize my week"` runs via Ollama (no API key)
- [ ] code / [ ] verified — `nimbus ask` runs via llama.cpp GGUF (no Ollama)
- [ ] code / [ ] verified — `TERM=dumb nimbus tui` falls back to Phase 3 REPL
- [ ] code / [ ] verified — `nimbus data export` + `nimbus data import` restores full state
- [ ] code / [ ] verified — `nimbus audit verify` passes on a fresh Gateway with 100+ audit rows
- [ ] code / [ ] verified — GPG-signed `.deb` and AppImage; `gpg --verify` passes
- [ ] code / [ ] verified — Tauri UI launches; Dashboard shows connector health; HITL dialog fires for a write action
- [ ] code / [ ] verified — VS Code extension connects to Gateway; `Nimbus: Ask` works

### Cross-Platform (automated tests)

- [ ] `multi-agent-hitl.e2e.test.ts` — 3 parallel sub-agents; no HITL bypass
- [ ] `air-gap-local-llm.e2e.test.ts` — zero outbound calls with local model + `enforce_air_gap = true`
- [ ] `voice-air-gap.e2e.test.ts` — audio never leaves localhost
- [ ] `import.test.ts` — export → wipe → import round-trip (integration, real SQLite)
- [ ] `audit-chain.test.ts` — tampered row detected by `nimbus audit verify`
- [ ] `lan-rpc.test.ts` — read allowed, write rejected without grant, tampered ciphertext rejected
- [ ] `multi-agent-hitl.e2e.test.ts` passes on all three CI platform runners
- [ ] `bun audit --audit-level high` clean for all Phase 4 packages
- [ ] Five community extensions available in the Marketplace at launch
- [ ] VS Code extension listed on Open VSX Registry and VS Code Marketplace

---

## New Files Summary

| File | Workstream |
|---|---|
| `packages/gateway/src/llm/ollama-provider.ts` | 1.1 |
| `packages/gateway/src/llm/llamacpp-provider.ts` | 1.2 |
| `packages/gateway/src/llm/router.ts` | 1.3 |
| `packages/gateway/src/llm/gpu-arbiter.ts` | 1.3.4 |
| `packages/gateway/src/engine/coordinator.ts` | 1.5 |
| `packages/gateway/src/engine/sub-agent.ts` | 1.5 |
| `packages/gateway/src/voice/stt.ts` | 2.1 |
| `packages/gateway/src/voice/tts.ts` | 2.2 |
| `packages/gateway/src/ipc/handlers/voice.ts` | 2.3 |
| `packages/gateway/src/voice/wake-word.ts` | 2.4 |
| `packages/gateway/src/commands/data-export.ts` | 3.1 |
| `packages/gateway/src/db/audit.ts` (modify) | 3.4 |
| `packages/gateway/src/updater/index.ts` | 4.2 |
| `packages/gateway/src/ipc/lan-server.ts` | 4.4 |
| `packages/ui/src/ipc/client.ts` | 5.1 |
| `packages/ui/src-tauri/src/gateway_bridge.rs` | 5.1 |
| `packages/ui/src/pages/Dashboard.tsx` | 5.3 |
| `packages/ui/src/components/HitlDialog.tsx` | 5.4 |
| `packages/ui/src/pages/Marketplace.tsx` | 5.5 |
| `packages/ui/src/pages/Watchers.tsx` | 5.6 |
| `packages/ui/src/pages/Workflows.tsx` | 5.7 |
| `packages/ui/src/pages/Settings.tsx` | 5.8 |
| `packages/cli/src/tui/App.tsx` | 6.2 |
| `packages/cli/src/tui/QueryInput.tsx` | 6.3 |
| `packages/cli/src/tui/ConnectorHealth.tsx` | 6.4 |
| `packages/cli/src/tui/WatcherPane.tsx` | 6.6 |
| `packages/cli/src/tui/SubTaskPane.tsx` | 6.6 |
| `packages/vscode-extension/` (new package) | 7.1–7.7 |
| `.github/workflows/release.yml` | 4.1 |
| `.github/workflows/publish-vscode.yml` | 7.7 |
