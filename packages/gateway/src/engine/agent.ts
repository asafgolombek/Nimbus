import { Mastra } from "@mastra/core";
import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";

import { Config } from "../config.ts";
import type { IndexSearchQuery, LocalIndex } from "../index/local-index.ts";

export type NimbusEngineAgentDeps = {
  localIndex: LocalIndex;
  agentModel?: string;
};

/**
 * Q1 Mastra agent with read-only gateway tools (index search, connector list, audit tail).
 * Destructive filesystem work stays on the planner + {@link ToolExecutor} path.
 */
export function createNimbusEngineAgent(deps: NimbusEngineAgentDeps): {
  mastra: Mastra;
  agent: Agent;
} {
  const model = deps.agentModel ?? Config.agentModel;

  const searchLocalIndex = createTool({
    id: "searchLocalIndex",
    description:
      "Search the local SQLite metadata index (FTS5). Pass optional name, service, itemType, limit.",
    execute: async (inputData: unknown) => {
      const q =
        inputData !== null && typeof inputData === "object" && !Array.isArray(inputData)
          ? (inputData as Record<string, unknown>)
          : {};
      const name = typeof q["name"] === "string" ? q["name"] : undefined;
      const service = typeof q["service"] === "string" ? q["service"] : undefined;
      const itemType = typeof q["itemType"] === "string" ? q["itemType"] : undefined;
      const limit =
        typeof q["limit"] === "number" && Number.isFinite(q["limit"])
          ? Math.min(500, Math.max(1, Math.floor(q["limit"])))
          : 20;
      const query: IndexSearchQuery = { limit };
      if (name !== undefined) {
        query.name = name;
      }
      if (service !== undefined) {
        query.service = service;
      }
      if (itemType !== undefined) {
        query.itemType = itemType;
      }
      const items = deps.localIndex.search(query);
      return { count: items.length, items };
    },
  });

  const listConnectors = createTool({
    id: "listConnectors",
    description:
      "List first-party MCP connector ids: filesystem always; Google bundle (Drive, Gmail, Photos) when `google.oauth` exists; Microsoft bundle (OneDrive, Outlook) when `microsoft.oauth` exists.",
    execute: async () => ({
      connectors: ["filesystem", "google_drive", "gmail", "google_photos", "onedrive", "outlook"],
    }),
  });

  const getAuditLog = createTool({
    id: "getAuditLog",
    description: "Return recent HITL audit rows from the local index (newest first).",
    execute: async (inputData: unknown) => {
      const q =
        inputData !== null && typeof inputData === "object" && !Array.isArray(inputData)
          ? (inputData as Record<string, unknown>)
          : {};
      const limit =
        typeof q["limit"] === "number" && Number.isFinite(q["limit"])
          ? Math.min(1000, Math.max(1, Math.floor(q["limit"])))
          : 20;
      return { entries: deps.localIndex.listAudit(limit) };
    },
  });

  const agent = new Agent({
    id: "nimbus-q1",
    name: "Nimbus",
    instructions:
      "You are Nimbus, a local-first assistant. Use searchLocalIndex, listConnectors, and getAuditLog for context. Do not claim you moved or deleted files unless the user already did so outside this chat.",
    model,
    tools: {
      searchLocalIndex,
      listConnectors,
      getAuditLog,
    },
  });

  const mastra = new Mastra({
    agents: { nimbus: agent },
    logger: false,
  });

  return { mastra, agent };
}
