import { type AuditLogger, createScopedAuditLogger } from "./audit-logger.ts";
import { type HitlRequest, isHitlRequest } from "./hitl-request.ts";
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

function validateRequiredStrings(manifest: ExtensionManifest): string[] {
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
  return errors;
}

function validateRuntime(manifest: ExtensionManifest): string[] {
  if (manifest.runtime === "bun" || manifest.runtime === "node") {
    return [];
  }
  return ['manifest.runtime must be "bun" or "node"'];
}

function validatePermissions(manifest: ExtensionManifest): string[] {
  const errors: string[] = [];
  if (!Array.isArray(manifest.permissions)) {
    errors.push("manifest.permissions must be an array");
    return errors;
  }
  for (const p of manifest.permissions) {
    if (!PERMS.has(p)) {
      errors.push(`invalid manifest.permissions entry: ${String(p)}`);
    }
  }
  return errors;
}

function validateHitlRequired(manifest: ExtensionManifest): string[] {
  const errors: string[] = [];
  if (Array.isArray(manifest.hitlRequired)) {
    for (const h of manifest.hitlRequired) {
      if (!HITL.has(h)) {
        errors.push(`invalid manifest.hitlRequired entry: ${String(h)}`);
      }
    }
  } else {
    errors.push("manifest.hitlRequired must be an array");
  }
  return errors;
}

function validateMinNimbusVersion(manifest: ExtensionManifest): string[] {
  if (!isNonEmptyString(manifest.minNimbusVersion)) {
    return ["manifest.minNimbusVersion is required"];
  }
  if (!/^\d+\.\d+\.\d+/.test(manifest.minNimbusVersion.trim())) {
    return ["manifest.minNimbusVersion must start with semver x.y.z"];
  }
  return [];
}

function assertV1AuditLoggerShape(logger: AuditLogger, extensionId: string): void {
  const ret = logger.log("test.action", {});
  if (typeof (ret as Promise<void>).then !== "function") {
    throw new ExtensionContractError(
      `AuditLogger.log must return a Promise (extension ${extensionId})`,
    );
  }
}

function assertV1HitlRequestGuard(): void {
  const good: HitlRequest = { actionId: "x", summary: "y" };
  if (!isHitlRequest(good)) {
    throw new ExtensionContractError("isHitlRequest must accept a valid HitlRequest");
  }
  if (isHitlRequest({})) {
    throw new ExtensionContractError("isHitlRequest must reject an empty object");
  }
  if (isHitlRequest({ actionId: "", summary: "y" })) {
    throw new ExtensionContractError("isHitlRequest must reject empty actionId");
  }
}

/**
 * Validates a {@link ExtensionManifest} for CI / `nimbus test` (no network, no Gateway).
 */
export function runContractTests(manifest: ExtensionManifest): void {
  const errors: string[] = [
    ...validateRequiredStrings(manifest),
    ...validateRuntime(manifest),
    ...validatePermissions(manifest),
    ...validateHitlRequired(manifest),
    ...validateMinNimbusVersion(manifest),
  ];
  if (errors.length > 0) {
    throw new ExtensionContractError(errors.join("; "));
  }
  assertV1HitlRequestGuard();
  assertV1AuditLoggerShape(
    createScopedAuditLogger(manifest.id, async () => {}),
    manifest.id,
  );
}
