import { type PKCEOptions, runPKCEFlow } from "../auth/pkce.ts";
import { Config } from "../config.ts";
import {
  type ConnectorServiceId,
  defaultSyncIntervalMsForService,
  GOOGLE_CONNECTOR_SERVICES,
  MICROSOFT_CONNECTOR_SERVICES,
  normalizeConnectorServiceId,
  oauthProfileForService,
} from "../connectors/connector-catalog.ts";
import { clearOAuthVaultIfProviderUnused } from "../connectors/connector-vault.ts";
import type { LocalIndex } from "../index/local-index.ts";
import { stripTrailingSlashes } from "../string/strip-trailing-slashes.ts";
import type { SyncScheduler } from "../sync/scheduler.ts";
import { listRecentSyncTelemetry } from "../sync/scheduler-store.ts";
import type { SyncStatus } from "../sync/types.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import {
  ConnectorRpcError,
  parseAtlassianSiteCredentials,
  parseServiceArg,
  registerAtlassianApiConnectorAuth,
  requireRegisteredConnector,
  requireServiceId,
  sumItemsSiblingServices,
} from "./connector-rpc-shared.ts";

export type ConnectorRpcHit = { kind: "hit"; value: unknown };

export type ConnectorRpcHandlerContext = {
  rec: Record<string, unknown> | undefined;
  vault: NimbusVault;
  localIndex: LocalIndex;
  openUrl: (url: string) => Promise<void>;
  syncScheduler: SyncScheduler | undefined;
};

export function handleConnectorListStatus(ctx: ConnectorRpcHandlerContext): ConnectorRpcHit {
  const { rec, localIndex } = ctx;
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

export function handleConnectorPause(ctx: ConnectorRpcHandlerContext): ConnectorRpcHit {
  const { rec, localIndex, syncScheduler } = ctx;
  const id = requireServiceId(rec);
  requireRegisteredConnector(localIndex, id);
  if (syncScheduler === undefined) {
    localIndex.pauseConnectorSync(id);
  } else {
    syncScheduler.pause(id);
  }
  return { kind: "hit", value: { ok: true } };
}

export function handleConnectorResume(ctx: ConnectorRpcHandlerContext): ConnectorRpcHit {
  const { rec, localIndex, syncScheduler } = ctx;
  const id = requireServiceId(rec);
  requireRegisteredConnector(localIndex, id);
  if (syncScheduler === undefined) {
    localIndex.resumeConnectorSync(id);
  } else {
    syncScheduler.resume(id);
  }
  return { kind: "hit", value: { ok: true } };
}

export function handleConnectorSetInterval(ctx: ConnectorRpcHandlerContext): ConnectorRpcHit {
  const { rec, localIndex, syncScheduler } = ctx;
  const id = requireServiceId(rec);
  const msRaw = rec?.["intervalMs"];
  if (typeof msRaw !== "number" || !Number.isFinite(msRaw) || msRaw < 1) {
    throw new ConnectorRpcError(-32602, "Invalid intervalMs");
  }
  const ms = Math.floor(msRaw);
  localIndex.setConnectorSyncIntervalMs(id, ms, Date.now());
  if (syncScheduler !== undefined) {
    syncScheduler.setInterval(id, ms);
  }
  return { kind: "hit", value: { ok: true } };
}

export function handleConnectorStatus(ctx: ConnectorRpcHandlerContext): ConnectorRpcHit {
  const { rec, localIndex } = ctx;
  const id = requireServiceId(rec);
  const rows = localIndex.persistedConnectorStatuses(id);
  if (rows.length === 0) {
    throw new ConnectorRpcError(-32602, `Unknown connector: ${id}`);
  }
  const row = rows[0];
  if (row === undefined) {
    throw new ConnectorRpcError(-32602, `Unknown connector: ${id}`);
  }
  const includeStats = rec?.["includeStats"] === true || rec?.["stats"] === true;
  if (includeStats) {
    const telemetry = listRecentSyncTelemetry(localIndex.getDatabase(), id, 15);
    return { kind: "hit", value: { ...row, telemetry } };
  }
  return { kind: "hit", value: row };
}

export async function handleConnectorRemove(
  ctx: ConnectorRpcHandlerContext,
): Promise<ConnectorRpcHit> {
  const { rec, vault, localIndex, syncScheduler } = ctx;
  const id = requireServiceId(rec);
  const db = localIndex.getDatabase();
  let googleOAuthBackup: string | null = null;
  let microsoftOAuthBackup: string | null = null;
  if (
    GOOGLE_CONNECTOR_SERVICES.has(id) &&
    sumItemsSiblingServices(db, id, GOOGLE_CONNECTOR_SERVICES) === 0
  ) {
    googleOAuthBackup = await vault.get("google.oauth");
  }
  if (
    MICROSOFT_CONNECTOR_SERVICES.has(id) &&
    sumItemsSiblingServices(db, id, MICROSOFT_CONNECTOR_SERVICES) === 0
  ) {
    microsoftOAuthBackup = await vault.get("microsoft.oauth");
  }
  if (syncScheduler !== undefined) {
    syncScheduler.unregister(id);
  }
  const itemsDeleted = localIndex.removeConnectorIndexData(id);
  let vaultKeys: string[] = [];
  try {
    vaultKeys = await clearOAuthVaultIfProviderUnused(vault, db, id);
    if (id === "github") {
      await vault.delete("github.pat");
      vaultKeys.push("github.pat");
    }
    if (id === "gitlab") {
      await vault.delete("gitlab.pat");
      await vault.delete("gitlab.api_base");
      vaultKeys.push("gitlab.pat", "gitlab.api_base");
    }
    if (id === "bitbucket") {
      await vault.delete("bitbucket.username");
      await vault.delete("bitbucket.app_password");
      vaultKeys.push("bitbucket.username", "bitbucket.app_password");
    }
    if (id === "slack") {
      await vault.delete("slack.oauth");
      vaultKeys.push("slack.oauth");
    }
    if (id === "linear") {
      await vault.delete("linear.api_key");
      vaultKeys.push("linear.api_key");
    }
    if (id === "jira") {
      await vault.delete("jira.api_token");
      await vault.delete("jira.email");
      await vault.delete("jira.base_url");
      vaultKeys.push("jira.api_token", "jira.email", "jira.base_url");
    }
    if (id === "notion") {
      await vault.delete("notion.oauth");
      vaultKeys.push("notion.oauth");
    }
    if (id === "confluence") {
      await vault.delete("confluence.api_token");
      await vault.delete("confluence.email");
      await vault.delete("confluence.base_url");
      vaultKeys.push("confluence.api_token", "confluence.email", "confluence.base_url");
    }
  } catch (removeErr) {
    if (googleOAuthBackup !== null) {
      await vault.set("google.oauth", googleOAuthBackup);
    }
    if (microsoftOAuthBackup !== null) {
      await vault.set("microsoft.oauth", microsoftOAuthBackup);
    }
    throw removeErr;
  }
  return { kind: "hit", value: { ok: true, itemsDeleted, vaultKeysRemoved: vaultKeys } };
}

export async function handleConnectorSync(
  ctx: ConnectorRpcHandlerContext,
): Promise<ConnectorRpcHit> {
  const { rec, localIndex, syncScheduler } = ctx;
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

function authSuccess(id: ConnectorServiceId): ConnectorRpcHit {
  return {
    kind: "hit",
    value: {
      ok: true,
      serviceId: id,
      scopesGranted: [] as string[],
    },
  };
}

async function connectorAuthGithub(
  rec: Record<string, unknown> | undefined,
  vault: NimbusVault,
  localIndex: LocalIndex,
): Promise<ConnectorRpcHit> {
  const tokenRaw = rec?.["personalAccessToken"] ?? rec?.["token"];
  const token = typeof tokenRaw === "string" && tokenRaw.trim() !== "" ? tokenRaw.trim() : "";
  if (token === "") {
    throw new ConnectorRpcError(-32602, "Missing personalAccessToken for github");
  }
  await vault.set("github.pat", token);
  const interval = defaultSyncIntervalMsForService("github");
  localIndex.ensureConnectorSchedulerRegistration("github", interval, Date.now());
  return authSuccess("github");
}

async function connectorAuthGitlab(
  rec: Record<string, unknown> | undefined,
  vault: NimbusVault,
  localIndex: LocalIndex,
): Promise<ConnectorRpcHit> {
  const tokenRaw = rec?.["personalAccessToken"] ?? rec?.["token"];
  const token = typeof tokenRaw === "string" && tokenRaw.trim() !== "" ? tokenRaw.trim() : "";
  if (token === "") {
    throw new ConnectorRpcError(-32602, "Missing personalAccessToken for gitlab");
  }
  await vault.set("gitlab.pat", token);
  const baseRaw = rec?.["apiBaseUrl"] ?? rec?.["api_base"];
  if (typeof baseRaw === "string" && baseRaw.trim() !== "") {
    await vault.set("gitlab.api_base", stripTrailingSlashes(baseRaw.trim()));
  } else {
    await vault.delete("gitlab.api_base");
  }
  const interval = defaultSyncIntervalMsForService("gitlab");
  localIndex.ensureConnectorSchedulerRegistration("gitlab", interval, Date.now());
  return authSuccess("gitlab");
}

async function connectorAuthLinear(
  rec: Record<string, unknown> | undefined,
  vault: NimbusVault,
  localIndex: LocalIndex,
): Promise<ConnectorRpcHit> {
  const tokenRaw = rec?.["personalAccessToken"] ?? rec?.["token"] ?? rec?.["apiKey"];
  const token = typeof tokenRaw === "string" && tokenRaw.trim() !== "" ? tokenRaw.trim() : "";
  if (token === "") {
    throw new ConnectorRpcError(-32602, "Missing API key for linear");
  }
  await vault.set("linear.api_key", token);
  const interval = defaultSyncIntervalMsForService("linear");
  localIndex.ensureConnectorSchedulerRegistration("linear", interval, Date.now());
  return authSuccess("linear");
}

async function connectorAuthBitbucket(
  rec: Record<string, unknown> | undefined,
  vault: NimbusVault,
  localIndex: LocalIndex,
): Promise<ConnectorRpcHit> {
  const userRaw = rec?.["bitbucketUsername"] ?? rec?.["username"];
  const user = typeof userRaw === "string" && userRaw.trim() !== "" ? userRaw.trim() : "";
  const tokenRaw = rec?.["personalAccessToken"] ?? rec?.["token"];
  const token = typeof tokenRaw === "string" && tokenRaw.trim() !== "" ? tokenRaw.trim() : "";
  if (user === "") {
    throw new ConnectorRpcError(-32602, "Missing username for bitbucket (Atlassian account)");
  }
  if (token === "") {
    throw new ConnectorRpcError(-32602, "Missing app password for bitbucket (use token field)");
  }
  await vault.set("bitbucket.username", user);
  await vault.set("bitbucket.app_password", token);
  const interval = defaultSyncIntervalMsForService("bitbucket");
  localIndex.ensureConnectorSchedulerRegistration("bitbucket", interval, Date.now());
  return authSuccess("bitbucket");
}

function oauthClientConfigForProvider(profile: ReturnType<typeof oauthProfileForService>): {
  clientId: string;
  emptyClientIdMessage: string;
} {
  switch (profile.provider) {
    case "google":
      return {
        clientId: Config.oauthGoogleClientId,
        emptyClientIdMessage:
          "Set NIMBUS_OAUTH_GOOGLE_CLIENT_ID to a registered desktop OAuth client id",
      };
    case "microsoft":
      return {
        clientId: Config.oauthMicrosoftClientId,
        emptyClientIdMessage:
          "Set NIMBUS_OAUTH_MICROSOFT_CLIENT_ID to a registered desktop OAuth client id",
      };
    case "slack":
      return {
        clientId: Config.oauthSlackClientId,
        emptyClientIdMessage:
          "Set NIMBUS_OAUTH_SLACK_CLIENT_ID to a Slack app client id with PKCE enabled",
      };
    case "notion":
      return {
        clientId: Config.oauthNotionClientId,
        emptyClientIdMessage:
          "Set NIMBUS_OAUTH_NOTION_CLIENT_ID to your Notion public integration OAuth client id",
      };
    default: {
      const _ex: never = profile.provider;
      throw new ConnectorRpcError(-32602, `Unsupported OAuth provider: ${_ex}`);
    }
  }
}

async function connectorAuthOAuthPkce(
  id: ConnectorServiceId,
  rec: Record<string, unknown> | undefined,
  vault: NimbusVault,
  localIndex: LocalIndex,
  openUrl: (url: string) => Promise<void>,
): Promise<ConnectorRpcHit> {
  const profile = oauthProfileForService(id);
  const { clientId, emptyClientIdMessage } = oauthClientConfigForProvider(profile);
  if (clientId === "") {
    throw new ConnectorRpcError(-32602, emptyClientIdMessage);
  }
  const notionSecret = profile.provider === "notion" ? Config.oauthNotionClientSecret : undefined;
  if (profile.provider === "notion" && (notionSecret === undefined || notionSecret === "")) {
    throw new ConnectorRpcError(
      -32602,
      "Set NIMBUS_OAUTH_NOTION_CLIENT_SECRET (required for Notion token exchange)",
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
    ...(notionSecret !== undefined && notionSecret !== ""
      ? { oauthClientSecret: notionSecret }
      : {}),
  };
  let pkceFlowInput: PKCEOptions = pkceBase;
  if (redirectPort !== undefined) {
    pkceFlowInput = { ...pkceBase, redirectPort };
  }
  const tokens = await runPKCEFlow(pkceFlowInput);

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

export async function handleConnectorAuth(
  ctx: ConnectorRpcHandlerContext,
): Promise<ConnectorRpcHit> {
  const { rec, vault, localIndex, openUrl } = ctx;
  const id = parseServiceArg(rec);
  if (id === "github") {
    return connectorAuthGithub(rec, vault, localIndex);
  }
  if (id === "gitlab") {
    return connectorAuthGitlab(rec, vault, localIndex);
  }
  if (id === "linear") {
    return connectorAuthLinear(rec, vault, localIndex);
  }
  if (id === "jira") {
    const creds = parseAtlassianSiteCredentials(rec, {
      missingEmail: "Missing Atlassian account email for jira (atlassianEmail)",
      missingToken: "Missing API token for jira",
      missingBase:
        "Missing Jira site base URL for jira (apiBaseUrl), e.g. https://your-domain.atlassian.net",
    });
    const value = await registerAtlassianApiConnectorAuth({
      vault,
      localIndex,
      serviceId: "jira",
      creds,
    });
    return { kind: "hit", value };
  }
  if (id === "confluence") {
    const creds = parseAtlassianSiteCredentials(rec, {
      missingEmail: "Missing Atlassian account email for confluence (atlassianEmail)",
      missingToken: "Missing API token for confluence",
      missingBase:
        "Missing Confluence site base URL (apiBaseUrl), e.g. https://your-domain.atlassian.net",
    });
    const value = await registerAtlassianApiConnectorAuth({
      vault,
      localIndex,
      serviceId: "confluence",
      creds,
    });
    return { kind: "hit", value };
  }
  if (id === "bitbucket") {
    return connectorAuthBitbucket(rec, vault, localIndex);
  }
  return connectorAuthOAuthPkce(id, rec, vault, localIndex, openUrl);
}
