import type { LazyConnectorMesh } from "../../connectors/lazy-mesh/index.ts";
import type { LocalIndex } from "../../index/local-index.ts";
import type { SyncScheduler } from "../../sync/scheduler.ts";
import type { NimbusVault } from "../../vault/nimbus-vault.ts";

export type ConnectorRpcHit = { kind: "hit"; value: unknown };

export type ConnectorRpcHandlerContext = {
  rec: Record<string, unknown> | undefined;
  vault: NimbusVault;
  localIndex: LocalIndex;
  openUrl: (url: string) => Promise<void>;
  syncScheduler: SyncScheduler | undefined;
  connectorMesh: LazyConnectorMesh | undefined;
  notify?: (method: string, params: Record<string, unknown>) => void;
};
