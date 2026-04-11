import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

export function loadNimbusEmbeddingFromConfigDir(configDir: string): NimbusEmbeddingToml {
  const path = join(configDir, "nimbus.toml");
  if (!existsSync(path)) {
    return { ...DEFAULT_NIMBUS_EMBEDDING_TOML };
  }
  try {
    const raw = readFileSync(path, "utf8");
    return { ...DEFAULT_NIMBUS_EMBEDDING_TOML, ...parseNimbusTomlEmbeddingSection(raw) };
  } catch {
    return { ...DEFAULT_NIMBUS_EMBEDDING_TOML };
  }
}
