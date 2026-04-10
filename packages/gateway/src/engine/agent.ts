import { Mastra } from "@mastra/core";
import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";

import { Config } from "../config.ts";
import type { IndexSearchQuery, LocalIndex } from "../index/local-index.ts";
import { searchPersons } from "../people/person-store.ts";
import { buildContextWindow } from "./context-ranker.ts";

export type NimbusEngineAgentDeps = {
  localIndex: LocalIndex;
  agentModel?: string;
  /** Q2 §7.0 — defaults to {@link Config.engineContextWindowItems}. */
  contextWindowItems?: number;
  /** Q2 §7.2 — defaults to {@link Config.searchServicePriorityMap}. */
  searchServicePriority?: ReadonlyMap<string, number>;
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
  const contextWindowItems = deps.contextWindowItems ?? Config.engineContextWindowItems;
  const searchPriority = deps.searchServicePriority ?? Config.searchServicePriorityMap;

  const searchLocalIndex = createTool({
    id: "searchLocalIndex",
    description:
      "Ranked search of the local SQLite metadata index (FTS5 when name is set). Returns a context window (top full items) plus a sourceSummary of remaining matches. Use fetchMoreIndexResults(service, indexedType, offset, limit) to page within a bucket. Use resolvePerson to map names to person ids.",
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
      const ranked = deps.localIndex.searchRanked(query, {
        searchServicePriority: searchPriority,
      });
      const window = buildContextWindow(ranked, contextWindowItems);
      return {
        totalMatches: window.totalMatches,
        itemsInWindow: window.items.length,
        items: window.items,
        sourceSummary: window.sourceSummary,
        note: "Additional matches are collapsed into sourceSummary. Call fetchMoreIndexResults with the same service and indexedType values shown in sourceSummary.type to retrieve more rows (offset starts at 0).",
      };
    },
  });

  const fetchMoreIndexResults = createTool({
    id: "fetchMoreIndexResults",
    description:
      "Fetch more index rows for a service and indexed type (raw SQLite item.type, e.g. pr, message, file). Matches sourceSummary buckets from searchLocalIndex. Ordered by modified_at descending.",
    execute: async (inputData: unknown) => {
      const q =
        inputData !== null && typeof inputData === "object" && !Array.isArray(inputData)
          ? (inputData as Record<string, unknown>)
          : {};
      const service = typeof q["service"] === "string" ? q["service"].trim() : "";
      const indexedType = typeof q["indexedType"] === "string" ? q["indexedType"].trim() : "";
      const offset =
        typeof q["offset"] === "number" && Number.isFinite(q["offset"])
          ? Math.max(0, Math.floor(q["offset"]))
          : 0;
      const limit =
        typeof q["limit"] === "number" && Number.isFinite(q["limit"])
          ? Math.min(100, Math.max(1, Math.floor(q["limit"])))
          : 20;
      if (service === "" || indexedType === "") {
        return { error: "service and indexedType are required strings" };
      }
      const items = deps.localIndex.fetchMoreItems(service, indexedType, offset, limit);
      return { count: items.length, items, offset, limit, service, indexedType };
    },
  });

  const resolvePerson = createTool({
    id: "resolvePerson",
    description:
      "Resolve a human name or handle to up to 3 candidate people in the local people graph (cross-service). Returns ids for use with listItemsForAuthor-style workflows.",
    execute: async (inputData: unknown) => {
      const q =
        inputData !== null && typeof inputData === "object" && !Array.isArray(inputData)
          ? (inputData as Record<string, unknown>)
          : {};
      const queryText = typeof q["query"] === "string" ? q["query"] : "";
      if (queryText.trim() === "") {
        return { candidates: [] as const, error: "query must be a non-empty string" };
      }
      const db = deps.localIndex.getDatabase();
      const rows = searchPersons(db, queryText, 3);
      return {
        candidates: rows.map((p) => ({
          id: p.id,
          displayName: p.displayName,
          canonicalEmail: p.canonicalEmail,
          githubLogin: p.githubLogin,
          gitlabLogin: p.gitlabLogin,
          slackHandle: p.slackHandle,
          linearMemberId: p.linearMemberId,
          jiraAccountId: p.jiraAccountId,
          notionUserId: p.notionUserId,
          linked: p.linked,
        })),
      };
    },
  });

  const listConnectors = createTool({
    id: "listConnectors",
    description:
      "List first-party MCP connector ids: filesystem always; Google bundle (Drive, Gmail, Photos) when `google.oauth` exists; Microsoft bundle (OneDrive, Outlook, Teams) when `microsoft.oauth` exists.",
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
      "You are Nimbus, a local-first assistant. Use searchLocalIndex for ranked index search; it returns a window of full items plus sourceSummary for the rest—call fetchMoreIndexResults(service, indexedType, offset, limit) when the user needs more rows from a bucket. Use resolvePerson to map names to person ids before reasoning about authors. Use listConnectors and getAuditLog as needed. Do not claim you moved or deleted files unless the user already did so outside this chat.",
    model,
    tools: {
      searchLocalIndex,
      fetchMoreIndexResults,
      resolvePerson,
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
