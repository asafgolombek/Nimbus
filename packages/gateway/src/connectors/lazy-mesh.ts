import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { MCPClient } from "@mastra/mcp";

import { getValidGoogleAccessToken } from "../auth/google-access-token.ts";
import { getValidMicrosoftAccessToken } from "../auth/microsoft-access-token.ts";
import { getValidNotionAccessToken } from "../auth/notion-access-token.ts";
import { readMicrosoftOAuthScopesForOutlookEnv } from "../auth/oauth-vault-tokens.ts";
import { getValidSlackAccessToken } from "../auth/slack-access-token.ts";
import type { PlatformPaths } from "../platform/paths.ts";
import { stripTrailingSlashes } from "../string/strip-trailing-slashes.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";

function googleDriveMcpScriptPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "..", "mcp-connectors", "google-drive", "src", "server.ts");
}

function gmailMcpScriptPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "..", "mcp-connectors", "gmail", "src", "server.ts");
}

function googlePhotosMcpScriptPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "..", "mcp-connectors", "google-photos", "src", "server.ts");
}

function onedriveMcpScriptPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "..", "mcp-connectors", "onedrive", "src", "server.ts");
}

function outlookMcpScriptPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "..", "mcp-connectors", "outlook", "src", "server.ts");
}

function teamsMcpScriptPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "..", "mcp-connectors", "teams", "src", "server.ts");
}

function githubMcpScriptPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "..", "mcp-connectors", "github", "src", "server.ts");
}

function gitlabMcpScriptPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "..", "mcp-connectors", "gitlab", "src", "server.ts");
}

function bitbucketMcpScriptPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "..", "mcp-connectors", "bitbucket", "src", "server.ts");
}

function slackMcpScriptPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "..", "mcp-connectors", "slack", "src", "server.ts");
}

function linearMcpScriptPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "..", "mcp-connectors", "linear", "src", "server.ts");
}

function jiraMcpScriptPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "..", "mcp-connectors", "jira", "src", "server.ts");
}

function notionMcpScriptPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "..", "mcp-connectors", "notion", "src", "server.ts");
}

function confluenceMcpScriptPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "..", "mcp-connectors", "confluence", "src", "server.ts");
}

function discordMcpScriptPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "..", "mcp-connectors", "discord", "src", "server.ts");
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
 * Eager filesystem MCP + lazily spawned Google MCP bundle (Drive + Gmail + Photos) + Microsoft bundle (OneDrive + Outlook + Teams) + GitHub / GitLab / Bitbucket / Slack / Linear / Jira / Notion / Confluence credential MCP when vault keys exist; Discord MCP when **`discord.enabled`** + **`discord.bot_token`** are set (Q2 §1.6 / Phase 2–5 + §4.3).
 */
export class LazyConnectorMesh {
  private readonly filesystem: MCPClient;
  private googleBundleClient: MCPClient | undefined;
  private googleIdleTimer: ReturnType<typeof setTimeout> | undefined;
  private microsoftBundleClient: MCPClient | undefined;
  private microsoftIdleTimer: ReturnType<typeof setTimeout> | undefined;
  private githubClient: MCPClient | undefined;
  private githubIdleTimer: ReturnType<typeof setTimeout> | undefined;
  private gitlabClient: MCPClient | undefined;
  private gitlabIdleTimer: ReturnType<typeof setTimeout> | undefined;
  private bitbucketClient: MCPClient | undefined;
  private bitbucketIdleTimer: ReturnType<typeof setTimeout> | undefined;
  private slackClient: MCPClient | undefined;
  private slackIdleTimer: ReturnType<typeof setTimeout> | undefined;
  private linearClient: MCPClient | undefined;
  private linearIdleTimer: ReturnType<typeof setTimeout> | undefined;
  private jiraClient: MCPClient | undefined;
  private jiraIdleTimer: ReturnType<typeof setTimeout> | undefined;
  private notionClient: MCPClient | undefined;
  private notionIdleTimer: ReturnType<typeof setTimeout> | undefined;
  private confluenceClient: MCPClient | undefined;
  private confluenceIdleTimer: ReturnType<typeof setTimeout> | undefined;
  private discordClient: MCPClient | undefined;
  private discordIdleTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly inactivityMs: number;
  private toolsEpoch = 0;

  constructor(
    paths: PlatformPaths,
    private readonly vault: NimbusVault,
    options?: { inactivityMs?: number },
  ) {
    this.inactivityMs = options?.inactivityMs ?? 300_000;
    this.filesystem = new MCPClient({
      servers: {
        filesystem: {
          command: "bunx",
          args: ["@modelcontextprotocol/server-filesystem", paths.dataDir],
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

  private clearGoogleIdleTimer(): void {
    if (this.googleIdleTimer !== undefined) {
      clearTimeout(this.googleIdleTimer);
      this.googleIdleTimer = undefined;
    }
  }

  private clearMicrosoftIdleTimer(): void {
    if (this.microsoftIdleTimer !== undefined) {
      clearTimeout(this.microsoftIdleTimer);
      this.microsoftIdleTimer = undefined;
    }
  }

  private clearGithubIdleTimer(): void {
    if (this.githubIdleTimer !== undefined) {
      clearTimeout(this.githubIdleTimer);
      this.githubIdleTimer = undefined;
    }
  }

  private clearGitlabIdleTimer(): void {
    if (this.gitlabIdleTimer !== undefined) {
      clearTimeout(this.gitlabIdleTimer);
      this.gitlabIdleTimer = undefined;
    }
  }

  private clearBitbucketIdleTimer(): void {
    if (this.bitbucketIdleTimer !== undefined) {
      clearTimeout(this.bitbucketIdleTimer);
      this.bitbucketIdleTimer = undefined;
    }
  }

  private clearSlackIdleTimer(): void {
    if (this.slackIdleTimer !== undefined) {
      clearTimeout(this.slackIdleTimer);
      this.slackIdleTimer = undefined;
    }
  }

  private clearLinearIdleTimer(): void {
    if (this.linearIdleTimer !== undefined) {
      clearTimeout(this.linearIdleTimer);
      this.linearIdleTimer = undefined;
    }
  }

  private clearJiraIdleTimer(): void {
    if (this.jiraIdleTimer !== undefined) {
      clearTimeout(this.jiraIdleTimer);
      this.jiraIdleTimer = undefined;
    }
  }

  private clearNotionIdleTimer(): void {
    if (this.notionIdleTimer !== undefined) {
      clearTimeout(this.notionIdleTimer);
      this.notionIdleTimer = undefined;
    }
  }

  private clearConfluenceIdleTimer(): void {
    if (this.confluenceIdleTimer !== undefined) {
      clearTimeout(this.confluenceIdleTimer);
      this.confluenceIdleTimer = undefined;
    }
  }

  private clearDiscordIdleTimer(): void {
    if (this.discordIdleTimer !== undefined) {
      clearTimeout(this.discordIdleTimer);
      this.discordIdleTimer = undefined;
    }
  }

  private scheduleGoogleDisconnect(): void {
    this.clearGoogleIdleTimer();
    this.googleIdleTimer = setTimeout(() => {
      this.googleIdleTimer = undefined;
      void this.stopGoogleBundle();
    }, this.inactivityMs);
  }

  private scheduleMicrosoftDisconnect(): void {
    this.clearMicrosoftIdleTimer();
    this.microsoftIdleTimer = setTimeout(() => {
      this.microsoftIdleTimer = undefined;
      void this.stopMicrosoftBundle();
    }, this.inactivityMs);
  }

  private scheduleGithubDisconnect(): void {
    this.clearGithubIdleTimer();
    this.githubIdleTimer = setTimeout(() => {
      this.githubIdleTimer = undefined;
      void this.stopGithubClient();
    }, this.inactivityMs);
  }

  private scheduleGitlabDisconnect(): void {
    this.clearGitlabIdleTimer();
    this.gitlabIdleTimer = setTimeout(() => {
      this.gitlabIdleTimer = undefined;
      void this.stopGitlabClient();
    }, this.inactivityMs);
  }

  private scheduleBitbucketDisconnect(): void {
    this.clearBitbucketIdleTimer();
    this.bitbucketIdleTimer = setTimeout(() => {
      this.bitbucketIdleTimer = undefined;
      void this.stopBitbucketClient();
    }, this.inactivityMs);
  }

  private scheduleSlackDisconnect(): void {
    this.clearSlackIdleTimer();
    this.slackIdleTimer = setTimeout(() => {
      this.slackIdleTimer = undefined;
      void this.stopSlackClient();
    }, this.inactivityMs);
  }

  private scheduleLinearDisconnect(): void {
    this.clearLinearIdleTimer();
    this.linearIdleTimer = setTimeout(() => {
      this.linearIdleTimer = undefined;
      void this.stopLinearClient();
    }, this.inactivityMs);
  }

  private scheduleJiraDisconnect(): void {
    this.clearJiraIdleTimer();
    this.jiraIdleTimer = setTimeout(() => {
      this.jiraIdleTimer = undefined;
      void this.stopJiraClient();
    }, this.inactivityMs);
  }

  private scheduleNotionDisconnect(): void {
    this.clearNotionIdleTimer();
    this.notionIdleTimer = setTimeout(() => {
      this.notionIdleTimer = undefined;
      void this.stopNotionClient();
    }, this.inactivityMs);
  }

  private scheduleConfluenceDisconnect(): void {
    this.clearConfluenceIdleTimer();
    this.confluenceIdleTimer = setTimeout(() => {
      this.confluenceIdleTimer = undefined;
      void this.stopConfluenceClient();
    }, this.inactivityMs);
  }

  private scheduleDiscordDisconnect(): void {
    this.clearDiscordIdleTimer();
    this.discordIdleTimer = setTimeout(() => {
      this.discordIdleTimer = undefined;
      void this.stopDiscordClient();
    }, this.inactivityMs);
  }

  private async stopGoogleBundle(): Promise<void> {
    const c = this.googleBundleClient;
    this.googleBundleClient = undefined;
    if (c !== undefined) {
      this.bumpToolsEpoch();
      try {
        await c.disconnect();
      } catch {
        /* ignore */
      }
    }
  }

  private async stopMicrosoftBundle(): Promise<void> {
    const c = this.microsoftBundleClient;
    this.microsoftBundleClient = undefined;
    if (c !== undefined) {
      this.bumpToolsEpoch();
      try {
        await c.disconnect();
      } catch {
        /* ignore */
      }
    }
  }

  private async stopGithubClient(): Promise<void> {
    const c = this.githubClient;
    this.githubClient = undefined;
    if (c !== undefined) {
      this.bumpToolsEpoch();
      try {
        await c.disconnect();
      } catch {
        /* ignore */
      }
    }
  }

  private async stopGitlabClient(): Promise<void> {
    const c = this.gitlabClient;
    this.gitlabClient = undefined;
    if (c !== undefined) {
      this.bumpToolsEpoch();
      try {
        await c.disconnect();
      } catch {
        /* ignore */
      }
    }
  }

  private async stopBitbucketClient(): Promise<void> {
    const c = this.bitbucketClient;
    this.bitbucketClient = undefined;
    if (c !== undefined) {
      this.bumpToolsEpoch();
      try {
        await c.disconnect();
      } catch {
        /* ignore */
      }
    }
  }

  private async stopSlackClient(): Promise<void> {
    const c = this.slackClient;
    this.slackClient = undefined;
    if (c !== undefined) {
      this.bumpToolsEpoch();
      try {
        await c.disconnect();
      } catch {
        /* ignore */
      }
    }
  }

  private async stopLinearClient(): Promise<void> {
    const c = this.linearClient;
    this.linearClient = undefined;
    if (c !== undefined) {
      this.bumpToolsEpoch();
      try {
        await c.disconnect();
      } catch {
        /* ignore */
      }
    }
  }

  private async stopJiraClient(): Promise<void> {
    const c = this.jiraClient;
    this.jiraClient = undefined;
    if (c !== undefined) {
      this.bumpToolsEpoch();
      try {
        await c.disconnect();
      } catch {
        /* ignore */
      }
    }
  }

  private async stopNotionClient(): Promise<void> {
    const c = this.notionClient;
    this.notionClient = undefined;
    if (c !== undefined) {
      this.bumpToolsEpoch();
      try {
        await c.disconnect();
      } catch {
        /* ignore */
      }
    }
  }

  private async stopConfluenceClient(): Promise<void> {
    const c = this.confluenceClient;
    this.confluenceClient = undefined;
    if (c !== undefined) {
      this.bumpToolsEpoch();
      try {
        await c.disconnect();
      } catch {
        /* ignore */
      }
    }
  }

  private async stopDiscordClient(): Promise<void> {
    const c = this.discordClient;
    this.discordClient = undefined;
    if (c !== undefined) {
      this.bumpToolsEpoch();
      try {
        await c.disconnect();
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Starts Google Drive + Gmail + Google Photos MCP subprocesses when `google.oauth` is present (shared token).
   */
  async ensureGoogleDriveRunning(): Promise<void> {
    this.clearGoogleIdleTimer();
    if (this.googleBundleClient !== undefined) {
      this.scheduleGoogleDisconnect();
      return;
    }
    const token = await getValidGoogleAccessToken(this.vault);
    this.googleBundleClient = new MCPClient({
      id: `nimbus-google-${String(Date.now())}`,
      servers: {
        google_drive: {
          command: "bun",
          args: [googleDriveMcpScriptPath()],
          env: { ...process.env, GOOGLE_OAUTH_ACCESS_TOKEN: token },
        },
        gmail: {
          command: "bun",
          args: [gmailMcpScriptPath()],
          env: { ...process.env, GOOGLE_OAUTH_ACCESS_TOKEN: token },
        },
        google_photos: {
          command: "bun",
          args: [googlePhotosMcpScriptPath()],
          env: { ...process.env, GOOGLE_OAUTH_ACCESS_TOKEN: token },
        },
      },
    });
    this.bumpToolsEpoch();
    this.scheduleGoogleDisconnect();
  }

  /**
   * Starts OneDrive + Outlook + Teams MCP subprocesses when `microsoft.oauth` is present (shared token).
   */
  async ensureMicrosoftBundleRunning(): Promise<void> {
    this.clearMicrosoftIdleTimer();
    if (this.microsoftBundleClient !== undefined) {
      this.scheduleMicrosoftDisconnect();
      return;
    }
    const token = await getValidMicrosoftAccessToken(this.vault);
    const outlookScopes = await readMicrosoftOAuthScopesForOutlookEnv(this.vault);
    const outlookEnv = {
      ...process.env,
      MICROSOFT_OAUTH_ACCESS_TOKEN: token,
    } as Record<string, string>;
    if (outlookScopes !== undefined) {
      outlookEnv["MICROSOFT_OAUTH_SCOPES"] = outlookScopes;
    }
    this.microsoftBundleClient = new MCPClient({
      id: `nimbus-ms-${String(Date.now())}`,
      servers: {
        onedrive: {
          command: "bun",
          args: [onedriveMcpScriptPath()],
          env: { ...process.env, MICROSOFT_OAUTH_ACCESS_TOKEN: token },
        },
        outlook: {
          command: "bun",
          args: [outlookMcpScriptPath()],
          env: outlookEnv,
        },
        teams: {
          command: "bun",
          args: [teamsMcpScriptPath()],
          env: { ...process.env, MICROSOFT_OAUTH_ACCESS_TOKEN: token },
        },
      },
    });
    this.bumpToolsEpoch();
    this.scheduleMicrosoftDisconnect();
  }

  /**
   * Starts GitHub MCP when `github.pat` is present in the Vault.
   */
  async ensureGithubRunning(): Promise<void> {
    this.clearGithubIdleTimer();
    if (this.githubClient !== undefined) {
      this.scheduleGithubDisconnect();
      return;
    }
    const pat = await this.vault.get("github.pat");
    if (pat === null || pat === "") {
      return;
    }
    this.githubClient = new MCPClient({
      id: `nimbus-github-${String(Date.now())}`,
      servers: {
        github: {
          command: "bun",
          args: [githubMcpScriptPath()],
          env: { ...process.env, GITHUB_PAT: pat },
        },
      },
    });
    this.bumpToolsEpoch();
    this.scheduleGithubDisconnect();
  }

  /**
   * Starts GitLab MCP when `gitlab.pat` is present in the Vault.
   */
  async ensureGitlabRunning(): Promise<void> {
    this.clearGitlabIdleTimer();
    if (this.gitlabClient !== undefined) {
      this.scheduleGitlabDisconnect();
      return;
    }
    const pat = await this.vault.get("gitlab.pat");
    if (pat === null || pat === "") {
      return;
    }
    const apiBase = await this.vault.get("gitlab.api_base");
    const trimmedBase =
      apiBase !== null && apiBase.trim() !== "" ? stripTrailingSlashes(apiBase) : null;
    const gitlabServerEnv =
      trimmedBase === null
        ? { ...process.env, GITLAB_PAT: pat }
        : { ...process.env, GITLAB_PAT: pat, GITLAB_API_BASE_URL: trimmedBase };
    this.gitlabClient = new MCPClient({
      id: `nimbus-gitlab-${String(Date.now())}`,
      servers: {
        gitlab: {
          command: "bun",
          args: [gitlabMcpScriptPath()],
          env: gitlabServerEnv,
        },
      },
    });
    this.bumpToolsEpoch();
    this.scheduleGitlabDisconnect();
  }

  /**
   * Starts Bitbucket Cloud MCP when `bitbucket.username` + `bitbucket.app_password` exist in the Vault.
   */
  async ensureBitbucketRunning(): Promise<void> {
    this.clearBitbucketIdleTimer();
    if (this.bitbucketClient !== undefined) {
      this.scheduleBitbucketDisconnect();
      return;
    }
    const user = await this.vault.get("bitbucket.username");
    const pass = await this.vault.get("bitbucket.app_password");
    if (user === null || user === "" || pass === null || pass === "") {
      return;
    }
    this.bitbucketClient = new MCPClient({
      id: `nimbus-bitbucket-${String(Date.now())}`,
      servers: {
        bitbucket: {
          command: "bun",
          args: [bitbucketMcpScriptPath()],
          env: {
            ...process.env,
            BITBUCKET_USERNAME: user,
            BITBUCKET_APP_PASSWORD: pass,
          },
        },
      },
    });
    this.bumpToolsEpoch();
    this.scheduleBitbucketDisconnect();
  }

  /**
   * Starts Slack MCP when `slack.oauth` is present in the Vault.
   */
  async ensureSlackRunning(): Promise<void> {
    this.clearSlackIdleTimer();
    if (this.slackClient !== undefined) {
      this.scheduleSlackDisconnect();
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
    this.slackClient = new MCPClient({
      id: `nimbus-slack-${String(Date.now())}`,
      servers: {
        slack: {
          command: "bun",
          args: [slackMcpScriptPath()],
          env: { ...process.env, SLACK_USER_ACCESS_TOKEN: token },
        },
      },
    });
    this.bumpToolsEpoch();
    this.scheduleSlackDisconnect();
  }

  /**
   * Starts Linear MCP when `linear.api_key` is present in the Vault.
   */
  async ensureLinearRunning(): Promise<void> {
    this.clearLinearIdleTimer();
    if (this.linearClient !== undefined) {
      this.scheduleLinearDisconnect();
      return;
    }
    const key = await this.vault.get("linear.api_key");
    if (key === null || key === "") {
      return;
    }
    this.linearClient = new MCPClient({
      id: `nimbus-linear-${String(Date.now())}`,
      servers: {
        linear: {
          command: "bun",
          args: [linearMcpScriptPath()],
          env: { ...process.env, LINEAR_API_KEY: key },
        },
      },
    });
    this.bumpToolsEpoch();
    this.scheduleLinearDisconnect();
  }

  /**
   * Starts Jira MCP when `jira.api_token`, `jira.email`, and `jira.base_url` are present in the Vault.
   */
  async ensureJiraRunning(): Promise<void> {
    this.clearJiraIdleTimer();
    if (this.jiraClient !== undefined) {
      this.scheduleJiraDisconnect();
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
    this.jiraClient = new MCPClient({
      id: `nimbus-jira-${String(Date.now())}`,
      servers: {
        jira: {
          command: "bun",
          args: [jiraMcpScriptPath()],
          env: {
            ...process.env,
            JIRA_API_TOKEN: token,
            JIRA_EMAIL: email,
            JIRA_BASE_URL: baseUrl,
          },
        },
      },
    });
    this.bumpToolsEpoch();
    this.scheduleJiraDisconnect();
  }

  /**
   * Starts Notion MCP when `notion.oauth` is present and a valid access token can be resolved.
   */
  async ensureNotionRunning(): Promise<void> {
    this.clearNotionIdleTimer();
    if (this.notionClient !== undefined) {
      this.scheduleNotionDisconnect();
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
    this.notionClient = new MCPClient({
      id: `nimbus-notion-${String(Date.now())}`,
      servers: {
        notion: {
          command: "bun",
          args: [notionMcpScriptPath()],
          env: { ...process.env, NOTION_ACCESS_TOKEN: accessToken },
        },
      },
    });
    this.bumpToolsEpoch();
    this.scheduleNotionDisconnect();
  }

  /**
   * Starts Confluence MCP when Confluence vault keys are present.
   */
  async ensureConfluenceRunning(): Promise<void> {
    this.clearConfluenceIdleTimer();
    if (this.confluenceClient !== undefined) {
      this.scheduleConfluenceDisconnect();
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
    this.confluenceClient = new MCPClient({
      id: `nimbus-confluence-${String(Date.now())}`,
      servers: {
        confluence: {
          command: "bun",
          args: [confluenceMcpScriptPath()],
          env: {
            ...process.env,
            CONFLUENCE_API_TOKEN: token,
            CONFLUENCE_EMAIL: em,
            CONFLUENCE_BASE_URL: baseUrl,
          },
        },
      },
    });
    this.bumpToolsEpoch();
    this.scheduleConfluenceDisconnect();
  }

  /**
   * Starts Discord MCP when `discord.enabled` is `1` and `discord.bot_token` is set (Q2 §4.3 opt-in).
   */
  async ensureDiscordRunning(): Promise<void> {
    this.clearDiscordIdleTimer();
    if (this.discordClient !== undefined) {
      this.scheduleDiscordDisconnect();
      return;
    }
    const enabled = await this.vault.get("discord.enabled");
    const token = await this.vault.get("discord.bot_token");
    if (enabled !== "1" || token === null || token === "") {
      return;
    }
    this.discordClient = new MCPClient({
      id: `nimbus-discord-${String(Date.now())}`,
      servers: {
        discord: {
          command: "bun",
          args: [discordMcpScriptPath()],
          env: { ...process.env, DISCORD_BOT_TOKEN: token },
        },
      },
    });
    this.bumpToolsEpoch();
    this.scheduleDiscordDisconnect();
  }

  private async ensureIfVaultKeyNonEmpty(key: string, run: () => Promise<void>): Promise<void> {
    const v = await this.vault.get(key);
    if (v !== null && v !== "") {
      await run();
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

  /** Spawns connector MCP children when matching vault keys are present (used before aggregating tools). */
  private async ensureCredentialConnectorsRunning(): Promise<void> {
    await this.ensureIfVaultKeyNonEmpty("google.oauth", () => this.ensureGoogleDriveRunning());
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
  }

  async listTools(): Promise<
    Record<string, { execute?: (input: unknown, context?: unknown) => Promise<unknown> }>
  > {
    await this.ensureCredentialConnectorsRunning();

    const fsTools = await this.filesystem.listTools();
    const gdTools = await listLazyMeshClientTools(this.googleBundleClient);
    const msTools = await listLazyMeshClientTools(this.microsoftBundleClient);
    const ghTools = await listLazyMeshClientTools(this.githubClient);
    const glTools = await listLazyMeshClientTools(this.gitlabClient);
    const bbTools = await listLazyMeshClientTools(this.bitbucketClient);
    const slackTools = await listLazyMeshClientTools(this.slackClient);
    const linearTools = await listLazyMeshClientTools(this.linearClient);
    const jiraTools = await listLazyMeshClientTools(this.jiraClient);
    const notionTools = await listLazyMeshClientTools(this.notionClient);
    const confluenceTools = await listLazyMeshClientTools(this.confluenceClient);
    const discordTools = await listLazyMeshClientTools(this.discordClient);
    return {
      ...fsTools,
      ...gdTools,
      ...msTools,
      ...ghTools,
      ...glTools,
      ...bbTools,
      ...slackTools,
      ...linearTools,
      ...jiraTools,
      ...notionTools,
      ...confluenceTools,
      ...discordTools,
    } as LazyMeshToolMap;
  }

  async disconnect(): Promise<void> {
    this.clearGoogleIdleTimer();
    this.clearMicrosoftIdleTimer();
    this.clearGithubIdleTimer();
    this.clearGitlabIdleTimer();
    this.clearBitbucketIdleTimer();
    this.clearSlackIdleTimer();
    this.clearLinearIdleTimer();
    this.clearJiraIdleTimer();
    this.clearNotionIdleTimer();
    this.clearConfluenceIdleTimer();
    this.clearDiscordIdleTimer();
    await this.stopGoogleBundle();
    await this.stopMicrosoftBundle();
    await this.stopGithubClient();
    await this.stopGitlabClient();
    await this.stopBitbucketClient();
    await this.stopSlackClient();
    await this.stopLinearClient();
    await this.stopJiraClient();
    await this.stopNotionClient();
    await this.stopConfluenceClient();
    await this.stopDiscordClient();
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
): Promise<LazyConnectorMesh> {
  return new LazyConnectorMesh(paths, vault);
}
