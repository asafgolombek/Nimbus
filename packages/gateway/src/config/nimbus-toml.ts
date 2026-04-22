import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { processEnvGet } from "../platform/env-access.ts";

export type NimbusEmbeddingToml = {
  enabled: boolean;
  provider: "local" | "openai";
  model: string;
  chunkTokens: number;
  chunkOverlapTokens: number;
  backfillBatchSize: number;
  pauseOnBattery: boolean;
};

export const DEFAULT_NIMBUS_EMBEDDING_TOML: NimbusEmbeddingToml = {
  enabled: true,
  provider: "local",
  model: "all-MiniLM-L6-v2",
  chunkTokens: 256,
  chunkOverlapTokens: 32,
  backfillBatchSize: 50,
  pauseOnBattery: true,
};

function stripComment(line: string): string {
  const hash = line.indexOf("#");
  if (hash < 0) {
    return line;
  }
  return line.slice(0, hash);
}

function parseBool(raw: string): boolean | undefined {
  const s = raw.trim().toLowerCase();
  if (s === "true") {
    return true;
  }
  if (s === "false") {
    return false;
  }
  return undefined;
}

function parseString(raw: string): string {
  const t = raw.trim();
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
    return t.slice(1, -1).replaceAll(String.raw`\\"`, '"');
  }
  return t;
}

function parseIntDec(raw: string): number | undefined {
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) ? n : undefined;
}

function setEmbeddingEnabled(out: Partial<NimbusEmbeddingToml>, valRaw: string): void {
  const b = parseBool(valRaw);
  if (b !== undefined) {
    out.enabled = b;
  }
}

function setEmbeddingPauseOnBattery(out: Partial<NimbusEmbeddingToml>, valRaw: string): void {
  const b = parseBool(valRaw);
  if (b !== undefined) {
    out.pauseOnBattery = b;
  }
}

function setEmbeddingProvider(out: Partial<NimbusEmbeddingToml>, valRaw: string): void {
  const p = parseString(valRaw).toLowerCase();
  if (p === "local" || p === "openai") {
    out.provider = p;
  }
}

function setEmbeddingPositiveInt(
  out: Partial<NimbusEmbeddingToml>,
  valRaw: string,
  field: "chunkTokens" | "backfillBatchSize",
): void {
  const n = parseIntDec(valRaw);
  if (n !== undefined && n > 0) {
    out[field] = n;
  }
}

function setEmbeddingOverlapTokens(out: Partial<NimbusEmbeddingToml>, valRaw: string): void {
  const n = parseIntDec(valRaw);
  if (n !== undefined && n >= 0) {
    out.chunkOverlapTokens = n;
  }
}

function applyNimbusEmbeddingKey(
  out: Partial<NimbusEmbeddingToml>,
  key: string,
  valRaw: string,
): void {
  switch (key) {
    case "enabled":
      setEmbeddingEnabled(out, valRaw);
      break;
    case "provider":
      setEmbeddingProvider(out, valRaw);
      break;
    case "model":
      out.model = parseString(valRaw);
      break;
    case "chunk_tokens":
      setEmbeddingPositiveInt(out, valRaw, "chunkTokens");
      break;
    case "chunk_overlap_tokens":
      setEmbeddingOverlapTokens(out, valRaw);
      break;
    case "backfill_batch_size":
      setEmbeddingPositiveInt(out, valRaw, "backfillBatchSize");
      break;
    case "pause_on_battery":
      setEmbeddingPauseOnBattery(out, valRaw);
      break;
    default:
      break;
  }
}

/**
 * Best-effort `[embedding]` section from `nimbus.toml` (no full TOML dependency).
 */
export function parseNimbusTomlEmbeddingSection(source: string): Partial<NimbusEmbeddingToml> {
  const lines = source.split(/\r?\n/);
  let inEmbedding = false;
  const out: Partial<NimbusEmbeddingToml> = {};

  for (const line of lines) {
    const trimmed = stripComment(line).trim();
    if (trimmed === "") {
      continue;
    }
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inEmbedding = trimmed === "[embedding]";
      continue;
    }
    if (!inEmbedding) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    const valRaw = trimmed.slice(eq + 1).trim();
    applyNimbusEmbeddingKey(out, key, valRaw);
  }
  return out;
}

/** Active profile from `NIMBUS_PROFILE` (default profile uses `nimbus.toml`). */
export function resolveNimbusTomlForProfile(configDir: string): string {
  const p = processEnvGet("NIMBUS_PROFILE")?.trim();
  if (p === undefined || p === "" || p === "default") {
    return join(configDir, "nimbus.toml");
  }
  const alt = join(configDir, `nimbus.${p}.toml`);
  return existsSync(alt) ? alt : join(configDir, "nimbus.toml");
}

export function loadNimbusEmbeddingFromPath(tomlPath: string): NimbusEmbeddingToml {
  if (!existsSync(tomlPath)) {
    return structuredClone(DEFAULT_NIMBUS_EMBEDDING_TOML);
  }
  try {
    const raw = readFileSync(tomlPath, "utf8");
    return structuredClone({
      ...DEFAULT_NIMBUS_EMBEDDING_TOML,
      ...parseNimbusTomlEmbeddingSection(raw),
    });
  } catch {
    return structuredClone(DEFAULT_NIMBUS_EMBEDDING_TOML);
  }
}

export function loadNimbusEmbeddingFromConfigDir(configDir: string): NimbusEmbeddingToml {
  return loadNimbusEmbeddingFromPath(join(configDir, "nimbus.toml"));
}

// ─── [llm] section ──────────────────────────────────────────────────────────

export type NimbusLlmToml = {
  preferLocal: boolean;
  remoteModel: string;
  localModel: string;
  llamacppServerPath: string;
  minReasoningParams: number;
  enforceAirGap: boolean;
  maxAgentDepth: number;
  maxToolCallsPerSession: number;
};

export const DEFAULT_NIMBUS_LLM_TOML: NimbusLlmToml = {
  preferLocal: true,
  remoteModel: "claude-sonnet-4-6",
  localModel: "llama3.2",
  llamacppServerPath: "",
  minReasoningParams: 7,
  enforceAirGap: false,
  maxAgentDepth: 3,
  maxToolCallsPerSession: 20,
};

function applyNimbusLlmKey(out: Partial<NimbusLlmToml>, key: string, valRaw: string): void {
  switch (key) {
    case "prefer_local": {
      const b = parseBool(valRaw);
      if (b !== undefined) out.preferLocal = b;
      break;
    }
    case "remote_model":
      out.remoteModel = parseString(valRaw);
      break;
    case "local_model":
      out.localModel = parseString(valRaw);
      break;
    case "llamacpp_server_path":
      out.llamacppServerPath = parseString(valRaw);
      break;
    case "min_reasoning_params": {
      const n = parseIntDec(valRaw);
      if (n !== undefined && n > 0) out.minReasoningParams = n;
      break;
    }
    case "enforce_air_gap": {
      const b = parseBool(valRaw);
      if (b !== undefined) out.enforceAirGap = b;
      break;
    }
    case "max_agent_depth": {
      const n = parseIntDec(valRaw);
      if (n !== undefined && n >= 1 && n <= 10) out.maxAgentDepth = n;
      break;
    }
    case "max_tool_calls_per_session": {
      const n = parseIntDec(valRaw);
      if (n !== undefined && n >= 1 && n <= 200) out.maxToolCallsPerSession = n;
      break;
    }
    default:
      break;
  }
}

export function parseNimbusTomlLlmSection(source: string): Partial<NimbusLlmToml> {
  const lines = source.split(/\r?\n/);
  let inLlm = false;
  const out: Partial<NimbusLlmToml> = {};

  for (const line of lines) {
    const trimmed = stripComment(line).trim();
    if (trimmed === "") continue;
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inLlm = trimmed === "[llm]";
      continue;
    }
    if (!inLlm) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const valRaw = trimmed.slice(eq + 1).trim();
    applyNimbusLlmKey(out, key, valRaw);
  }
  return out;
}

export function loadNimbusLlmFromPath(tomlPath: string): NimbusLlmToml {
  if (!existsSync(tomlPath)) {
    return structuredClone(DEFAULT_NIMBUS_LLM_TOML);
  }
  try {
    const raw = readFileSync(tomlPath, "utf8");
    return structuredClone({
      ...DEFAULT_NIMBUS_LLM_TOML,
      ...parseNimbusTomlLlmSection(raw),
    });
  } catch {
    return structuredClone(DEFAULT_NIMBUS_LLM_TOML);
  }
}

export function loadNimbusLlmFromConfigDir(configDir: string): NimbusLlmToml {
  return loadNimbusLlmFromPath(join(configDir, "nimbus.toml"));
}

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

// ─── [updater] section ──────────────────────────────────────────────────────

export type NimbusUpdaterToml = {
  enabled: boolean;
  url: string;
  checkOnStartup: boolean;
  autoApply: boolean;
};

export const DEFAULT_NIMBUS_UPDATER_TOML: NimbusUpdaterToml = {
  enabled: true,
  url: "https://github.com/asafgolombek/Nimbus/releases/latest/download/latest.json",
  checkOnStartup: true,
  autoApply: false,
};

function applyNimbusUpdaterKey(out: Partial<NimbusUpdaterToml>, key: string, valRaw: string): void {
  switch (key) {
    case "enabled": {
      const b = parseBool(valRaw);
      if (b !== undefined) out.enabled = b;
      break;
    }
    case "url":
      out.url = parseString(valRaw);
      break;
    case "check_on_startup": {
      const b = parseBool(valRaw);
      if (b !== undefined) out.checkOnStartup = b;
      break;
    }
    case "auto_apply": {
      const b = parseBool(valRaw);
      if (b !== undefined) out.autoApply = b;
      break;
    }
    default:
      break;
  }
}

export function parseNimbusTomlUpdaterSection(source: string): Partial<NimbusUpdaterToml> {
  const lines = source.split(/\r?\n/);
  let inUpdater = false;
  const out: Partial<NimbusUpdaterToml> = {};

  for (const line of lines) {
    const trimmed = stripComment(line).trim();
    if (trimmed === "") continue;
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inUpdater = trimmed === "[updater]";
      continue;
    }
    if (!inUpdater) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const valRaw = trimmed.slice(eq + 1).trim();
    applyNimbusUpdaterKey(out, key, valRaw);
  }
  return out;
}

export function parseNimbusUpdaterToml(
  raw: string,
  defaults: NimbusUpdaterToml = DEFAULT_NIMBUS_UPDATER_TOML,
): NimbusUpdaterToml {
  const section = parseNimbusTomlUpdaterSection(raw);
  const result: NimbusUpdaterToml = { ...defaults, ...section };

  const urlOverride = processEnvGet("NIMBUS_UPDATER_URL");
  if (urlOverride) {
    result.url = urlOverride;
  }
  if (processEnvGet("NIMBUS_UPDATER_DISABLE") === "1") {
    result.enabled = false;
  }
  return result;
}

export function loadNimbusUpdaterFromPath(tomlPath: string): NimbusUpdaterToml {
  if (!existsSync(tomlPath)) {
    return structuredClone(DEFAULT_NIMBUS_UPDATER_TOML);
  }
  try {
    const raw = readFileSync(tomlPath, "utf8");
    return parseNimbusUpdaterToml(raw);
  } catch {
    return structuredClone(DEFAULT_NIMBUS_UPDATER_TOML);
  }
}

export function loadNimbusUpdaterFromConfigDir(configDir: string): NimbusUpdaterToml {
  return loadNimbusUpdaterFromPath(join(configDir, "nimbus.toml"));
}

// ─── [lan] section ──────────────────────────────────────────────────────────

export type NimbusLanToml = {
  enabled: boolean;
  port: number;
  bind: string;
  pairingWindowSeconds: number;
  maxFailedAttempts: number;
  lockoutSeconds: number;
};

export const DEFAULT_NIMBUS_LAN_TOML: NimbusLanToml = {
  enabled: false,
  port: 7475,
  bind: "0.0.0.0",
  pairingWindowSeconds: 300,
  maxFailedAttempts: 3,
  lockoutSeconds: 60,
};

function applyNimbusLanKey(out: Partial<NimbusLanToml>, key: string, valRaw: string): void {
  switch (key) {
    case "enabled": {
      const b = parseBool(valRaw);
      if (b !== undefined) out.enabled = b;
      break;
    }
    case "port": {
      const n = parseIntDec(valRaw);
      if (n !== undefined && n > 0) out.port = n;
      break;
    }
    case "bind":
      out.bind = parseString(valRaw);
      break;
    case "pairing_window_seconds": {
      const n = parseIntDec(valRaw);
      if (n !== undefined && n > 0) out.pairingWindowSeconds = n;
      break;
    }
    case "max_failed_attempts": {
      const n = parseIntDec(valRaw);
      if (n !== undefined && n > 0) out.maxFailedAttempts = n;
      break;
    }
    case "lockout_seconds": {
      const n = parseIntDec(valRaw);
      if (n !== undefined && n >= 0) out.lockoutSeconds = n;
      break;
    }
    default:
      break;
  }
}

function parseNimbusTomlLanSection(source: string): Partial<NimbusLanToml> {
  const lines = source.split(/\r?\n/);
  let inLan = false;
  const out: Partial<NimbusLanToml> = {};

  for (const line of lines) {
    const trimmed = stripComment(line).trim();
    if (trimmed === "") continue;
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inLan = trimmed === "[lan]";
      continue;
    }
    if (!inLan) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const valRaw = trimmed.slice(eq + 1).trim();
    applyNimbusLanKey(out, key, valRaw);
  }
  return out;
}

export function parseNimbusLanToml(
  raw: string,
  defaults: NimbusLanToml = DEFAULT_NIMBUS_LAN_TOML,
): NimbusLanToml {
  const section = parseNimbusTomlLanSection(raw);
  const result: NimbusLanToml = { ...defaults, ...section };

  const portOverride = processEnvGet("NIMBUS_LAN_PORT");
  if (portOverride) {
    const parsed = Number.parseInt(portOverride, 10);
    if (!Number.isNaN(parsed)) result.port = parsed;
  }
  return result;
}

export function loadNimbusLanFromPath(tomlPath: string): NimbusLanToml {
  if (!existsSync(tomlPath)) {
    return structuredClone(DEFAULT_NIMBUS_LAN_TOML);
  }
  try {
    const raw = readFileSync(tomlPath, "utf8");
    return parseNimbusLanToml(raw);
  } catch {
    return structuredClone(DEFAULT_NIMBUS_LAN_TOML);
  }
}

export function loadNimbusLanFromConfigDir(configDir: string): NimbusLanToml {
  return loadNimbusLanFromPath(join(configDir, "nimbus.toml"));
}

// ─── [automation] ───────────────────────────────────────────────────────────

export type NimbusAutomationToml = {
  /** When true (default), graph predicates on watchers are evaluated. Phase 4 Section 2. */
  graphConditions: boolean;
};

export const DEFAULT_NIMBUS_AUTOMATION_TOML: NimbusAutomationToml = {
  graphConditions: true,
};

function parseNimbusTomlAutomationSection(source: string): Partial<NimbusAutomationToml> {
  const lines = source.split(/\r?\n/);
  let inSection = false;
  const out: Partial<NimbusAutomationToml> = {};
  for (const line of lines) {
    const trimmed = stripComment(line).trim();
    if (trimmed === "") continue;
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inSection = trimmed === "[automation]";
      continue;
    }
    if (!inSection) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const valRaw = trimmed.slice(eq + 1).trim();
    if (key === "graph_conditions") {
      const b = parseBool(valRaw);
      if (b !== undefined) out.graphConditions = b;
    }
  }
  return out;
}

export function parseNimbusAutomationToml(
  raw: string,
  defaults: NimbusAutomationToml = DEFAULT_NIMBUS_AUTOMATION_TOML,
): NimbusAutomationToml {
  return { ...defaults, ...parseNimbusTomlAutomationSection(raw) };
}

export function loadNimbusAutomationFromPath(tomlPath: string): NimbusAutomationToml {
  if (!existsSync(tomlPath)) {
    return structuredClone(DEFAULT_NIMBUS_AUTOMATION_TOML);
  }
  try {
    const raw = readFileSync(tomlPath, "utf8");
    return parseNimbusAutomationToml(raw);
  } catch {
    return structuredClone(DEFAULT_NIMBUS_AUTOMATION_TOML);
  }
}

export function loadNimbusAutomationFromConfigDir(configDir: string): NimbusAutomationToml {
  return loadNimbusAutomationFromPath(join(configDir, "nimbus.toml"));
}
