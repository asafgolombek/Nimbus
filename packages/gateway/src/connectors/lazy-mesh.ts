import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { MCPClient } from "@mastra/mcp";

import {
  anyGoogleOAuthVaultPresent,
  type GoogleConnectorOAuthServiceId,
  getValidGoogleAccessToken,
  resolveGoogleOAuthVaultKey,
} from "../auth/google-access-token.ts";
import { getValidMicrosoftAccessToken } from "../auth/microsoft-access-token.ts";
import { getValidNotionAccessToken } from "../auth/notion-access-token.ts";
import { readMicrosoftOAuthScopesForOutlookEnv } from "../auth/oauth-vault-tokens.ts";
import { getValidSlackAccessToken } from "../auth/slack-access-token.ts";
import { wrapToolOutput } from "../engine/tool-output-envelope.ts";
import { extensionProcessEnv } from "../extensions/spawn-env.ts";
import type { PlatformPaths } from "../platform/paths.ts";
import { stripTrailingSlashes } from "../string/strip-trailing-slashes.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import type { UserMcpConnectorRow } from "./user-mcp-store.ts";

const _LAZY_MESH_DIR = dirname(fileURLToPath(import.meta.url));
const MCP_CONNECTORS_ROOT = join(_LAZY_MESH_DIR, "..", "..", "..", "mcp-connectors");

function mcpConnectorServerScript(packageDir: string): string {
  return join(MCP_CONNECTORS_ROOT, packageDir, "src", "server.ts");
}

/**
 * S8-F7 — per-slot in-flight refcount with awaitable drain.
 * Used by LazyConnectorMesh to defer disconnect while tool calls are running.
 */
export class LazyDrainTracker {
  private inFlight = 0;
  private resolveDrained: (() => void) | undefined;
  private drained: Promise<void> | undefined;

  bump(): void {
    this.inFlight += 1;
    this.drained ??= new Promise<void>((r) => {
      this.resolveDrained = r;
    });
  }

  drop(): void {
    if (this.inFlight > 0) this.inFlight -= 1;
    if (this.inFlight === 0 && this.resolveDrained !== undefined) {
      this.resolveDrained();
      this.drained = undefined;
      this.resolveDrained = undefined;
    }
  }

  awaitDrain(): Promise<void> {
    return this.drained ?? Promise.resolve();
  }

  get count(): number {
    return this.inFlight;
  }
}

/**
 * S8-F4 — explicit collision detection. The Mastra per-server prefix should
 * structurally prevent collisions (mcp_* prefix on user MCPs vs. built-in
 * server names without that prefix), but a future Mastra change or a manual
 * misconfiguration could regress to a silent override. Fail loud.
 */
export function mergeToolMapsOrThrow(
  sources: ReadonlyArray<{ map: LazyMeshToolMap; name: string }>,
): LazyMeshToolMap {
  const merged: LazyMeshToolMap = {};
  const owners: Record<string, string> = {};
  for (const { map, name } of sources) {
    for (const [key, value] of Object.entries(map)) {
      if (key in merged) {
        throw new Error(
          `MCP tool-name collision: ${key} provided by both ${owners[key]} and ${name}`,
        );
      }
      merged[key] = value;
      owners[key] = name;
    }
  }
  return merged;
}

type LazyMcpSlot = {
  client: MCPClient | undefined;
  idleTimer: ReturnType<typeof setTimeout> | undefined;
  /** S8-F7 — per-slot in-flight refcount. */
  drain: LazyDrainTracker;
};

const LAZY_MESH = {
  googleBundle: "mesh:google-bundle",
  microsoftBundle: "mesh:microsoft-bundle",
  github: "mesh:github",
  gitlab: "mesh:gitlab",
  bitbucket: "mesh:bitbucket",
  slack: "mesh:slack",
  linear: "mesh:linear",
  jira: "mesh:jira",
  notion: "mesh:notion",
  confluence: "mesh:confluence",
  discord: "mesh:discord",
  jenkins: "mesh:jenkins",
  circleci: "mesh:circleci",
  pagerduty: "mesh:pagerduty",
  kubernetes: "mesh:kubernetes",
  phase3Bundle: "mesh:phase3-bundle",
} as const;

const USER_MESH_PREFIX = "mesh:user:";

function userMcpMeshKey(serviceId: string): string {
  return `${USER_MESH_PREFIX}${serviceId}`;
}

type LazyMeshToolMap = Record<
  string,
  { execute?: (input: unknown, context?: unknown) => Promise<unknown> }
>;

async function listLazyMeshClientTools(client: MCPClient | undefined): Promise<LazyMeshToolMap> {
  if (client === undefined) {
    return {};
  }
  return (await client.listTools()) as LazyMeshToolMap;
}

/**
 * Eager filesystem MCP + lazily spawned Google MCP bundle (Drive + Gmail + Photos) + Microsoft bundle (OneDrive + Outlook + Teams) + GitHub (includes GitHub Actions MCP child) / GitLab / Bitbucket / Slack / Linear / Jira / Notion / Confluence / Jenkins / CircleCI / PagerDuty / Kubernetes credential MCP when vault keys exist; Phase 3 bundle (AWS, Azure, GCP, IaC, Grafana, Sentry, New Relic, Datadog) when matching vault keys exist; Discord MCP when **`discord.enabled`** + **`discord.bot_token`** are set (Q2 §1.6 / Phase 2–5 + §4.3).
 */
export class LazyConnectorMesh {
  private readonly filesystem: MCPClient;
  /** Lazy MCP stdio children: built-in bundles use `LAZY_MESH.*`; user MCP uses `mesh:user:<serviceId>`. */
  private readonly lazySlots = new Map<string, LazyMcpSlot>();
  private readonly listUserMcpConnectors: () => readonly UserMcpConnectorRow[];
  private readonly inactivityMs: number;
  private toolsEpoch = 0;

  constructor(
    paths: PlatformPaths,
    private readonly vault: NimbusVault,
    options?: {
      inactivityMs?: number;
      listUserMcpConnectors?: () => readonly UserMcpConnectorRow[];
    },
  ) {
    this.inactivityMs = options?.inactivityMs ?? 300_000;
    this.listUserMcpConnectors = options?.listUserMcpConnectors ?? (() => []);
    this.filesystem = new MCPClient({
      servers: {
        filesystem: {
          command: "bunx",
          args: ["@modelcontextprotocol/server-filesystem", paths.dataDir],
          env: extensionProcessEnv({}),
        },
      },
    });
  }

  getToolsEpoch(): number {
    return this.toolsEpoch;
  }

  private bumpToolsEpoch(): void {
    this.toolsEpoch += 1;
  }

  private lazySlot(key: string): LazyMcpSlot {
    let s = this.lazySlots.get(key);
    if (s === undefined) {
      s = { client: undefined, idleTimer: undefined, drain: new LazyDrainTracker() };
      this.lazySlots.set(key, s);
    }
    return s;
  }

  private getLazyClient(key: string): MCPClient | undefined {
    return this.lazySlots.get(key)?.client ?? undefined;
  }

  private setLazyClient(key: string, client: MCPClient): void {
    this.lazySlot(key).client = client;
  }

  private clearLazyIdle(key: string): void {
    const s = this.lazySlots.get(key);
    if (s?.idleTimer !== undefined) {
      clearTimeout(s.idleTimer);
      s.idleTimer = undefined;
    }
  }

  private scheduleLazyDisconnect(key: string): void {
    this.clearLazyIdle(key);
    const slot = this.lazySlot(key);
    slot.idleTimer = setTimeout(() => {
      slot.idleTimer = undefined;
      void this.stopLazyClient(key);
    }, this.inactivityMs);
  }

  private async stopLazyClient(key: string): Promise<void> {
    this.clearLazyIdle(key);
    const slot = this.lazySlots.get(key);
    if (slot === undefined) {
      return;
    }
    // S8-F7 — wait for in-flight calls before tearing down. Hard cap at
    // 10 minutes total so a stuck tool call cannot indefinitely defer
    // disconnect; beyond that, force-disconnect anyway.
    if (slot.drain.count > 0) {
      await Promise.race([
        slot.drain.awaitDrain(),
        new Promise<void>((r) => setTimeout(r, 10 * 60_000)),
      ]);
    }
    const c = slot.client;
    slot.client = undefined;
    if (slot.idleTimer === undefined) {
      this.lazySlots.delete(key);
    }
    if (c !== undefined) {
      this.bumpToolsEpoch();
      try {
        await c.disconnect();
      } catch {
        /* ignore */
      }
    }
  }

  private async stopUserMcpClient(serviceId: string): Promise<void> {
    await this.stopLazyClient(userMcpMeshKey(serviceId));
  }

  private mcpServerKeyForUserConnector(serviceId: string): string {
    return serviceId.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
  }

  private async ensureUserMcpClient(row: UserMcpConnectorRow): Promise<void> {
    const meshKey = userMcpMeshKey(row.service_id);
    this.clearLazyIdle(meshKey);
    if (this.getLazyClient(meshKey) !== undefined) {
      this.scheduleLazyDisconnect(meshKey);
      return;
    }
    let args: string[];
    try {
      const parsed: unknown = JSON.parse(row.args_json);
      if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === "string")) {
        return;
      }
      args = parsed;
    } catch {
      return;
    }
    const key = this.mcpServerKeyForUserConnector(row.service_id);
    const client = new MCPClient({
      id: `nimbus-user-mcp-${row.service_id}-${String(Date.now())}`,
      servers: {
        [key]: {
          command: row.command,
          args,
          env: extensionProcessEnv({}),
        },
      },
    });
    this.setLazyClient(meshKey, client);
    this.bumpToolsEpoch();
    this.scheduleLazyDisconnect(meshKey);
  }

  private async ensureUserMcpConnectorsRunning(): Promise<void> {
    const rows = this.listUserMcpConnectors();
    const active = new Set(rows.map((r) => r.service_id));
    for (const key of this.lazySlots.keys()) {
      if (!key.startsWith(USER_MESH_PREFIX)) {
        continue;
      }
      const id = key.slice(USER_MESH_PREFIX.length);
      if (!active.has(id)) {
        await this.stopUserMcpClient(id);
      }
    }
    for (const row of rows) {
      await this.ensureUserMcpClient(row);
    }
  }

  /** Ensures the persisted user MCP server for `serviceId` is spawned (sync + agent tool listing). */
  async ensureUserMcpRunning(serviceId: string): Promise<void> {
    const rows = this.listUserMcpConnectors();
    const row = rows.find((r) => r.service_id === serviceId);
    if (row === undefined) {
      return;
    }
    await this.ensureUserMcpClient(row);
  }

  private async phase3AddAwsMcp(
    servers: Record<string, { command: string; args: string[]; env: Record<string, string> }>,
  ): Promise<void> {
    const ak = (await this.vault.get("aws.access_key_id"))?.trim() ?? "";
    const sk = (await this.vault.get("aws.secret_access_key"))?.trim() ?? "";
    const reg = (await this.vault.get("aws.default_region"))?.trim() ?? "";
    const prof = (await this.vault.get("aws.profile"))?.trim() ?? "";
    const awsOk =
      (ak !== "" && sk !== "" && (reg !== "" || prof !== "")) || (prof !== "" && ak === "");
    if (!awsOk) {
      return;
    }
    const extra: Record<string, string> = {};
    if (ak !== "") {
      extra["AWS_ACCESS_KEY_ID"] = ak;
    }
    if (sk !== "") {
      extra["AWS_SECRET_ACCESS_KEY"] = sk;
    }
    if (reg !== "") {
      extra["AWS_DEFAULT_REGION"] = reg;
    }
    if (prof !== "") {
      extra["AWS_PROFILE"] = prof;
    }
    servers["aws"] = {
      command: "bun",
      args: [mcpConnectorServerScript("aws")],
      env: extensionProcessEnv(extra),
    };
  }

  private async phase3AddAzureMcp(
    servers: Record<string, { command: string; args: string[]; env: Record<string, string> }>,
  ): Promise<void> {
    const azT = (await this.vault.get("azure.tenant_id"))?.trim() ?? "";
    const azC = (await this.vault.get("azure.client_id"))?.trim() ?? "";
    const azS = (await this.vault.get("azure.client_secret"))?.trim() ?? "";
    if (azT === "" || azC === "" || azS === "") {
      return;
    }
    servers["azure"] = {
      command: "bun",
      args: [mcpConnectorServerScript("azure")],
      env: extensionProcessEnv({
        AZURE_TENANT_ID: azT,
        AZURE_CLIENT_ID: azC,
        AZURE_CLIENT_SECRET: azS,
      }),
    };
  }

  private async phase3AddGcpMcp(
    servers: Record<string, { command: string; args: string[]; env: Record<string, string> }>,
  ): Promise<void> {
    const gcpPath = (await this.vault.get("gcp.credentials_json_path"))?.trim() ?? "";
    if (gcpPath === "") {
      return;
    }
    servers["gcp"] = {
      command: "bun",
      args: [mcpConnectorServerScript("gcp")],
      env: extensionProcessEnv({ GOOGLE_APPLICATION_CREDENTIALS: gcpPath }),
    };
  }

  private async phase3AddIacMcp(
    servers: Record<string, { command: string; args: string[]; env: Record<string, string> }>,
  ): Promise<void> {
    const iacEn = await this.vault.get("iac.enabled");
    if (iacEn !== "1") {
      return;
    }
    servers["iac"] = {
      command: "bun",
      args: [mcpConnectorServerScript("iac")],
      env: extensionProcessEnv({}),
    };
  }

  private async phase3AddGrafanaMcp(
    servers: Record<string, { command: string; args: string[]; env: Record<string, string> }>,
  ): Promise<void> {
    const gfu = (await this.vault.get("grafana.url"))?.trim() ?? "";
    const gtk = (await this.vault.get("grafana.api_token"))?.trim() ?? "";
    if (gfu === "" || gtk === "") {
      return;
    }
    servers["grafana"] = {
      command: "bun",
      args: [mcpConnectorServerScript("grafana")],
      env: extensionProcessEnv({ GRAFANA_URL: gfu, GRAFANA_API_TOKEN: gtk }),
    };
  }

  private async phase3AddSentryMcp(
    servers: Record<string, { command: string; args: string[]; env: Record<string, string> }>,
  ): Promise<void> {
    const sentTok = (await this.vault.get("sentry.auth_token"))?.trim() ?? "";
    const sentOrg = (await this.vault.get("sentry.org_slug"))?.trim() ?? "";
    if (sentTok === "" || sentOrg === "") {
      return;
    }
    const extra: Record<string, string> = {
      SENTRY_AUTH_TOKEN: sentTok,
      SENTRY_ORG_SLUG: sentOrg,
    };
    const surl = (await this.vault.get("sentry.url"))?.trim() ?? "";
    if (surl !== "") {
      extra["SENTRY_URL"] = surl;
    }
    servers["sentry"] = {
      command: "bun",
      args: [mcpConnectorServerScript("sentry")],
      env: extensionProcessEnv(extra),
    };
  }

  private async phase3AddNewrelicMcp(
    servers: Record<string, { command: string; args: string[]; env: Record<string, string> }>,
  ): Promise<void> {
    const nrKey = (await this.vault.get("newrelic.api_key"))?.trim() ?? "";
    if (nrKey === "") {
      return;
    }
    servers["newrelic"] = {
      command: "bun",
      args: [mcpConnectorServerScript("newrelic")],
      env: extensionProcessEnv({ NEW_RELIC_API_KEY: nrKey }),
    };
  }

  private async phase3AddDatadogMcp(
    servers: Record<string, { command: string; args: string[]; env: Record<string, string> }>,
  ): Promise<void> {
    const ddKey = (await this.vault.get("datadog.api_key"))?.trim() ?? "";
    const ddApp = (await this.vault.get("datadog.app_key"))?.trim() ?? "";
    if (ddKey === "" || ddApp === "") {
      return;
    }
    const extra: Record<string, string> = {
      DD_API_KEY: ddKey,
      DD_APP_KEY: ddApp,
    };
    const site = (await this.vault.get("datadog.site"))?.trim() ?? "";
    if (site !== "") {
      extra["DD_SITE"] = site;
    }
    servers["datadog"] = {
      command: "bun",
      args: [mcpConnectorServerScript("datadog")],
      env: extensionProcessEnv(extra),
    };
  }

  private async buildPhase3Servers(): Promise<
    Record<string, { command: string; args: string[]; env: Record<string, string> }>
  > {
    const servers: Record<
      string,
      { command: string; args: string[]; env: Record<string, string> }
    > = {};
    await this.phase3AddAwsMcp(servers);
    await this.phase3AddAzureMcp(servers);
    await this.phase3AddGcpMcp(servers);
    await this.phase3AddIacMcp(servers);
    await this.phase3AddGrafanaMcp(servers);
    await this.phase3AddSentryMcp(servers);
    await this.phase3AddNewrelicMcp(servers);
    await this.phase3AddDatadogMcp(servers);
    return servers;
  }

  /**
   * Starts the Phase 3 MCP bundle (any of AWS / Azure / GCP / IaC / observability) when vault keys are present.
   */
  async ensurePhase3BundleRunning(): Promise<void> {
    const slotKey = LAZY_MESH.phase3Bundle;
    this.clearLazyIdle(slotKey);
    if (this.getLazyClient(slotKey) !== undefined) {
      this.scheduleLazyDisconnect(slotKey);
      return;
    }
    const servers = await this.buildPhase3Servers();
    if (Object.keys(servers).length === 0) {
      return;
    }
    this.setLazyClient(
      slotKey,
      new MCPClient({
        id: `nimbus-phase3-${String(Date.now())}`,
        servers,
      }),
    );
    this.bumpToolsEpoch();
    this.scheduleLazyDisconnect(slotKey);
  }

  /**
   * Starts Google Drive / Gmail / Google Photos MCP subprocesses for which a vault
   * token exists (per-service keys or legacy `google.oauth`). Each server gets its own access token.
   */
  async ensureGoogleDriveRunning(): Promise<void> {
    const slotKey = LAZY_MESH.googleBundle;
    this.clearLazyIdle(slotKey);
    if (this.getLazyClient(slotKey) !== undefined) {
      this.scheduleLazyDisconnect(slotKey);
      return;
    }
    const googleServers: Record<
      string,
      { command: string; args: string[]; env: Record<string, string> }
    > = {};
    const ids: GoogleConnectorOAuthServiceId[] = ["google_drive", "gmail", "google_photos"];
    for (const id of ids) {
      const resolved = await resolveGoogleOAuthVaultKey(this.vault, id);
      if (resolved === null) {
        continue;
      }
      const token = await getValidGoogleAccessToken(this.vault, id);
      if (id === "google_drive") {
        googleServers["google_drive"] = {
          command: "bun",
          args: [mcpConnectorServerScript("google-drive")],
          env: extensionProcessEnv({ GOOGLE_OAUTH_ACCESS_TOKEN: token }),
        };
      } else if (id === "gmail") {
        googleServers["gmail"] = {
          command: "bun",
          args: [mcpConnectorServerScript("gmail")],
          env: extensionProcessEnv({ GOOGLE_OAUTH_ACCESS_TOKEN: token }),
        };
      } else {
        googleServers["google_photos"] = {
          command: "bun",
          args: [mcpConnectorServerScript("google-photos")],
          env: extensionProcessEnv({ GOOGLE_OAUTH_ACCESS_TOKEN: token }),
        };
      }
    }
    if (Object.keys(googleServers).length === 0) {
      return;
    }
    this.setLazyClient(
      slotKey,
      new MCPClient({
        id: `nimbus-google-${String(Date.now())}`,
        servers: googleServers,
      }),
    );
    this.bumpToolsEpoch();
    this.scheduleLazyDisconnect(slotKey);
  }

  /**
   * Starts OneDrive + Outlook + Teams MCP subprocesses when `microsoft.oauth` is present (shared token).
   */
  async ensureMicrosoftBundleRunning(): Promise<void> {
    const slotKey = LAZY_MESH.microsoftBundle;
    this.clearLazyIdle(slotKey);
    if (this.getLazyClient(slotKey) !== undefined) {
      this.scheduleLazyDisconnect(slotKey);
      return;
    }
    const token = await getValidMicrosoftAccessToken(this.vault);
    const outlookScopes = await readMicrosoftOAuthScopesForOutlookEnv(this.vault);
    const outlookEnv = extensionProcessEnv({
      MICROSOFT_OAUTH_ACCESS_TOKEN: token,
      ...(outlookScopes === undefined ? {} : { MICROSOFT_OAUTH_SCOPES: outlookScopes }),
    });
    this.setLazyClient(
      slotKey,
      new MCPClient({
        id: `nimbus-ms-${String(Date.now())}`,
        servers: {
          onedrive: {
            command: "bun",
            args: [mcpConnectorServerScript("onedrive")],
            env: extensionProcessEnv({ MICROSOFT_OAUTH_ACCESS_TOKEN: token }),
          },
          outlook: {
            command: "bun",
            args: [mcpConnectorServerScript("outlook")],
            env: outlookEnv,
          },
          teams: {
            command: "bun",
            args: [mcpConnectorServerScript("teams")],
            env: extensionProcessEnv({ MICROSOFT_OAUTH_ACCESS_TOKEN: token }),
          },
        },
      }),
    );
    this.bumpToolsEpoch();
    this.scheduleLazyDisconnect(slotKey);
  }

  /**
   * Starts GitHub MCP when `github.pat` is present in the Vault.
   */
  async ensureGithubRunning(): Promise<void> {
    const slotKey = LAZY_MESH.github;
    this.clearLazyIdle(slotKey);
    if (this.getLazyClient(slotKey) !== undefined) {
      this.scheduleLazyDisconnect(slotKey);
      return;
    }
    const pat = await this.vault.get("github.pat");
    if (pat === null || pat === "") {
      return;
    }
    this.setLazyClient(
      slotKey,
      new MCPClient({
        id: `nimbus-github-${String(Date.now())}`,
        servers: {
          github: {
            command: "bun",
            args: [mcpConnectorServerScript("github")],
            env: extensionProcessEnv({ GITHUB_PAT: pat }),
          },
          github_actions: {
            command: "bun",
            args: [mcpConnectorServerScript("github-actions")],
            env: extensionProcessEnv({ GITHUB_PAT: pat }),
          },
        },
      }),
    );
    this.bumpToolsEpoch();
    this.scheduleLazyDisconnect(slotKey);
  }

  /**
   * Starts GitLab MCP when `gitlab.pat` is present in the Vault.
   */
  async ensureGitlabRunning(): Promise<void> {
    const slotKey = LAZY_MESH.gitlab;
    this.clearLazyIdle(slotKey);
    if (this.getLazyClient(slotKey) !== undefined) {
      this.scheduleLazyDisconnect(slotKey);
      return;
    }
    const pat = await this.vault.get("gitlab.pat");
    if (pat === null || pat === "") {
      return;
    }
    const apiBase = await this.vault.get("gitlab.api_base");
    const trimmedBase =
      apiBase !== null && apiBase.trim() !== "" ? stripTrailingSlashes(apiBase) : null;
    const gitlabServerEnv = extensionProcessEnv(
      trimmedBase === null
        ? { GITLAB_PAT: pat }
        : { GITLAB_PAT: pat, GITLAB_API_BASE_URL: trimmedBase },
    );
    this.setLazyClient(
      slotKey,
      new MCPClient({
        id: `nimbus-gitlab-${String(Date.now())}`,
        servers: {
          gitlab: {
            command: "bun",
            args: [mcpConnectorServerScript("gitlab")],
            env: gitlabServerEnv,
          },
        },
      }),
    );
    this.bumpToolsEpoch();
    this.scheduleLazyDisconnect(slotKey);
  }

  /**
   * Starts Bitbucket Cloud MCP when `bitbucket.username` + `bitbucket.app_password` exist in the Vault.
   */
  async ensureBitbucketRunning(): Promise<void> {
    const slotKey = LAZY_MESH.bitbucket;
    this.clearLazyIdle(slotKey);
    if (this.getLazyClient(slotKey) !== undefined) {
      this.scheduleLazyDisconnect(slotKey);
      return;
    }
    const user = await this.vault.get("bitbucket.username");
    const pass = await this.vault.get("bitbucket.app_password");
    if (user === null || user === "" || pass === null || pass === "") {
      return;
    }
    this.setLazyClient(
      slotKey,
      new MCPClient({
        id: `nimbus-bitbucket-${String(Date.now())}`,
        servers: {
          bitbucket: {
            command: "bun",
            args: [mcpConnectorServerScript("bitbucket")],
            env: extensionProcessEnv({
              BITBUCKET_USERNAME: user,
              BITBUCKET_APP_PASSWORD: pass,
            }),
          },
        },
      }),
    );
    this.bumpToolsEpoch();
    this.scheduleLazyDisconnect(slotKey);
  }

  /**
   * Starts Slack MCP when `slack.oauth` is present in the Vault.
   */
  async ensureSlackRunning(): Promise<void> {
    const slotKey = LAZY_MESH.slack;
    this.clearLazyIdle(slotKey);
    if (this.getLazyClient(slotKey) !== undefined) {
      this.scheduleLazyDisconnect(slotKey);
      return;
    }
    let token: string;
    try {
      token = await getValidSlackAccessToken(this.vault);
    } catch {
      return;
    }
    if (token === "") {
      return;
    }
    this.setLazyClient(
      slotKey,
      new MCPClient({
        id: `nimbus-slack-${String(Date.now())}`,
        servers: {
          slack: {
            command: "bun",
            args: [mcpConnectorServerScript("slack")],
            env: extensionProcessEnv({ SLACK_USER_ACCESS_TOKEN: token }),
          },
        },
      }),
    );
    this.bumpToolsEpoch();
    this.scheduleLazyDisconnect(slotKey);
  }

  /**
   * Starts Linear MCP when `linear.api_key` is present in the Vault.
   */
  async ensureLinearRunning(): Promise<void> {
    const slotKey = LAZY_MESH.linear;
    this.clearLazyIdle(slotKey);
    if (this.getLazyClient(slotKey) !== undefined) {
      this.scheduleLazyDisconnect(slotKey);
      return;
    }
    const apiKey = await this.vault.get("linear.api_key");
    if (apiKey === null || apiKey === "") {
      return;
    }
    this.setLazyClient(
      slotKey,
      new MCPClient({
        id: `nimbus-linear-${String(Date.now())}`,
        servers: {
          linear: {
            command: "bun",
            args: [mcpConnectorServerScript("linear")],
            env: extensionProcessEnv({ LINEAR_API_KEY: apiKey }),
          },
        },
      }),
    );
    this.bumpToolsEpoch();
    this.scheduleLazyDisconnect(slotKey);
  }

  /**
   * Starts Jira MCP when `jira.api_token`, `jira.email`, and `jira.base_url` are present in the Vault.
   */
  async ensureJiraRunning(): Promise<void> {
    const slotKey = LAZY_MESH.jira;
    this.clearLazyIdle(slotKey);
    if (this.getLazyClient(slotKey) !== undefined) {
      this.scheduleLazyDisconnect(slotKey);
      return;
    }
    const token = await this.vault.get("jira.api_token");
    const email = await this.vault.get("jira.email");
    const baseUrl = await this.vault.get("jira.base_url");
    if (
      token === null ||
      token === "" ||
      email === null ||
      email === "" ||
      baseUrl === null ||
      baseUrl === ""
    ) {
      return;
    }
    this.setLazyClient(
      slotKey,
      new MCPClient({
        id: `nimbus-jira-${String(Date.now())}`,
        servers: {
          jira: {
            command: "bun",
            args: [mcpConnectorServerScript("jira")],
            env: extensionProcessEnv({
              JIRA_API_TOKEN: token,
              JIRA_EMAIL: email,
              JIRA_BASE_URL: baseUrl,
            }),
          },
        },
      }),
    );
    this.bumpToolsEpoch();
    this.scheduleLazyDisconnect(slotKey);
  }

  /**
   * Starts Notion MCP when `notion.oauth` is present and a valid access token can be resolved.
   */
  async ensureNotionRunning(): Promise<void> {
    const slotKey = LAZY_MESH.notion;
    this.clearLazyIdle(slotKey);
    if (this.getLazyClient(slotKey) !== undefined) {
      this.scheduleLazyDisconnect(slotKey);
      return;
    }
    const raw = await this.vault.get("notion.oauth");
    if (raw === null || raw === "") {
      return;
    }
    let accessToken: string;
    try {
      accessToken = await getValidNotionAccessToken(this.vault);
    } catch {
      return;
    }
    if (accessToken === "") {
      return;
    }
    this.setLazyClient(
      slotKey,
      new MCPClient({
        id: `nimbus-notion-${String(Date.now())}`,
        servers: {
          notion: {
            command: "bun",
            args: [mcpConnectorServerScript("notion")],
            env: extensionProcessEnv({ NOTION_ACCESS_TOKEN: accessToken }),
          },
        },
      }),
    );
    this.bumpToolsEpoch();
    this.scheduleLazyDisconnect(slotKey);
  }

  /**
   * Starts Confluence MCP when Confluence vault keys are present.
   */
  async ensureConfluenceRunning(): Promise<void> {
    const slotKey = LAZY_MESH.confluence;
    this.clearLazyIdle(slotKey);
    if (this.getLazyClient(slotKey) !== undefined) {
      this.scheduleLazyDisconnect(slotKey);
      return;
    }
    const token = await this.vault.get("confluence.api_token");
    const em = await this.vault.get("confluence.email");
    const baseUrl = await this.vault.get("confluence.base_url");
    if (
      token === null ||
      token === "" ||
      em === null ||
      em === "" ||
      baseUrl === null ||
      baseUrl === ""
    ) {
      return;
    }
    this.setLazyClient(
      slotKey,
      new MCPClient({
        id: `nimbus-confluence-${String(Date.now())}`,
        servers: {
          confluence: {
            command: "bun",
            args: [mcpConnectorServerScript("confluence")],
            env: extensionProcessEnv({
              CONFLUENCE_API_TOKEN: token,
              CONFLUENCE_EMAIL: em,
              CONFLUENCE_BASE_URL: baseUrl,
            }),
          },
        },
      }),
    );
    this.bumpToolsEpoch();
    this.scheduleLazyDisconnect(slotKey);
  }

  /**
   * Starts Discord MCP when `discord.enabled` is `1` and `discord.bot_token` is set (Q2 §4.3 opt-in).
   */
  async ensureDiscordRunning(): Promise<void> {
    const slotKey = LAZY_MESH.discord;
    this.clearLazyIdle(slotKey);
    if (this.getLazyClient(slotKey) !== undefined) {
      this.scheduleLazyDisconnect(slotKey);
      return;
    }
    const enabled = await this.vault.get("discord.enabled");
    const token = await this.vault.get("discord.bot_token");
    if (enabled !== "1" || token === null || token === "") {
      return;
    }
    this.setLazyClient(
      slotKey,
      new MCPClient({
        id: `nimbus-discord-${String(Date.now())}`,
        servers: {
          discord: {
            command: "bun",
            args: [mcpConnectorServerScript("discord")],
            env: extensionProcessEnv({ DISCORD_BOT_TOKEN: token }),
          },
        },
      }),
    );
    this.bumpToolsEpoch();
    this.scheduleLazyDisconnect(slotKey);
  }

  /**
   * Starts Jenkins MCP when `jenkins.base_url`, `jenkins.username`, and `jenkins.api_token` are present in the Vault.
   */
  async ensureJenkinsRunning(): Promise<void> {
    const slotKey = LAZY_MESH.jenkins;
    this.clearLazyIdle(slotKey);
    if (this.getLazyClient(slotKey) !== undefined) {
      this.scheduleLazyDisconnect(slotKey);
      return;
    }
    const baseRaw = await this.vault.get("jenkins.base_url");
    const user = await this.vault.get("jenkins.username");
    const token = await this.vault.get("jenkins.api_token");
    if (
      baseRaw === null ||
      baseRaw.trim() === "" ||
      user === null ||
      user.trim() === "" ||
      token === null ||
      token.trim() === ""
    ) {
      return;
    }
    const base = stripTrailingSlashes(baseRaw.trim());
    this.setLazyClient(
      slotKey,
      new MCPClient({
        id: `nimbus-jenkins-${String(Date.now())}`,
        servers: {
          jenkins: {
            command: "bun",
            args: [mcpConnectorServerScript("jenkins")],
            env: extensionProcessEnv({
              JENKINS_BASE_URL: base,
              JENKINS_USERNAME: user.trim(),
              JENKINS_API_TOKEN: token.trim(),
            }),
          },
        },
      }),
    );
    this.bumpToolsEpoch();
    this.scheduleLazyDisconnect(slotKey);
  }

  /**
   * Starts CircleCI MCP when `circleci.api_token` is present in the Vault.
   */
  async ensureCircleciRunning(): Promise<void> {
    const slotKey = LAZY_MESH.circleci;
    this.clearLazyIdle(slotKey);
    if (this.getLazyClient(slotKey) !== undefined) {
      this.scheduleLazyDisconnect(slotKey);
      return;
    }
    const tok = await this.vault.get("circleci.api_token");
    if (tok === null || tok.trim() === "") {
      return;
    }
    this.setLazyClient(
      slotKey,
      new MCPClient({
        id: `nimbus-circleci-${String(Date.now())}`,
        servers: {
          circleci: {
            command: "bun",
            args: [mcpConnectorServerScript("circleci")],
            env: extensionProcessEnv({ CIRCLECI_API_TOKEN: tok.trim() }),
          },
        },
      }),
    );
    this.bumpToolsEpoch();
    this.scheduleLazyDisconnect(slotKey);
  }

  /**
   * Starts PagerDuty MCP when `pagerduty.api_token` is present in the Vault.
   */
  async ensurePagerdutyRunning(): Promise<void> {
    const slotKey = LAZY_MESH.pagerduty;
    this.clearLazyIdle(slotKey);
    if (this.getLazyClient(slotKey) !== undefined) {
      this.scheduleLazyDisconnect(slotKey);
      return;
    }
    const tok = await this.vault.get("pagerduty.api_token");
    if (tok === null || tok.trim() === "") {
      return;
    }
    this.setLazyClient(
      slotKey,
      new MCPClient({
        id: `nimbus-pagerduty-${String(Date.now())}`,
        servers: {
          pagerduty: {
            command: "bun",
            args: [mcpConnectorServerScript("pagerduty")],
            env: extensionProcessEnv({ PAGERDUTY_API_TOKEN: tok.trim() }),
          },
        },
      }),
    );
    this.bumpToolsEpoch();
    this.scheduleLazyDisconnect(slotKey);
  }

  /**
   * Starts Kubernetes MCP when `kubernetes.kubeconfig` is set (path to kubeconfig file).
   */
  async ensureKubernetesRunning(): Promise<void> {
    const slotKey = LAZY_MESH.kubernetes;
    this.clearLazyIdle(slotKey);
    if (this.getLazyClient(slotKey) !== undefined) {
      this.scheduleLazyDisconnect(slotKey);
      return;
    }
    const kc = await this.vault.get("kubernetes.kubeconfig");
    if (kc === null || kc.trim() === "") {
      return;
    }
    const ctxRaw = await this.vault.get("kubernetes.context");
    const kubeExtra: Record<string, string> = { KUBECONFIG: kc.trim() };
    if (ctxRaw !== null && ctxRaw.trim() !== "") {
      kubeExtra["KUBE_CONTEXT"] = ctxRaw.trim();
    }
    this.setLazyClient(
      slotKey,
      new MCPClient({
        id: `nimbus-kubernetes-${String(Date.now())}`,
        servers: {
          kubernetes: {
            command: "bun",
            args: [mcpConnectorServerScript("kubernetes")],
            env: extensionProcessEnv(kubeExtra),
          },
        },
      }),
    );
    this.bumpToolsEpoch();
    this.scheduleLazyDisconnect(slotKey);
  }

  private async ensureIfVaultKeyNonEmpty(key: string, run: () => Promise<void>): Promise<void> {
    const v = await this.vault.get(key);
    if (v !== null && v !== "") {
      await run();
    }
  }

  private async ensureIfGoogleOAuthPresent(): Promise<void> {
    if (await anyGoogleOAuthVaultPresent(this.vault)) {
      await this.ensureGoogleDriveRunning();
    }
  }

  private async ensureBitbucketIfVaultCreds(): Promise<void> {
    const bbUser = await this.vault.get("bitbucket.username");
    const bbPass = await this.vault.get("bitbucket.app_password");
    if (bbUser !== null && bbUser !== "" && bbPass !== null && bbPass !== "") {
      await this.ensureBitbucketRunning();
    }
  }

  private async ensureJiraIfVaultCreds(): Promise<void> {
    const jt = await this.vault.get("jira.api_token");
    const je = await this.vault.get("jira.email");
    const jb = await this.vault.get("jira.base_url");
    if (jt !== null && jt !== "" && je !== null && je !== "" && jb !== null && jb !== "") {
      await this.ensureJiraRunning();
    }
  }

  private async ensureConfluenceIfVaultCreds(): Promise<void> {
    const ct = await this.vault.get("confluence.api_token");
    const ce = await this.vault.get("confluence.email");
    const cb = await this.vault.get("confluence.base_url");
    if (ct !== null && ct !== "" && ce !== null && ce !== "" && cb !== null && cb !== "") {
      await this.ensureConfluenceRunning();
    }
  }

  private async ensureDiscordIfOptIn(): Promise<void> {
    const en = await this.vault.get("discord.enabled");
    const tok = await this.vault.get("discord.bot_token");
    if (en === "1" && tok !== null && tok !== "") {
      await this.ensureDiscordRunning();
    }
  }

  private async ensureJenkinsIfVaultCreds(): Promise<void> {
    const jb = await this.vault.get("jenkins.base_url");
    const ju = await this.vault.get("jenkins.username");
    const jt = await this.vault.get("jenkins.api_token");
    if (
      jb !== null &&
      jb.trim() !== "" &&
      ju !== null &&
      ju.trim() !== "" &&
      jt !== null &&
      jt.trim() !== ""
    ) {
      await this.ensureJenkinsRunning();
    }
  }

  private async ensureCircleciIfVaultCreds(): Promise<void> {
    const t = await this.vault.get("circleci.api_token");
    if (t !== null && t.trim() !== "") {
      await this.ensureCircleciRunning();
    }
  }

  private async ensurePagerdutyIfVaultCreds(): Promise<void> {
    const t = await this.vault.get("pagerduty.api_token");
    if (t !== null && t.trim() !== "") {
      await this.ensurePagerdutyRunning();
    }
  }

  private async ensureKubernetesIfVaultCreds(): Promise<void> {
    const k = await this.vault.get("kubernetes.kubeconfig");
    if (k !== null && k.trim() !== "") {
      await this.ensureKubernetesRunning();
    }
  }

  /** Spawns connector MCP children when matching vault keys are present (used before aggregating tools). */
  private async ensureCredentialConnectorsRunning(): Promise<void> {
    await this.ensureIfGoogleOAuthPresent();
    await this.ensureIfVaultKeyNonEmpty("microsoft.oauth", () =>
      this.ensureMicrosoftBundleRunning(),
    );
    await this.ensureIfVaultKeyNonEmpty("github.pat", () => this.ensureGithubRunning());
    await this.ensureIfVaultKeyNonEmpty("gitlab.pat", () => this.ensureGitlabRunning());
    await this.ensureBitbucketIfVaultCreds();
    await this.ensureIfVaultKeyNonEmpty("slack.oauth", () => this.ensureSlackRunning());
    await this.ensureIfVaultKeyNonEmpty("linear.api_key", () => this.ensureLinearRunning());
    await this.ensureJiraIfVaultCreds();
    await this.ensureIfVaultKeyNonEmpty("notion.oauth", () => this.ensureNotionRunning());
    await this.ensureConfluenceIfVaultCreds();
    await this.ensureDiscordIfOptIn();
    await this.ensureJenkinsIfVaultCreds();
    await this.ensureCircleciIfVaultCreds();
    await this.ensurePagerdutyIfVaultCreds();
    await this.ensureKubernetesIfVaultCreds();
    await this.ensurePhase3BundleRunning();
  }

  /** Collect tool maps from all built-in lazy slots. */
  private async collectBuiltInToolMaps(): Promise<
    ReadonlyArray<{ map: LazyMeshToolMap; name: string }>
  > {
    const list = async (mesh: string): Promise<LazyMeshToolMap> =>
      listLazyMeshClientTools(this.getLazyClient(mesh));
    const fsTools = (await this.filesystem.listTools()) as LazyMeshToolMap;
    return [
      { map: fsTools, name: "filesystem" },
      { map: await list(LAZY_MESH.googleBundle), name: "google-bundle" },
      { map: await list(LAZY_MESH.microsoftBundle), name: "microsoft-bundle" },
      { map: await list(LAZY_MESH.github), name: "github" },
      { map: await list(LAZY_MESH.gitlab), name: "gitlab" },
      { map: await list(LAZY_MESH.bitbucket), name: "bitbucket" },
      { map: await list(LAZY_MESH.slack), name: "slack" },
      { map: await list(LAZY_MESH.linear), name: "linear" },
      { map: await list(LAZY_MESH.jira), name: "jira" },
      { map: await list(LAZY_MESH.notion), name: "notion" },
      { map: await list(LAZY_MESH.confluence), name: "confluence" },
      { map: await list(LAZY_MESH.discord), name: "discord" },
      { map: await list(LAZY_MESH.jenkins), name: "jenkins" },
      { map: await list(LAZY_MESH.circleci), name: "circleci" },
      { map: await list(LAZY_MESH.pagerduty), name: "pagerduty" },
      { map: await list(LAZY_MESH.kubernetes), name: "kubernetes" },
      { map: await list(LAZY_MESH.phase3Bundle), name: "phase3-bundle" },
    ];
  }

  /** Merge tool maps from every active user MCP slot. */
  private async collectUserMcpToolMap(): Promise<LazyMeshToolMap> {
    let merged: LazyMeshToolMap = {};
    for (const [meshKey, slot] of this.lazySlots) {
      if (!meshKey.startsWith(USER_MESH_PREFIX) || slot.client === undefined) {
        continue;
      }
      merged = { ...merged, ...(await listLazyMeshClientTools(slot.client)) };
    }
    return merged;
  }

  /** Index every tool key to its owning slot's drain tracker. Best-effort; races with disconnect are ignored. */
  private async buildSlotForToolMap(): Promise<Map<string, LazyDrainTracker>> {
    const slotForTool = new Map<string, LazyDrainTracker>();
    for (const slot of this.lazySlots.values()) {
      if (slot.client === undefined) continue;
      try {
        const tools = (await slot.client.listTools()) as LazyMeshToolMap;
        for (const k of Object.keys(tools)) {
          if (!slotForTool.has(k)) slotForTool.set(k, slot.drain);
        }
      } catch {
        /* slot disappearing — skip */
      }
    }
    return slotForTool;
  }

  /**
   * S8-F7 — wrap each tool's execute with bump/drop counters keyed to the
   * owning slot, so stopLazyClient can defer disconnect while calls are in
   * flight.
   */
  private wrapMergedToolsWithRefcount(
    merged: LazyMeshToolMap,
    slotForTool: ReadonlyMap<string, LazyDrainTracker>,
  ): void {
    for (const key of Object.keys(merged)) {
      const value = merged[key];
      const original = value?.execute;
      const drain = slotForTool.get(key);
      if (value === undefined || original === undefined || drain === undefined) continue;
      merged[key] = {
        execute: async (input: unknown, ctx?: unknown): Promise<unknown> => {
          drain.bump();
          try {
            return await original(input, ctx);
          } finally {
            drain.drop();
          }
        },
      };
    }
  }

  /**
   * Bare tool map — for the planner path (`ConnectorDispatcher` →
   * `ToolExecutor`). Returns refcount-wrapped but otherwise structured tool
   * results so `ToolExecutor` consumers see the same shape as upstream MCPs.
   */
  async listToolsForDispatcher(): Promise<
    Record<string, { execute?: (input: unknown, context?: unknown) => Promise<unknown> }>
  > {
    await this.ensureCredentialConnectorsRunning();
    await this.ensureUserMcpConnectorsRunning();

    const builtIns = await this.collectBuiltInToolMaps();
    const userMcpMerged = await this.collectUserMcpToolMap();
    const merged = mergeToolMapsOrThrow([...builtIns, { map: userMcpMerged, name: "user-mcp" }]);
    const slotForTool = await this.buildSlotForToolMap();
    this.wrapMergedToolsWithRefcount(merged, slotForTool);
    return merged;
  }

  /**
   * Envelope-wrapped tool map — for the LLM-visible surface via Mastra. Each
   * tool's execute returns a `<tool_output>`-tagged string. Use this for the
   * agent / Mastra path; use `listToolsForDispatcher` for the planner path.
   */
  async listTools(): Promise<
    Record<string, { execute?: (input: unknown, context?: unknown) => Promise<unknown> }>
  > {
    const merged = await this.listToolsForDispatcher();
    for (const key of Object.keys(merged)) {
      const value = merged[key];
      if (value === undefined) continue;
      const inner = value.execute;
      if (inner === undefined) continue;
      const service = key.split("_")[0] ?? "mcp";
      merged[key] = {
        execute: async (input: unknown, ctx?: unknown): Promise<string> => {
          const raw = await inner(input, ctx);
          return wrapToolOutput({ service, tool: key }, raw);
        },
      };
    }
    return merged;
  }

  async disconnect(): Promise<void> {
    for (const key of this.lazySlots.keys()) {
      await this.stopLazyClient(key);
    }
    try {
      await this.filesystem.disconnect();
    } catch {
      /* ignore */
    }
  }
}

export async function createLazyConnectorMesh(
  paths: PlatformPaths,
  vault: NimbusVault,
  options?: { inactivityMs?: number; listUserMcpConnectors?: () => readonly UserMcpConnectorRow[] },
): Promise<LazyConnectorMesh> {
  return new LazyConnectorMesh(paths, vault, options);
}
