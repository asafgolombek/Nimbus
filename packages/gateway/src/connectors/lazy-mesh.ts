import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { MCPClient } from "@mastra/mcp";

import { getValidGoogleAccessToken } from "../auth/google-access-token.ts";
import { getValidMicrosoftAccessToken } from "../auth/microsoft-access-token.ts";
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

function githubMcpScriptPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "..", "mcp-connectors", "github", "src", "server.ts");
}

/**
 * Eager filesystem MCP + lazily spawned Google MCP bundle (Drive + Gmail + Photos) + Microsoft bundle (OneDrive + Outlook) + GitHub MCP when `github.pat` exists (Q2 §1.6 / Phase 2–3).
 */
export class LazyConnectorMesh {
  private readonly filesystem: MCPClient;
  private googleBundleClient: MCPClient | undefined;
  private googleIdleTimer: ReturnType<typeof setTimeout> | undefined;
  private microsoftBundleClient: MCPClient | undefined;
  private microsoftIdleTimer: ReturnType<typeof setTimeout> | undefined;
  private githubClient: MCPClient | undefined;
  private githubIdleTimer: ReturnType<typeof setTimeout> | undefined;
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
   * Starts OneDrive + Outlook MCP subprocesses when `microsoft.oauth` is present (shared token).
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

    const fsTools = await this.filesystem.listTools();
    const gdTools =
      this.googleBundleClient !== undefined ? await this.googleBundleClient.listTools() : {};
    const msTools =
      this.microsoftBundleClient !== undefined ? await this.microsoftBundleClient.listTools() : {};
    const ghTools = this.githubClient !== undefined ? await this.githubClient.listTools() : {};
    return { ...fsTools, ...gdTools, ...msTools, ...ghTools } as Record<
      string,
      { execute?: (input: unknown, context?: unknown) => Promise<unknown> }
    >;
  }

  async disconnect(): Promise<void> {
    this.clearGoogleIdleTimer();
    this.clearMicrosoftIdleTimer();
    this.clearGithubIdleTimer();
    await this.stopGoogleBundle();
    await this.stopMicrosoftBundle();
    await this.stopGithubClient();
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
