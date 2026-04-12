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
    case "circleci":
      await vault.delete("circleci.api_token");
      return ["circleci.api_token"];
    case "pagerduty":
      await vault.delete("pagerduty.api_token");
      return ["pagerduty.api_token"];
    case "kubernetes":
      await vault.delete("kubernetes.kubeconfig");
      await vault.delete("kubernetes.context");
      return ["kubernetes.kubeconfig", "kubernetes.context"];
    case "aws":
      await vault.delete("aws.access_key_id");
      await vault.delete("aws.secret_access_key");
      await vault.delete("aws.default_region");
      await vault.delete("aws.profile");
      return ["aws.access_key_id", "aws.secret_access_key", "aws.default_region", "aws.profile"];
    case "azure":
      await vault.delete("azure.tenant_id");
      await vault.delete("azure.client_id");
      await vault.delete("azure.client_secret");
      return ["azure.tenant_id", "azure.client_id", "azure.client_secret"];
    case "gcp":
      await vault.delete("gcp.credentials_json_path");
      await vault.delete("gcp.project_id");
      return ["gcp.credentials_json_path", "gcp.project_id"];
    case "iac":
      await vault.delete("iac.enabled");
      return ["iac.enabled"];
    case "grafana":
      await vault.delete("grafana.url");
      await vault.delete("grafana.api_token");
      return ["grafana.url", "grafana.api_token"];
    case "sentry":
      await vault.delete("sentry.auth_token");
      await vault.delete("sentry.org_slug");
      await vault.delete("sentry.url");
      return ["sentry.auth_token", "sentry.org_slug", "sentry.url"];
    case "newrelic":
      await vault.delete("newrelic.api_key");
      await vault.delete("newrelic.account_id");
      return ["newrelic.api_key", "newrelic.account_id"];
    case "datadog":
      await vault.delete("datadog.api_key");
      await vault.delete("datadog.app_key");
      await vault.delete("datadog.site");
      return ["datadog.api_key", "datadog.app_key", "datadog.site"];
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

async function connectorAuthCircleci(
  rec: Record<string, unknown> | undefined,
  vault: NimbusVault,
  localIndex: LocalIndex,
): Promise<ConnectorRpcHit> {
  const tokenRaw = rec?.["personalAccessToken"] ?? rec?.["token"];
  const token = typeof tokenRaw === "string" && tokenRaw.trim() !== "" ? tokenRaw.trim() : "";
  if (token === "") {
    throw new ConnectorRpcError(-32602, "Missing API token for circleci");
  }
  await vault.set("circleci.api_token", token);
  const interval = defaultSyncIntervalMsForService("circleci");
  localIndex.ensureConnectorSchedulerRegistration("circleci", interval, Date.now());
  return authSuccess("circleci");
}

async function persistAwsAccessKeyPair(
  vault: NimbusVault,
  ak: string,
  sk: string,
  reg: string,
  prof: string,
): Promise<void> {
  if (reg === "" && prof === "") {
    throw new ConnectorRpcError(
      -32602,
      "AWS key pair requires a default region or profile (connector.auth aws --region … or --profile …)",
    );
  }
  await vault.set("aws.access_key_id", ak);
  await vault.set("aws.secret_access_key", sk);
  if (reg === "") {
    await vault.delete("aws.default_region");
  } else {
    await vault.set("aws.default_region", reg);
  }
  if (prof === "") {
    await vault.delete("aws.profile");
  } else {
    await vault.set("aws.profile", prof);
  }
}

async function persistAwsProfileOnly(vault: NimbusVault, prof: string): Promise<void> {
  await vault.delete("aws.access_key_id");
  await vault.delete("aws.secret_access_key");
  await vault.delete("aws.default_region");
  await vault.set("aws.profile", prof);
}

async function connectorAuthAws(
  rec: Record<string, unknown> | undefined,
  vault: NimbusVault,
  localIndex: LocalIndex,
): Promise<ConnectorRpcHit> {
  const akRaw = rec?.["awsAccessKeyId"] ?? rec?.["accessKeyId"];
  const skRaw = rec?.["awsSecretAccessKey"] ?? rec?.["secretAccessKey"];
  const regRaw = rec?.["awsDefaultRegion"] ?? rec?.["defaultRegion"];
  const profRaw = rec?.["awsProfile"] ?? rec?.["profile"];
  const ak = typeof akRaw === "string" ? akRaw.trim() : "";
  const sk = typeof skRaw === "string" ? skRaw.trim() : "";
  const reg = typeof regRaw === "string" ? regRaw.trim() : "";
  const prof = typeof profRaw === "string" ? profRaw.trim() : "";

  const hasKeyPair = ak !== "" && sk !== "";
  if (hasKeyPair) {
    await persistAwsAccessKeyPair(vault, ak, sk, reg, prof);
  } else {
    if (prof === "") {
      throw new ConnectorRpcError(
        -32602,
        "Missing AWS credentials: access key + secret + region/profile, or profile-only (connector.auth aws …)",
      );
    }
    await persistAwsProfileOnly(vault, prof);
  }
  const interval = defaultSyncIntervalMsForService("aws");
  localIndex.ensureConnectorSchedulerRegistration("aws", interval, Date.now());
  return authSuccess("aws");
}

async function connectorAuthAzure(
  rec: Record<string, unknown> | undefined,
  vault: NimbusVault,
  localIndex: LocalIndex,
): Promise<ConnectorRpcHit> {
  const tRaw = rec?.["azureTenantId"] ?? rec?.["tenantId"];
  const cRaw = rec?.["azureClientId"] ?? rec?.["clientId"];
  const sRaw = rec?.["azureClientSecret"] ?? rec?.["clientSecret"];
  const tenant = typeof tRaw === "string" ? tRaw.trim() : "";
  const clientId = typeof cRaw === "string" ? cRaw.trim() : "";
  const secret = typeof sRaw === "string" ? sRaw.trim() : "";
  if (tenant === "" || clientId === "" || secret === "") {
    throw new ConnectorRpcError(
      -32602,
      "Azure requires tenant id, client id, and client secret (connector.auth azure …)",
    );
  }
  await vault.set("azure.tenant_id", tenant);
  await vault.set("azure.client_id", clientId);
  await vault.set("azure.client_secret", secret);
  const interval = defaultSyncIntervalMsForService("azure");
  localIndex.ensureConnectorSchedulerRegistration("azure", interval, Date.now());
  return authSuccess("azure");
}

async function connectorAuthGcp(
  rec: Record<string, unknown> | undefined,
  vault: NimbusVault,
  localIndex: LocalIndex,
): Promise<ConnectorRpcHit> {
  const pathRaw = rec?.["gcpCredentialsJsonPath"] ?? rec?.["credentialsJsonPath"] ?? rec?.["path"];
  const path = typeof pathRaw === "string" && pathRaw.trim() !== "" ? pathRaw.trim() : "";
  if (path === "") {
    throw new ConnectorRpcError(
      -32602,
      "GCP requires a service account JSON key path (connector.auth gcp --credentials-json <path>)",
    );
  }
  await vault.set("gcp.credentials_json_path", path);
  const projRaw = rec?.["gcpProjectId"] ?? rec?.["projectId"];
  const proj = typeof projRaw === "string" && projRaw.trim() !== "" ? projRaw.trim() : "";
  if (proj === "") {
    await vault.delete("gcp.project_id");
  } else {
    await vault.set("gcp.project_id", proj);
  }
  const interval = defaultSyncIntervalMsForService("gcp");
  localIndex.ensureConnectorSchedulerRegistration("gcp", interval, Date.now());
  return authSuccess("gcp");
}

async function connectorAuthIac(
  rec: Record<string, unknown> | undefined,
  vault: NimbusVault,
  localIndex: LocalIndex,
): Promise<ConnectorRpcHit> {
  const opt =
    rec?.["iacOptIn"] === true || rec?.["iacOptIn"] === "true" || rec?.["iacOptIn"] === "1";
  if (!opt) {
    throw new ConnectorRpcError(
      -32602,
      "IaC connector is opt-in: nimbus connector auth iac --enable",
    );
  }
  await vault.set("iac.enabled", "1");
  const interval = defaultSyncIntervalMsForService("iac");
  localIndex.ensureConnectorSchedulerRegistration("iac", interval, Date.now());
  return authSuccess("iac");
}

async function connectorAuthGrafana(
  rec: Record<string, unknown> | undefined,
  vault: NimbusVault,
  localIndex: LocalIndex,
): Promise<ConnectorRpcHit> {
  const baseRaw = rec?.["apiBaseUrl"] ?? rec?.["grafanaUrl"] ?? rec?.["url"];
  const base =
    typeof baseRaw === "string" && baseRaw.trim() !== ""
      ? stripTrailingSlashes(baseRaw.trim())
      : "";
  const tokenRaw = rec?.["personalAccessToken"] ?? rec?.["token"];
  const token = typeof tokenRaw === "string" && tokenRaw.trim() !== "" ? tokenRaw.trim() : "";
  if (base === "") {
    throw new ConnectorRpcError(
      -32602,
      "Grafana requires base URL (connector.auth grafana --api-base https://grafana.example/)",
    );
  }
  if (token === "") {
    throw new ConnectorRpcError(
      -32602,
      "Grafana requires an API token (connector.auth grafana --token …)",
    );
  }
  await vault.set("grafana.url", base);
  await vault.set("grafana.api_token", token);
  const interval = defaultSyncIntervalMsForService("grafana");
  localIndex.ensureConnectorSchedulerRegistration("grafana", interval, Date.now());
  return authSuccess("grafana");
}

async function connectorAuthSentry(
  rec: Record<string, unknown> | undefined,
  vault: NimbusVault,
  localIndex: LocalIndex,
): Promise<ConnectorRpcHit> {
  const tokenRaw = rec?.["personalAccessToken"] ?? rec?.["token"];
  const token = typeof tokenRaw === "string" && tokenRaw.trim() !== "" ? tokenRaw.trim() : "";
  const orgRaw = rec?.["sentryOrgSlug"] ?? rec?.["orgSlug"];
  const org = typeof orgRaw === "string" && orgRaw.trim() !== "" ? orgRaw.trim() : "";
  if (token === "" || org === "") {
    throw new ConnectorRpcError(
      -32602,
      "Sentry requires auth token and org slug (connector.auth sentry --token … --org …)",
    );
  }
  await vault.set("sentry.auth_token", token);
  await vault.set("sentry.org_slug", org);
  const urlRaw = rec?.["sentryUrl"] ?? rec?.["apiBaseUrl"];
  const surl =
    typeof urlRaw === "string" && urlRaw.trim() !== "" ? stripTrailingSlashes(urlRaw.trim()) : "";
  if (surl === "") {
    await vault.delete("sentry.url");
  } else {
    await vault.set("sentry.url", surl);
  }
  const interval = defaultSyncIntervalMsForService("sentry");
  localIndex.ensureConnectorSchedulerRegistration("sentry", interval, Date.now());
  return authSuccess("sentry");
}

async function connectorAuthNewrelic(
  rec: Record<string, unknown> | undefined,
  vault: NimbusVault,
  localIndex: LocalIndex,
): Promise<ConnectorRpcHit> {
  const tokenRaw = rec?.["personalAccessToken"] ?? rec?.["token"];
  const token = typeof tokenRaw === "string" && tokenRaw.trim() !== "" ? tokenRaw.trim() : "";
  if (token === "") {
    throw new ConnectorRpcError(
      -32602,
      "New Relic requires a user API key (connector.auth newrelic --token …)",
    );
  }
  await vault.set("newrelic.api_key", token);
  const acctRaw = rec?.["newrelicAccountId"] ?? rec?.["accountId"];
  const acct = typeof acctRaw === "string" && acctRaw.trim() !== "" ? acctRaw.trim() : "";
  if (acct === "") {
    await vault.delete("newrelic.account_id");
  } else {
    await vault.set("newrelic.account_id", acct);
  }
  const interval = defaultSyncIntervalMsForService("newrelic");
  localIndex.ensureConnectorSchedulerRegistration("newrelic", interval, Date.now());
  return authSuccess("newrelic");
}

async function connectorAuthDatadog(
  rec: Record<string, unknown> | undefined,
  vault: NimbusVault,
  localIndex: LocalIndex,
): Promise<ConnectorRpcHit> {
  const apiRaw = rec?.["datadogApiKey"] ?? rec?.["apiKey"];
  const appRaw = rec?.["datadogAppKey"] ?? rec?.["appKey"];
  const api = typeof apiRaw === "string" && apiRaw.trim() !== "" ? apiRaw.trim() : "";
  const app = typeof appRaw === "string" && appRaw.trim() !== "" ? appRaw.trim() : "";
  if (api === "" || app === "") {
    throw new ConnectorRpcError(
      -32602,
      "Datadog requires API key and application key (connector.auth datadog …)",
    );
  }
  await vault.set("datadog.api_key", api);
  await vault.set("datadog.app_key", app);
  const siteRaw = rec?.["datadogSite"] ?? rec?.["site"];
  const site = typeof siteRaw === "string" && siteRaw.trim() !== "" ? siteRaw.trim() : "";
  if (site === "") {
    await vault.delete("datadog.site");
  } else {
    await vault.set("datadog.site", site);
  }
  const interval = defaultSyncIntervalMsForService("datadog");
  localIndex.ensureConnectorSchedulerRegistration("datadog", interval, Date.now());
  return authSuccess("datadog");
}

async function connectorAuthKubernetes(
  rec: Record<string, unknown> | undefined,
  vault: NimbusVault,
  localIndex: LocalIndex,
): Promise<ConnectorRpcHit> {
  const pathRaw = rec?.["kubeconfigPath"] ?? rec?.["kubeconfig"] ?? rec?.["path"];
  const kubePath = typeof pathRaw === "string" && pathRaw.trim() !== "" ? pathRaw.trim() : "";
  if (kubePath === "") {
    throw new ConnectorRpcError(
      -32602,
      "Kubernetes requires kubeconfig path: connector.auth kubernetes --kubeconfig <path>",
    );
  }
  await vault.set("kubernetes.kubeconfig", kubePath);
  const ctxRaw = rec?.["context"];
  if (typeof ctxRaw === "string" && ctxRaw.trim() !== "") {
    await vault.set("kubernetes.context", ctxRaw.trim());
  } else {
    await vault.delete("kubernetes.context");
  }
  const interval = defaultSyncIntervalMsForService("kubernetes");
  localIndex.ensureConnectorSchedulerRegistration("kubernetes", interval, Date.now());
  return authSuccess("kubernetes");
}

async function connectorAuthPagerduty(
  rec: Record<string, unknown> | undefined,
  vault: NimbusVault,
  localIndex: LocalIndex,
): Promise<ConnectorRpcHit> {
  const tokenRaw = rec?.["personalAccessToken"] ?? rec?.["token"];
  const token = typeof tokenRaw === "string" && tokenRaw.trim() !== "" ? tokenRaw.trim() : "";
  if (token === "") {
    throw new ConnectorRpcError(-32602, "Missing API token for pagerduty");
  }
  await vault.set("pagerduty.api_token", token);
  const interval = defaultSyncIntervalMsForService("pagerduty");
  localIndex.ensureConnectorSchedulerRegistration("pagerduty", interval, Date.now());
  return authSuccess("pagerduty");
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
  if (id === "circleci") {
    return connectorAuthCircleci(rec, vault, localIndex);
  }
  if (id === "pagerduty") {
    return connectorAuthPagerduty(rec, vault, localIndex);
  }
  if (id === "kubernetes") {
    return connectorAuthKubernetes(rec, vault, localIndex);
  }
  if (id === "aws") {
    return connectorAuthAws(rec, vault, localIndex);
  }
  if (id === "azure") {
    return connectorAuthAzure(rec, vault, localIndex);
  }
  if (id === "gcp") {
    return connectorAuthGcp(rec, vault, localIndex);
  }
  if (id === "iac") {
    return connectorAuthIac(rec, vault, localIndex);
  }
  if (id === "grafana") {
    return connectorAuthGrafana(rec, vault, localIndex);
  }
  if (id === "sentry") {
    return connectorAuthSentry(rec, vault, localIndex);
  }
  if (id === "newrelic") {
    return connectorAuthNewrelic(rec, vault, localIndex);
  }
  if (id === "datadog") {
    return connectorAuthDatadog(rec, vault, localIndex);
  }
  return connectorAuthOAuthPkce(id, rec, vault, localIndex, openUrl);
}
