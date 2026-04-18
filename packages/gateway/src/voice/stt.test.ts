import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { WhisperSttProvider } from "./stt.ts";

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
    stderr: new ReadableStream({
      start(c) {
        c.close();
      },
    }),
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
    Bun.spawn = mock((_cmd: string[], _opts?: unknown) =>
      makeSpawnMock(WHISPER_STDOUT),
    ) as unknown as typeof Bun.spawn;

    const provider = new WhisperSttProvider({ whisperBin: "/usr/local/bin/whisper-cli" });
    const result = await provider.transcribe(import.meta.path);
    expect(result.text).toBe("Hello, this is a test.");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("transcribe strips leading/trailing whitespace from transcript", async () => {
    Bun.spawn = mock((_cmd: string[], _opts?: unknown) =>
      makeSpawnMock("[00:00:00.000 --> 00:00:01.000]   Trimmed output.   \n"),
    ) as unknown as typeof Bun.spawn;

    const provider = new WhisperSttProvider({ whisperBin: "/usr/local/bin/whisper-cli" });
    const result = await provider.transcribe(import.meta.path);
    expect(result.text).toBe("Trimmed output.");
  });

  test("transcribe throws when Whisper exits with non-zero code", async () => {
    Bun.spawn = mock((_cmd: string[], _opts?: unknown) =>
      makeSpawnMock("", 1),
    ) as unknown as typeof Bun.spawn;

    const provider = new WhisperSttProvider({ whisperBin: "/usr/local/bin/whisper-cli" });
    await expect(provider.transcribe(import.meta.path)).rejects.toThrow("Whisper exited");
  });

  test("transcribe throws when audio file does not exist", async () => {
    const provider = new WhisperSttProvider({ whisperBin: "/usr/local/bin/whisper-cli" });
    await expect(provider.transcribe("/nonexistent/audio.wav")).rejects.toThrow("not found");
  });

  test("transcribe passes model flag when modelName is configured", async () => {
    const captured: string[][] = [];
    Bun.spawn = mock((cmd: string[], _opts?: unknown) => {
      captured.push(cmd as string[]);
      return makeSpawnMock(WHISPER_STDOUT);
    }) as unknown as typeof Bun.spawn;

    const provider = new WhisperSttProvider({
      whisperBin: "/usr/local/bin/whisper-cli",
      modelName: "small",
    });
    await provider.transcribe(import.meta.path);
    expect(captured[0]).toContain("-m");
    expect(captured[0]).toContain("small");
  });
});
