import type { PlatformTarget, UpdateManifest } from "./types.ts";

export class ManifestFetchError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ManifestFetchError";
  }
}

const PLATFORM_TARGETS = new Set<string>([
  "darwin-x86_64",
  "darwin-aarch64",
  "linux-x86_64",
  "windows-x86_64",
]);

function validatePlatformAsset(key: string, asset: unknown): void {
  if (typeof asset !== "object" || asset === null) {
    throw new ManifestFetchError(`platforms.${key} must be an object`);
  }
  const a = asset as Record<string, unknown>;
  if (typeof a["url"] !== "string") {
    throw new ManifestFetchError(`platforms.${key}.url must be a string`);
  }
  if (typeof a["sha256"] !== "string") {
    throw new ManifestFetchError(`platforms.${key}.sha256 must be a string`);
  }
  if (typeof a["signature"] !== "string") {
    throw new ManifestFetchError(`platforms.${key}.signature must be a string`);
  }
}

function validateManifest(raw: unknown): UpdateManifest {
  if (typeof raw !== "object" || raw === null) {
    throw new ManifestFetchError("manifest must be an object");
  }
  const m = raw as Record<string, unknown>;
  const version = m["version"];
  if (typeof version !== "string") {
    throw new ManifestFetchError("manifest.version must be a string");
  }
  const pub_date = m["pub_date"];
  if (typeof pub_date !== "string") {
    throw new ManifestFetchError("manifest.pub_date must be a string");
  }
  if (typeof m["platforms"] !== "object" || m["platforms"] === null) {
    throw new ManifestFetchError("manifest.platforms must be an object");
  }
  const platforms = m["platforms"] as Record<string, unknown>;
  for (const target of PLATFORM_TARGETS) {
    if (!(target in platforms)) {
      throw new ManifestFetchError(`manifest.platforms missing required target: ${target}`);
    }
    validatePlatformAsset(target, platforms[target]);
  }
  const manifest: UpdateManifest = {
    version,
    pub_date,
    platforms: platforms as Record<
      PlatformTarget,
      { url: string; sha256: string; signature: string }
    >,
  };
  if (typeof m["notes"] === "string") {
    manifest.notes = m["notes"];
  }
  return manifest;
}

export async function fetchUpdateManifest(
  url: string,
  options: { timeoutMs: number },
): Promise<UpdateManifest> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (err) {
    throw new ManifestFetchError(`fetch failed: ${String(err)}`, err);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new ManifestFetchError(`HTTP ${response.status} from ${url}`);
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch (err) {
    throw new ManifestFetchError(`invalid JSON from ${url}`, err);
  }
  return validateManifest(raw);
}
