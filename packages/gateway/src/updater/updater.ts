import { sha256HexEqualConstantTime } from "../util/hex-compare.ts";
import { fetchUpdateManifest, isPermittedSchemeForUpdater } from "./manifest-fetcher.ts";
import { sha256Hex, verifyBinarySignature, verifyManifestEnvelope } from "./signature-verifier.ts";
import type { PlatformTarget, UpdateManifest, UpdaterStatus } from "./types.ts";

/**
 * S6-F9 — strip URL userinfo (user:pass@) from a message string before it
 * lands in `lastError` or in any externally-visible field. The scheme pattern
 * permits compound schemes (`git+https://`, `chrome-extension://`) and the
 * authority pattern stops at the first `/` so paths containing `@` (mailto-
 * like, query strings) are bounded.
 */
export function redactUrlUserinfo(message: string): string {
  return message.replace(/[a-zA-Z0-9+\-.]+:\/\/[^\s/]+@[^\s/]+/g, (urlMatch) => {
    try {
      const u = new URL(urlMatch);
      u.username = "";
      u.password = "";
      return u.toString();
    } catch {
      return "[REDACTED-URL]";
    }
  });
}

/** S6-F3 — manifest-controlled OOM defence. 500 MiB is well above any realistic Nimbus binary. */
export const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024;

export type UpdaterEmit = (
  name:
    | "updater.updateAvailable"
    | "updater.downloadProgress"
    | "updater.restarting"
    | "updater.rolledBack"
    | "updater.verifyFailed",
  payload?: Record<string, unknown>,
) => void;

export type UpdateEventPhase =
  | "system.update.start"
  | "system.update.verified"
  | "system.update.installed"
  | "system.update.failed";

export interface UpdaterOptions {
  currentVersion: string;
  manifestUrl: string;
  publicKey: Uint8Array;
  target: PlatformTarget;
  emit: UpdaterEmit;
  timeoutMs: number;
  invokeInstaller?: (binaryPath: string) => Promise<void>;
  /** S6-F7 — opt-in callback for audit_log row recording. */
  recordUpdateEvent?: (phase: UpdateEventPhase, payload: Record<string, unknown>) => void;
  /** S6-F3 — override download size cap (defaults to MAX_DOWNLOAD_BYTES). Tests use a small value. */
  maxDownloadBytes?: number;
}

export interface CheckNowResult {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  notes?: string;
}

export class Updater {
  private state: UpdaterStatus["state"] = "idle";
  private lastManifest?: UpdateManifest;
  private lastError?: string;
  private lastCheckAt?: string;

  constructor(private readonly opts: UpdaterOptions) {}

  async checkNow(): Promise<CheckNowResult> {
    this.state = "checking";
    try {
      const manifest = await fetchUpdateManifest(this.opts.manifestUrl, {
        timeoutMs: this.opts.timeoutMs,
      });
      this.lastManifest = manifest;
      this.lastCheckAt = new Date().toISOString();
      const updateAvailable = semverGreater(manifest.version, this.opts.currentVersion);
      if (updateAvailable) {
        const payload: Record<string, unknown> = { version: manifest.version };
        if (manifest.notes !== undefined) {
          payload["notes"] = manifest.notes;
        }
        this.opts.emit("updater.updateAvailable", payload);
      }
      this.state = "idle";
      const result: CheckNowResult = {
        currentVersion: this.opts.currentVersion,
        latestVersion: manifest.version,
        updateAvailable,
      };
      if (manifest.notes !== undefined) {
        result.notes = manifest.notes;
      }
      return result;
    } catch (err) {
      this.state = "failed";
      // S6-F9 — never echo URL userinfo into `lastError`. The fetch error chain
      // sometimes embeds the request URL verbatim, which can include
      // user:pass@ if a misconfigured manifestUrl carries credentials.
      this.lastError = redactUrlUserinfo(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  async applyUpdate(): Promise<void> {
    if (!this.lastManifest) {
      throw new Error("no manifest loaded — call checkNow() first");
    }
    if (!semverGreater(this.lastManifest.version, this.opts.currentVersion)) {
      throw new Error(
        `Manifest version ${this.lastManifest.version} is not newer than ` +
          `current version ${this.opts.currentVersion}; aborting download`,
      );
    }
    const asset = this.lastManifest.platforms[this.opts.target];
    if (!asset) {
      throw new Error(`no asset for target ${this.opts.target}`);
    }

    // S6-F7 — pre-flight audit row.
    this.opts.recordUpdateEvent?.("system.update.start", {
      fromVersion: this.opts.currentVersion,
      toVersion: this.lastManifest.version,
      manifestUrl: this.opts.manifestUrl,
      sha256: asset.sha256,
      target: this.opts.target,
    });

    this.state = "downloading";
    let bytes: Uint8Array;
    try {
      bytes = await this.downloadAsset(asset.url);
    } catch (err) {
      this.state = "failed";
      this.lastError = err instanceof Error ? err.message : String(err);
      this.opts.emit("updater.rolledBack", { reason: "download_failed" });
      this.opts.recordUpdateEvent?.("system.update.failed", {
        toVersion: this.lastManifest.version,
        reason: "download_failed",
      });
      throw err;
    }

    this.state = "verifying";
    const computedSha = sha256Hex(bytes);
    // S6-F10 — constant-time compare. Prevents partial-prefix timing
    // information leaking across many upload attempts during an active
    // attack on the manifest endpoint.
    if (!sha256HexEqualConstantTime(computedSha, asset.sha256)) {
      this.state = "rolled_back";
      this.opts.emit("updater.verifyFailed", { reason: "hash_mismatch" });
      this.opts.emit("updater.rolledBack", { reason: "hash_mismatch" });
      this.opts.recordUpdateEvent?.("system.update.failed", {
        toVersion: this.lastManifest.version,
        reason: "hash_mismatch",
      });
      throw new Error(`binary hash mismatch: expected ${asset.sha256}, got ${computedSha}`);
    }
    const sigBytes = new Uint8Array(Buffer.from(asset.signature, "base64"));
    // S6-F6 — primary defence is the envelope. Fall back to bare-SHA verification
    // only during the migration window of one release; the verifier still
    // emits an audit event noting which mode succeeded.
    const envelopeOk = verifyManifestEnvelope({
      version: this.lastManifest.version,
      target: this.opts.target,
      sha256: asset.sha256,
      signature: sigBytes,
      publicKey: this.opts.publicKey,
    });
    if (envelopeOk) {
      this.opts.recordUpdateEvent?.("system.update.verified", {
        toVersion: this.lastManifest.version,
        envelope: true,
      });
    } else {
      const bareOk = verifyBinarySignature(bytes, sigBytes, this.opts.publicKey);
      if (!bareOk) {
        this.state = "rolled_back";
        this.opts.emit("updater.verifyFailed", { reason: "signature_invalid" });
        this.opts.emit("updater.rolledBack", { reason: "signature_invalid" });
        this.opts.recordUpdateEvent?.("system.update.failed", {
          toVersion: this.lastManifest.version,
          reason: "signature_invalid",
        });
        throw new Error("Ed25519 signature verification failed");
      }
      this.opts.recordUpdateEvent?.("system.update.verified", {
        toVersion: this.lastManifest.version,
        envelope: false,
      });
    }

    this.state = "applying";
    // S6-F8 — write the installer to a fresh temp dir, run the installer,
    // and ALWAYS clean up the temp dir in finally — success and failure
    // alike. Without the cleanup the verified binary lingers on disk
    // between updates, accumulating one mode-0o600 file per update under
    // /tmp until the OS sweeps it.
    const { dir, path: binaryPath } = await writeToTempFile(bytes);
    try {
      if (this.opts.invokeInstaller) {
        await this.opts.invokeInstaller(binaryPath);
      }
      this.opts.recordUpdateEvent?.("system.update.installed", {
        fromVersion: this.opts.currentVersion,
        toVersion: this.lastManifest.version,
      });
      this.opts.emit("updater.restarting", {
        fromVersion: this.opts.currentVersion,
        toVersion: this.lastManifest.version,
      });
      this.state = "idle";
    } catch (err) {
      this.state = "failed";
      this.lastError = redactUrlUserinfo(err instanceof Error ? err.message : String(err));
      this.opts.emit("updater.rolledBack", { reason: "installer_failed" });
      this.opts.recordUpdateEvent?.("system.update.failed", {
        toVersion: this.lastManifest.version,
        reason: "installer_failed",
      });
      throw err;
    } finally {
      try {
        const { rmSync } = await import("node:fs");
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
  }

  private async downloadAsset(url: string): Promise<Uint8Array> {
    if (!isPermittedSchemeForUpdater(url)) {
      let scheme: string;
      try {
        scheme = new URL(url).protocol;
      } catch {
        scheme = url;
      }
      throw new Error(`asset URL must be https:// (got ${scheme})`);
    }
    const cap = this.opts.maxDownloadBytes ?? MAX_DOWNLOAD_BYTES;
    const resp = await fetch(url, { redirect: "follow" });
    if (!resp.ok) throw new Error(`download HTTP ${resp.status}`);
    const declaredTotal = Number(resp.headers.get("content-length") ?? 0);
    if (declaredTotal > cap) {
      throw new Error(`Content-Length ${declaredTotal} exceeds download size cap of ${cap} bytes`);
    }
    const reader = resp.body?.getReader();
    if (reader === undefined) throw new Error("No response body from download");
    const chunks: Uint8Array[] = [];
    let downloaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined) {
        downloaded += value.byteLength;
        if (downloaded > cap) {
          await reader.cancel();
          throw new Error(`Download body exceeds size cap of ${cap} bytes (read ${downloaded})`);
        }
        chunks.push(value);
        this.opts.emit("updater.downloadProgress", { bytes: downloaded, total: declaredTotal });
      }
    }
    const bytes = new Uint8Array(downloaded);
    let off = 0;
    for (const c of chunks) {
      bytes.set(c, off);
      off += c.byteLength;
    }
    return bytes;
  }

  getStatus(): UpdaterStatus {
    const status: UpdaterStatus = {
      state: this.state,
      currentVersion: this.opts.currentVersion,
      configUrl: this.opts.manifestUrl,
    };
    if (this.lastCheckAt !== undefined) {
      status.lastCheckAt = this.lastCheckAt;
    }
    if (this.lastError !== undefined) {
      status.lastError = this.lastError;
    }
    return status;
  }
}

function semverGreater(a: string, b: string): boolean {
  const pa = a.split(".").map((s) => Number.parseInt(s, 10));
  const pb = b.split(".").map((s) => Number.parseInt(s, 10));
  for (let i = 0; i < 3; i++) {
    const ai = pa[i] ?? 0;
    const bi = pb[i] ?? 0;
    if (ai > bi) return true;
    if (ai < bi) return false;
  }
  return false;
}

async function writeToTempFile(bytes: Uint8Array): Promise<{ dir: string; path: string }> {
  const { chmodSync, mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "nimbus-update-"));
  const path = join(dir, "installer.bin");
  // S6-F8 — explicit 0o600 so the installer binary is never readable by
  // other users on a shared machine. Bytes are SHA-256 and Ed25519 verified
  // by the caller before reaching here. // lgtm[js/path-injection,js/unsafe-deserialization]
  writeFileSync(path, bytes, { mode: 0o600 }); // lgtm[js/network-data-written-to-file]
  try {
    chmodSync(path, 0o600);
  } catch {
    /* belt-and-suspenders for filesystems that ignore the create-mode */
  }
  return { dir, path };
}

export { ManifestFetchError } from "./manifest-fetcher.ts";
