import { MCPClient } from "@mastra/mcp";

import type { ConnectorDispatcher, PlannedAction } from "../engine/types.ts";
import type { PlatformPaths } from "../platform/paths.ts";

/**
 * Q1 filesystem-only MCP mesh. Cloud connectors are Q2+.
 */
export async function buildConnectorMesh(paths: PlatformPaths): Promise<MCPClient> {
  return new MCPClient({
    servers: {
      filesystem: {
        command: "bunx",
        args: ["@modelcontextprotocol/server-filesystem", paths.dataDir],
      },
    },
  });
}

/** Minimal surface needed to dispatch tools (MCPClient satisfies this). */
export type McpToolListingClient = {
  listTools(): Promise<
    Record<
      string,
      {
        execute?: (input: unknown, context?: unknown) => Promise<unknown>;
      }
    >
  >;
};

/**
 * Maps {@link PlannedAction} to a Mastra namespaced MCP tool id (see `MCPClient.listTools()`).
 *
 * Resolution order:
 * 1. `action.payload.mcpToolId` when it is a non-empty string
 * 2. `action.type` (must equal the namespaced id, e.g. `filesystem_list_directory`)
 *
 * Execution input: `action.payload.input` when present; otherwise payload minus `mcpToolId` / `input`.
 */
export function createConnectorDispatcher(client: McpToolListingClient): ConnectorDispatcher {
  let toolsPromise: ReturnType<McpToolListingClient["listTools"]> | undefined;

  async function tools(): Promise<
    Record<string, { execute?: (a: unknown, b?: unknown) => Promise<unknown> }>
  > {
    if (toolsPromise === undefined) {
      toolsPromise = client.listTools();
    }
    return toolsPromise;
  }

  return {
    async dispatch(action: PlannedAction): Promise<unknown> {
      const map = await tools();
      const fromPayload = action.payload?.["mcpToolId"];
      const toolId =
        typeof fromPayload === "string" && fromPayload.length > 0 ? fromPayload : action.type;
      const tool = map[toolId];
      if (tool === undefined) {
        const available = Object.keys(map).sort().join(", ");
        throw new Error(`No MCP tool "${toolId}". Available: ${available}`);
      }
      const execute = tool.execute;
      if (execute === undefined) {
        throw new Error(`MCP tool "${toolId}" has no execute implementation`);
      }
      const input = extractToolInput(action);
      return await execute(input, {});
    },
  };
}

function extractToolInput(action: PlannedAction): unknown {
  const p = action.payload;
  if (p === undefined) {
    return {};
  }
  if (Object.hasOwn(p, "input")) {
    return p["input"];
  }
  const rest: Record<string, unknown> = { ...p };
  delete rest["mcpToolId"];
  return rest;
}
