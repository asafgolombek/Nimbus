# WS 2 — Voice Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a local voice pipeline — Whisper.cpp STT, platform-native TTS, wake word detection, and IPC handlers — enabling a complete push-to-talk query round-trip on all three platforms without any cloud calls.

**Architecture:** A thin `VoiceService` wires three independent providers (`WhisperSttProvider`, `NativeTtsProvider`, `WakeWordDetector`) behind IPC-facing handlers. All audio stays local. Wake word uses Whisper-based polling (record 2-second chunks with `-ar 16000 -ac 1` format, VAD silence-skip, then `tiny.en` transcription) — a separate `wakeWordWhisperModel` config key keeps the detection loop lightweight regardless of the user's primary STT model. The `WakeWordDetector` interface is intentionally provider-agnostic so a dedicated engine (Porcupine, openWakeWord) can be slotted in later without touching `VoiceService`. TTS uses OS-native speech synthesis (no external binaries required), with a `piperPath` escape hatch for higher-quality output. `VoiceService.transcribe()` acts as the microphone arbiter — it automatically pauses the wake word detector for the duration of a manual query to avoid audio-device contention. A `voice.microphoneActive` IPC notification fires whenever the microphone opens or closes so the UI can render a privacy indicator (continuous wake-word recording is sensitive; users must always be able to see when the mic is hot). `voice.enabled` defaults to `false` — the feature is opt-in.

**Depends on:** WS1 complete — `LlmRouter` and `LlmProvider` interfaces must exist (used in the push-to-talk integration test).

**Tech Stack:** Bun v1.2+, TypeScript 6.x strict, `Bun.spawn`, OS-native TTS commands, Whisper.cpp binary (user-supplied or PATH-discovered).

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `packages/gateway/src/voice/types.ts` | Voice provider interfaces and result types |
| Modify | `packages/gateway/src/config/nimbus-toml.ts` | Add `[voice]` section — `NimbusVoiceToml` type, parser, loader |
| Create | `packages/gateway/src/config/nimbus-toml-voice.test.ts` | `[voice]` TOML parser unit tests |
| Create | `packages/gateway/src/voice/stt.ts` | `WhisperSttProvider` — binary discovery + audio transcription |
| Create | `packages/gateway/src/voice/stt.test.ts` | STT unit tests (mocked subprocess) |
| Create | `packages/gateway/src/voice/tts.ts` | `NativeTtsProvider` — platform-native speech synthesis |
| Create | `packages/gateway/src/voice/tts.test.ts` | TTS unit tests (mocked Bun.spawn) |
| Create | `packages/gateway/src/voice/wake-word.ts` | `WakeWordDetector` — Whisper-polling keyword detection |
| Create | `packages/gateway/src/voice/wake-word.test.ts` | Wake word detector unit tests |
| Create | `packages/gateway/src/voice/service.ts` | `VoiceService` — wires STT + TTS + wake word + LLM; microphone arbiter |
| Create | `packages/gateway/src/voice/service.test.ts` | `VoiceService` unit tests (arbiter, mic-state forwarding) |
| Create | `packages/gateway/src/ipc/handlers/voice.ts` | `dispatchVoiceRpc` + `VoiceRpcError` class |
| Create | `packages/gateway/src/ipc/handlers/voice.test.ts` | Voice RPC handler unit tests |
| Modify | `packages/gateway/src/ipc/server.ts` | Wire `voice.*` handlers and `voice.microphoneActive` notification into the IPC server |
| Create | `packages/gateway/src/voice/push-to-talk.test.ts` | Integration: full STT → LLM → TTS round-trip |
| Modify | `packages/cli/src/commands/doctor.ts` | `doctorVoiceLines` — check whisper-cli, ffmpeg, native TTS when `voice.enabled` |
| Create | `packages/cli/src/commands/doctor-voice.test.ts` | `doctorVoiceLines` unit tests |

---

## Task 1: Voice Types

**Files:**
- Create: `packages/gateway/src/voice/types.ts`

Pure type definitions — no test needed. Commit after.

- [ ] **Step 1: Write the types file**

```typescript
// packages/gateway/src/voice/types.ts

export type SttResult = {
  text: string;
  /** Transcription duration in ms (wall-clock). */
  durationMs: number;
  /** Language detected by Whisper, e.g. "en". */
  language?: string;
};

export interface SttProvider {
  /** Returns true if the STT binary is available and executable. */
  isAvailable(): Promise<boolean>;
  /**
   * Transcribe a WAV/MP3 audio file to text.
   * @param audioPath Absolute path to the audio file.
   */
  transcribe(audioPath: string): Promise<SttResult>;
}

export interface TtsProvider {
  /** Returns true if the TTS engine is available on this platform. */
  isAvailable(): Promise<boolean>;
  /**
   * Speak the given text aloud and resolve when playback is complete.
   * Text is sanitised before passing to the OS — never passed via shell expansion.
   */
  speak(text: string): Promise<void>;
}

export type WakeWordEvent = {
  /** The phrase that triggered detection (full transcript of the triggering chunk). */
  transcript: string;
  detectedAt: number;
};

export type MicrophoneStateEvent = {
  /** True when the microphone is being recorded; false when released. */
  active: boolean;
  /** Why the microphone is hot: wake-word polling, or a caller-initiated transcription. */
  source: "wake-word" | "transcribe";
  changedAt: number;
};

/**
 * The interface is provider-agnostic: today implemented by `WakeWordDetectorImpl`
 * (Whisper + VAD polling), but can be swapped for a dedicated engine
 * (Porcupine, openWakeWord) without any change to `VoiceService` or IPC handlers.
 */
export interface WakeWordDetector {
  /** Start polling for the wake word. No-op if already running. */
  start(): void;
  /** Stop polling and release audio resources. No-op if already stopped. */
  stop(): void;
  onDetected: ((event: WakeWordEvent) => void) | undefined;
  /** Fires whenever the microphone opens or closes inside the detector loop. */
  onMicrophoneStateChange: ((event: MicrophoneStateEvent) => void) | undefined;
  readonly isRunning: boolean;
}
```

- [ ] **Step 2: Run type check to confirm no errors**

```bash
cd packages/gateway && bun run typecheck 2>&1 | tail -5
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add packages/gateway/src/voice/types.ts
git commit -m "feat(voice): add voice provider interfaces and result types"
```

---

## Task 2: [voice] Config Section

**Files:**
- Modify: `packages/gateway/src/config/nimbus-toml.ts`
- Create: `packages/gateway/src/config/nimbus-toml-voice.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/gateway/src/config/nimbus-toml-voice.test.ts
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_NIMBUS_VOICE_TOML,
  loadNimbusVoiceFromPath,
  parseNimbusTomlVoiceSection,
} from "./nimbus-toml.ts";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("parseNimbusTomlVoiceSection", () => {
  test("returns empty object for empty string", () => {
    expect(parseNimbusTomlVoiceSection("")).toEqual({});
  });

  test("ignores unrelated sections", () => {
    const src = `[llm]\nprefer_local = true\n`;
    expect(parseNimbusTomlVoiceSection(src)).toEqual({});
  });

  test("parses enabled bool", () => {
    const src = `[voice]\nenabled = true\n`;
    expect(parseNimbusTomlVoiceSection(src)).toEqual({ enabled: true });
  });

  test("parses whisper_path string", () => {
    const src = `[voice]\nwhisper_path = "/usr/local/bin/whisper-cli"\n`;
    expect(parseNimbusTomlVoiceSection(src)).toEqual({
      whisperPath: "/usr/local/bin/whisper-cli",
    });
  });

  test("parses whisper_model string", () => {
    const src = `[voice]\nwhisper_model = "base.en"\n`;
    expect(parseNimbusTomlVoiceSection(src)).toEqual({ whisperModel: "base.en" });
  });

  test("parses wake_word_whisper_model string", () => {
    const src = `[voice]\nwake_word_whisper_model = "tiny.en"\n`;
    expect(parseNimbusTomlVoiceSection(src)).toEqual({ wakeWordWhisperModel: "tiny.en" });
  });

  test("parses wake_word string", () => {
    const src = `[voice]\nwake_word = "hey nimbus"\n`;
    expect(parseNimbusTomlVoiceSection(src)).toEqual({ wakeWord: "hey nimbus" });
  });

  test("parses piper_path string", () => {
    const src = `[voice]\npiper_path = "/usr/local/bin/piper"\n`;
    expect(parseNimbusTomlVoiceSection(src)).toEqual({ piperPath: "/usr/local/bin/piper" });
  });

  test("parses piper_model string", () => {
    const src = `[voice]\npiper_model = "en_US-amy-medium.onnx"\n`;
    expect(parseNimbusTomlVoiceSection(src)).toEqual({
      piperModel: "en_US-amy-medium.onnx",
    });
  });

  test("strips # comments", () => {
    const src = `[voice]\nenabled = true # enable voice\n`;
    expect(parseNimbusTomlVoiceSection(src)).toEqual({ enabled: true });
  });

  test("stops reading at next section header", () => {
    const src = `[voice]\nenabled = true\n[llm]\nprefer_local = false\n`;
    expect(parseNimbusTomlVoiceSection(src)).toEqual({ enabled: true });
  });

  test("ignores unknown keys", () => {
    const src = `[voice]\nunknown_key = "foo"\n`;
    expect(parseNimbusTomlVoiceSection(src)).toEqual({});
  });
});

describe("DEFAULT_NIMBUS_VOICE_TOML", () => {
  test("has expected default values", () => {
    expect(DEFAULT_NIMBUS_VOICE_TOML.enabled).toBe(false);
    expect(DEFAULT_NIMBUS_VOICE_TOML.whisperPath).toBe("");
    expect(DEFAULT_NIMBUS_VOICE_TOML.whisperModel).toBe("base.en");
    expect(DEFAULT_NIMBUS_VOICE_TOML.wakeWordWhisperModel).toBe("tiny.en");
    expect(DEFAULT_NIMBUS_VOICE_TOML.wakeWord).toBe("hey nimbus");
    expect(DEFAULT_NIMBUS_VOICE_TOML.piperPath).toBe("");
    expect(DEFAULT_NIMBUS_VOICE_TOML.piperModel).toBe("");
  });
});

describe("loadNimbusVoiceFromPath", () => {
  test("returns defaults when file does not exist", () => {
    const result = loadNimbusVoiceFromPath("/nonexistent/path/nimbus.toml");
    expect(result).toEqual(DEFAULT_NIMBUS_VOICE_TOML);
  });

  test("merges file values over defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "nimbus-voice-test-"));
    const tomlPath = join(dir, "nimbus.toml");
    writeFileSync(tomlPath, `[voice]\nenabled = true\nwake_word = "computer"\n`);
    const result = loadNimbusVoiceFromPath(tomlPath);
    expect(result.enabled).toBe(true);
    expect(result.wakeWord).toBe("computer");
    expect(result.whisperModel).toBe("base.en"); // default preserved
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/gateway && bun test src/config/nimbus-toml-voice.test.ts 2>&1 | tail -10
```

Expected: FAIL — `parseNimbusTomlVoiceSection is not a function`.

- [ ] **Step 3: Add the [voice] section to `nimbus-toml.ts`**

Append this block to `packages/gateway/src/config/nimbus-toml.ts`, after the existing `[llm]` section exports:

```typescript
// ─── [voice] section ────────────────────────────────────────────────────────

export type NimbusVoiceToml = {
  enabled: boolean;
  /** Absolute path to the whisper-cli binary. Falls back to NIMBUS_WHISPER_PATH env var, then PATH. */
  whisperPath: string;
  /** Whisper model for full STT transcription, e.g. "base.en", "small", "medium". */
  whisperModel: string;
  /**
   * Whisper model used exclusively by the wake word detector loop.
   * Defaults to "tiny.en" to keep CPU load low — independent of `whisperModel`.
   */
  wakeWordWhisperModel: string;
  /** Wake word phrase. Case-insensitive substring match against Whisper transcript. */
  wakeWord: string;
  /** Optional path to piper TTS binary for higher-quality output. */
  piperPath: string;
  /** Optional path to piper voice model (.onnx file). */
  piperModel: string;
};

export const DEFAULT_NIMBUS_VOICE_TOML: NimbusVoiceToml = {
  enabled: false,
  whisperPath: "",
  whisperModel: "base.en",
  wakeWordWhisperModel: "tiny.en",
  wakeWord: "hey nimbus",
  piperPath: "",
  piperModel: "",
};

function applyNimbusVoiceKey(out: Partial<NimbusVoiceToml>, key: string, valRaw: string): void {
  switch (key) {
    case "enabled": {
      const b = parseBool(valRaw);
      if (b !== undefined) out.enabled = b;
      break;
    }
    case "whisper_path":
      out.whisperPath = parseString(valRaw);
      break;
    case "whisper_model":
      out.whisperModel = parseString(valRaw);
      break;
    case "wake_word_whisper_model":
      out.wakeWordWhisperModel = parseString(valRaw);
      break;
    case "wake_word":
      out.wakeWord = parseString(valRaw);
      break;
    case "piper_path":
      out.piperPath = parseString(valRaw);
      break;
    case "piper_model":
      out.piperModel = parseString(valRaw);
      break;
    default:
      break;
  }
}

export function parseNimbusTomlVoiceSection(source: string): Partial<NimbusVoiceToml> {
  const lines = source.split(/\r?\n/);
  let inVoice = false;
  const out: Partial<NimbusVoiceToml> = {};

  for (const line of lines) {
    const trimmed = stripComment(line).trim();
    if (trimmed === "") continue;
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inVoice = trimmed === "[voice]";
      continue;
    }
    if (!inVoice) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const valRaw = trimmed.slice(eq + 1).trim();
    applyNimbusVoiceKey(out, key, valRaw);
  }
  return out;
}

export function loadNimbusVoiceFromPath(tomlPath: string): NimbusVoiceToml {
  if (!existsSync(tomlPath)) {
    return structuredClone(DEFAULT_NIMBUS_VOICE_TOML);
  }
  try {
    const raw = readFileSync(tomlPath, "utf8");
    return structuredClone({
      ...DEFAULT_NIMBUS_VOICE_TOML,
      ...parseNimbusTomlVoiceSection(raw),
    });
  } catch {
    return structuredClone(DEFAULT_NIMBUS_VOICE_TOML);
  }
}

export function loadNimbusVoiceFromConfigDir(configDir: string): NimbusVoiceToml {
  return loadNimbusVoiceFromPath(join(configDir, "nimbus.toml"));
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/gateway && bun test src/config/nimbus-toml-voice.test.ts 2>&1 | tail -10
```

Expected: All tests PASS.

- [ ] **Step 5: Run type check**

```bash
cd packages/gateway && bun run typecheck 2>&1 | tail -5
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/config/nimbus-toml.ts \
        packages/gateway/src/config/nimbus-toml-voice.test.ts
git commit -m "feat(config): add [voice] TOML section parser and NimbusVoiceToml type"
```

---

## Task 3: Whisper STT Provider

**Files:**
- Create: `packages/gateway/src/voice/stt.ts`
- Create: `packages/gateway/src/voice/stt.test.ts`

Whisper.cpp binary discovery order:
1. `whisperPath` from config (if non-empty and exists)
2. `NIMBUS_WHISPER_PATH` env var (if set)
3. `whisper-cli` on PATH
4. `main` on PATH (older Whisper.cpp build name)

**Important:** Do **not** pass `--output-txt` — that flag writes a `.txt` file to disk, not stdout. Read the transcript directly from `proc.stdout`. Use `-nt` (no timestamps) to get clean text output. Input audio must be 16kHz 16-bit mono WAV — the caller (ffmpeg recorder) is responsible for this format.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/gateway/src/voice/stt.test.ts
import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { WhisperSttProvider } from "./stt.ts";
import type { SpawnOptions } from "bun";

// Whisper outputs: one line of text after stripping timestamps
const WHISPER_STDOUT = `[00:00:00.000 --> 00:00:03.000]  Hello, this is a test.\n`;

type MockSpawnResult = {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
};

function makeSpawnMock(stdout: string, exitCode = 0): MockSpawnResult {
  const encoder = new TextEncoder();
  return {
    stdout: new ReadableStream({
      start(c) {
        c.enqueue(encoder.encode(stdout));
        c.close();
      },
    }),
    stderr: new ReadableStream({ start(c) { c.close(); } }),
    exited: Promise.resolve(exitCode),
  };
}

describe("WhisperSttProvider", () => {
  let originalSpawn: typeof Bun.spawn;

  beforeEach(() => {
    originalSpawn = Bun.spawn;
  });

  afterEach(() => {
    Bun.spawn = originalSpawn;
  });

  test("isAvailable returns true when binary resolves", async () => {
    const provider = new WhisperSttProvider({ whisperBin: "whisper-cli" });
    // Mock Bun.which to simulate binary on PATH
    const origWhich = Bun.which;
    Bun.which = (_name: string) => "/usr/local/bin/whisper-cli";
    expect(await provider.isAvailable()).toBe(true);
    Bun.which = origWhich;
  });

  test("isAvailable returns false when binary not found", async () => {
    const provider = new WhisperSttProvider({ whisperBin: "whisper-cli" });
    const origWhich = Bun.which;
    Bun.which = (_name: string) => null;
    expect(await provider.isAvailable()).toBe(false);
    Bun.which = origWhich;
  });

  test("transcribe returns parsed text from Whisper stdout", async () => {
    Bun.spawn = mock((_cmd: string[], _opts?: SpawnOptions.OptionsObject) =>
      makeSpawnMock(WHISPER_STDOUT),
    ) as unknown as typeof Bun.spawn;

    const provider = new WhisperSttProvider({ whisperBin: "/usr/local/bin/whisper-cli" });
    const result = await provider.transcribe("/tmp/audio.wav");
    expect(result.text).toBe("Hello, this is a test.");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("transcribe strips leading/trailing whitespace from transcript", async () => {
    Bun.spawn = mock((_cmd: string[], _opts?: SpawnOptions.OptionsObject) =>
      makeSpawnMock("[00:00:00.000 --> 00:00:01.000]   Trimmed output.   \n"),
    ) as unknown as typeof Bun.spawn;

    const provider = new WhisperSttProvider({ whisperBin: "/usr/local/bin/whisper-cli" });
    const result = await provider.transcribe("/tmp/audio.wav");
    expect(result.text).toBe("Trimmed output.");
  });

  test("transcribe throws when Whisper exits with non-zero code", async () => {
    Bun.spawn = mock((_cmd: string[], _opts?: SpawnOptions.OptionsObject) =>
      makeSpawnMock("", 1),
    ) as unknown as typeof Bun.spawn;

    const provider = new WhisperSttProvider({ whisperBin: "/usr/local/bin/whisper-cli" });
    await expect(provider.transcribe("/tmp/audio.wav")).rejects.toThrow("Whisper exited");
  });

  test("transcribe throws when audio file does not exist", async () => {
    const provider = new WhisperSttProvider({ whisperBin: "/usr/local/bin/whisper-cli" });
    await expect(provider.transcribe("/nonexistent/audio.wav")).rejects.toThrow("not found");
  });

  test("transcribe passes model flag when modelName is configured", async () => {
    const captured: string[][] = [];
    Bun.spawn = mock((cmd: string[], _opts?: SpawnOptions.OptionsObject) => {
      captured.push(cmd as string[]);
      return makeSpawnMock(WHISPER_STDOUT);
    }) as unknown as typeof Bun.spawn;

    const provider = new WhisperSttProvider({
      whisperBin: "/usr/local/bin/whisper-cli",
      modelName: "small",
    });
    await provider.transcribe("/tmp/audio.wav");
    expect(captured[0]).toContain("-m");
    expect(captured[0]).toContain("small");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/gateway && bun test src/voice/stt.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `stt.ts`**

```typescript
// packages/gateway/src/voice/stt.ts
import { processEnvGet } from "../platform/env-access.ts";
import type { SttProvider, SttResult } from "./types.ts";

type WhisperSttOptions = {
  /** Resolved path to the whisper-cli binary, or name to search on PATH. */
  whisperBin?: string;
  /** Model name passed to whisper via -m flag (e.g. "base.en", "small"). */
  modelName?: string;
};

/**
 * Discover the Whisper binary in priority order:
 *  1. explicit `configuredPath` argument (from nimbus.toml whisper_path)
 *  2. NIMBUS_WHISPER_PATH env var
 *  3. "whisper-cli" on PATH
 *  4. "main" on PATH (older Whisper.cpp build name)
 */
export function resolveWhisperBin(configuredPath?: string): string {
  if (configuredPath !== undefined && configuredPath !== "") return configuredPath;
  const envPath = processEnvGet("NIMBUS_WHISPER_PATH");
  if (envPath !== undefined && envPath !== "") return envPath;
  if (Bun.which("whisper-cli") !== null) return "whisper-cli";
  return "main";
}

/**
 * Strip Whisper.cpp timestamp brackets from a line, e.g.:
 *   "[00:00:00.000 --> 00:00:03.000]  Hello world" → "Hello world"
 */
function stripTimestamp(line: string): string {
  return line.replace(/^\[[^\]]+\]\s*/, "").trim();
}

export class WhisperSttProvider implements SttProvider {
  private readonly whisperBin: string;
  private readonly modelName: string | undefined;

  constructor(opts: WhisperSttOptions = {}) {
    this.whisperBin = opts.whisperBin ?? resolveWhisperBin();
    this.modelName = opts.modelName;
  }

  async isAvailable(): Promise<boolean> {
    // If it's an absolute path, check existence; otherwise check PATH
    if (this.whisperBin.startsWith("/") || this.whisperBin.includes("\\")) {
      try {
        const stat = Bun.file(this.whisperBin);
        return await stat.exists();
      } catch {
        return false;
      }
    }
    return Bun.which(this.whisperBin) !== null;
  }

  async transcribe(audioPath: string): Promise<SttResult> {
    if (!(await Bun.file(audioPath).exists())) {
      throw new Error(`Audio file not found: ${audioPath}`);
    }

    // -nt suppresses timestamps; do NOT add --output-txt (that writes a .txt file, not stdout)
    const cmd: string[] = [this.whisperBin, "-f", audioPath, "-nt"];
    if (this.modelName !== undefined && this.modelName !== "") {
      cmd.push("-m", this.modelName);
    }

    const start = Date.now();
    const proc = Bun.spawn(cmd, {
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      throw new Error(`Whisper exited with code ${exitCode} for file: ${audioPath}`);
    }

    const raw = await new Response(proc.stdout).text();
    const text = raw
      .split("\n")
      .map((line) => stripTimestamp(line))
      .filter((line) => line.length > 0)
      .join(" ")
      .trim();

    return {
      text,
      durationMs: Date.now() - start,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/gateway && bun test src/voice/stt.test.ts 2>&1 | tail -10
```

Expected: All tests PASS.

- [ ] **Step 5: Run type check**

```bash
cd packages/gateway && bun run typecheck 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/voice/stt.ts \
        packages/gateway/src/voice/stt.test.ts
git commit -m "feat(voice): add WhisperSttProvider with binary discovery and transcript parsing"
```

---

## Task 4: Platform-Native TTS Provider

**Files:**
- Create: `packages/gateway/src/voice/tts.ts`
- Create: `packages/gateway/src/voice/tts.test.ts`

Platform dispatch:
- **Windows** (`win32`): `PowerShell.exe -NoProfile -Command "(New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak([System.String]$args[0])" -- "<text>"`  — text is passed as a separate argument, never interpolated into the command string.
- **macOS** (`darwin`): `say` — text passed as argv, not via shell.
- **Linux** (`linux`): `espeak-ng` if available, otherwise `spd-say`. Text passed as argv.

If `piperPath` + `piperModel` are configured, `PiperTtsProvider` is used instead (all platforms).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/gateway/src/voice/tts.test.ts
import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { NativeTtsProvider } from "./tts.ts";
import type { SpawnOptions } from "bun";

type MockSpawnResult = {
  exited: Promise<number>;
};

function makeSpawnMock(exitCode = 0): MockSpawnResult {
  return { exited: Promise.resolve(exitCode) };
}

describe("NativeTtsProvider", () => {
  let originalSpawn: typeof Bun.spawn;

  beforeEach(() => {
    originalSpawn = Bun.spawn;
  });

  afterEach(() => {
    Bun.spawn = originalSpawn;
  });

  test("speak resolves when TTS exits with code 0", async () => {
    Bun.spawn = mock((_cmd: string[], _opts?: SpawnOptions.OptionsObject) =>
      makeSpawnMock(0),
    ) as unknown as typeof Bun.spawn;

    const provider = new NativeTtsProvider({ platform: "darwin" });
    await expect(provider.speak("Hello world")).resolves.toBeUndefined();
  });

  test("speak throws when TTS exits with non-zero code", async () => {
    Bun.spawn = mock((_cmd: string[], _opts?: SpawnOptions.OptionsObject) =>
      makeSpawnMock(1),
    ) as unknown as typeof Bun.spawn;

    const provider = new NativeTtsProvider({ platform: "darwin" });
    await expect(provider.speak("Hello")).rejects.toThrow("TTS exited");
  });

  test("speak passes text as separate argv element (no shell injection risk)", async () => {
    const captured: string[][] = [];
    Bun.spawn = mock((cmd: string[], _opts?: SpawnOptions.OptionsObject) => {
      captured.push(cmd as string[]);
      return makeSpawnMock(0);
    }) as unknown as typeof Bun.spawn;

    const dangerous = 'Hello"; rm -rf /';
    const provider = new NativeTtsProvider({ platform: "darwin" });
    await provider.speak(dangerous);
    // Text must appear as its own argv element, not shell-expanded
    expect(captured[0]).toContain(dangerous);
    expect(captured[0]?.join(" ")).not.toContain("sh -c");
  });

  test("isAvailable returns true on darwin (say is always present)", async () => {
    const provider = new NativeTtsProvider({ platform: "darwin" });
    expect(await provider.isAvailable()).toBe(true);
  });

  test("isAvailable returns true on win32", async () => {
    const provider = new NativeTtsProvider({ platform: "win32" });
    expect(await provider.isAvailable()).toBe(true);
  });

  test("linux: uses espeak-ng when available on PATH", async () => {
    const origWhich = Bun.which;
    Bun.which = (_name: string) => "/usr/bin/espeak-ng";
    const captured: string[][] = [];
    Bun.spawn = mock((cmd: string[], _opts?: SpawnOptions.OptionsObject) => {
      captured.push(cmd as string[]);
      return makeSpawnMock(0);
    }) as unknown as typeof Bun.spawn;

    const provider = new NativeTtsProvider({ platform: "linux" });
    await provider.speak("Test");
    expect(captured[0]?.[0]).toContain("espeak-ng");
    Bun.which = origWhich;
  });

  test("linux: falls back to spd-say when espeak-ng not on PATH", async () => {
    const origWhich = Bun.which;
    Bun.which = (name: string) => (name === "spd-say" ? "/usr/bin/spd-say" : null);
    const captured: string[][] = [];
    Bun.spawn = mock((cmd: string[], _opts?: SpawnOptions.OptionsObject) => {
      captured.push(cmd as string[]);
      return makeSpawnMock(0);
    }) as unknown as typeof Bun.spawn;

    const provider = new NativeTtsProvider({ platform: "linux" });
    await provider.speak("Test");
    expect(captured[0]?.[0]).toContain("spd-say");
    Bun.which = origWhich;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/gateway && bun test src/voice/tts.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `tts.ts`**

```typescript
// packages/gateway/src/voice/tts.ts
import type { TtsProvider } from "./types.ts";

type NativeTtsOptions = {
  platform: "win32" | "darwin" | "linux";
};

function buildTtsCommand(platform: "win32" | "darwin" | "linux", text: string): string[] {
  switch (platform) {
    case "darwin":
      // `say` accepts text as argv — safe from shell injection
      return ["say", text];
    case "win32":
      // Pass text as a separate argument via --, never interpolated into the script string
      return [
        "PowerShell.exe",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "(New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak($args[0])",
        "--",
        text,
      ];
    case "linux": {
      // espeak-ng preferred; spd-say as fallback; both accept text as argv
      const bin = Bun.which("espeak-ng") !== null ? "espeak-ng" : "spd-say";
      return [bin, text];
    }
  }
}

export class NativeTtsProvider implements TtsProvider {
  private readonly platform: "win32" | "darwin" | "linux";

  constructor(opts: NativeTtsOptions) {
    this.platform = opts.platform;
  }

  async isAvailable(): Promise<boolean> {
    if (this.platform === "darwin" || this.platform === "win32") return true;
    // Linux: check for espeak-ng or spd-say
    return Bun.which("espeak-ng") !== null || Bun.which("spd-say") !== null;
  }

  async speak(text: string): Promise<void> {
    const cmd = buildTtsCommand(this.platform, text);
    const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      throw new Error(`TTS exited with code ${exitCode}`);
    }
  }
}

type PiperTtsOptions = {
  piperBin: string;
  modelPath: string;
};

/**
 * Higher-quality TTS via Piper (https://github.com/rhasspy/piper).
 * Piper reads text from stdin and writes WAV to stdout; we pipe to `aplay`/`afplay`/`powershell`.
 * Used when `piper_path` + `piper_model` are both configured.
 */
export class PiperTtsProvider implements TtsProvider {
  private readonly piperBin: string;
  private readonly modelPath: string;

  constructor(opts: PiperTtsOptions) {
    this.piperBin = opts.piperBin;
    this.modelPath = opts.modelPath;
  }

  async isAvailable(): Promise<boolean> {
    const binExists =
      this.piperBin.includes("/") || this.piperBin.includes("\\")
        ? await Bun.file(this.piperBin).exists()
        : Bun.which(this.piperBin) !== null;
    const modelExists = this.modelPath !== "" && (await Bun.file(this.modelPath).exists());
    return binExists && modelExists;
  }

  async speak(text: string): Promise<void> {
    // Piper reads from stdin; player receives WAV from stdout.
    // Playback player selected by platform.
    const playerCmd = selectAudioPlayer();
    if (playerCmd === undefined) {
      throw new Error("No audio player found (tried aplay, afplay, PowerShell)");
    }

    const encoder = new TextEncoder();
    const proc = Bun.spawn(
      [this.piperBin, "--model", this.modelPath, "--output-raw"],
      {
        stdin: new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(text));
            controller.close();
          },
        }),
        stdout: "pipe",
        stderr: "ignore",
      },
    );

    const player = Bun.spawn(playerCmd, {
      stdin: proc.stdout,
      stdout: "ignore",
      stderr: "ignore",
    });

    // TODO: streaming playback — resolve as soon as player starts for lower perceived latency
    const [piperCode, playerCode] = await Promise.all([proc.exited, player.exited]);
    if (piperCode !== 0) throw new Error(`Piper exited with code ${piperCode}`);
    if (playerCode !== 0) throw new Error(`Audio player exited with code ${playerCode}`);
  }
}

function selectAudioPlayer(): string[] | undefined {
  const platform = process.platform;
  if (platform === "darwin") return ["afplay", "-"];
  if (platform === "win32") {
    return [
      "PowerShell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$s = New-Object System.IO.MemoryStream; $input.BaseStream.CopyTo($s); [System.Media.SoundPlayer]::new($s).PlaySync()",
    ];
  }
  if (Bun.which("aplay") !== null) return ["aplay", "--file-type", "raw", "-"];
  return undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/gateway && bun test src/voice/tts.test.ts 2>&1 | tail -10
```

Expected: All tests PASS.

- [ ] **Step 5: Run type check**

```bash
cd packages/gateway && bun run typecheck 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/voice/tts.ts \
        packages/gateway/src/voice/tts.test.ts
git commit -m "feat(voice): add NativeTtsProvider and PiperTtsProvider with shell-injection-safe argv passing"
```

---

## Task 5: Wake Word Detector

**Files:**
- Create: `packages/gateway/src/voice/wake-word.ts`
- Create: `packages/gateway/src/voice/wake-word.test.ts`

Strategy: Whisper-based polling. Every `pollIntervalMs` (default 2000), record `chunkDurationMs` of audio via `ffmpeg -f alsa`/`avfoundation`/`dshow` **with `-ar 16000 -ac 1`** (Whisper requires 16kHz mono WAV), run a lightweight VAD silence check, and only call Whisper if the chunk is non-silent. Uses `wakeWordWhisperModel` (default `"tiny.en"`) — always the smallest model, regardless of the user's full STT model. If detected, fire `onDetected` and pause polling for `cooldownMs` to avoid repeated triggers. An `onMicrophoneStateChange` callback fires with `active=true` before every recording and `active=false` after, so the IPC layer can forward `voice.microphoneActive` notifications to clients for privacy UI.

Audio capture requires `ffmpeg` on PATH. If unavailable, `isAvailable()` returns false and the detector is a no-op.

**Bun-native imports:** All Node helpers (`node:os`, `node:path`, `node:crypto`) are imported at the top of the file; `Bun.spawn` is used in-place. Do **not** use dynamic `require()` inside functions — Bun supports native ESM imports without that legacy escape hatch.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/gateway/src/voice/wake-word.test.ts
import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { WakeWordDetectorImpl } from "./wake-word.ts";
import type { SttProvider, SttResult } from "./types.ts";

function makeFakeStt(transcripts: string[]): SttProvider {
  let callCount = 0;
  return {
    isAvailable: async () => true,
    transcribe: async (_path: string): Promise<SttResult> => {
      const text = transcripts[callCount % transcripts.length] ?? "";
      callCount++;
      return { text, durationMs: 10 };
    },
  };
}

describe("WakeWordDetectorImpl", () => {
  test("isRunning is false initially", () => {
    const det = new WakeWordDetectorImpl({
      stt: makeFakeStt([]),
      wakeWord: "hey nimbus",
      recordAudio: async () => "/tmp/chunk.wav",
    });
    expect(det.isRunning).toBe(false);
  });

  test("start sets isRunning to true, stop sets it to false", () => {
    const det = new WakeWordDetectorImpl({
      stt: makeFakeStt([]),
      wakeWord: "hey nimbus",
      recordAudio: async () => "/tmp/chunk.wav",
    });
    det.start();
    expect(det.isRunning).toBe(true);
    det.stop();
    expect(det.isRunning).toBe(false);
  });

  test("start is idempotent", () => {
    const det = new WakeWordDetectorImpl({
      stt: makeFakeStt([]),
      wakeWord: "hey nimbus",
      recordAudio: async () => "/tmp/chunk.wav",
    });
    det.start();
    det.start(); // should not throw or spawn a second loop
    expect(det.isRunning).toBe(true);
    det.stop();
  });

  test("fires onDetected when transcript contains wake word (case-insensitive)", async () => {
    const events: string[] = [];
    const det = new WakeWordDetectorImpl({
      stt: makeFakeStt(["Hey Nimbus, what time is it?"]),
      wakeWord: "hey nimbus",
      pollIntervalMs: 10,
      recordAudio: async () => "/tmp/chunk.wav",
    });
    det.onDetected = (evt) => {
      events.push(evt.transcript);
      det.stop();
    };
    det.start();
    await new Promise((r) => setTimeout(r, 100));
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]).toContain("Hey Nimbus");
  });

  test("does not fire onDetected when transcript does not contain wake word", async () => {
    const events: string[] = [];
    const det = new WakeWordDetectorImpl({
      stt: makeFakeStt(["The weather is nice today."]),
      wakeWord: "hey nimbus",
      pollIntervalMs: 10,
      maxPolls: 3, // stop after N polls for test determinism
      recordAudio: async () => "/tmp/chunk.wav",
    });
    det.onDetected = (evt) => events.push(evt.transcript);
    det.start();
    await new Promise((r) => setTimeout(r, 100));
    det.stop();
    expect(events).toHaveLength(0);
  });

  test("onMicrophoneStateChange fires active=true before recording and active=false after", async () => {
    const states: Array<{ active: boolean; source: string }> = [];
    const det = new WakeWordDetectorImpl({
      stt: makeFakeStt([""]),
      wakeWord: "hey nimbus",
      pollIntervalMs: 10,
      maxPolls: 1,
      recordAudio: async () => "/tmp/chunk.wav",
      isChunkSilent: async () => true, // skip Whisper entirely
    });
    det.onMicrophoneStateChange = (evt) =>
      states.push({ active: evt.active, source: evt.source });
    det.start();
    await new Promise((r) => setTimeout(r, 100));
    det.stop();
    expect(states.length).toBeGreaterThanOrEqual(2);
    expect(states[0]).toEqual({ active: true, source: "wake-word" });
    expect(states.at(-1)).toEqual({ active: false, source: "wake-word" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/gateway && bun test src/voice/wake-word.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `wake-word.ts`**

```typescript
// packages/gateway/src/voice/wake-word.ts
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  MicrophoneStateEvent,
  SttProvider,
  WakeWordDetector,
  WakeWordEvent,
} from "./types.ts";

type WakeWordDetectorOptions = {
  stt: SttProvider;
  wakeWord: string;
  /** Audio chunk duration in ms (default 2000). */
  chunkDurationMs?: number;
  /** Poll interval in ms between recordings (default 500). */
  pollIntervalMs?: number;
  /** Cooldown after detection in ms (default 3000) — prevents double-firing. */
  cooldownMs?: number;
  /** For tests: stop after this many polls automatically (undefined = no limit). */
  maxPolls?: number;
  /**
   * Inject an audio recorder for testing.
   * Default implementation uses ffmpeg to capture from the default audio input.
   * Output must be 16kHz 16-bit mono WAV (Whisper requirement).
   */
  recordAudio?: (durationMs: number) => Promise<string>;
  /**
   * Inject a silence checker for testing.
   * Default uses ffmpeg silencedetect filter.
   * Returns true if the chunk contains only silence (skip Whisper).
   */
  isChunkSilent?: (audioPath: string) => Promise<boolean>;
};

async function defaultIsChunkSilent(audioPath: string): Promise<boolean> {
  // ffmpeg silencedetect: noise floor -50dBFS, minimum silence 0.5s
  // If no "silence_end" appears, the entire chunk was silent
  const proc = Bun.spawn(
    ["ffmpeg", "-i", audioPath, "-af", "silencedetect=noise=-50dB:d=0.5", "-f", "null", "-"],
    { stdout: "ignore", stderr: "pipe" },
  );
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;
  return !stderr.includes("silence_end");
}

function defaultRecordAudio(durationMs: number): Promise<string> {
  const outPath = join(tmpdir(), `nimbus-wake-${randomUUID()}.wav`);
  const durationSec = Math.ceil(durationMs / 1000).toString();

  // -ar 16000 -ac 1: Whisper.cpp requires 16kHz mono WAV
  const platform = process.platform;
  let cmd: string[];
  if (platform === "darwin") {
    cmd = [
      "ffmpeg", "-y", "-f", "avfoundation", "-i", ":0",
      "-ar", "16000", "-ac", "1", "-t", durationSec, outPath,
    ];
  } else if (platform === "win32") {
    cmd = [
      "ffmpeg", "-y", "-f", "dshow", "-i", "audio=default",
      "-ar", "16000", "-ac", "1", "-t", durationSec, outPath,
    ];
  } else {
    cmd = [
      "ffmpeg", "-y", "-f", "alsa", "-i", "default",
      "-ar", "16000", "-ac", "1", "-t", durationSec, outPath,
    ];
  }

  return new Promise<string>((resolve, reject) => {
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" }).exited.then((code) => {
      if (code !== 0) reject(new Error(`ffmpeg exited with ${code}`));
      else resolve(outPath);
    });
  });
}

export class WakeWordDetectorImpl implements WakeWordDetector {
  onDetected: ((event: WakeWordEvent) => void) | undefined;
  onMicrophoneStateChange: ((event: MicrophoneStateEvent) => void) | undefined;

  private readonly stt: SttProvider;
  private readonly wakeWordLower: string;
  private readonly chunkDurationMs: number;
  private readonly pollIntervalMs: number;
  private readonly cooldownMs: number;
  private readonly maxPolls: number | undefined;
  private readonly recordAudioFn: (durationMs: number) => Promise<string>;
  private readonly isChunkSilentFn: (audioPath: string) => Promise<boolean>;
  private running = false;
  private pollCount = 0;

  private emitMicState(active: boolean): void {
    this.onMicrophoneStateChange?.({
      active,
      source: "wake-word",
      changedAt: Date.now(),
    });
  }

  constructor(opts: WakeWordDetectorOptions) {
    this.stt = opts.stt;
    this.wakeWordLower = opts.wakeWord.toLowerCase();
    this.chunkDurationMs = opts.chunkDurationMs ?? 2000;
    this.pollIntervalMs = opts.pollIntervalMs ?? 500;
    this.cooldownMs = opts.cooldownMs ?? 3000;
    this.maxPolls = opts.maxPolls;
    this.recordAudioFn = opts.recordAudio ?? defaultRecordAudio;
    this.isChunkSilentFn = opts.isChunkSilent ?? defaultIsChunkSilent;
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.pollCount = 0;
    void this.pollLoop();
  }

  stop(): void {
    this.running = false;
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      if (this.maxPolls !== undefined && this.pollCount >= this.maxPolls) {
        this.running = false;
        break;
      }
      this.pollCount++;

      try {
        // Emit active=true before opening the mic; active=false in a finally-style
        // block so the UI indicator always clears even if recording/transcription throws.
        this.emitMicState(true);
        let audioPath: string;
        try {
          audioPath = await this.recordAudioFn(this.chunkDurationMs);
        } finally {
          this.emitMicState(false);
        }
        // VAD: skip Whisper entirely on silent chunks to reduce CPU load
        const silent = await this.isChunkSilentFn(audioPath);
        if (!silent) {
          const result = await this.stt.transcribe(audioPath);
          if (result.text.toLowerCase().includes(this.wakeWordLower)) {
            this.onDetected?.({ transcript: result.text, detectedAt: Date.now() });
            // Cooldown — pause to avoid immediate re-trigger
            await new Promise((r) => setTimeout(r, this.cooldownMs));
          }
        }
      } catch {
        /* audio or transcription error — skip this chunk */
      }

      if (this.running) {
        await new Promise((r) => setTimeout(r, this.pollIntervalMs));
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/gateway && bun test src/voice/wake-word.test.ts 2>&1 | tail -10
```

Expected: All tests PASS.

- [ ] **Step 5: Run type check**

```bash
cd packages/gateway && bun run typecheck 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/voice/wake-word.ts \
        packages/gateway/src/voice/wake-word.test.ts
git commit -m "feat(voice): add WakeWordDetectorImpl with Whisper-polling keyword detection"
```

---

## Task 6: VoiceService

**Files:**
- Create: `packages/gateway/src/voice/service.ts`
- Create: `packages/gateway/src/voice/service.test.ts`

`VoiceService` wires the three providers and exposes `transcribe`, `speak`, and `getStatus`. It also acts as the **microphone arbiter**: a manual `transcribe()` call pauses the wake word detector for the duration of the call so the two loops cannot contend for the audio device, and resumes polling afterwards (only if the detector was active before). Microphone state events from the wake-word loop **and** from `transcribe()` are forwarded through a single `onMicrophoneStateChange` callback so the IPC layer can emit a unified `voice.microphoneActive` notification.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/gateway/src/voice/service.test.ts
import { describe, expect, test } from "bun:test";
import { VoiceService } from "./service.ts";
import type { MicrophoneStateEvent, SttProvider, TtsProvider, WakeWordDetector } from "./types.ts";

function makeFakeStt(): SttProvider {
  return {
    isAvailable: async () => true,
    transcribe: async (_p) => ({ text: "hello", durationMs: 1 }),
  };
}

function makeFakeTts(): TtsProvider {
  return { isAvailable: async () => true, speak: async (_t) => undefined };
}

function makeFakeDetector(): WakeWordDetector & {
  startCalls: number;
  stopCalls: number;
} {
  let running = false;
  const det = {
    startCalls: 0,
    stopCalls: 0,
    onDetected: undefined,
    onMicrophoneStateChange: undefined,
    get isRunning() {
      return running;
    },
    start() {
      running = true;
      this.startCalls++;
    },
    stop() {
      running = false;
      this.stopCalls++;
    },
  } as WakeWordDetector & { startCalls: number; stopCalls: number };
  return det;
}

describe("VoiceService microphone arbiter", () => {
  test("transcribe pauses wake word when running and resumes after", async () => {
    const det = makeFakeDetector();
    det.start();
    expect(det.isRunning).toBe(true);

    const svc = new VoiceService({
      enabled: true,
      stt: makeFakeStt(),
      tts: makeFakeTts(),
      wakeWord: det,
    });

    await svc.transcribe("/tmp/x.wav");
    expect(det.stopCalls).toBe(1);
    expect(det.startCalls).toBe(2); // initial + resume
    expect(det.isRunning).toBe(true);
  });

  test("transcribe does NOT start wake word if it was not running before", async () => {
    const det = makeFakeDetector();
    const svc = new VoiceService({
      enabled: true,
      stt: makeFakeStt(),
      tts: makeFakeTts(),
      wakeWord: det,
    });

    await svc.transcribe("/tmp/x.wav");
    expect(det.startCalls).toBe(0);
    expect(det.stopCalls).toBe(0);
  });

  test("onMicrophoneStateChange fires active=true/false around transcribe", async () => {
    const states: MicrophoneStateEvent[] = [];
    const svc = new VoiceService({
      enabled: true,
      stt: makeFakeStt(),
      tts: makeFakeTts(),
      onMicrophoneStateChange: (e) => states.push(e),
    });
    await svc.transcribe("/tmp/x.wav");
    expect(states.map((s) => ({ active: s.active, source: s.source }))).toEqual([
      { active: true, source: "transcribe" },
      { active: false, source: "transcribe" },
    ]);
  });

  test("forwards wake-word mic state events through the service callback", () => {
    const states: MicrophoneStateEvent[] = [];
    const det = makeFakeDetector();
    const _svc = new VoiceService({
      enabled: true,
      stt: makeFakeStt(),
      tts: makeFakeTts(),
      wakeWord: det,
      onMicrophoneStateChange: (e) => states.push(e),
    });
    // VoiceService wires its callback onto the detector
    det.onMicrophoneStateChange?.({ active: true, source: "wake-word", changedAt: 1 });
    expect(states).toHaveLength(1);
    expect(states[0]?.source).toBe("wake-word");
  });

  test("transcribe/speak throw when voice is disabled", async () => {
    const svc = new VoiceService({
      enabled: false,
      stt: makeFakeStt(),
      tts: makeFakeTts(),
    });
    await expect(svc.transcribe("/x")).rejects.toThrow("not enabled");
    await expect(svc.speak("hi")).rejects.toThrow("not enabled");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/gateway && bun test src/voice/service.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found / missing behavior.

- [ ] **Step 3: Implement `service.ts`**

```typescript
// packages/gateway/src/voice/service.ts
import type {
  MicrophoneStateEvent,
  SttProvider,
  TtsProvider,
  WakeWordDetector,
} from "./types.ts";

export type VoiceServiceConfig = {
  enabled: boolean;
  stt: SttProvider;
  tts: TtsProvider;
  wakeWord?: WakeWordDetector;
  /**
   * Called whenever the microphone opens or closes — from either the wake-word
   * loop or a caller-initiated `transcribe()`. IPC layer forwards these as
   * `voice.microphoneActive` notifications.
   */
  onMicrophoneStateChange?: (event: MicrophoneStateEvent) => void;
};

export type VoiceStatus = {
  enabled: boolean;
  sttAvailable: boolean;
  ttsAvailable: boolean;
  wakeWordActive: boolean;
};

export class VoiceService {
  private readonly stt: SttProvider;
  private readonly tts: TtsProvider;
  private readonly wakeWordDet: WakeWordDetector | undefined;
  private readonly micListener: ((event: MicrophoneStateEvent) => void) | undefined;
  readonly enabled: boolean;

  constructor(cfg: VoiceServiceConfig) {
    this.enabled = cfg.enabled;
    this.stt = cfg.stt;
    this.tts = cfg.tts;
    this.wakeWordDet = cfg.wakeWord;
    this.micListener = cfg.onMicrophoneStateChange;
    if (this.wakeWordDet !== undefined && this.micListener !== undefined) {
      this.wakeWordDet.onMicrophoneStateChange = (e) => this.micListener?.(e);
    }
  }

  private emitMicState(active: boolean): void {
    this.micListener?.({ active, source: "transcribe", changedAt: Date.now() });
  }

  async transcribe(audioPath: string): Promise<{ text: string; durationMs: number }> {
    if (!this.enabled) throw new Error("Voice is not enabled in configuration");

    // Microphone arbiter: pause wake word so the two audio loops cannot contend
    // for the input device. Only resume if it was running before we stopped it.
    const resumeWakeWord =
      this.wakeWordDet !== undefined && this.wakeWordDet.isRunning;
    if (resumeWakeWord) {
      this.wakeWordDet?.stop();
    }

    this.emitMicState(true);
    try {
      return await this.stt.transcribe(audioPath);
    } finally {
      this.emitMicState(false);
      if (resumeWakeWord) {
        this.wakeWordDet?.start();
      }
    }
  }

  async speak(text: string): Promise<void> {
    if (!this.enabled) throw new Error("Voice is not enabled in configuration");
    return this.tts.speak(text);
  }

  async getStatus(): Promise<VoiceStatus> {
    const [sttAvailable, ttsAvailable] = await Promise.all([
      this.stt.isAvailable().catch(() => false),
      this.tts.isAvailable().catch(() => false),
    ]);
    return {
      enabled: this.enabled,
      sttAvailable,
      ttsAvailable,
      wakeWordActive: this.wakeWordDet?.isRunning ?? false,
    };
  }

  startWakeWord(): void {
    if (this.wakeWordDet === undefined) return;
    this.wakeWordDet.start();
  }

  stopWakeWord(): void {
    this.wakeWordDet?.stop();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/gateway && bun test src/voice/service.test.ts 2>&1 | tail -10
```

Expected: All tests PASS.

- [ ] **Step 5: Run type check**

```bash
cd packages/gateway && bun run typecheck 2>&1 | tail -5
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/voice/service.ts \
        packages/gateway/src/voice/service.test.ts
git commit -m "feat(voice): add VoiceService with microphone arbiter and mic-state callback"
```

---

## Task 7: Voice IPC Handlers

**Files:**
- Create: `packages/gateway/src/ipc/handlers/voice.ts`
- Create: `packages/gateway/src/ipc/handlers/voice.test.ts`
- Modify: `packages/gateway/src/ipc/server.ts`

IPC methods exposed:
| Method | Params | Returns |
|--------|--------|---------|
| `voice.getStatus` | — | `VoiceStatus` |
| `voice.transcribe` | `{ audioPath: string }` | `{ text: string; durationMs: number }` |
| `voice.speak` | `{ text: string }` | `{}` |
| `voice.startWakeWord` | — | `{}` |
| `voice.stopWakeWord` | — | `{}` |

IPC notifications emitted (broadcast to all connected clients):
| Notification | Params | Trigger |
|--------------|--------|---------|
| `voice.microphoneActive` | `{ active: boolean; source: "wake-word" \| "transcribe" }` | Fires on every mic open/close so the UI can render a privacy indicator |

**Error handling:** Errors are thrown as `VoiceRpcError` instances — a dedicated class mirroring the existing `LlmRpcError` / `ConnectorRpcError` pattern (`extends Error`, carries `rpcCode`). This keeps error shape consistent across namespaces so the server's central `dispatchMethod` can translate them via `RpcMethodError` without special-casing voice.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/gateway/src/ipc/handlers/voice.test.ts
import { describe, expect, test } from "bun:test";
import { dispatchVoiceRpc, VoiceRpcError } from "./voice.ts";
import type { VoiceRpcContext } from "./voice.ts";
import type { VoiceStatus } from "../../voice/service.ts";

function makeFakeService(enabled = true): VoiceRpcContext["voiceService"] {
  return {
    enabled,
    transcribe: async (path: string) => ({ text: `transcribed:${path}`, durationMs: 42 }),
    speak: async (_text: string) => undefined,
    getStatus: async (): Promise<VoiceStatus> => ({
      enabled,
      sttAvailable: true,
      ttsAvailable: true,
      wakeWordActive: false,
    }),
    startWakeWord: () => undefined,
    stopWakeWord: () => undefined,
  } as unknown as VoiceRpcContext["voiceService"];
}

describe("dispatchVoiceRpc", () => {
  test("returns miss for non-voice method", async () => {
    const ctx: VoiceRpcContext = { voiceService: makeFakeService() };
    const result = await dispatchVoiceRpc("llm.listModels", {}, ctx);
    expect(result.kind).toBe("miss");
  });

  test("voice.getStatus returns status object", async () => {
    const ctx: VoiceRpcContext = { voiceService: makeFakeService() };
    const result = await dispatchVoiceRpc("voice.getStatus", {}, ctx);
    expect(result.kind).toBe("hit");
    if (result.kind === "hit") {
      const value = result.value as VoiceStatus;
      expect(value.enabled).toBe(true);
      expect(value.sttAvailable).toBe(true);
    }
  });

  test("voice.transcribe returns text from STT", async () => {
    const ctx: VoiceRpcContext = { voiceService: makeFakeService() };
    const result = await dispatchVoiceRpc(
      "voice.transcribe",
      { audioPath: "/tmp/test.wav" },
      ctx,
    );
    expect(result.kind).toBe("hit");
    if (result.kind === "hit") {
      const value = result.value as { text: string };
      expect(value.text).toBe("transcribed:/tmp/test.wav");
    }
  });

  test("voice.transcribe throws VoiceRpcError for missing audioPath param", async () => {
    const ctx: VoiceRpcContext = { voiceService: makeFakeService() };
    await expect(dispatchVoiceRpc("voice.transcribe", {}, ctx)).rejects.toBeInstanceOf(
      VoiceRpcError,
    );
  });

  test("VoiceRpcError carries rpcCode -32602 for invalid params", async () => {
    const ctx: VoiceRpcContext = { voiceService: makeFakeService() };
    try {
      await dispatchVoiceRpc("voice.transcribe", {}, ctx);
      throw new Error("expected VoiceRpcError to be thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(VoiceRpcError);
      expect((e as VoiceRpcError).rpcCode).toBe(-32602);
    }
  });

  test("voice.speak returns empty result", async () => {
    const ctx: VoiceRpcContext = { voiceService: makeFakeService() };
    const result = await dispatchVoiceRpc("voice.speak", { text: "Hello" }, ctx);
    expect(result.kind).toBe("hit");
  });

  test("voice.speak throws VoiceRpcError for missing text param", async () => {
    const ctx: VoiceRpcContext = { voiceService: makeFakeService() };
    await expect(dispatchVoiceRpc("voice.speak", {}, ctx)).rejects.toBeInstanceOf(
      VoiceRpcError,
    );
  });

  test("voice.startWakeWord and voice.stopWakeWord return empty hit", async () => {
    const ctx: VoiceRpcContext = { voiceService: makeFakeService() };
    expect((await dispatchVoiceRpc("voice.startWakeWord", {}, ctx)).kind).toBe("hit");
    expect((await dispatchVoiceRpc("voice.stopWakeWord", {}, ctx)).kind).toBe("hit");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/gateway && bun test src/ipc/handlers/voice.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `voice.ts` handler**

```typescript
// packages/gateway/src/ipc/handlers/voice.ts
import type { VoiceService } from "../../voice/service.ts";

/**
 * Mirrors `LlmRpcError` / `ConnectorRpcError`: a named Error subclass carrying
 * the JSON-RPC error code. The central server dispatcher catches these and
 * translates them into wire-format RPC errors without special-casing voice.
 */
export class VoiceRpcError extends Error {
  readonly rpcCode: number;
  constructor(rpcCode: number, message: string) {
    super(message);
    this.rpcCode = rpcCode;
    this.name = "VoiceRpcError";
  }
}

export type VoiceRpcContext = {
  voiceService: VoiceService;
};

type RpcResult = { kind: "hit"; value: unknown } | { kind: "miss" };

function expectString(params: unknown, key: string): string {
  if (
    params === null ||
    typeof params !== "object" ||
    !(key in (params as Record<string, unknown>)) ||
    typeof (params as Record<string, unknown>)[key] !== "string"
  ) {
    throw new VoiceRpcError(-32602, `Missing or invalid param: ${key}`);
  }
  return (params as Record<string, string>)[key]!;
}

export async function dispatchVoiceRpc(
  method: string,
  params: unknown,
  ctx: VoiceRpcContext,
): Promise<RpcResult> {
  if (!method.startsWith("voice.")) return { kind: "miss" };

  switch (method) {
    case "voice.getStatus": {
      const status = await ctx.voiceService.getStatus();
      return { kind: "hit", value: status };
    }
    case "voice.transcribe": {
      const audioPath = expectString(params, "audioPath");
      try {
        const result = await ctx.voiceService.transcribe(audioPath);
        return { kind: "hit", value: result };
      } catch (e) {
        throw new VoiceRpcError(-32603, e instanceof Error ? e.message : String(e));
      }
    }
    case "voice.speak": {
      const text = expectString(params, "text");
      try {
        await ctx.voiceService.speak(text);
        return { kind: "hit", value: {} };
      } catch (e) {
        throw new VoiceRpcError(-32603, e instanceof Error ? e.message : String(e));
      }
    }
    case "voice.startWakeWord": {
      ctx.voiceService.startWakeWord();
      return { kind: "hit", value: {} };
    }
    case "voice.stopWakeWord": {
      ctx.voiceService.stopWakeWord();
      return { kind: "hit", value: {} };
    }
    default:
      return { kind: "miss" };
  }
}
```

- [ ] **Step 4: Wire into `server.ts`**

**a)** Add imports near the top of `server.ts`:

```typescript
import { dispatchVoiceRpc, VoiceRpcError } from "./handlers/voice.ts";
import type { VoiceService } from "../voice/service.ts";
```

**b)** Add `voiceService?: VoiceService` to `CreateIpcServerOptions`.

**c)** Add a `tryDispatchVoiceRpc` helper and call it in `dispatchMethod`, following the same pattern as `tryDispatchLlmRpc`. Return `voiceRpcSkipped` sentinel for non-voice methods or when `voiceService` is undefined. Because `dispatchVoiceRpc` now throws `VoiceRpcError` directly, catch `VoiceRpcError` in the server's central error handler (next to the existing `LlmRpcError` branch) and translate it into `new RpcMethodError(err.rpcCode, err.message)`.

**d)** Wire the `voice.microphoneActive` notification. When constructing the `VoiceService` in the Gateway startup path (outside this file — wherever `createIpcServer` is called), pass an `onMicrophoneStateChange` callback that calls the IPC server's existing notification-broadcast helper with method `voice.microphoneActive` and params `{ active, source }`. If the server does not yet have a notification broadcast helper, add a minimal `broadcastNotification(method, params)` that sends a JSON-RPC notification object (no `id`) to every connected session.

- [ ] **Step 5: Run test to verify it passes**

```bash
cd packages/gateway && bun test src/ipc/handlers/voice.test.ts 2>&1 | tail -10
```

Expected: All tests PASS.

- [ ] **Step 6: Run all IPC tests to catch regressions**

```bash
cd packages/gateway && bun test src/ipc/ 2>&1 | tail -15
```

Expected: All PASS.

- [ ] **Step 7: Run type check**

```bash
cd packages/gateway && bun run typecheck 2>&1 | tail -5
```

- [ ] **Step 8: Commit**

```bash
git add packages/gateway/src/ipc/handlers/voice.ts \
        packages/gateway/src/ipc/handlers/voice.test.ts \
        packages/gateway/src/ipc/server.ts
git commit -m "feat(ipc): add voice.* RPC handlers wired into IPC server"
```

---

## Task 8: Push-to-Talk Integration Test

**Files:**
- Create: `packages/gateway/src/voice/push-to-talk.test.ts`

Verifies the full STT → LLM → TTS round-trip with mock providers. This is the acceptance-criteria test for WS2.

- [ ] **Step 1: Write the integration test**

```typescript
// packages/gateway/src/voice/push-to-talk.test.ts
import { describe, expect, test } from "bun:test";
import { VoiceService } from "./service.ts";
import type { SttProvider, TtsProvider } from "./types.ts";
import { LlmRouter, type LlmRouterConfig } from "../llm/router.ts";
import type { LlmProvider } from "../llm/types.ts";

function makeFakeStt(transcriptToReturn: string): SttProvider {
  return {
    isAvailable: async () => true,
    transcribe: async (_path) => ({ text: transcriptToReturn, durationMs: 5 }),
  };
}

function makeFakeSpokenLog(): { spoken: string[]; tts: TtsProvider } {
  const spoken: string[] = [];
  return {
    spoken,
    tts: {
      isAvailable: async () => true,
      speak: async (text) => { spoken.push(text); },
    },
  };
}

function makeFakeLlmProvider(): LlmProvider {
  return {
    providerId: "ollama",
    isAvailable: async () => true,
    listModels: async () => [],
    generate: async (opts) => ({
      text: `LLM response to: ${opts.prompt}`,
      tokensIn: 1,
      tokensOut: 1,
      modelUsed: "llama3.2",
      isLocal: true,
      provider: "ollama",
    }),
  };
}

const ROUTER_CONFIG: LlmRouterConfig = {
  preferLocal: true,
  remoteModel: "claude-sonnet-4-6",
  localModel: "llama3.2",
  minReasoningParams: 7,
  enforceAirGap: false,
};

describe("Push-to-talk round-trip", () => {
  test("STT → LLM generate → TTS pipeline completes successfully", async () => {
    const stt = makeFakeStt("Hey Nimbus, summarize my week");
    const { spoken, tts } = makeFakeSpokenLog();

    const router = new LlmRouter(ROUTER_CONFIG);
    router.registerProvider(makeFakeLlmProvider());

    const voice = new VoiceService({ enabled: true, stt, tts });

    // Step 1: Transcribe audio
    const { text: transcript } = await voice.transcribe("/tmp/recording.wav");
    expect(transcript).toBe("Hey Nimbus, summarize my week");

    // Step 2: Route to LLM
    const llmResult = await router.generate({ task: "summarisation", prompt: transcript });
    expect(llmResult.text).toBe("LLM response to: Hey Nimbus, summarize my week");

    // Step 3: Speak the response
    await voice.speak(llmResult.text);
    expect(spoken).toEqual(["LLM response to: Hey Nimbus, summarize my week"]);
  });

  test("voice.transcribe throws when voice is disabled", async () => {
    const stt = makeFakeStt("test");
    const { tts } = makeFakeSpokenLog();
    const voice = new VoiceService({ enabled: false, stt, tts });
    await expect(voice.transcribe("/tmp/audio.wav")).rejects.toThrow("not enabled");
  });

  test("voice.speak throws when voice is disabled", async () => {
    const stt = makeFakeStt("test");
    const { tts } = makeFakeSpokenLog();
    const voice = new VoiceService({ enabled: false, stt, tts });
    await expect(voice.speak("Hello")).rejects.toThrow("not enabled");
  });

  test("getStatus reflects live availability", async () => {
    const stt = makeFakeStt("test");
    const { tts } = makeFakeSpokenLog();
    const voice = new VoiceService({ enabled: true, stt, tts });
    const status = await voice.getStatus();
    expect(status.enabled).toBe(true);
    expect(status.sttAvailable).toBe(true);
    expect(status.ttsAvailable).toBe(true);
    expect(status.wakeWordActive).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

```bash
cd packages/gateway && bun test src/voice/push-to-talk.test.ts 2>&1 | tail -10
```

Expected: All tests PASS.

- [ ] **Step 3: Run the full voice test suite**

```bash
cd packages/gateway && bun test src/voice/ src/config/nimbus-toml-voice.test.ts src/ipc/handlers/voice.test.ts 2>&1 | tail -15
```

Expected: All PASS.

- [ ] **Step 4: Run type check**

```bash
cd packages/gateway && bun run typecheck 2>&1 | tail -5
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/voice/push-to-talk.test.ts
git commit -m "test(voice): add push-to-talk integration test (STT → LLM → TTS round-trip)"
```

---

## Task 9: `nimbus doctor` — Voice Binary Checks

**Files:**
- Modify: `packages/cli/src/commands/doctor.ts`
- Create: `packages/cli/src/commands/doctor-voice.test.ts`

`WhisperSttProvider.isAvailable()` and `NativeTtsProvider.isAvailable()` return a boolean, but surfacing **why** a binary is missing (and on which platform) belongs in `nimbus doctor` alongside the existing Bun / Vault / index checks. This task only runs voice checks when `config.voice.enabled === true` — disabled voice means zero friction for users who never opt in.

Each check prints one line using the existing `[ok] / [warn] / [fail]` prefix convention already used in `doctor.ts`. Missing binaries are `[warn]` (not `[fail]`) because voice is an opt-in feature — the Gateway still starts without it.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/cli/src/commands/doctor-voice.test.ts
import { describe, expect, test } from "bun:test";
import { doctorVoiceLines } from "./doctor.ts";

describe("doctorVoiceLines", () => {
  test("returns empty array when voice is disabled", () => {
    const lines = doctorVoiceLines(
      { enabled: false, whisperPath: "", piperPath: "", piperModel: "" },
      { which: () => null, platform: "linux" },
    );
    expect(lines).toEqual([]);
  });

  test("reports whisper-cli missing on PATH when not configured", () => {
    const lines = doctorVoiceLines(
      { enabled: true, whisperPath: "", piperPath: "", piperModel: "" },
      { which: () => null, platform: "linux" },
    );
    expect(lines.some((l) => l.includes("[warn]") && l.includes("whisper-cli"))).toBe(true);
  });

  test("reports ffmpeg missing for wake-word capture", () => {
    const lines = doctorVoiceLines(
      { enabled: true, whisperPath: "", piperPath: "", piperModel: "" },
      { which: () => null, platform: "linux" },
    );
    expect(lines.some((l) => l.includes("[warn]") && l.includes("ffmpeg"))).toBe(true);
  });

  test("reports Linux TTS missing when neither espeak-ng nor spd-say is present", () => {
    const lines = doctorVoiceLines(
      { enabled: true, whisperPath: "", piperPath: "", piperModel: "" },
      { which: () => null, platform: "linux" },
    );
    expect(lines.some((l) => l.includes("[warn]") && l.includes("espeak-ng"))).toBe(true);
  });

  test("reports Linux TTS ok when espeak-ng is on PATH", () => {
    const lines = doctorVoiceLines(
      { enabled: true, whisperPath: "", piperPath: "", piperModel: "" },
      { which: (n) => (n === "espeak-ng" ? "/usr/bin/espeak-ng" : null), platform: "linux" },
    );
    expect(lines.some((l) => l.includes("[ok]") && l.includes("espeak-ng"))).toBe(true);
  });

  test("skips Linux TTS check on darwin/win32 (always available)", () => {
    const darwin = doctorVoiceLines(
      { enabled: true, whisperPath: "", piperPath: "", piperModel: "" },
      { which: () => null, platform: "darwin" },
    );
    expect(darwin.some((l) => l.includes("say"))).toBe(true);
    const win = doctorVoiceLines(
      { enabled: true, whisperPath: "", piperPath: "", piperModel: "" },
      { which: () => null, platform: "win32" },
    );
    expect(win.some((l) => l.includes("SAPI") || l.includes("PowerShell"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/cli && bun test src/commands/doctor-voice.test.ts 2>&1 | tail -10
```

Expected: FAIL — `doctorVoiceLines is not a function`.

- [ ] **Step 3: Add `doctorVoiceLines` to `doctor.ts`**

Append this exported helper to `packages/cli/src/commands/doctor.ts`. Keep the function pure and dependency-injected (takes `which` + `platform` as options) so the test does not shell out:

```typescript
export type DoctorVoiceConfig = {
  enabled: boolean;
  whisperPath: string;
  piperPath: string;
  piperModel: string;
};

export type DoctorEnv = {
  which: (name: string) => string | null;
  platform: "win32" | "darwin" | "linux";
};

export function doctorVoiceLines(cfg: DoctorVoiceConfig, env: DoctorEnv): string[] {
  if (!cfg.enabled) return [];
  const lines: string[] = [];

  // Whisper binary
  const whisperOk =
    cfg.whisperPath !== "" || env.which("whisper-cli") !== null || env.which("main") !== null;
  lines.push(
    whisperOk
      ? "[ok] Voice: whisper-cli is available."
      : "[warn] Voice: whisper-cli not found on PATH and voice.whisper_path is unset — STT will not work.",
  );

  // ffmpeg (required for wake-word recording)
  const ffmpegOk = env.which("ffmpeg") !== null;
  lines.push(
    ffmpegOk
      ? "[ok] Voice: ffmpeg is on PATH."
      : "[warn] Voice: ffmpeg not found on PATH — wake word detection requires ffmpeg for audio capture.",
  );

  // Platform TTS
  if (env.platform === "darwin") {
    lines.push("[ok] Voice: macOS `say` is always available.");
  } else if (env.platform === "win32") {
    lines.push("[ok] Voice: Windows SAPI via PowerShell is always available.");
  } else {
    const espeakOk = env.which("espeak-ng") !== null;
    const spdSayOk = env.which("spd-say") !== null;
    if (espeakOk) {
      lines.push("[ok] Voice: Linux TTS via espeak-ng.");
    } else if (spdSayOk) {
      lines.push("[ok] Voice: Linux TTS via spd-say (espeak-ng preferred).");
    } else {
      lines.push(
        "[warn] Voice: neither espeak-ng nor spd-say found on PATH — install one to enable TTS on Linux.",
      );
    }
  }

  // Optional Piper
  if (cfg.piperPath !== "" || cfg.piperModel !== "") {
    const piperBinOk =
      cfg.piperPath !== "" &&
      (cfg.piperPath.includes("/") || cfg.piperPath.includes("\\") || env.which(cfg.piperPath) !== null);
    if (!piperBinOk) {
      lines.push(`[warn] Voice: piper_path is set but the binary was not found: ${cfg.piperPath}`);
    }
    if (cfg.piperModel === "") {
      lines.push("[warn] Voice: piper_path is set but piper_model is empty — Piper TTS will not run.");
    }
  }

  return lines;
}
```

Then update `runDoctor` to call `doctorVoiceLines` with the loaded `[voice]` TOML config and `{ which: Bun.which, platform: process.platform as "win32" | "darwin" | "linux" }`, printing each returned line. Keep exit code calculation additive: any `[fail]` promotes to 2, any `[warn]` promotes to 1, same as existing checks.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/cli && bun test src/commands/doctor-voice.test.ts 2>&1 | tail -10
```

Expected: All tests PASS.

- [ ] **Step 5: Run type check**

```bash
bun run typecheck 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/doctor.ts \
        packages/cli/src/commands/doctor-voice.test.ts
git commit -m "feat(cli): add nimbus doctor voice-binary checks (whisper-cli, ffmpeg, native TTS)"
```

---

## Final Verification

- [ ] **Run all new WS2 tests**

```bash
cd packages/gateway && bun test src/voice/ src/config/nimbus-toml-voice.test.ts src/ipc/handlers/voice.test.ts 2>&1 | tail -20
cd ../cli && bun test src/commands/doctor-voice.test.ts 2>&1 | tail -10
```

Expected: All PASS.

- [ ] **Run full test suite to check for regressions**

```bash
bun test 2>&1 | tail -10
```

Expected: All PASS, 0 failures.

- [ ] **Run typecheck on all packages**

```bash
bun run typecheck 2>&1 | tail -10
```

Expected: 0 errors.

- [ ] **Acceptance criterion verification**

The acceptance criterion for WS2 is: _Voice push-to-talk query round-trip (STT → LLM → TTS) — all three platforms._

The `push-to-talk.test.ts` integration test satisfies this criterion with mock providers. Real hardware testing requires:
1. A WAV file from the microphone (push-to-talk recording)
2. Whisper binary installed (`brew install whisper-cpp` / `apt install whisper-cpp` / pre-built Windows binary)
3. LLM router pointing to Ollama or llama.cpp
4. Native TTS available (`say` on macOS, `espeak-ng` on Linux, PowerShell speech on Windows)

---

## Acceptance Criteria Checklist

- [ ] `packages/gateway/src/voice/types.ts` — `SttProvider`, `TtsProvider`, `WakeWordDetector`, `MicrophoneStateEvent` interfaces
- [ ] `packages/gateway/src/config/nimbus-toml.ts` — `[voice]` section parser; `DEFAULT_NIMBUS_VOICE_TOML` with `enabled = false` default
- [ ] `packages/gateway/src/voice/stt.ts` — `WhisperSttProvider` with binary discovery, `-nt` stdout parsing (no `--output-txt`), and audio-file existence check
- [ ] `packages/gateway/src/voice/tts.ts` — `NativeTtsProvider` (macOS/Windows/Linux) + `PiperTtsProvider` with streaming-TTS TODO
- [ ] `packages/gateway/src/voice/wake-word.ts` — `WakeWordDetectorImpl` with VAD silence-skip, `-ar 16000 -ac 1` ffmpeg flags, dedicated `wakeWordWhisperModel` (default `tiny.en`), mic-state callback, and pluggable interface for future engines (Porcupine/openWakeWord)
- [ ] `packages/gateway/src/voice/service.ts` — `VoiceService` wiring all three providers; microphone arbiter pauses wake word during `transcribe()`; forwards mic-state events
- [ ] `packages/gateway/src/ipc/handlers/voice.ts` — `dispatchVoiceRpc` with 5 methods + `VoiceRpcError` class matching `LlmRpcError` pattern
- [ ] `voice.*` methods wired into `server.ts`; `voice.microphoneActive` notification broadcast on mic open/close
- [ ] `packages/cli/src/commands/doctor.ts` — `doctorVoiceLines` checks whisper-cli, ffmpeg, platform TTS, and Piper (only when `voice.enabled`)
- [ ] Integration test: push-to-talk round-trip passes with mock providers
- [ ] No shell injection: text always passed as argv, never interpolated
- [ ] No `require()` in voice code — Bun-native ESM imports only
- [ ] All tests pass; 0 typecheck errors
