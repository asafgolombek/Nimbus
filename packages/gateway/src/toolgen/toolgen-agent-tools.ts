import type { ToolsInput } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { ToolgenRegistry } from "./toolgen-registry.ts";

/**
 * The model-facing surface for generated tools.
 *
 * Returns `{}` -- NO tool at all, not a disabled tool that errors when called -- when the session
 * holds none, mirroring `buildComputerUseTools`. An undefined session (a caller outside the
 * request context) likewise gets nothing rather than another session's tools.
 */
export function buildGeneratedTools(
  sessionId: string | undefined,
  registry: ToolgenRegistry,
  invoke: (toolId: string, args: Record<string, unknown>) => Promise<unknown>,
  /**
   * The I11 envelope wrapper, INJECTED because `agent.ts`'s `wrapToolForLlm` is module-private.
   * Passing it in beats exporting it: a generated tool returns a remote API's response verbatim
   * into the model's context, so it is the single most injection-prone tool surface in the tree and
   * MUST NOT be constructible without the envelope. A required parameter makes that a compile
   * error rather than a review comment.
   */
  wrap: <T>(service: string, tool: string, def: T) => T,
): ToolsInput {
  if (sessionId === undefined) return {};
  const out: ToolsInput = {};
  for (const envelope of registry.forSession(sessionId)) {
    const { toolId, description } = envelope.artifact;
    out[toolId] = wrap(
      "toolgen",
      toolId,
      createTool({
        id: toolId,
        description: `${description} (runtime-generated, approved this session)`,
        inputSchema: z.object({}).passthrough(),
        execute: async (input: unknown) => await invoke(toolId, input as Record<string, unknown>),
      }),
    );
  }
  return out;
}
