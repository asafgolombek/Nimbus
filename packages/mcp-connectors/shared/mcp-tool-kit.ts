import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export type McpListResult = { content: Array<{ type: "text"; text: string }> };

export function mcpJsonResult(data: unknown): McpListResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/** Input shape matches MCP `server.tool` zod fields; typed as unknown to avoid a zod import from this shared path. */
export type RegisterSimpleToolFn = (
  name: string,
  description: string,
  inputShape: Record<string, unknown>,
  handler: (args: unknown) => Promise<McpListResult>,
) => unknown;

export function createRegisterSimpleTool(server: McpServer): RegisterSimpleToolFn {
  return server.tool.bind(server) as RegisterSimpleToolFn;
}

export function requireProcessEnv(envVarName: string): string {
  const t = process.env[envVarName];
  if (t === undefined || t === "") {
    throw new Error(`${envVarName} is not set`);
  }
  return t;
}

/** HTTP Basic header for email:API-token style Atlassian credentials (never log the raw value). */
export function encodeBasicAuthHeader(email: string, token: string): string {
  const raw = `${email}:${token}`;
  const b64 = Buffer.from(raw, "utf8").toString("base64");
  return `Basic ${b64}`;
}
