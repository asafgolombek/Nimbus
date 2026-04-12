import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type NimbusSessionToml = {
  memoryTtlHours: number;
};

export const DEFAULT_NIMBUS_SESSION_TOML: NimbusSessionToml = {
  memoryTtlHours: 24,
};

function stripComment(line: string): string {
  const hash = line.indexOf("#");
  if (hash < 0) {
    return line;
  }
  return line.slice(0, hash);
}

function applySessionTomlKey(out: Partial<NimbusSessionToml>, trimmed: string): void {
  const eq = trimmed.indexOf("=");
  if (eq <= 0) {
    return;
  }
  const key = trimmed.slice(0, eq).trim();
  const valRaw = trimmed.slice(eq + 1).trim();
  if (key !== "memory_ttl_hours") {
    return;
  }
  const n = Number.parseInt(valRaw, 10);
  if (Number.isFinite(n) && n > 0 && n <= 24 * 365) {
    out.memoryTtlHours = n;
  }
}

export function parseNimbusTomlSessionSection(source: string): Partial<NimbusSessionToml> {
  const lines = source.split(/\r?\n/);
  let inSession = false;
  const out: Partial<NimbusSessionToml> = {};

  for (const line of lines) {
    const trimmed = stripComment(line).trim();
    if (trimmed === "") {
      continue;
    }
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inSession = trimmed === "[session]";
      continue;
    }
    if (inSession) {
      applySessionTomlKey(out, trimmed);
    }
  }
  return out;
}

export function loadNimbusSessionFromConfigDir(configDir: string): NimbusSessionToml {
  const path = join(configDir, "nimbus.toml");
  if (!existsSync(path)) {
    return { ...DEFAULT_NIMBUS_SESSION_TOML };
  }
  try {
    const raw = readFileSync(path, "utf8");
    return { ...DEFAULT_NIMBUS_SESSION_TOML, ...parseNimbusTomlSessionSection(raw) };
  } catch {
    return { ...DEFAULT_NIMBUS_SESSION_TOML };
  }
}
