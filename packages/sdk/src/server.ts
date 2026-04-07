/**
 * NimbusExtensionServer — base class for all Nimbus MCP extension servers
 *
 * Usage:
 *   const server = new NimbusExtensionServer({ manifest, onAuth });
 *   server.registerTool("search", { description, inputSchema, handler });
 *   server.start();
 */

import type { ExtensionManifest } from "./types";

export interface ExtensionServerOptions<TClient> {
  manifest: ExtensionManifest;
  onAuth?: (ctx: { accessToken: string }) => TClient;
}

export interface ToolDefinition<TInput, TClient> {
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (input: TInput, ctx: { client: TClient }) => Promise<unknown>;
}

export class NimbusExtensionServer<TClient = unknown> {
  // TODO Q3: store options and initialize MCP stdio server with manifest
  private readonly _options: ExtensionServerOptions<TClient>;

  constructor(options: ExtensionServerOptions<TClient>) {
    this._options = options;
  }

  registerTool<TInput>(_name: string, _definition: ToolDefinition<TInput, TClient>): void {
    // TODO Q3: Register tool with MCP server
  }

  start(): void {
    // TODO Q3: Start MCP stdio server
    void this._options;
  }
}
