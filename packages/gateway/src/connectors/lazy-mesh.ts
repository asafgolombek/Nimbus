import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { MCPClient } from "@mastra/mcp";

import { getValidGoogleAccessToken } from "../auth/google-access-token.ts";
import { getValidMicrosoftAccessToken } from "../auth/microsoft-access-token.ts";
import { getValidSlackAccessToken } from "../auth/slack-access-token.ts";
import type { PlatformPaths } from "../platform/paths.ts";
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

/**
 * Eager filesystem MCP + lazily spawned Google MCP bundle (Drive + Gmail + Photos) + Microsoft bundle (OneDrive + Outlook + Teams) + GitHub / GitLab / Bitbucket / Slack credential MCP when vault keys exist (Q2 §1.6 / Phase 2–4).
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
          env: { ...process.env, MICROSOFT_OAUTH_ACCESS_TOKEN: token },
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
      apiBase !== null && apiBase.trim() !== "" ? apiBase.trim().replace(/\/+$/, "") : null;
    this.gitlabClient = new MCPClient({
      id: `nimbus-gitlab-${String(Date.now())}`,
      servers: {
        gitlab: {
          command: "bun",
          args: [gitlabMcpScriptPath()],
          env:
            trimmedBase !== null
              ? { ...process.env, GITLAB_PAT: pat, GITLAB_API_BASE_URL: trimmedBase }
              : { ...process.env, GITLAB_PAT: pat },
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

  async listTools(): Promise<
    Record<string, { execute?: (input: unknown, context?: unknown) => Promise<unknown> }>
  > {
    const rawGoogle = await this.vault.get("google.oauth");
    if (rawGoogle !== null && rawGoogle !== "") {
      await this.ensureGoogleDriveRunning();
    }
    const rawMs = await this.vault.get("microsoft.oauth");
    if (rawMs !== null && rawMs !== "") {
      await this.ensureMicrosoftBundleRunning();
    }
    const rawGh = await this.vault.get("github.pat");
    if (rawGh !== null && rawGh !== "") {
      await this.ensureGithubRunning();
    }
    const rawGl = await this.vault.get("gitlab.pat");
    if (rawGl !== null && rawGl !== "") {
      await this.ensureGitlabRunning();
    }
    const bbUser = await this.vault.get("bitbucket.username");
    const bbPass = await this.vault.get("bitbucket.app_password");
    if (bbUser !== null && bbUser !== "" && bbPass !== null && bbPass !== "") {
      await this.ensureBitbucketRunning();
    }
    const rawSlack = await this.vault.get("slack.oauth");
    if (rawSlack !== null && rawSlack !== "") {
      await this.ensureSlackRunning();
    }

    const fsTools = await this.filesystem.listTools();
    const gdTools =
      this.googleBundleClient !== undefined ? await this.googleBundleClient.listTools() : {};
    const msTools =
      this.microsoftBundleClient !== undefined ? await this.microsoftBundleClient.listTools() : {};
    const ghTools = this.githubClient !== undefined ? await this.githubClient.listTools() : {};
    const glTools = this.gitlabClient !== undefined ? await this.gitlabClient.listTools() : {};
    const bbTools =
      this.bitbucketClient !== undefined ? await this.bitbucketClient.listTools() : {};
    const slackTools = this.slackClient !== undefined ? await this.slackClient.listTools() : {};
    return {
      ...fsTools,
      ...gdTools,
      ...msTools,
      ...ghTools,
      ...glTools,
      ...bbTools,
      ...slackTools,
    } as Record<string, { execute?: (input: unknown, context?: unknown) => Promise<unknown> }>;
  }

  async disconnect(): Promise<void> {
    this.clearGoogleIdleTimer();
    this.clearMicrosoftIdleTimer();
    this.clearGithubIdleTimer();
    this.clearGitlabIdleTimer();
    this.clearBitbucketIdleTimer();
    this.clearSlackIdleTimer();
    await this.stopGoogleBundle();
    await this.stopMicrosoftBundle();
    await this.stopGithubClient();
    await this.stopGitlabClient();
    await this.stopBitbucketClient();
    await this.stopSlackClient();
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
