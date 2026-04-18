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
    if (this.whisperBin.includes("/") || this.whisperBin.includes("\\")) {
      try {
        return await Bun.file(this.whisperBin).exists();
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
