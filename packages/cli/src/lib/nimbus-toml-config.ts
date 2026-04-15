import { existsSync, readFileSync, writeFileSync } from "node:fs";

export type TomlKeySource = "file" | "env";

export type TomlKeyEntry = {
  readonly key: string;
  readonly value: string;
  readonly source: TomlKeySource;
  readonly envVar?: string;
};

/** Known env overrides for `nimbus config list` (Phase 3.5). */
const ENV_BY_DOTTED: Readonly<Record<string, string>> = {
  "telemetry.enabled": "NIMBUS_TELEMETRY_ENABLED",
  "telemetry.endpoint": "NIMBUS_TELEMETRY_ENDPOINT",
  "telemetry.flush_interval_seconds": "NIMBUS_TELEMETRY_FLUSH_SECONDS",
};

function stripComment(line: string): string {
  const hash = line.indexOf("#");
  if (hash < 0) {
    return line;
  }
  return line.slice(0, hash);
}

function parseSectionKey(source: string, section: string, key: string): string | undefined {
  const lines = source.split(/\r?\n/);
  let inSection = false;
  for (const line of lines) {
    const trimmed = stripComment(line).trim();
    if (trimmed === "") {
      continue;
    }
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inSection = trimmed === `[${section}]`;
      continue;
    }
    if (!inSection) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const k = trimmed.slice(0, eq).trim();
    if (k !== key) {
      continue;
    }
    return trimmed.slice(eq + 1).trim();
  }
  return undefined;
}

export function getTomlValueFromFile(tomlPath: string, dotted: string): string | undefined {
  if (!existsSync(tomlPath)) {
    return undefined;
  }
  const raw = readFileSync(tomlPath, "utf8");
  const dot = dotted.indexOf(".");
  if (dot <= 0) {
    return undefined;
  }
  const section = dotted.slice(0, dot);
  const key = dotted.slice(dot + 1);
  return parseSectionKey(raw, section, key);
}

export function setTomlValueInFile(tomlPath: string, dotted: string, value: string): void {
  const dot = dotted.indexOf(".");
  if (dot <= 0) {
    throw new Error(`Invalid key (expected section.name): ${dotted}`);
  }
  const section = dotted.slice(0, dot);
  const key = dotted.slice(dot + 1);
  const full = existsSync(tomlPath) ? readFileSync(tomlPath, "utf8") : "";
  const lines = full.split(/\r?\n/);
  const header = `[${section}]`;
  let sectionStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = stripComment(lines[i] ?? "").trim();
    if (t === header) {
      sectionStart = i;
      break;
    }
  }
  if (sectionStart < 0) {
    const sep = full.trim() === "" ? "" : "\n\n";
    writeFileSync(
      tomlPath,
      `${full.replace(/\s+$/, "")}${sep}${header}\n${key} = ${formatTomlValue(value)}\n`,
      "utf8",
    );
    return;
  }
  let sectionEnd = lines.length;
  for (let j = sectionStart + 1; j < lines.length; j++) {
    const t = stripComment(lines[j] ?? "").trim();
    if (t.startsWith("[") && t.endsWith("]") && t !== header) {
      sectionEnd = j;
      break;
    }
  }
  const newLines = [...lines];
  let replaced = false;
  for (let j = sectionStart + 1; j < sectionEnd; j++) {
    const rawLine = lines[j] ?? "";
    const t = stripComment(rawLine).trim();
    const eq = t.indexOf("=");
    if (eq > 0 && t.slice(0, eq).trim() === key) {
      newLines[j] = `${key} = ${formatTomlValue(value)}`;
      replaced = true;
      break;
    }
  }
  if (!replaced) {
    newLines.splice(sectionEnd, 0, `${key} = ${formatTomlValue(value)}`);
  }
  writeFileSync(tomlPath, `${newLines.join("\n").replace(/\n+$/, "")}\n`, "utf8");
}

function formatTomlValue(value: string): string {
  const t = value.trim();
  if (t === "true" || t === "false") {
    return t;
  }
  if (/^-?\d+$/.test(t)) {
    return t;
  }
  const esc = t.replaceAll("\\", String.raw`\\`).replaceAll('"', String.raw`\"`);
  return `"${esc}"`;
}

export function listTomlKeysWithEnv(tomlPath: string): TomlKeyEntry[] {
  const out: TomlKeyEntry[] = [];
  for (const [dotted, envVar] of Object.entries(ENV_BY_DOTTED)) {
    const fromEnv = process.env[envVar]?.trim();
    if (fromEnv !== undefined && fromEnv !== "") {
      out.push({ key: dotted, value: fromEnv, source: "env", envVar });
      continue;
    }
    const fromFile = getTomlValueFromFile(tomlPath, dotted);
    if (fromFile !== undefined) {
      out.push({ key: dotted, value: fromFile, source: "file" });
    }
  }
  return out;
}
