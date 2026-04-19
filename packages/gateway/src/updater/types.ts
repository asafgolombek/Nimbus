export type PlatformTarget = "darwin-x86_64" | "darwin-aarch64" | "linux-x86_64" | "windows-x86_64";

export interface PlatformAsset {
  url: string;
  sha256: string; // lowercase hex, 64 chars
  signature: string; // base64, 64 bytes Ed25519 signature over sha256 digest
}

export interface UpdateManifest {
  version: string; // semver
  pub_date: string; // ISO 8601
  notes?: string;
  platforms: Record<PlatformTarget, PlatformAsset>;
}

export type UpdaterStateName =
  | "idle"
  | "checking"
  | "downloading"
  | "verifying"
  | "applying"
  | "rolled_back"
  | "failed";

export interface UpdaterStatus {
  state: UpdaterStateName;
  currentVersion: string;
  configUrl: string;
  lastCheckAt?: string;
  lastError?: string;
}
