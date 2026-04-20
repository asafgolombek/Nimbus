import type { LazyConnectorMesh } from "../connectors/lazy-mesh.ts";
import type { LocalIndex } from "../index/local-index.ts";
import type { SyncScheduler } from "../sync/scheduler.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import {
  handleConnectorAddMcp,
  handleConnectorAuth,
  handleConnectorHealthHistory,
  handleConnectorListStatus,
  handleConnectorPause,
  handleConnectorRemove,
  handleConnectorResume,
  handleConnectorSetConfig,
  handleConnectorSetInterval,
  handleConnectorStatus,
  handleConnectorSync,
} from "./connector-rpc-handlers.ts";
import { asRecord } from "./connector-rpc-shared.ts";

export { ConnectorRpcError } from "./connector-rpc-shared.ts";

export async function dispatchConnectorRpc(options: {
  method: string;
  params: unknown;
  vault: NimbusVault;
  localIndex: LocalIndex;
  openUrl: (url: string) => Promise<void>;
  syncScheduler: SyncScheduler | undefined;
  connectorMesh?: LazyConnectorMesh;
  notify?: (method: string, params: Record<string, unknown>) => void;
}): Promise<{ kind: "hit"; value: unknown } | { kind: "miss" }> {
  const { method, params, vault, localIndex, openUrl, syncScheduler, connectorMesh, notify } =
    options;
  const rec = asRecord(params);
  const ctx = {
    rec,
    vault,
    localIndex,
    openUrl,
    syncScheduler,
    connectorMesh,
    ...(notify !== undefined ? { notify } : {}),
  };

  switch (method) {
    case "connector.addMcp":
      return handleConnectorAddMcp(ctx);
    case "connector.listStatus":
      return handleConnectorListStatus(ctx);
    case "connector.pause":
      return handleConnectorPause(ctx);
    case "connector.resume":
      return handleConnectorResume(ctx);
    case "connector.setConfig":
      return handleConnectorSetConfig(ctx);
    case "connector.setInterval":
      return handleConnectorSetInterval(ctx);
    case "connector.status":
      return handleConnectorStatus(ctx);
    case "connector.healthHistory":
      return handleConnectorHealthHistory(ctx);
    case "connector.remove":
      return handleConnectorRemove(ctx);
    case "connector.sync":
      return handleConnectorSync(ctx);
    case "connector.auth":
      return handleConnectorAuth(ctx);
    default:
      return { kind: "miss" };
  }
}
