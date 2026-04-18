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
