import { fetchUpdateManifest } from "./manifest-fetcher.ts";
import { sha256Hex, verifyBinarySignature } from "./signature-verifier.ts";
import type { PlatformTarget, UpdateManifest, UpdaterStatus } from "./types.ts";

export type UpdaterEmit = (
  name:
    | "updater.updateAvailable"
    | "updater.downloadProgress"
    | "updater.restarting"
    | "updater.rolledBack"
    | "updater.verifyFailed",
  payload?: Record<string, unknown>,
) => void;

export interface UpdaterOptions {
  currentVersion: string;
  manifestUrl: string;
  publicKey: Uint8Array;
  target: PlatformTarget;
  emit: UpdaterEmit;
  timeoutMs: number;
  invokeInstaller?: (binaryPath: string) => Promise<void>;
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
      this.lastError = err instanceof Error ? err.message : String(err);
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

    this.state = "downloading";
    let bytes: Uint8Array;
    try {
      bytes = await this.downloadAsset(asset.url);
    } catch (err) {
      this.state = "failed";
      this.lastError = err instanceof Error ? err.message : String(err);
      this.opts.emit("updater.rolledBack", { reason: "download_failed" });
      throw err;
    }

    this.state = "verifying";
    const computedSha = sha256Hex(bytes);
    if (computedSha !== asset.sha256) {
      this.state = "rolled_back";
      this.opts.emit("updater.verifyFailed", { reason: "hash_mismatch" });
      this.opts.emit("updater.rolledBack", { reason: "hash_mismatch" });
      throw new Error(`binary hash mismatch: expected ${asset.sha256}, got ${computedSha}`);
    }
    const sigBytes = new Uint8Array(Buffer.from(asset.signature, "base64"));
    if (!verifyBinarySignature(bytes, sigBytes, this.opts.publicKey)) {
      this.state = "rolled_back";
      this.opts.emit("updater.verifyFailed", { reason: "signature_invalid" });
      this.opts.emit("updater.rolledBack", { reason: "signature_invalid" });
      throw new Error("Ed25519 signature verification failed");
    }

    this.state = "applying";
    const binaryPath = await writeToTempFile(bytes);
    try {
      if (this.opts.invokeInstaller) {
        await this.opts.invokeInstaller(binaryPath);
      }
      this.opts.emit("updater.restarting", {
        fromVersion: this.opts.currentVersion,
        toVersion: this.lastManifest.version,
      });
      this.state = "idle";
    } catch (err) {
      this.state = "failed";
      this.lastError = err instanceof Error ? err.message : String(err);
      this.opts.emit("updater.rolledBack", { reason: "installer_failed" });
      throw err;
    }
  }

  private async downloadAsset(url: string): Promise<Uint8Array> {
    const resp = await fetch(url, { redirect: "follow" });
    if (!resp.ok) throw new Error(`download HTTP ${resp.status}`);
    const total = Number(resp.headers.get("content-length") ?? 0);
    const reader = resp.body?.getReader();
    if (reader === undefined) throw new Error("No response body from download");
    const chunks: Uint8Array[] = [];
    let downloaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined) {
        chunks.push(value);
        downloaded += value.byteLength;
        this.opts.emit("updater.downloadProgress", { bytes: downloaded, total });
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

async function writeToTempFile(bytes: Uint8Array): Promise<string> {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "nimbus-update-"));
  const path = join(dir, "installer.bin");
  // Bytes are SHA-256 and Ed25519 verified by the caller before reaching here. // lgtm[js/path-injection,js/unsafe-deserialization]
  writeFileSync(path, bytes); // lgtm[js/network-data-written-to-file]
  return path;
}

export { ManifestFetchError } from "./manifest-fetcher.ts";
