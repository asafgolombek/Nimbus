import type { LocalIndex } from "../index/local-index.ts";
import type { IPCServer } from "../ipc/index.ts";
import type { NimbusVault } from "../vault/index.ts";
import type { PlatformPaths } from "./paths.ts";

export interface AutostartManager {
  isEnabled(): Promise<boolean>;
  enable(): Promise<void>;
  disable(): Promise<void>;
}

export interface NotificationService {
  show(title: string, body: string): Promise<void>;
}

export interface PlatformServices {
  vault: NimbusVault;
  ipc: IPCServer;
  paths: PlatformPaths;
  localIndex: LocalIndex;
  autostart: AutostartManager;
  notifications: NotificationService;
  /** Opens a URL in the system default browser (OAuth, help links). */
  openUrl(url: string): Promise<void>;
}
