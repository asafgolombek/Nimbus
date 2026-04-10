export type McpListResult = { content: Array<{ type: "text"; text: string }> };

export function mcpJsonResult(data: unknown): McpListResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/** Shape of `z.object()` — structural so `shared/` does not depend on `zod` (not a workspace package). */
export type ZodObjectSchema<T> = {
  readonly shape: Record<string, unknown>;
  safeParse: (
    args: unknown,
  ) => { success: true; data: T } | { success: false; error: { message: string } };
};

/** Registers a tool with one schema object — avoids duplicating the shape for MCP metadata vs `safeParse`. */
export function registerZodTool<T>(
  registerSimpleTool: RegisterSimpleToolFn,
  name: string,
  description: string,
  schema: ZodObjectSchema<T>,
  handler: (args: T) => Promise<McpListResult>,
): void {
  registerSimpleTool(
    name,
    description,
    schema.shape,
    async (args: unknown): Promise<McpListResult> => {
      const parsed = schema.safeParse(args);
      if (!parsed.success) {
        throw new Error(parsed.error.message);
      }
      return handler(parsed.data);
    },
  );
}

/** Input shape matches MCP `server.tool` zod fields; typed as unknown to avoid a zod import from this shared path. */
export type RegisterSimpleToolFn = (
  name: string,
  description: string,
  inputShape: Record<string, unknown>,
  handler: (args: unknown) => Promise<McpListResult>,
) => unknown;

export function createRegisterSimpleTool(server: unknown): RegisterSimpleToolFn {
  /* Callers pass `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`. This file cannot import
   * that module: `shared/` is not a workspace package, so `tsc` does not resolve the SDK for these paths. */
  if (
    typeof server !== "object" ||
    server === null ||
    !("tool" in server) ||
    typeof (server as { tool: unknown }).tool !== "function"
  ) {
    throw new Error("createRegisterSimpleTool: expected MCP server with .tool");
  }
  const host = server as { tool: (...args: never) => unknown };
  return host.tool.bind(server) as RegisterSimpleToolFn;
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
