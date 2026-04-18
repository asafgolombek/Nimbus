import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { NativeTtsProvider } from "./tts.ts";

type MockSpawnResult = {
  exited: Promise<number>;
};

function makeSpawnMock(exitCode = 0): MockSpawnResult {
  return { exited: Promise.resolve(exitCode) };
}

async function runLinuxTts(whichFn: (name: string) => string | null): Promise<string[][]> {
  const origWhich = Bun.which;
  Bun.which = whichFn;
  const captured: string[][] = [];
  const origSpawn = Bun.spawn;
  Bun.spawn = mock((cmd: string[], _opts?: unknown) => {
    captured.push(cmd);
    return makeSpawnMock(0);
  }) as unknown as typeof Bun.spawn;
  try {
    const provider = new NativeTtsProvider({ platform: "linux" });
    await provider.speak("Test");
  } finally {
    Bun.which = origWhich;
    Bun.spawn = origSpawn;
  }
  return captured;
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
    Bun.spawn = mock((_cmd: string[], _opts?: unknown) =>
      makeSpawnMock(0),
    ) as unknown as typeof Bun.spawn;

    const provider = new NativeTtsProvider({ platform: "darwin" });
    await expect(provider.speak("Hello world")).resolves.toBeUndefined();
  });

  test("speak throws when TTS exits with non-zero code", async () => {
    Bun.spawn = mock((_cmd: string[], _opts?: unknown) =>
      makeSpawnMock(1),
    ) as unknown as typeof Bun.spawn;

    const provider = new NativeTtsProvider({ platform: "darwin" });
    await expect(provider.speak("Hello")).rejects.toThrow("TTS exited");
  });

  test("speak passes text as separate argv element (no shell injection risk)", async () => {
    const captured: string[][] = [];
    Bun.spawn = mock((cmd: string[], _opts?: unknown) => {
      captured.push(cmd);
      return makeSpawnMock(0);
    }) as unknown as typeof Bun.spawn;

    const dangerous = 'Hello"; rm -rf /';
    const provider = new NativeTtsProvider({ platform: "darwin" });
    await provider.speak(dangerous);
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
    const captured = await runLinuxTts((_name) => "/usr/bin/espeak-ng");
    expect(captured[0]?.[0]).toContain("espeak-ng");
  });

  test("linux: falls back to spd-say when espeak-ng not on PATH", async () => {
    const captured = await runLinuxTts((name) => (name === "spd-say" ? "/usr/bin/spd-say" : null));
    expect(captured[0]?.[0]).toContain("spd-say");
  });
});
