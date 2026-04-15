import type { ExtensionManifest } from "./types";

export class ExtensionContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtensionContractError";
  }
}

const PERMS = new Set<ExtensionManifest["permissions"][number]>(["read", "write", "delete"]);
const HITL = new Set<ExtensionManifest["hitlRequired"][number]>(["write", "delete"]);

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

/**
 * Validates a {@link ExtensionManifest} for CI / `nimbus test` (no network, no Gateway).
 */
export function runContractTests(manifest: ExtensionManifest): void {
  const errors: string[] = [];
  if (!isNonEmptyString(manifest.id)) {
    errors.push("manifest.id is required");
  }
  if (!isNonEmptyString(manifest.displayName)) {
    errors.push("manifest.displayName is required");
  }
  if (!isNonEmptyString(manifest.version)) {
    errors.push("manifest.version is required");
  }
  if (!isNonEmptyString(manifest.description)) {
    errors.push("manifest.description is required");
  }
  if (!isNonEmptyString(manifest.author)) {
    errors.push("manifest.author is required");
  }
  if (!isNonEmptyString(manifest.entrypoint)) {
    errors.push("manifest.entrypoint is required");
  }
  if (manifest.runtime !== "bun" && manifest.runtime !== "node") {
    errors.push('manifest.runtime must be "bun" or "node"');
  }
  if (!Array.isArray(manifest.permissions) || manifest.permissions.length === 0) {
    errors.push("manifest.permissions must be a non-empty array");
  } else {
    for (const p of manifest.permissions) {
      if (!PERMS.has(p)) {
        errors.push(`invalid manifest.permissions entry: ${String(p)}`);
      }
    }
  }
  if (!Array.isArray(manifest.hitlRequired)) {
    errors.push("manifest.hitlRequired must be an array");
  } else {
    for (const h of manifest.hitlRequired) {
      if (!HITL.has(h)) {
        errors.push(`invalid manifest.hitlRequired entry: ${String(h)}`);
      }
    }
  }
  if (!isNonEmptyString(manifest.minNimbusVersion)) {
    errors.push("manifest.minNimbusVersion is required");
  } else if (!/^\d+\.\d+\.\d+/.test(manifest.minNimbusVersion.trim())) {
    errors.push("manifest.minNimbusVersion must start with semver x.y.z");
  }
  if (errors.length > 0) {
    throw new ExtensionContractError(errors.join("; "));
  }
}
