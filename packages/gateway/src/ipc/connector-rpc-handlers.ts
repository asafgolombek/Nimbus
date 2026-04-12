import {
  GOOGLE_OAUTH_CLIENT_ID_HELP,
  MICROSOFT_OAUTH_CLIENT_ID_HELP,
  NOTION_OAUTH_CLIENT_ID_HELP,
  NOTION_OAUTH_CLIENT_SECRET_HELP,
  SLACK_OAUTH_CLIENT_ID_HELP,
} from "../auth/oauth-env-help-messages.ts";
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
import type { LazyConnectorMesh } from "../connectors/lazy-mesh.ts";
import {
  deleteUserMcpConnector,
  insertUserMcpConnector,
  normalizeUserMcpServiceId,
  parseUserMcpCommandLine,
  validateUserMcpArgsJson,
} from "../connectors/user-mcp-store.ts";
import { createUserMcpSyncable } from "../connectors/user-mcp-sync.ts";
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
  requireRegisteredSchedulerServiceId,
  resolveConnectorListFilterServiceId,
  sumItemsSiblingServices,
} from "./connector-rpc-shared.ts";

/** PATs / API keys cleared when removing a connector (OAuth keys use {@link clearOAuthVaultIfProviderUnused}). */
async function deleteConnectorPatAndTokenKeys(
  vault: NimbusVault,
  id: ConnectorServiceId,
): Promise<string[]> {
  switch (id) {
    case "github":
      await vault.delete("github.pat");
      return ["github.pat"];
    case "gitlab":
      await vault.delete("gitlab.pat");
      await vault.delete("gitlab.api_base");
      return ["gitlab.pat", "gitlab.api_base"];
    case "bitbucket":
      await vault.delete("bitbucket.username");
      await vault.delete("bitbucket.app_password");
      return ["bitbucket.username", "bitbucket.app_password"];
    case "slack":
      await vault.delete("slack.oauth");
      return ["slack.oauth"];
    case "linear":
      await vault.delete("linear.api_key");
      return ["linear.api_key"];
    case "jira":
      await vault.delete("jira.api_token");
      await vault.delete("jira.email");
      await vault.delete("jira.base_url");
      return ["jira.api_token", "jira.email", "jira.base_url"];
    case "notion":
      await vault.delete("notion.oauth");
      return ["notion.oauth"];
    case "confluence":
      await vault.delete("confluence.api_token");
      await vault.delete("confluence.email");
      await vault.delete("confluence.base_url");
      return ["confluence.api_token", "confluence.email", "confluence.base_url"];
    case "discord":
      await vault.delete("discord.bot_token");
      await vault.delete("discord.enabled");
      return ["discord.bot_token", "discord.enabled"];
    case "jenkins":
      await vault.delete("jenkins.base_url");
      await vault.delete("jenkins.username");
      await vault.delete("jenkins.api_token");
      return ["jenkins.base_url", "jenkins.username", "jenkins.api_token"];
    default:
      return [];
  }
}

function oauthScopesFromConnectorRequest(
  rec: Record<string, unknown> | undefined,
  defaultScopes: readonly string[],
): string[] {
  const scopeParam = rec?.["scopes"];
  if (!Array.isArray(scopeParam)) {
    return [...defaultScopes];
  }
  const next: string[] = [];
  for (const s of scopeParam) {
    if (typeof s === "string" && s.trim() !== "") {
      next.push(s.trim());
    }
  }
  return next.length > 0 ? next : [...defaultScopes];
}

function oauthRedirectPortFromRec(rec: Record<string, unknown> | undefined): number | undefined {
  const portRaw = rec?.["port"];
  if (
    typeof portRaw === "number" &&
    Number.isInteger(portRaw) &&
    portRaw > 0 &&
    portRaw <= 65_535
  ) {
    return portRaw;
  }
  return undefined;
}

export type ConnectorRpcHit = { kind: "hit"; value: unknown };

export type ConnectorRpcHandlerContext = {
  rec: Record<string, unknown> | undefined;
  vault: NimbusVault;
  localIndex: LocalIndex;
  openUrl: (url: string) => Promise<void>;
  syncScheduler: SyncScheduler | undefined;
  connectorMesh: LazyConnectorMesh | undefined;
};

export async function handleConnectorAddMcp(
  ctx: ConnectorRpcHandlerContext,
): Promise<ConnectorRpcHit> {
  const { rec, localIndex, syncScheduler, connectorMesh } = ctx;
  if (syncScheduler === undefined || connectorMesh === undefined) {
    throw new ConnectorRpcError(-32603, "User MCP registration requires sync and connector mesh");
  }
  const serviceRaw = rec?.["serviceId"];
  const cmdRaw = rec?.["commandLine"];
  if (typeof serviceRaw !== "string" || typeof cmdRaw !== "string") {
    throw new ConnectorRpcError(-32602, "Missing serviceId or commandLine");
  }
  const serviceId = normalizeUserMcpServiceId(serviceRaw);
  if (serviceId === null) {
    throw new ConnectorRpcError(
      -32602,
      "serviceId must match mcp_<lowercase_letters_numbers_underscores> (1–62 chars after prefix)",
    );
  }
  if (normalizeConnectorServiceId(serviceId) !== null) {
    throw new ConnectorRpcError(-32602, "serviceId conflicts with a built-in connector id");
  }
  const { command, args } = parseUserMcpCommandLine(cmdRaw);
  const argsJson = validateUserMcpArgsJson(args);
  const db = localIndex.getDatabase();
  try {
    insertUserMcpConnector(db, { service_id: serviceId, command, args_json: argsJson });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE") || msg.includes("unique")) {
      throw new ConnectorRpcError(-32602, `User MCP connector already exists: ${serviceId}`);
    }
    throw new ConnectorRpcError(-32603, `Failed to save user MCP connector: ${msg}`);
  }
  syncScheduler.register(
    createUserMcpSyncable(serviceId, () => connectorMesh.ensureUserMcpRunning(serviceId)),
  );
  return { kind: "hit", value: { ok: true, serviceId } };
}

export function handleConnectorListStatus(ctx: ConnectorRpcHandlerContext): ConnectorRpcHit {
  const { rec, localIndex } = ctx;
  const filter =
    rec !== undefined && typeof rec["serviceId"] === "string" ? rec["serviceId"] : undefined;
  let list: SyncStatus[];
  if (filter !== undefined && filter !== "") {
    const sid = resolveConnectorListFilterServiceId(filter);
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
  const id = requireRegisteredSchedulerServiceId(rec, localIndex);
  if (syncScheduler === undefined) {
    localIndex.pauseConnectorSync(id);
  } else {
    syncScheduler.pause(id);
  }
  return { kind: "hit", value: { ok: true } };
}

export function handleConnectorResume(ctx: ConnectorRpcHandlerContext): ConnectorRpcHit {
  const { rec, localIndex, syncScheduler } = ctx;
  const id = requireRegisteredSchedulerServiceId(rec, localIndex);
  if (syncScheduler === undefined) {
    localIndex.resumeConnectorSync(id);
  } else {
    syncScheduler.resume(id);
  }
  return { kind: "hit", value: { ok: true } };
}

export function handleConnectorSetInterval(ctx: ConnectorRpcHandlerContext): ConnectorRpcHit {
  const { rec, localIndex, syncScheduler } = ctx;
  const id = requireRegisteredSchedulerServiceId(rec, localIndex);
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
  const id = requireRegisteredSchedulerServiceId(rec, localIndex);
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
  const id = requireRegisteredSchedulerServiceId(rec, localIndex);
  const db = localIndex.getDatabase();
  let googleOAuthBackup: string | null = null;
  let microsoftOAuthBackup: string | null = null;
  const normalizedForFamily = normalizeConnectorServiceId(id);
  if (
    normalizedForFamily !== null &&
    GOOGLE_CONNECTOR_SERVICES.has(normalizedForFamily) &&
    sumItemsSiblingServices(db, normalizedForFamily, GOOGLE_CONNECTOR_SERVICES) === 0
  ) {
    googleOAuthBackup = await vault.get("google.oauth");
  }
  if (
    normalizedForFamily !== null &&
    MICROSOFT_CONNECTOR_SERVICES.has(normalizedForFamily) &&
    sumItemsSiblingServices(db, normalizedForFamily, MICROSOFT_CONNECTOR_SERVICES) === 0
  ) {
    microsoftOAuthBackup = await vault.get("microsoft.oauth");
  }
  if (syncScheduler !== undefined) {
    if (id === "github") {
      syncScheduler.unregister("github_actions");
    }
    syncScheduler.unregister(id);
  }
  deleteUserMcpConnector(db, id);
  let itemsDeleted = 0;
  if (id === "github") {
    itemsDeleted += localIndex.removeConnectorIndexData("github_actions");
  }
  itemsDeleted += localIndex.removeConnectorIndexData(id);
  let vaultKeys: string[] = [];
  try {
    vaultKeys = await clearOAuthVaultIfProviderUnused(vault, db, id);
    const normalizedBuiltin = normalizeConnectorServiceId(id);
    if (normalizedBuiltin !== null) {
      vaultKeys.push(...(await deleteConnectorPatAndTokenKeys(vault, normalizedBuiltin)));
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
  const id = requireRegisteredSchedulerServiceId(rec, localIndex);
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
  const now = Date.now();
  const interval = defaultSyncIntervalMsForService("github");
  localIndex.ensureConnectorSchedulerRegistration("github", interval, now);
  const ghaInterval = defaultSyncIntervalMsForService("github_actions");
  localIndex.ensureConnectorSchedulerRegistration("github_actions", ghaInterval, now);
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

async function connectorAuthDiscord(
  rec: Record<string, unknown> | undefined,
  vault: NimbusVault,
  localIndex: LocalIndex,
): Promise<ConnectorRpcHit> {
  const opt =
    rec?.["discordOptIn"] === true ||
    rec?.["discordOptIn"] === "true" ||
    rec?.["discordOptIn"] === "1";
  if (!opt) {
    throw new ConnectorRpcError(
      -32602,
      "Discord is opt-in: use CLI `nimbus connector auth discord --token <bot_token> --enable`",
    );
  }
  const tokenRaw = rec?.["personalAccessToken"] ?? rec?.["token"];
  const token = typeof tokenRaw === "string" && tokenRaw.trim() !== "" ? tokenRaw.trim() : "";
  if (token === "") {
    throw new ConnectorRpcError(-32602, "Missing bot token for discord");
  }
  await vault.set("discord.bot_token", token);
  await vault.set("discord.enabled", "1");
  const interval = defaultSyncIntervalMsForService("discord");
  localIndex.ensureConnectorSchedulerRegistration("discord", interval, Date.now());
  return authSuccess("discord");
}

async function connectorAuthJenkins(
  rec: Record<string, unknown> | undefined,
  vault: NimbusVault,
  localIndex: LocalIndex,
): Promise<ConnectorRpcHit> {
  const baseRaw = rec?.["apiBaseUrl"] ?? rec?.["baseUrl"];
  const base =
    typeof baseRaw === "string" && baseRaw.trim() !== ""
      ? stripTrailingSlashes(baseRaw.trim())
      : "";
  if (base === "") {
    throw new ConnectorRpcError(
      -32602,
      "Jenkins requires --api-base <url> (e.g. https://ci.example/)",
    );
  }
  const userRaw = rec?.["username"];
  const user = typeof userRaw === "string" && userRaw.trim() !== "" ? userRaw.trim() : "";
  const tokenRaw = rec?.["personalAccessToken"] ?? rec?.["token"];
  const token = typeof tokenRaw === "string" && tokenRaw.trim() !== "" ? tokenRaw.trim() : "";
  if (user === "") {
    throw new ConnectorRpcError(-32602, "Jenkins requires --username <jenkins_user>");
  }
  if (token === "") {
    throw new ConnectorRpcError(-32602, "Jenkins requires --token <api_token>");
  }
  await vault.set("jenkins.base_url", base);
  await vault.set("jenkins.username", user);
  await vault.set("jenkins.api_token", token);
  const interval = defaultSyncIntervalMsForService("jenkins");
  localIndex.ensureConnectorSchedulerRegistration("jenkins", interval, Date.now());
  return authSuccess("jenkins");
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
        emptyClientIdMessage: GOOGLE_OAUTH_CLIENT_ID_HELP,
      };
    case "microsoft":
      return {
        clientId: Config.oauthMicrosoftClientId,
        emptyClientIdMessage: MICROSOFT_OAUTH_CLIENT_ID_HELP,
      };
    case "slack":
      return {
        clientId: Config.oauthSlackClientId,
        emptyClientIdMessage: SLACK_OAUTH_CLIENT_ID_HELP,
      };
    case "notion":
      return {
        clientId: Config.oauthNotionClientId,
        emptyClientIdMessage: NOTION_OAUTH_CLIENT_ID_HELP,
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
    throw new ConnectorRpcError(-32602, NOTION_OAUTH_CLIENT_SECRET_HELP);
  }
  const scopes = oauthScopesFromConnectorRequest(rec, profile.defaultScopes);
  const redirectPort = oauthRedirectPortFromRec(rec);

  const pkceBase: PKCEOptions = {
    clientId,
    scopes,
    provider: profile.provider,
    vault,
    openUrl,
  };
  let merged: PKCEOptions = pkceBase;
  if (profile.provider === "notion" && notionSecret !== undefined && notionSecret !== "") {
    merged = { ...merged, oauthClientSecret: notionSecret };
  } else if (profile.provider === "google" && Config.oauthGoogleClientSecret !== "") {
    merged = { ...merged, oauthClientSecret: Config.oauthGoogleClientSecret };
  }
  const pkceFlowInput: PKCEOptions =
    redirectPort === undefined ? merged : { ...merged, redirectPort };
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
  if (id === "discord") {
    return connectorAuthDiscord(rec, vault, localIndex);
  }
  if (id === "jenkins") {
    return connectorAuthJenkins(rec, vault, localIndex);
  }
  return connectorAuthOAuthPkce(id, rec, vault, localIndex, openUrl);
}
