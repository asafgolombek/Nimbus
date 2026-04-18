import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_NIMBUS_VOICE_TOML,
  loadNimbusVoiceFromPath,
  parseNimbusTomlVoiceSection,
} from "./nimbus-toml.ts";

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
    expect(result.whisperModel).toBe("base.en");
  });
});
