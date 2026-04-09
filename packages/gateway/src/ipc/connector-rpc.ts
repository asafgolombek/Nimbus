import { runPKCEFlow } from "../auth/pkce.ts";
import { Config } from "../config.ts";
import {
  type ConnectorServiceId,
  defaultSyncIntervalMsForService,
  normalizeConnectorServiceId,
  oauthProfileForService,
} from "../connectors/connector-catalog.ts";
import { clearOAuthVaultIfProviderUnused } from "../connectors/connector-vault.ts";
import type { LocalIndex } from "../index/local-index.ts";
import type { SyncScheduler } from "../sync/scheduler.ts";
import type { SyncStatus } from "../sync/types.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";

export class ConnectorRpcError extends Error {
  readonly rpcCode: number;
  constructor(rpcCode: number, message: string) {
    super(message);
    this.rpcCode = rpcCode;
    this.name = "ConnectorRpcError";
  }
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return undefined;
}

function requireServiceId(rec: Record<string, unknown> | undefined): ConnectorServiceId {
  const raw = rec !== undefined && typeof rec["serviceId"] === "string" ? rec["serviceId"] : "";
  const id = normalizeConnectorServiceId(raw);
  if (id === null) {
    throw new ConnectorRpcError(-32602, "Invalid or unknown serviceId");
  }
  return id;
}

function requireRegisteredConnector(localIndex: LocalIndex, id: ConnectorServiceId): void {
  if (localIndex.persistedConnectorStatuses(id).length === 0) {
    throw new ConnectorRpcError(-32602, `Unknown connector: ${id}`);
  }
}

function parseServiceArg(rec: Record<string, unknown> | undefined): ConnectorServiceId {
  const raw =
    rec !== undefined && typeof rec["service"] === "string"
      ? rec["service"]
      : rec !== undefined && typeof rec["serviceId"] === "string"
        ? rec["serviceId"]
        : "";
  const id = normalizeConnectorServiceId(raw);
  if (id === null) {
    throw new ConnectorRpcError(-32602, "Invalid or unknown service");
  }
  return id;
}

export async function dispatchConnectorRpc(options: {
  method: string;
  params: unknown;
  vault: NimbusVault;
  localIndex: LocalIndex;
  openUrl: (url: string) => Promise<void>;
  syncScheduler: SyncScheduler | undefined;
}): Promise<{ kind: "hit"; value: unknown } | { kind: "miss" }> {
  const { method, params, vault, localIndex, openUrl, syncScheduler } = options;
  const rec = asRecord(params);

  switch (method) {
    case "connector.listStatus": {
      const filter =
        rec !== undefined && typeof rec["serviceId"] === "string" ? rec["serviceId"] : undefined;
      let list: SyncStatus[];
      if (filter !== undefined && filter !== "") {
        const sid = normalizeConnectorServiceId(filter);
        if (sid === null) {
          throw new ConnectorRpcError(-32602, "Invalid serviceId filter");
        }
        list = localIndex.persistedConnectorStatuses(sid);
      } else {
        list = localIndex.persistedConnectorStatuses();
      }
      return { kind: "hit", value: list };
    }

    case "connector.pause": {
      const id = requireServiceId(rec);
      requireRegisteredConnector(localIndex, id);
      if (syncScheduler !== undefined) {
        syncScheduler.pause(id);
      } else {
        localIndex.pauseConnectorSync(id);
      }
      return { kind: "hit", value: { ok: true } };
    }

    case "connector.resume": {
      const id = requireServiceId(rec);
      requireRegisteredConnector(localIndex, id);
      if (syncScheduler !== undefined) {
        syncScheduler.resume(id);
      } else {
        localIndex.resumeConnectorSync(id);
      }
      return { kind: "hit", value: { ok: true } };
    }

    case "connector.setInterval": {
      const id = requireServiceId(rec);
      const msRaw = rec?.["intervalMs"];
      if (typeof msRaw !== "number" || !Number.isFinite(msRaw) || msRaw < 1) {
        throw new ConnectorRpcError(-32602, "Invalid intervalMs");
      }
      localIndex.setConnectorSyncIntervalMs(id, Math.floor(msRaw), Date.now());
      if (syncScheduler !== undefined) {
        syncScheduler.setInterval(id, Math.floor(msRaw));
      }
      return { kind: "hit", value: { ok: true } };
    }

    case "connector.status": {
      const id = requireServiceId(rec);
      const rows = localIndex.persistedConnectorStatuses(id);
      if (rows.length === 0) {
        throw new ConnectorRpcError(-32602, `Unknown connector: ${id}`);
      }
      return { kind: "hit", value: rows[0] };
    }

    case "connector.remove": {
      const id = requireServiceId(rec);
      const itemsDeleted = localIndex.removeConnectorIndexData(id);
      const vaultKeys = await clearOAuthVaultIfProviderUnused(vault, localIndex.getDatabase(), id);
      return { kind: "hit", value: { ok: true, itemsDeleted, vaultKeysRemoved: vaultKeys } };
    }

    case "connector.sync": {
      const id = requireServiceId(rec);
      requireRegisteredConnector(localIndex, id);
      if (rec?.["full"] === true) {
        localIndex.clearConnectorSyncCursor(id);
      }
      if (syncScheduler === undefined) {
        throw new ConnectorRpcError(-32603, "Sync scheduler is not available");
      }
      await syncScheduler.forceSync(id);
      return { kind: "hit", value: { ok: true } };
    }

    case "connector.auth": {
      const id = parseServiceArg(rec);
      const profile = oauthProfileForService(id);
      const clientId =
        profile.provider === "google" ? Config.oauthGoogleClientId : Config.oauthMicrosoftClientId;
      if (clientId === "") {
        throw new ConnectorRpcError(
          -32602,
          profile.provider === "google"
            ? "Set NIMBUS_OAUTH_GOOGLE_CLIENT_ID to a registered desktop OAuth client id"
            : "Set NIMBUS_OAUTH_MICROSOFT_CLIENT_ID to a registered desktop OAuth client id",
        );
      }
      let scopes = profile.defaultScopes;
      const scopeParam = rec?.["scopes"];
      if (Array.isArray(scopeParam)) {
        const next: string[] = [];
        for (const s of scopeParam) {
          if (typeof s === "string" && s.trim() !== "") {
            next.push(s.trim());
          }
        }
        if (next.length > 0) {
          scopes = next;
        }
      }
      const portRaw = rec?.["port"];
      const redirectPort =
        typeof portRaw === "number" && Number.isInteger(portRaw) && portRaw > 0 && portRaw <= 65_535
          ? portRaw
          : undefined;

      const pkceBase = {
        clientId,
        scopes,
        provider: profile.provider,
        vault,
        openUrl,
      };
      const tokens = await runPKCEFlow(
        redirectPort !== undefined ? { ...pkceBase, redirectPort } : pkceBase,
      );

      const interval = defaultSyncIntervalMsForService(id);
      localIndex.ensureConnectorSchedulerRegistration(id, interval, Date.now());

      return {
        kind: "hit",
        value: {
          ok: true,
          serviceId: id,
          scopesGranted: tokens.scopes,
        },
      };
    }

    default:
      return { kind: "miss" };
  }
}
