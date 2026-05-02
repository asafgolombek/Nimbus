import type { LazyConnectorMesh } from "../connectors/lazy-mesh/index.ts";
import type { LocalIndex } from "../index/local-index.ts";
import type { IPCServer } from "../ipc/index.ts";
import type { SessionMemoryStore } from "../memory/session-memory-store.ts";
import type { SyncScheduler } from "../sync/scheduler.ts";
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
  /** Lazy MCP mesh (filesystem + optional Google Drive). */
  connectorMesh: LazyConnectorMesh;
  /** Delta sync scheduler (Q2); started in platform assembly. */
  syncScheduler: SyncScheduler;
  autostart: AutostartManager;
  notifications: NotificationService;
  /** Opens a URL in the system default browser (OAuth, help links). */
  openUrl(url: string): Promise<void>;
  /** RAG session memory (schema v10+); undefined when embeddings unavailable. */
  sessionMemoryStore?: SessionMemoryStore;
  /** Optional HTTP / metrics sidecars; stopped before IPC on gateway shutdown. */
  disposeSidecars?: () => void;
}
