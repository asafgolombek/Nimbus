import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { MCPClient } from "@mastra/mcp";

import { getValidGoogleAccessToken } from "../auth/google-access-token.ts";
import type { PlatformPaths } from "../platform/paths.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";

function googleDriveMcpScriptPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "..", "mcp-connectors", "google-drive", "src", "server.ts");
}

/**
 * Eager filesystem MCP + lazily spawned Google Drive MCP (Q2 §1.6).
 * Increments {@link getToolsEpoch} when the Drive child starts or stops so tool caches refresh.
 */
export class LazyConnectorMesh {
  private readonly filesystem: MCPClient;
  private googleDriveClient: MCPClient | undefined;
  private googleIdleTimer: ReturnType<typeof setTimeout> | undefined;
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

  private scheduleGoogleDisconnect(): void {
    this.clearGoogleIdleTimer();
    this.googleIdleTimer = setTimeout(() => {
      this.googleIdleTimer = undefined;
      void this.stopGoogleDrive();
    }, this.inactivityMs);
  }

  private async stopGoogleDrive(): Promise<void> {
    const c = this.googleDriveClient;
    this.googleDriveClient = undefined;
    if (c !== undefined) {
      this.bumpToolsEpoch();
      try {
        await c.disconnect();
      } catch {
        /* ignore */
      }
    }
  }

  async ensureGoogleDriveRunning(): Promise<void> {
    this.clearGoogleIdleTimer();
    if (this.googleDriveClient !== undefined) {
      this.scheduleGoogleDisconnect();
      return;
    }
    const token = await getValidGoogleAccessToken(this.vault);
    this.googleDriveClient = new MCPClient({
      id: `nimbus-gdrive-${String(Date.now())}`,
      servers: {
        google_drive: {
          command: "bun",
          args: [googleDriveMcpScriptPath()],
          env: { ...process.env, GOOGLE_OAUTH_ACCESS_TOKEN: token },
        },
      },
    });
    this.bumpToolsEpoch();
    this.scheduleGoogleDisconnect();
  }

  async listTools(): Promise<
    Record<string, { execute?: (input: unknown, context?: unknown) => Promise<unknown> }>
  > {
    const raw = await this.vault.get("google.oauth");
    if (raw !== null && raw !== "") {
      await this.ensureGoogleDriveRunning();
    }
    const fsTools = await this.filesystem.listTools();
    const gdTools =
      this.googleDriveClient !== undefined ? await this.googleDriveClient.listTools() : {};
    return { ...fsTools, ...gdTools } as Record<
      string,
      { execute?: (input: unknown, context?: unknown) => Promise<unknown> }
    >;
  }

  async disconnect(): Promise<void> {
    this.clearGoogleIdleTimer();
    await this.stopGoogleDrive();
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
