import { IPCClient } from "../ipc-client/index.ts";
import {
  GOOGLE_OAUTH_CLIENT_ID_HELP,
  MICROSOFT_OAUTH_CLIENT_ID_HELP,
  NOTION_OAUTH_ENV_HELP,
  printConnectorAuthHelpPointer,
  printConnectorAuthPatOnlyHelp,
  SLACK_OAUTH_CLIENT_ID_HELP,
} from "../lib/connector-oauth-env-help.ts";
import { readGatewayState } from "../lib/gateway-process.ts";
import { parseDurationToMs } from "../lib/parse-duration.ts";
import { stripTrailingSlashes } from "../lib/strip-trailing-slashes.ts";
import { getCliPlatformPaths } from "../paths.ts";

type SyncStatus = {
  serviceId: string;
  status: string;
  lastSyncAt: number | null;
  nextSyncAt: number | null;
  intervalMs: number;
  itemCount: number;
  lastError: string | null;
  consecutiveFailures: number;
};

type SyncTelemetryEntry = {
  startedAt: number;
  durationMs: number;
  itemsUpserted: number;
  itemsDeleted: number;
  bytesTransferred: number | null;
  hadMore: boolean;
  errorMsg: string | null;
};

type SyncStatusWithTelemetry = SyncStatus & { telemetry?: SyncTelemetryEntry[] };

type ConnectorFlags = {
  rest: string[];
  port?: number;
  scopes?: string[];
  token?: string;
  username?: string;
  apiBase?: string;
  kubeconfig?: string;
  kubeContext?: string;
  full?: boolean;
  /** Opt-in flag for Discord bot connector (Q2 §4.3). */
  enable?: boolean;
  help?: boolean;
  awsAccessKey?: string;
  awsSecretKey?: string;
  awsRegion?: string;
  awsProfile?: string;
  azureTenantId?: string;
  azureClientId?: string;
  azureClientSecret?: string;
  gcpCredentialsJson?: string;
  gcpProjectId?: string;
  sentryOrg?: string;
  sentryUrl?: string;
  newrelicAccountId?: string;
  datadogApiKey?: string;
  datadogAppKey?: string;
  datadogSite?: string;
};

async function withIpc<T>(fn: (c: IPCClient) => Promise<T>): Promise<T> {
  const paths = getCliPlatformPaths();
  const state = await readGatewayState(paths);
  if (state === undefined) {
    throw new Error("Gateway is not running. Start with: nimbus start");
  }
  const client = new IPCClient(state.socketPath);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.disconnect();
  }
}

function relTime(ms: number | null): string {
  if (ms === null) {
    return "—";
  }
  const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (sec < 60) {
    return `${String(sec)}s ago`;
  }
  if (sec < 3600) {
    return `${String(Math.floor(sec / 60))}m ago`;
  }
  if (sec < 86400) {
    return `${String(Math.floor(sec / 3600))}h ago`;
  }
  return `${String(Math.floor(sec / 86400))}d ago`;
}

function fmtNextSync(ms: number | null): string {
  if (ms === null) {
    return "—";
  }
  const delta = ms - Date.now();
  if (delta <= 0) {
    return "due";
  }
  const sec = Math.floor(delta / 1000);
  if (sec < 60) {
    return `in ${String(sec)}s`;
  }
  if (sec < 3600) {
    return `in ${String(Math.floor(sec / 60))}m`;
  }
  if (sec < 86400) {
    return `in ${String(Math.floor(sec / 3600))}h`;
  }
  return `in ${String(Math.floor(sec / 86400))}d`;
}

function truncateText(s: string, maxLen: number): string {
  if (s.length <= maxLen) {
    return s;
  }
  if (maxLen <= 1) {
    return "…";
  }
  return `${s.slice(0, maxLen - 1)}…`;
}

function takeFlagValue(q: string[], flagLabel: string): string {
  const v = q.shift();
  if (v === undefined) {
    throw new Error(`Missing value for ${flagLabel}`);
  }
  return v;
}

function parseFlags(args: string[]): ConnectorFlags {
  const rest: string[] = [];
  let port: number | undefined;
  let scopes: string[] | undefined;
  let token: string | undefined;
  let username: string | undefined;
  let apiBase: string | undefined;
  let kubeconfig: string | undefined;
  let kubeContext: string | undefined;
  let full: boolean | undefined;
  let enable: boolean | undefined;
  let help: boolean | undefined;
  let awsAccessKey: string | undefined;
  let awsSecretKey: string | undefined;
  let awsRegion: string | undefined;
  let awsProfile: string | undefined;
  let azureTenantId: string | undefined;
  let azureClientId: string | undefined;
  let azureClientSecret: string | undefined;
  let gcpCredentialsJson: string | undefined;
  let gcpProjectId: string | undefined;
  let sentryOrg: string | undefined;
  let sentryUrl: string | undefined;
  let newrelicAccountId: string | undefined;
  let datadogApiKey: string | undefined;
  let datadogAppKey: string | undefined;
  let datadogSite: string | undefined;
  const q = [...args];

  while (q.length > 0) {
    const a = q.shift();
    if (a === undefined) {
      break;
    }
    if (a === "--help" || a === "-h") {
      help = true;
      continue;
    }
    if (a === "--port" || a === "-p") {
      const v = takeFlagValue(q, "--port");
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 65_535) {
        throw new Error("Invalid --port");
      }
      port = n;
      continue;
    }
    if (a === "--scopes" || a === "-s") {
      const v = takeFlagValue(q, "--scopes");
      scopes = v
        .split(",")
        .map((x) => x.trim())
        .filter((x) => x.length > 0);
      continue;
    }
    if (a === "--token" || a === "-t") {
      const v = takeFlagValue(q, "--token").trim();
      if (v === "") {
        throw new Error("Invalid --token (empty)");
      }
      token = v;
      continue;
    }
    if (a === "--username" || a === "-u") {
      const v = takeFlagValue(q, "--username").trim();
      if (v === "") {
        throw new Error("Invalid --username (empty)");
      }
      username = v;
      continue;
    }
    if (a === "--full") {
      full = true;
      continue;
    }
    if (a === "--enable") {
      enable = true;
      continue;
    }
    if (a === "--api-base") {
      const v = takeFlagValue(q, "--api-base").trim();
      if (v === "") {
        throw new Error("Invalid --api-base (empty)");
      }
      apiBase = stripTrailingSlashes(v);
      continue;
    }
    if (a === "--kubeconfig") {
      const v = takeFlagValue(q, "--kubeconfig").trim();
      if (v === "") {
        throw new Error("Invalid --kubeconfig (empty)");
      }
      kubeconfig = v;
      continue;
    }
    if (a === "--context") {
      const v = takeFlagValue(q, "--context").trim();
      if (v === "") {
        throw new Error("Invalid --context (empty)");
      }
      kubeContext = v;
      continue;
    }
    if (a === "--aws-access-key") {
      awsAccessKey = takeFlagValue(q, "--aws-access-key").trim();
      continue;
    }
    if (a === "--aws-secret-key") {
      awsSecretKey = takeFlagValue(q, "--aws-secret-key").trim();
      continue;
    }
    if (a === "--aws-region") {
      awsRegion = takeFlagValue(q, "--aws-region").trim();
      continue;
    }
    if (a === "--aws-profile") {
      awsProfile = takeFlagValue(q, "--aws-profile").trim();
      continue;
    }
    if (a === "--azure-tenant-id") {
      azureTenantId = takeFlagValue(q, "--azure-tenant-id").trim();
      continue;
    }
    if (a === "--azure-client-id") {
      azureClientId = takeFlagValue(q, "--azure-client-id").trim();
      continue;
    }
    if (a === "--azure-client-secret") {
      azureClientSecret = takeFlagValue(q, "--azure-client-secret").trim();
      continue;
    }
    if (a === "--gcp-credentials-json") {
      gcpCredentialsJson = takeFlagValue(q, "--gcp-credentials-json").trim();
      continue;
    }
    if (a === "--gcp-project-id") {
      gcpProjectId = takeFlagValue(q, "--gcp-project-id").trim();
      continue;
    }
    if (a === "--sentry-org") {
      sentryOrg = takeFlagValue(q, "--sentry-org").trim();
      continue;
    }
    if (a === "--sentry-url") {
      sentryUrl = takeFlagValue(q, "--sentry-url").trim();
      continue;
    }
    if (a === "--newrelic-account-id") {
      newrelicAccountId = takeFlagValue(q, "--newrelic-account-id").trim();
      continue;
    }
    if (a === "--datadog-api-key") {
      datadogApiKey = takeFlagValue(q, "--datadog-api-key").trim();
      continue;
    }
    if (a === "--datadog-app-key") {
      datadogAppKey = takeFlagValue(q, "--datadog-app-key").trim();
      continue;
    }
    if (a === "--datadog-site") {
      datadogSite = takeFlagValue(q, "--datadog-site").trim();
      continue;
    }
    rest.push(a);
  }

  const out: ConnectorFlags = { rest };
  if (port !== undefined) {
    out.port = port;
  }
  if (scopes !== undefined) {
    out.scopes = scopes;
  }
  if (token !== undefined) {
    out.token = token;
  }
  if (username !== undefined) {
    out.username = username;
  }
  if (apiBase !== undefined) {
    out.apiBase = apiBase;
  }
  if (kubeconfig !== undefined) {
    out.kubeconfig = kubeconfig;
  }
  if (kubeContext !== undefined) {
    out.kubeContext = kubeContext;
  }
  if (full !== undefined) {
    out.full = full;
  }
  if (enable !== undefined) {
    out.enable = enable;
  }
  if (help !== undefined) {
    out.help = help;
  }
  if (awsAccessKey !== undefined) {
    out.awsAccessKey = awsAccessKey;
  }
  if (awsSecretKey !== undefined) {
    out.awsSecretKey = awsSecretKey;
  }
  if (awsRegion !== undefined) {
    out.awsRegion = awsRegion;
  }
  if (awsProfile !== undefined) {
    out.awsProfile = awsProfile;
  }
  if (azureTenantId !== undefined) {
    out.azureTenantId = azureTenantId;
  }
  if (azureClientId !== undefined) {
    out.azureClientId = azureClientId;
  }
  if (azureClientSecret !== undefined) {
    out.azureClientSecret = azureClientSecret;
  }
  if (gcpCredentialsJson !== undefined) {
    out.gcpCredentialsJson = gcpCredentialsJson;
  }
  if (gcpProjectId !== undefined) {
    out.gcpProjectId = gcpProjectId;
  }
  if (sentryOrg !== undefined) {
    out.sentryOrg = sentryOrg;
  }
  if (sentryUrl !== undefined) {
    out.sentryUrl = sentryUrl;
  }
  if (newrelicAccountId !== undefined) {
    out.newrelicAccountId = newrelicAccountId;
  }
  if (datadogApiKey !== undefined) {
    out.datadogApiKey = datadogApiKey;
  }
  if (datadogAppKey !== undefined) {
    out.datadogAppKey = datadogAppKey;
  }
  if (datadogSite !== undefined) {
    out.datadogSite = datadogSite;
  }
  return out;
}

function printConnectorAuthServiceHelp(normalized: string): void {
  switch (normalized) {
    case "google_drive":
    case "gmail":
    case "google_photos":
      console.log(GOOGLE_OAUTH_CLIENT_ID_HELP);
      return;
    case "onedrive":
    case "outlook":
    case "teams":
      console.log(MICROSOFT_OAUTH_CLIENT_ID_HELP);
      return;
    case "slack":
      console.log(SLACK_OAUTH_CLIENT_ID_HELP);
      return;
    case "notion":
      console.log(NOTION_OAUTH_ENV_HELP);
      return;
    default:
      printConnectorAuthPatOnlyHelp(normalized);
  }
}

function padField(s: string, w: number): string {
  return s.length >= w ? s : s + " ".repeat(w - s.length);
}

function repeatChar(ch: string, n: number): string {
  return ch.repeat(Math.max(0, n));
}

function firstEnvTrimmed(keys: readonly string[]): string {
  for (const k of keys) {
    const v = process.env[k]?.trim();
    if (v !== undefined && v !== "") {
      return v;
    }
  }
  return "";
}

function resolveAtlassianSiteCredentials(opts: {
  username: string | undefined;
  token: string | undefined;
  apiBase: string | undefined;
  emailEnvKeys: readonly string[];
  tokenEnvKeys: readonly string[];
  baseEnvKeys: readonly string[];
  errEmail: string;
  errToken: string;
  errBase: string;
}): { email: string; token: string; base: string } {
  const mail = opts.username?.trim() || firstEnvTrimmed(opts.emailEnvKeys);
  if (mail === "") {
    throw new Error(opts.errEmail);
  }
  const apiTok = opts.token?.trim() || firstEnvTrimmed(opts.tokenEnvKeys);
  if (apiTok === "") {
    throw new Error(opts.errToken);
  }
  const baseRaw = opts.apiBase?.trim() || firstEnvTrimmed(opts.baseEnvKeys);
  if (baseRaw === "") {
    throw new Error(opts.errBase);
  }
  return { email: mail, token: apiTok, base: stripTrailingSlashes(baseRaw) };
}

/** PAT-style connectors: CLI `--token` or first non-empty env in the list. */
function requirePatFromFlagsOrEnv(
  token: string | undefined,
  envKeys: readonly string[],
  errMsg: string,
): string {
  const pat = token?.trim() || firstEnvTrimmed(envKeys);
  if (pat === "") {
    throw new Error(errMsg);
  }
  return pat;
}

type AtlassianConnectorSiteConfig = {
  readonly emailEnvKeys: readonly string[];
  readonly tokenEnvKeys: readonly string[];
  readonly baseEnvKeys: readonly string[];
  readonly errEmail: string;
  readonly errToken: string;
  readonly errBase: string;
};

const JIRA_CONNECTOR_SITE: AtlassianConnectorSiteConfig = {
  emailEnvKeys: ["NIMBUS_JIRA_EMAIL", "ATLASSIAN_EMAIL"],
  tokenEnvKeys: ["NIMBUS_JIRA_API_TOKEN"],
  baseEnvKeys: ["NIMBUS_JIRA_BASE_URL", "JIRA_BASE_URL"],
  errEmail:
    "Jira requires your Atlassian account email: nimbus connector auth jira --username <email> --token <api_token> --api-base https://your-domain.atlassian.net  (or set NIMBUS_JIRA_EMAIL)",
  errToken:
    "Jira requires an API token: nimbus connector auth jira --username <email> --token <api_token> --api-base <url>  (or set NIMBUS_JIRA_API_TOKEN)",
  errBase:
    "Jira requires the site URL: nimbus connector auth jira ... --api-base https://your-domain.atlassian.net  (or set NIMBUS_JIRA_BASE_URL)",
};

const CONFLUENCE_CONNECTOR_SITE: AtlassianConnectorSiteConfig = {
  emailEnvKeys: ["NIMBUS_CONFLUENCE_EMAIL", "ATLASSIAN_EMAIL"],
  tokenEnvKeys: ["NIMBUS_CONFLUENCE_API_TOKEN"],
  baseEnvKeys: ["NIMBUS_CONFLUENCE_BASE_URL", "CONFLUENCE_BASE_URL"],
  errEmail:
    "Confluence requires your Atlassian account email: nimbus connector auth confluence --username <email> --token <api_token> --api-base https://your-domain.atlassian.net  (or set NIMBUS_CONFLUENCE_EMAIL)",
  errToken:
    "Confluence requires an API token: nimbus connector auth confluence ... (or set NIMBUS_CONFLUENCE_API_TOKEN)",
  errBase:
    "Confluence requires the site URL: ... --api-base https://your-domain.atlassian.net  (or set NIMBUS_CONFLUENCE_BASE_URL)",
};

function applyAtlassianSiteConnectorAuth(
  p: ConnectorAuthParams,
  token: string | undefined,
  username: string | undefined,
  apiBase: string | undefined,
  site: AtlassianConnectorSiteConfig,
): void {
  const {
    email,
    token: apiTok,
    base,
  } = resolveAtlassianSiteCredentials({
    username,
    token,
    apiBase,
    emailEnvKeys: site.emailEnvKeys,
    tokenEnvKeys: site.tokenEnvKeys,
    baseEnvKeys: site.baseEnvKeys,
    errEmail: site.errEmail,
    errToken: site.errToken,
    errBase: site.errBase,
  });
  p.atlassianEmail = email;
  p.personalAccessToken = apiTok;
  p.apiBaseUrl = base;
}

type ConnectorAuthParams = {
  service: string;
  port?: number;
  scopes?: string[];
  personalAccessToken?: string;
  bitbucketUsername?: string;
  /** Jenkins user id (HTTP Basic); also used for Jira/Confluence via atlassianEmail. */
  username?: string;
  atlassianEmail?: string;
  apiBaseUrl?: string;
  kubeconfigPath?: string;
  context?: string;
  discordOptIn?: boolean;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsDefaultRegion?: string;
  awsProfile?: string;
  azureTenantId?: string;
  azureClientId?: string;
  azureClientSecret?: string;
  gcpCredentialsJsonPath?: string;
  gcpProjectId?: string;
  iacOptIn?: boolean;
  sentryOrgSlug?: string;
  sentryUrl?: string;
  newrelicAccountId?: string;
  datadogApiKey?: string;
  datadogAppKey?: string;
  datadogSite?: string;
};

function applyLinearConnectorAuth(p: ConnectorAuthParams, token: string | undefined): void {
  p.personalAccessToken = requirePatFromFlagsOrEnv(
    token,
    ["NIMBUS_LINEAR_API_KEY"],
    "Linear requires an API key: nimbus connector auth linear --token <key>  (or set NIMBUS_LINEAR_API_KEY)",
  );
}

function applyGithubConnectorAuth(p: ConnectorAuthParams, token: string | undefined): void {
  p.personalAccessToken = requirePatFromFlagsOrEnv(
    token,
    ["NIMBUS_GITHUB_PAT"],
    "GitHub requires a PAT: nimbus connector auth github --token <pat>  (or set NIMBUS_GITHUB_PAT in the environment)",
  );
}

function applyCircleciConnectorAuth(p: ConnectorAuthParams, token: string | undefined): void {
  p.personalAccessToken = requirePatFromFlagsOrEnv(
    token,
    ["NIMBUS_CIRCLECI_API_TOKEN", "CIRCLECI_TOKEN"],
    "CircleCI requires an API token: nimbus connector auth circleci --token <token>  (or set NIMBUS_CIRCLECI_API_TOKEN)",
  );
}

function applyPagerdutyConnectorAuth(p: ConnectorAuthParams, token: string | undefined): void {
  p.personalAccessToken = requirePatFromFlagsOrEnv(
    token,
    ["NIMBUS_PAGERDUTY_API_TOKEN", "PAGERDUTY_API_TOKEN"],
    "PagerDuty requires an API token: nimbus connector auth pagerduty --token <token>  (or set NIMBUS_PAGERDUTY_API_TOKEN)",
  );
}

function applyAwsConnectorAuth(
  p: ConnectorAuthParams,
  flags: {
    awsAccessKey?: string;
    awsSecretKey?: string;
    awsRegion?: string;
    awsProfile?: string;
  },
): void {
  const ak =
    flags.awsAccessKey?.trim() ||
    firstEnvTrimmed(["NIMBUS_AWS_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID"]);
  const sk =
    flags.awsSecretKey?.trim() ||
    firstEnvTrimmed(["NIMBUS_AWS_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY"]);
  const reg =
    flags.awsRegion?.trim() || firstEnvTrimmed(["NIMBUS_AWS_DEFAULT_REGION", "AWS_DEFAULT_REGION"]);
  const prof = flags.awsProfile?.trim() || firstEnvTrimmed(["NIMBUS_AWS_PROFILE", "AWS_PROFILE"]);
  if (ak !== "" && sk !== "") {
    if (reg === "" && prof === "") {
      throw new Error(
        "AWS key pair requires --aws-region <r> or --aws-profile <p> (or set NIMBUS_AWS_DEFAULT_REGION / NIMBUS_AWS_PROFILE)",
      );
    }
    p.awsAccessKeyId = ak;
    p.awsSecretAccessKey = sk;
    if (reg !== "") {
      p.awsDefaultRegion = reg;
    }
    if (prof !== "") {
      p.awsProfile = prof;
    }
  } else if (prof !== "") {
    p.awsProfile = prof;
  } else {
    throw new Error(
      "AWS: use --aws-access-key + --aws-secret-key + region/profile, or --aws-profile only (or set env vars)",
    );
  }
}

function applyAzureConnectorAuth(
  p: ConnectorAuthParams,
  flags: {
    azureTenantId?: string;
    azureClientId?: string;
    azureClientSecret?: string;
  },
): void {
  const tenant =
    flags.azureTenantId?.trim() || firstEnvTrimmed(["NIMBUS_AZURE_TENANT_ID", "AZURE_TENANT_ID"]);
  const cid =
    flags.azureClientId?.trim() || firstEnvTrimmed(["NIMBUS_AZURE_CLIENT_ID", "AZURE_CLIENT_ID"]);
  const sec =
    flags.azureClientSecret?.trim() ||
    firstEnvTrimmed(["NIMBUS_AZURE_CLIENT_SECRET", "AZURE_CLIENT_SECRET"]);
  if (tenant === "" || cid === "" || sec === "") {
    throw new Error(
      "Azure requires tenant id, client id, and client secret (flags --azure-tenant-id, --azure-client-id, --azure-client-secret or env AZURE_*)",
    );
  }
  p.azureTenantId = tenant;
  p.azureClientId = cid;
  p.azureClientSecret = sec;
}

function applyGcpConnectorAuth(
  p: ConnectorAuthParams,
  flags: { gcpCredentialsJson?: string; gcpProjectId?: string },
): void {
  const pathRaw =
    flags.gcpCredentialsJson?.trim() ||
    firstEnvTrimmed(["NIMBUS_GCP_CREDENTIALS_JSON", "GOOGLE_APPLICATION_CREDENTIALS"]);
  if (pathRaw === "") {
    throw new Error(
      "GCP requires --gcp-credentials-json <path> (or set GOOGLE_APPLICATION_CREDENTIALS / NIMBUS_GCP_CREDENTIALS_JSON)",
    );
  }
  p.gcpCredentialsJsonPath = pathRaw;
  const proj =
    flags.gcpProjectId?.trim() ||
    firstEnvTrimmed(["NIMBUS_GCP_PROJECT_ID", "GOOGLE_CLOUD_PROJECT"]);
  if (proj !== "") {
    p.gcpProjectId = proj;
  }
}

function applyIacConnectorAuth(p: ConnectorAuthParams, enable: boolean | undefined): void {
  if (enable !== true) {
    throw new Error("IaC connector is opt-in: nimbus connector auth iac --enable");
  }
  p.iacOptIn = true;
}

function applyGrafanaConnectorAuth(
  p: ConnectorAuthParams,
  token: string | undefined,
  apiBase: string | undefined,
): void {
  const base = apiBase?.trim() || firstEnvTrimmed(["NIMBUS_GRAFANA_URL", "GRAFANA_URL"]);
  const tok = token?.trim() || firstEnvTrimmed(["NIMBUS_GRAFANA_API_TOKEN", "GRAFANA_API_TOKEN"]);
  if (base === "") {
    throw new Error(
      "Grafana requires base URL: nimbus connector auth grafana --api-base https://grafana.example/ --token <api_token>",
    );
  }
  if (tok === "") {
    throw new Error("Grafana requires an API token (--token or NIMBUS_GRAFANA_API_TOKEN)");
  }
  p.apiBaseUrl = stripTrailingSlashes(base);
  p.personalAccessToken = tok;
}

function applySentryConnectorAuth(
  p: ConnectorAuthParams,
  token: string | undefined,
  flags: { sentryOrg?: string; sentryUrl?: string },
): void {
  const tok = token?.trim() || firstEnvTrimmed(["NIMBUS_SENTRY_AUTH_TOKEN", "SENTRY_AUTH_TOKEN"]);
  const org = flags.sentryOrg?.trim() || firstEnvTrimmed(["NIMBUS_SENTRY_ORG", "SENTRY_ORG"]);
  if (tok === "" || org === "") {
    throw new Error(
      "Sentry requires --token and --sentry-org <slug> (or env NIMBUS_SENTRY_AUTH_TOKEN / NIMBUS_SENTRY_ORG)",
    );
  }
  p.personalAccessToken = tok;
  p.sentryOrgSlug = org;
  const surl = flags.sentryUrl?.trim() || firstEnvTrimmed(["NIMBUS_SENTRY_URL"]);
  if (surl !== "") {
    p.sentryUrl = stripTrailingSlashes(surl);
  }
}

function applyNewrelicConnectorAuth(
  p: ConnectorAuthParams,
  token: string | undefined,
  flags: { newrelicAccountId?: string },
): void {
  const tok = token?.trim() || firstEnvTrimmed(["NIMBUS_NEW_RELIC_API_KEY", "NEW_RELIC_API_KEY"]);
  if (tok === "") {
    throw new Error("New Relic requires --token (or NIMBUS_NEW_RELIC_API_KEY / NEW_RELIC_API_KEY)");
  }
  p.personalAccessToken = tok;
  const acct = flags.newrelicAccountId?.trim() || firstEnvTrimmed(["NIMBUS_NEW_RELIC_ACCOUNT_ID"]);
  if (acct !== "") {
    p.newrelicAccountId = acct;
  }
}

function applyDatadogConnectorAuth(
  p: ConnectorAuthParams,
  flags: {
    datadogApiKey?: string;
    datadogAppKey?: string;
    datadogSite?: string;
  },
): void {
  const api =
    flags.datadogApiKey?.trim() || firstEnvTrimmed(["NIMBUS_DATADOG_API_KEY", "DD_API_KEY"]);
  const app =
    flags.datadogAppKey?.trim() || firstEnvTrimmed(["NIMBUS_DATADOG_APP_KEY", "DD_APP_KEY"]);
  if (api === "" || app === "") {
    throw new Error(
      "Datadog requires --datadog-api-key and --datadog-app-key (or DD_API_KEY / DD_APP_KEY)",
    );
  }
  p.datadogApiKey = api;
  p.datadogAppKey = app;
  const site = flags.datadogSite?.trim() || firstEnvTrimmed(["NIMBUS_DATADOG_SITE", "DD_SITE"]);
  if (site !== "") {
    p.datadogSite = site;
  }
}

function applyKubernetesConnectorAuth(
  p: ConnectorAuthParams,
  kubeconfig: string | undefined,
  context: string | undefined,
): void {
  const pathRaw = kubeconfig?.trim() || firstEnvTrimmed(["NIMBUS_KUBECONFIG", "KUBECONFIG"]);
  if (pathRaw === "") {
    throw new Error(
      "Kubernetes requires --kubeconfig <path> or env NIMBUS_KUBECONFIG / KUBECONFIG (vault key kubernetes.kubeconfig)",
    );
  }
  p.kubeconfigPath = pathRaw;
  if (context !== undefined && context.trim() !== "") {
    p.context = context.trim();
  }
}

function applyDiscordConnectorAuth(
  p: ConnectorAuthParams,
  token: string | undefined,
  enable: boolean | undefined,
): void {
  if (enable !== true) {
    throw new Error(
      "Discord is off by default: nimbus connector auth discord --token <bot_token> --enable  (or set NIMBUS_DISCORD_BOT_TOKEN and pass --enable)",
    );
  }
  p.discordOptIn = true;
  p.personalAccessToken = requirePatFromFlagsOrEnv(
    token,
    ["NIMBUS_DISCORD_BOT_TOKEN"],
    "Discord requires a bot token: nimbus connector auth discord --token <bot_token> --enable  (or set NIMBUS_DISCORD_BOT_TOKEN)",
  );
}

function applyGitlabConnectorAuth(
  p: ConnectorAuthParams,
  token: string | undefined,
  apiBase: string | undefined,
): void {
  p.personalAccessToken = requirePatFromFlagsOrEnv(
    token,
    ["NIMBUS_GITLAB_PAT"],
    "GitLab requires a PAT: nimbus connector auth gitlab --token <pat>  (or set NIMBUS_GITLAB_PAT in the environment)",
  );
  if (apiBase !== undefined) {
    p.apiBaseUrl = apiBase;
  }
}

function applyBitbucketConnectorAuth(
  p: ConnectorAuthParams,
  token: string | undefined,
  username: string | undefined,
): void {
  const u =
    username ??
    process.env["NIMBUS_BITBUCKET_USERNAME"]?.trim() ??
    process.env["BITBUCKET_USERNAME"]?.trim();
  if (u === undefined || u === "") {
    throw new Error(
      "Bitbucket requires username: nimbus connector auth bitbucket --username <atlassian_username> --token <app_password>  (or set NIMBUS_BITBUCKET_USERNAME)",
    );
  }
  const appPass = token ?? process.env["NIMBUS_BITBUCKET_APP_PASSWORD"]?.trim();
  if (appPass === undefined || appPass === "") {
    throw new Error(
      "Bitbucket requires an app password: nimbus connector auth bitbucket --username ... --token <app_password>  (or set NIMBUS_BITBUCKET_APP_PASSWORD)",
    );
  }
  p.bitbucketUsername = u;
  p.personalAccessToken = appPass;
}

function applyJiraConnectorAuth(
  p: ConnectorAuthParams,
  token: string | undefined,
  username: string | undefined,
  apiBase: string | undefined,
): void {
  applyAtlassianSiteConnectorAuth(p, token, username, apiBase, JIRA_CONNECTOR_SITE);
}

function applyConfluenceConnectorAuth(
  p: ConnectorAuthParams,
  token: string | undefined,
  username: string | undefined,
  apiBase: string | undefined,
): void {
  applyAtlassianSiteConnectorAuth(p, token, username, apiBase, CONFLUENCE_CONNECTOR_SITE);
}

function applyJenkinsConnectorAuth(
  p: ConnectorAuthParams,
  token: string | undefined,
  username: string | undefined,
  apiBase: string | undefined,
): void {
  const user = username?.trim() || firstEnvTrimmed(["NIMBUS_JENKINS_USERNAME", "JENKINS_USERNAME"]);
  if (user === "") {
    throw new Error(
      "Jenkins requires --username <user>: nimbus connector auth jenkins --username <user> --token <api_token> --api-base https://ci.example/  (or set NIMBUS_JENKINS_USERNAME)",
    );
  }
  const apiTok =
    token?.trim() || firstEnvTrimmed(["NIMBUS_JENKINS_API_TOKEN", "JENKINS_API_TOKEN"]);
  if (apiTok === "") {
    throw new Error(
      "Jenkins requires an API token: nimbus connector auth jenkins ... --token <api_token>  (or set NIMBUS_JENKINS_API_TOKEN)",
    );
  }
  const baseRaw =
    apiBase?.trim() || firstEnvTrimmed(["NIMBUS_JENKINS_BASE_URL", "JENKINS_BASE_URL"]);
  if (baseRaw === "") {
    throw new Error(
      "Jenkins requires --api-base <url>: nimbus connector auth jenkins ... --api-base https://ci.example/  (or set NIMBUS_JENKINS_BASE_URL)",
    );
  }
  p.username = user;
  p.personalAccessToken = apiTok;
  p.apiBaseUrl = stripTrailingSlashes(baseRaw);
}

async function runConnectorAuth(tail: string[]): Promise<void> {
  const {
    rest,
    port,
    scopes,
    token,
    username,
    apiBase,
    kubeconfig,
    kubeContext,
    enable,
    help,
    awsAccessKey,
    awsSecretKey,
    awsRegion,
    awsProfile,
    azureTenantId,
    azureClientId,
    azureClientSecret,
    gcpCredentialsJson,
    gcpProjectId,
    sentryOrg,
    sentryUrl,
    newrelicAccountId,
    datadogApiKey,
    datadogAppKey,
    datadogSite,
  } = parseFlags(tail);
  const service = rest[0];

  if (help === true) {
    if (service === undefined) {
      printConnectorAuthHelpPointer();
      return;
    }
    const normalized = service.trim().toLowerCase().replaceAll("-", "_");
    printConnectorAuthServiceHelp(normalized);
    return;
  }

  if (service === undefined) {
    throw new Error(
      "Usage: nimbus connector auth <service> [--port <n>] [--scopes a,b] [--token <pat>] [--username <u>] [--api-base <url>] [--enable] [--help]",
    );
  }
  const params: ConnectorAuthParams = { service };
  if (port !== undefined) {
    params.port = port;
  }
  if (scopes !== undefined) {
    params.scopes = scopes;
  }
  const normalized = service.trim().toLowerCase().replaceAll("-", "_");
  switch (normalized) {
    case "linear":
      applyLinearConnectorAuth(params, token);
      break;
    case "github":
      applyGithubConnectorAuth(params, token);
      break;
    case "circleci":
      applyCircleciConnectorAuth(params, token);
      break;
    case "pagerduty":
      applyPagerdutyConnectorAuth(params, token);
      break;
    case "kubernetes":
      applyKubernetesConnectorAuth(params, kubeconfig, kubeContext);
      break;
    case "aws": {
      const awsFlags: {
        awsAccessKey?: string;
        awsSecretKey?: string;
        awsRegion?: string;
        awsProfile?: string;
      } = {};
      if (awsAccessKey !== undefined) {
        awsFlags.awsAccessKey = awsAccessKey;
      }
      if (awsSecretKey !== undefined) {
        awsFlags.awsSecretKey = awsSecretKey;
      }
      if (awsRegion !== undefined) {
        awsFlags.awsRegion = awsRegion;
      }
      if (awsProfile !== undefined) {
        awsFlags.awsProfile = awsProfile;
      }
      applyAwsConnectorAuth(params, awsFlags);
      break;
    }
    case "azure": {
      const azFlags: {
        azureTenantId?: string;
        azureClientId?: string;
        azureClientSecret?: string;
      } = {};
      if (azureTenantId !== undefined) {
        azFlags.azureTenantId = azureTenantId;
      }
      if (azureClientId !== undefined) {
        azFlags.azureClientId = azureClientId;
      }
      if (azureClientSecret !== undefined) {
        azFlags.azureClientSecret = azureClientSecret;
      }
      applyAzureConnectorAuth(params, azFlags);
      break;
    }
    case "gcp": {
      const gcpFlags: { gcpCredentialsJson?: string; gcpProjectId?: string } = {};
      if (gcpCredentialsJson !== undefined) {
        gcpFlags.gcpCredentialsJson = gcpCredentialsJson;
      }
      if (gcpProjectId !== undefined) {
        gcpFlags.gcpProjectId = gcpProjectId;
      }
      applyGcpConnectorAuth(params, gcpFlags);
      break;
    }
    case "iac":
      applyIacConnectorAuth(params, enable);
      break;
    case "grafana":
      applyGrafanaConnectorAuth(params, token, apiBase);
      break;
    case "sentry": {
      const seFlags: { sentryOrg?: string; sentryUrl?: string } = {};
      if (sentryOrg !== undefined) {
        seFlags.sentryOrg = sentryOrg;
      }
      if (sentryUrl !== undefined) {
        seFlags.sentryUrl = sentryUrl;
      }
      applySentryConnectorAuth(params, token, seFlags);
      break;
    }
    case "newrelic": {
      const nrFlags: { newrelicAccountId?: string } = {};
      if (newrelicAccountId !== undefined) {
        nrFlags.newrelicAccountId = newrelicAccountId;
      }
      applyNewrelicConnectorAuth(params, token, nrFlags);
      break;
    }
    case "datadog": {
      const ddFlags: {
        datadogApiKey?: string;
        datadogAppKey?: string;
        datadogSite?: string;
      } = {};
      if (datadogApiKey !== undefined) {
        ddFlags.datadogApiKey = datadogApiKey;
      }
      if (datadogAppKey !== undefined) {
        ddFlags.datadogAppKey = datadogAppKey;
      }
      if (datadogSite !== undefined) {
        ddFlags.datadogSite = datadogSite;
      }
      applyDatadogConnectorAuth(params, ddFlags);
      break;
    }
    case "gitlab":
      applyGitlabConnectorAuth(params, token, apiBase);
      break;
    case "bitbucket":
      applyBitbucketConnectorAuth(params, token, username);
      break;
    case "discord":
      applyDiscordConnectorAuth(params, token, enable);
      break;
    case "jira":
      applyJiraConnectorAuth(params, token, username, apiBase);
      break;
    case "confluence":
      applyConfluenceConnectorAuth(params, token, username, apiBase);
      break;
    case "jenkins":
      applyJenkinsConnectorAuth(params, token, username, apiBase);
      break;
    default:
      break;
  }
  const res = await withIpc((c) =>
    c.call<{ ok: boolean; serviceId: string; scopesGranted: string[] }>("connector.auth", params),
  );
  console.log(`Signed in: ${res.serviceId}`);
  const vaultPatServices = new Set([
    "github",
    "gitlab",
    "bitbucket",
    "linear",
    "jira",
    "confluence",
    "discord",
    "jenkins",
    "circleci",
    "pagerduty",
    "kubernetes",
    "aws",
    "azure",
    "gcp",
    "iac",
    "grafana",
    "sentry",
    "newrelic",
    "datadog",
  ]);
  if (vaultPatServices.has(res.serviceId)) {
    console.log("Credential: stored in the OS vault (no OAuth scopes).");
  } else {
    console.log(`Scopes: ${res.scopesGranted.join(", ")}`);
  }
}

async function runConnectorList(): Promise<void> {
  const rows = await withIpc((c) => c.call<SyncStatus[]>("connector.listStatus"));
  if (rows.length === 0) {
    console.log("No connectors registered yet. Use: nimbus connector auth <service>");
    return;
  }
  const errCap = 48;
  const wService = Math.max(10, "SERVICE".length, ...rows.map((r) => r.serviceId.length));
  const wStatus = Math.max(8, "STATUS".length, ...rows.map((r) => r.status.length));
  const wLast = Math.max(10, "LAST SYNC".length, ...rows.map((r) => relTime(r.lastSyncAt).length));
  const wNext = Math.max(
    10,
    "NEXT SYNC".length,
    ...rows.map((r) => fmtNextSync(r.nextSyncAt).length),
  );
  const wItems = Math.max(5, "ITEMS".length, ...rows.map((r) => String(r.itemCount).length));
  const wFail = Math.max(
    4,
    "FAIL".length,
    ...rows.map((r) => String(r.consecutiveFailures).length),
  );

  const head = `${padField("SERVICE", wService)}  ${padField("STATUS", wStatus)}  ${padField("LAST SYNC", wLast)}  ${padField("NEXT SYNC", wNext)}  ${padField("ITEMS", wItems)}  ${padField("FAIL", wFail)}  ERROR`;
  const ruleLen = head.length + errCap;
  console.log(head);
  console.log(repeatChar("─", ruleLen));
  for (const r of rows) {
    const errRaw = r.lastError ?? "—";
    const err = truncateText(errRaw, errCap);
    const line = `${padField(r.serviceId, wService)}  ${padField(r.status, wStatus)}  ${padField(relTime(r.lastSyncAt), wLast)}  ${padField(fmtNextSync(r.nextSyncAt), wNext)}  ${padField(String(r.itemCount), wItems)}  ${padField(String(r.consecutiveFailures), wFail)}  ${err}`;
    console.log(line);
  }
}

async function runConnectorPause(service: string): Promise<void> {
  await withIpc((c) => c.call("connector.pause", { serviceId: service }));
  console.log(`Paused: ${service}`);
}

async function runConnectorResume(service: string): Promise<void> {
  await withIpc((c) => c.call("connector.resume", { serviceId: service }));
  console.log(`Resumed: ${service}`);
}

function parseStatusArgs(tail: string[]): { service: string; stats: boolean } {
  let stats = false;
  const rest: string[] = [];
  for (const a of tail) {
    if (a === "--stats") {
      stats = true;
    } else {
      rest.push(a);
    }
  }
  const service = rest[0];
  if (service === undefined) {
    throw new Error("Usage: nimbus connector status <service> [--stats]");
  }
  return { service, stats };
}

async function runConnectorStatusParsed(service: string, stats: boolean): Promise<void> {
  const params: { serviceId: string; includeStats?: boolean } = { serviceId: service };
  if (stats) {
    params.includeStats = true;
  }
  const row = await withIpc((c) => c.call<SyncStatusWithTelemetry>("connector.status", params));
  console.log(JSON.stringify(row, null, 2));
}

async function runConnectorLifecycle(sub: string, tail: string[]): Promise<void> {
  if (sub === "status") {
    const { service, stats } = parseStatusArgs(tail);
    await runConnectorStatusParsed(service, stats);
    return;
  }
  const service = tail[0];
  if (service === undefined) {
    throw new Error(`Usage: nimbus connector ${sub} <service>`);
  }
  if (sub === "pause") {
    await runConnectorPause(service);
    return;
  }
  if (sub === "resume") {
    await runConnectorResume(service);
    return;
  }
}

async function runConnectorSetInterval(tail: string[]): Promise<void> {
  const service = tail[0];
  const dur = tail[1];
  if (service === undefined || dur === undefined) {
    throw new Error("Usage: nimbus connector set-interval <service> <duration>  (e.g. 5m, 1h)");
  }
  const ms = parseDurationToMs(dur);
  await withIpc((c) => c.call("connector.setInterval", { serviceId: service, intervalMs: ms }));
  console.log(`Interval set: ${service} → ${dur} (${String(ms)} ms)`);
}

async function runConnectorSync(tail: string[]): Promise<void> {
  const { rest, full } = parseFlags(tail);
  const service = rest[0];
  if (service === undefined) {
    throw new Error("Usage: nimbus connector sync <service> [--full]");
  }
  let syncParams: { serviceId: string; full?: boolean };
  if (full === true) {
    syncParams = { serviceId: service, full: true };
  } else {
    syncParams = { serviceId: service };
  }
  await withIpc((c) => c.call("connector.sync", syncParams));
  const suffix = full === true ? " (full)" : "";
  console.log(`Sync requested: ${service}${suffix}`);
}

async function runConnectorAddMcp(tail: string[]): Promise<void> {
  const id = tail[0]?.trim() ?? "";
  const commandLine = tail.slice(1).join(" ").trim();
  if (id === "" || commandLine === "") {
    throw new Error(
      "Usage: nimbus connector add --mcp <mcp_id> <command...>\nExample: nimbus connector add --mcp mcp_brave npx -y @some/mcp-server",
    );
  }
  await withIpc((c) => c.call("connector.addMcp", { serviceId: id, commandLine }));
  console.log(`Registered user MCP connector: ${id}`);
}

async function runConnectorRemove(tail: string[]): Promise<void> {
  const service = tail[0];
  if (service === undefined) {
    throw new Error("Usage: nimbus connector remove <service>");
  }
  const res = await withIpc((c) =>
    c.call<{ ok: boolean; itemsDeleted: number; vaultKeysRemoved: string[] }>("connector.remove", {
      serviceId: service,
    }),
  );
  console.log(`Removed index rows: ${String(res.itemsDeleted)}`);
  if (res.vaultKeysRemoved.length > 0) {
    console.log(`Cleared vault keys: ${res.vaultKeysRemoved.join(", ")}`);
  }
}

export async function runConnector(args: string[]): Promise<void> {
  const sub = args[0];
  const tail = args.slice(1);

  if (sub === undefined || sub === "help" || sub === "--help" || sub === "-h") {
    printConnectorHelp();
    return;
  }

  if (sub === "auth") {
    await runConnectorAuth(tail);
    return;
  }
  if (sub === "add") {
    const mode = tail[0]?.trim() ?? "";
    if (mode === "--mcp") {
      await runConnectorAddMcp(tail.slice(1));
      return;
    }
    throw new Error("Usage: nimbus connector add --mcp <mcp_id> <command...>");
  }
  if (sub === "list") {
    await runConnectorList();
    return;
  }
  if (sub === "pause" || sub === "resume" || sub === "status") {
    await runConnectorLifecycle(sub, tail);
    return;
  }
  if (sub === "set-interval") {
    await runConnectorSetInterval(tail);
    return;
  }
  if (sub === "sync") {
    await runConnectorSync(tail);
    return;
  }
  if (sub === "remove") {
    await runConnectorRemove(tail);
    return;
  }

  throw new Error(`Unknown connector subcommand: ${sub}. Try: nimbus connector help`);
}

function printConnectorHelp(): void {
  console.log(`nimbus connector — cloud connector registration and sync (Q2)

Usage:
  nimbus connector auth <service> [--port <n>] [--scopes a,b] [--token <pat>] [--api-base <url>] [--help]
  nimbus connector add --mcp <mcp_id> <command...>   Register a user MCP server (id must be mcp_*)
  nimbus connector list
  nimbus connector status <service> [--stats]
  nimbus connector sync <service> [--full]
  nimbus connector pause <service>
  nimbus connector resume <service>
  nimbus connector set-interval <service> <duration>
  nimbus connector remove <service>

Services (examples): google_drive, gmail, google_photos, onedrive, outlook, teams, github, gitlab, linear, jira, notion, confluence, jenkins, circleci, pagerduty, kubernetes

OAuth PKCE — set env vars before nimbus start, or run for setup steps:
  nimbus connector auth google_drive --help    (gmail, google_photos)
  nimbus connector auth onedrive --help        (outlook, teams)
  nimbus connector auth slack --help
  nimbus connector auth notion --help

Env vars: NIMBUS_OAUTH_GOOGLE_CLIENT_ID, NIMBUS_OAUTH_GOOGLE_CLIENT_SECRET (Web OAuth clients only), NIMBUS_OAUTH_MICROSOFT_CLIENT_ID, NIMBUS_OAUTH_SLACK_CLIENT_ID,
  NIMBUS_OAUTH_NOTION_CLIENT_ID, NIMBUS_OAUTH_NOTION_CLIENT_SECRET
`);
  console.log(`GitHub: use --token or env NIMBUS_GITHUB_PAT (stored as vault key github.pat). Also registers GitHub Actions sync (service id github_actions) with the same PAT.
GitLab: use --token or env NIMBUS_GITLAB_PAT (gitlab.pat). Self-hosted: --api-base https://git.example.com/api/v4 (gitlab.api_base).
Linear: use --token or env NIMBUS_LINEAR_API_KEY (linear.api_key).
`);
  console.log(`Jira: use --username (Atlassian email), --token (API token), --api-base https://your-domain.atlassian.net
  or env NIMBUS_JIRA_EMAIL, NIMBUS_JIRA_API_TOKEN, NIMBUS_JIRA_BASE_URL (jira.email, jira.api_token, jira.base_url).
Notion: OAuth in the browser (notion.oauth); see auth notion --help for env setup.
Confluence: same flags/env pattern as Jira (NIMBUS_CONFLUENCE_* → confluence.email, confluence.api_token, confluence.base_url).
`);
  console.log(`Jenkins: --username, --token (API token), --api-base https://ci.example/  or env NIMBUS_JENKINS_USERNAME, NIMBUS_JENKINS_API_TOKEN, NIMBUS_JENKINS_BASE_URL (jenkins.username, jenkins.api_token, jenkins.base_url).
CircleCI: --token (personal API token) or env NIMBUS_CIRCLECI_API_TOKEN / CIRCLECI_TOKEN (vault key circleci.api_token). Indexes pipelines for GitHub repos already in the local index (project slug gh/owner/repo).
`);
  const pdEnv = "NIMBUS_PAGERDUTY_API_TOKEN";
  const pdAlt = "PAGERDUTY_API_TOKEN";
  console.log(
    `PagerDuty: --token (REST API token) or env ${pdEnv} / ${pdAlt} (vault key pagerduty.api_token). Indexes open incidents for search.`,
  );
  console.log(`Kubernetes: --kubeconfig <path> [--context <name>] or env NIMBUS_KUBECONFIG / KUBECONFIG (vault keys kubernetes.kubeconfig, optional kubernetes.context). Indexes cluster deployments.

Credentials are stored in the OS vault only (never printed here).
`);
}
