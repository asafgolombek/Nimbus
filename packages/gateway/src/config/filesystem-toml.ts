import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type NimbusFilesystemRootToml = {
  path: string;
  gitAware: boolean;
  codeIndex: boolean;
  dependencyGraph: boolean;
  exclude: string[];
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

function expandPath(p: string): string {
  const t = p.trim();
  if (t === "" || t === "~" || t.startsWith("~/")) {
    const rest = t === "~" || t === "~/" ? "" : t.slice(2);
    return resolve(join(homedir(), rest));
  }
  return resolve(t);
}

function defaultRoot(): NimbusFilesystemRootToml {
  return {
    path: "",
    gitAware: true,
    codeIndex: false,
    dependencyGraph: true,
    exclude: ["node_modules", ".git", "dist", "target", "build", ".next"],
  };
}

function parseExcludeList(raw: string): string[] {
  return parseString(raw)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/**
 * Best-effort `[[filesystem.roots]]` tables from `nimbus.toml` (no full TOML parser).
 */
export function parseNimbusTomlFilesystemRoots(source: string): NimbusFilesystemRootToml[] {
  const lines = source.split(/\r?\n/);
  const roots: NimbusFilesystemRootToml[] = [];
  let cur: NimbusFilesystemRootToml | undefined;

  for (const line of lines) {
    const trimmed = stripComment(line).trim();
    if (trimmed === "") {
      continue;
    }
    if (trimmed === "[[filesystem.roots]]") {
      if (cur !== undefined && cur.path.trim() !== "") {
        roots.push({
          ...cur,
          path: expandPath(cur.path),
        });
      }
      cur = defaultRoot();
      continue;
    }
    if (cur === undefined) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    const valRaw = trimmed.slice(eq + 1).trim();
    switch (key) {
      case "path":
        cur.path = parseString(valRaw);
        break;
      case "git_aware": {
        const b = parseBool(valRaw);
        if (b !== undefined) {
          cur.gitAware = b;
        }
        break;
      }
      case "code_index": {
        const b = parseBool(valRaw);
        if (b !== undefined) {
          cur.codeIndex = b;
        }
        break;
      }
      case "dependency_graph": {
        const b = parseBool(valRaw);
        if (b !== undefined) {
          cur.dependencyGraph = b;
        }
        break;
      }
      case "exclude":
        cur.exclude = parseExcludeList(valRaw);
        break;
      default:
        break;
    }
  }
  if (cur !== undefined && cur.path.trim() !== "") {
    roots.push({
      ...cur,
      path: expandPath(cur.path),
    });
  }
  return roots;
}

export function loadNimbusFilesystemRootsFromConfigDir(
  configDir: string,
): NimbusFilesystemRootToml[] {
  const path = join(configDir, "nimbus.toml");
  if (!existsSync(path)) {
    return [];
  }
  try {
    const raw = readFileSync(path, "utf8");
    return parseNimbusTomlFilesystemRoots(raw);
  } catch {
    return [];
  }
}
