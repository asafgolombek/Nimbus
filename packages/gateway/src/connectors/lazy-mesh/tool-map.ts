import type { MCPClient } from "@mastra/mcp";

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

export type LazyMeshToolMap = Record<
  string,
  { execute?: (input: unknown, context?: unknown) => Promise<unknown> }
>;

export async function listLazyMeshClientTools(
  client: MCPClient | undefined,
): Promise<LazyMeshToolMap> {
  if (client === undefined) {
    return {};
  }
  return (await client.listTools()) as LazyMeshToolMap;
}

/** Minimal logger shape — accepts the pino `(bindings, msg)` form. */
export interface MeshLogger {
  warn(bindings: Record<string, unknown>, msg?: string): void;
}
