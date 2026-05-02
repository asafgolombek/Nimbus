import type { MCPClient } from "@mastra/mcp";

import type { NimbusVault } from "../../vault/nimbus-vault.ts";
import type { LazyDrainTracker } from "./drain.ts";
import type { MeshLogger } from "./tool-map.ts";

export type LazyMcpSlot = {
  client: MCPClient | undefined;
  idleTimer: ReturnType<typeof setTimeout> | undefined;
  /** S8-F7 — per-slot in-flight refcount. */
  drain: LazyDrainTracker;
};

export type ServerSpec = {
  command: string;
  args: string[];
  env: Record<string, string>;
};

/**
 * Internal collaborator interface — wraps the slot state-machine on
 * `LazyConnectorMesh` so per-connector spawn functions can live in sibling
 * files without `this.` access. Not exported from `index.ts`.
 *
 * `logger` and `healthDb` are optional and used only by `recordArgsJsonFailure`
 * in `user-mcp.ts`.
 */
export interface MeshSpawnContext {
  readonly vault: NimbusVault;
  readonly logger?: MeshLogger | undefined;
  readonly healthDb?: import("bun:sqlite").Database | undefined;
  clearLazyIdle(key: string): void;
  getLazyClient(key: string): MCPClient | undefined;
  setLazyClient(key: string, client: MCPClient): void;
  bumpToolsEpoch(): void;
  scheduleLazyDisconnect(key: string): void;
}
