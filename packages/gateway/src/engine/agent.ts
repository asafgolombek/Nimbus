import { Mastra } from "@mastra/core";
import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";

import { Config } from "../config.ts";
import type {
  IndexSearchQuery,
  LocalIndex,
  TraverseGraphOptions,
} from "../index/local-index.ts";
import type { SessionMemoryStore } from "../memory/session-memory-store.ts";
import { searchPersons } from "../people/person-store.ts";
import { getAgentRequestSessionId } from "./agent-request-context.ts";
import { buildContextWindow } from "./context-ranker.ts";

export type NimbusEngineAgentDeps = {
  localIndex: LocalIndex;
  agentModel?: string;
  /** Q2 §7.0 — defaults to {@link Config.engineContextWindowItems}. */
  contextWindowItems?: number;
  /** Q2 §7.2 — defaults to {@link Config.searchServicePriorityMap}. */
  searchServicePriority?: ReadonlyMap<string, number>;
  /** When set, exposes recall/append session memory tools (requires `agent.invoke` sessionId). */
  sessionMemoryStore?: SessionMemoryStore;
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
      "Ranked search of the local SQLite index: FTS5 keywords plus optional semantic (vector) fusion when enabled. Set semantic false for keyword-only. Returns a context window (top full items) plus sourceSummary. Use fetchMoreIndexResults to page within a bucket.",
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
      const semantic = q["semantic"] !== false;
      const contextChunks =
        typeof q["contextChunks"] === "number" && Number.isFinite(q["contextChunks"])
          ? Math.min(8, Math.max(0, Math.floor(q["contextChunks"])))
          : 2;
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
      const ranked = await deps.localIndex.searchRankedAsync(query, {
        searchServicePriority: searchPriority,
        semantic,
        contextChunks,
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

  const traverseGraph = createTool({
    id: "traverseGraph",
    description:
      "Traverse the local relationship graph (PR/issue/repo/person edges from indexed items). Pass startRef as an item primary key (e.g. github:org/repo#42) or a graph_entity id. Use after locating an entity via searchLocalIndex when the user asks what is connected to an item.",
    execute: async (inputData: unknown) => {
      const q =
        inputData !== null && typeof inputData === "object" && !Array.isArray(inputData)
          ? (inputData as Record<string, unknown>)
          : {};
      const startRef = typeof q["entityId"] === "string" ? q["entityId"].trim() : "";
      if (startRef === "") {
        return { error: "entityId must be a non-empty string (item id or graph entity id)" };
      }
      const opts: TraverseGraphOptions = {};
      if (typeof q["depth"] === "number" && Number.isFinite(q["depth"])) {
        opts.depth = Math.min(8, Math.max(0, Math.floor(q["depth"])));
      }
      const relationTypesRaw = q["relationTypes"];
      if (Array.isArray(relationTypesRaw) && relationTypesRaw.every((x) => typeof x === "string")) {
        opts.relationTypes = relationTypesRaw as string[];
      }
      return deps.localIndex.traverseGraph(startRef, opts);
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
          bitbucketUuid: p.bitbucketUuid,
          microsoftUserId: p.microsoftUserId,
          discordUserId: p.discordUserId,
          linked: p.linked,
        })),
      };
    },
  });

  const listConnectors = createTool({
    id: "listConnectors",
    description:
      "List first-party index/sync connector service ids shipped in Nimbus (filesystem is always available; cloud MCPs lazy-start when credentials exist in the Vault — see lazy mesh / connector catalog).",
    execute: async () => ({
      connectors: [
        "filesystem",
        "google_drive",
        "gmail",
        "google_photos",
        "onedrive",
        "outlook",
        "teams",
        "github",
        "gitlab",
        "bitbucket",
        "slack",
        "linear",
        "jira",
        "notion",
        "confluence",
        "discord",
      ] as const,
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

  const recallSessionMemory =
    deps.sessionMemoryStore === undefined
      ? undefined
      : createTool({
          id: "recallSessionMemory",
          description:
            "Semantic recall over prior turns in the current interactive session. Requires the client to pass sessionId on agent.invoke. Use when the user refers to earlier context (e.g. 'the ones from last month').",
          execute: async (inputData: unknown) => {
            const q =
              inputData !== null && typeof inputData === "object" && !Array.isArray(inputData)
                ? (inputData as Record<string, unknown>)
                : {};
            const sid =
              typeof q["sessionId"] === "string" && q["sessionId"].trim() !== ""
                ? q["sessionId"].trim()
                : getAgentRequestSessionId();
            const queryText = typeof q["query"] === "string" ? q["query"].trim() : "";
            if (sid === undefined || sid === "") {
              return { error: "No sessionId — pass sessionId on agent.invoke or as a tool argument." };
            }
            if (queryText === "") {
              return { error: "query must be a non-empty string" };
            }
            const topK =
              typeof q["topK"] === "number" && Number.isFinite(q["topK"])
                ? Math.min(32, Math.max(1, Math.floor(q["topK"])))
                : 8;
            const store = deps.sessionMemoryStore;
            if (store === undefined) {
              return { error: "Session memory is not configured" };
            }
            const chunks = await store.recall(sid, queryText, topK);
            return { chunks };
          },
        });

  const appendSessionMemory =
    deps.sessionMemoryStore === undefined
      ? undefined
      : createTool({
          id: "appendSessionMemory",
          description:
            "Append a short text chunk to session RAG memory (user, assistant, or tool role). Normally the host appends after each turn; use sparingly for explicit user notes.",
          execute: async (inputData: unknown) => {
            const q =
              inputData !== null && typeof inputData === "object" && !Array.isArray(inputData)
                ? (inputData as Record<string, unknown>)
                : {};
            const sid =
              typeof q["sessionId"] === "string" && q["sessionId"].trim() !== ""
                ? q["sessionId"].trim()
                : getAgentRequestSessionId();
            const text = typeof q["text"] === "string" ? q["text"].trim() : "";
            const roleRaw = typeof q["role"] === "string" ? q["role"].trim() : "";
            if (sid === undefined || sid === "") {
              return { error: "No sessionId — pass sessionId on agent.invoke or as a tool argument." };
            }
            if (text === "") {
              return { error: "text must be non-empty" };
            }
            if (roleRaw !== "user" && roleRaw !== "assistant" && roleRaw !== "tool") {
              return { error: "role must be user, assistant, or tool" };
            }
            const store = deps.sessionMemoryStore;
            if (store === undefined) {
              return { error: "Session memory is not configured" };
            }
            await store.append({
              sessionId: sid,
              text,
              role: roleRaw,
              createdAt: Date.now(),
            });
            return { ok: true };
          },
        });

  let sessionHint = "";
  if (deps.sessionMemoryStore !== undefined) {
    sessionHint =
      " When the client passes sessionId on agent.invoke, use recallSessionMemory for cross-turn references and appendSessionMemory only for explicit durable notes.";
  }

  const agent = new Agent({
    id: "nimbus-q1",
    name: "Nimbus",
    instructions:
      `You are Nimbus, a local-first assistant. Use searchLocalIndex for ranked index search; it returns a window of full items plus sourceSummary for the rest—call fetchMoreIndexResults(service, indexedType, offset, limit) when the user needs more rows from a bucket. Use traverseGraph(entityId, depth?, relationTypes?) when the user asks what is linked to a PR, issue, repo, channel, or person already identified in the index. Use resolvePerson to map names to person ids before reasoning about authors. Use listConnectors and getAuditLog as needed. Do not claim you moved or deleted files unless the user already did so outside this chat.${sessionHint}`,
    model,
    tools: {
      searchLocalIndex,
      fetchMoreIndexResults,
      traverseGraph,
      resolvePerson,
      listConnectors,
      getAuditLog,
      ...(recallSessionMemory !== undefined && appendSessionMemory !== undefined
        ? { recallSessionMemory, appendSessionMemory }
        : {}),
    },
  });

  const mastra = new Mastra({
    agents: { nimbus: agent },
    logger: false,
  });

  return { mastra, agent };
}
