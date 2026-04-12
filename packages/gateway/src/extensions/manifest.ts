import { existsSync } from "node:fs";
import { join } from "node:path";

/** Spec name (Phase 3 §2.1); preferred when both exist. */
export const EXTENSION_MANIFEST_FILENAME = "nimbus.extension.json";

/** Legacy scaffold filename; still accepted for installs and verification. */
export const EXTENSION_MANIFEST_FILENAME_LEGACY = "nimbus-extension.json";

/** Order: canonical spec first, then legacy. */
export const EXTENSION_MANIFEST_FILENAMES = [
  EXTENSION_MANIFEST_FILENAME,
  EXTENSION_MANIFEST_FILENAME_LEGACY,
] as const;

/** First manifest file present under `dir`, or undefined. */
export function resolveExtensionManifestPath(dir: string): string | undefined {
  for (const name of EXTENSION_MANIFEST_FILENAMES) {
    const p = join(dir, name);
    if (existsSync(p)) {
      return p;
    }
  }
  return undefined;
}

export type ExtensionManifest = {
  id: string;
  version: string;
  name?: string;
  /** Relative path to entry file (default dist/index.js). */
  entry?: string;
};

export function parseExtensionManifestJson(text: string): ExtensionManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("extension manifest is not valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("extension manifest must be a JSON object");
  }
  const o = parsed as Record<string, unknown>;
  const id = typeof o["id"] === "string" ? o["id"].trim() : "";
  const version = typeof o["version"] === "string" ? o["version"].trim() : "";
  if (id === "" || version === "") {
    throw new Error("extension manifest requires non-empty id and version");
  }
  const name = typeof o["name"] === "string" ? o["name"].trim() : undefined;
  const entry =
    typeof o["entry"] === "string" ? o["entry"].trim().replaceAll("\\", "/") : undefined;
  return {
    id,
    version,
    ...(name !== undefined && name !== "" ? { name } : {}),
    ...(entry !== undefined && entry !== "" ? { entry } : {}),
  };
}
