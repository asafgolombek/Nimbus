/**
 * nimbus-mcp-notion — Notion REST MCP server.
 * Token: NOTION_ACCESS_TOKEN (never logged). Mutations require Gateway HITL.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { joinApiPath } from "../../shared/join-api-path.ts";
import {
  createRegisterSimpleTool,
  mcpJsonResult as jsonResult,
  type McpListResult,
  registerZodTool,
  requireProcessEnv,
  type ZodObjectSchema,
} from "../../shared/mcp-tool-kit.ts";

const NOTION_VERSION = "2022-06-28";
const API = "https://api.notion.com/v1";

async function notionFetch(
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; text: string }> {
  const token = requireProcessEnv("NOTION_ACCESS_TOKEN");
  const url = joinApiPath(API, path);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
  };
  if (init?.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(url, {
    ...init,
    headers: {
      ...headers,
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

function richText(content: string): ReadonlyArray<Record<string, unknown>> {
  return [{ type: "text", text: { content: content.slice(0, 2000) } }];
}

const server = new McpServer({ name: "nimbus-notion", version: "0.1.0" });

const registerSimpleTool = createRegisterSimpleTool(server);

function reg<T>(
  name: string,
  description: string,
  schema: ZodObjectSchema<T>,
  handler: (args: T) => Promise<McpListResult>,
): void {
  registerZodTool(registerSimpleTool, name, description, schema, handler);
}

const notionSearchSchema = z.object({
  query: z.string().optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  startCursor: z.string().optional(),
});

reg(
  "notion_page_list",
  "Search Notion pages the integration can access (POST /v1/search, object filter page).",
  notionSearchSchema,
  async (parsed) => {
    const body: Record<string, unknown> = {
      filter: { property: "object", value: "page" },
      page_size: parsed.pageSize ?? 50,
    };
    if (parsed.query !== undefined && parsed.query !== "") {
      body["query"] = parsed.query;
    }
    if (parsed.startCursor !== undefined && parsed.startCursor !== "") {
      body["start_cursor"] = parsed.startCursor;
    }
    const res = await notionFetch("/search", { method: "POST", body: JSON.stringify(body) });
    if (!res.ok) {
      throw new Error(`Notion ${String(res.status)}: ${res.text.slice(0, 400)}`);
    }
    return jsonResult(JSON.parse(res.text) as unknown);
  },
);

const notionPageIdSchema = z.object({ pageId: z.string().min(1) });

reg(
  "notion_page_get",
  "Retrieve a Notion page and its direct child blocks.",
  notionPageIdSchema,
  async (parsed) => {
    const id = encodeURIComponent(parsed.pageId);
    const page = await notionFetch(`/pages/${id}`);
    if (!page.ok) {
      throw new Error(`Notion ${String(page.status)}: ${page.text.slice(0, 400)}`);
    }
    const blocks = await notionFetch(`/blocks/${id}/children?page_size=100`);
    if (!blocks.ok) {
      throw new Error(`Notion blocks ${String(blocks.status)}: ${blocks.text.slice(0, 400)}`);
    }
    return jsonResult({
      page: JSON.parse(page.text) as unknown,
      blockChildren: JSON.parse(blocks.text) as unknown,
    });
  },
);

reg(
  "notion_database_list",
  "Search Notion databases (POST /v1/search, object filter database).",
  notionSearchSchema,
  async (parsed) => {
    const body: Record<string, unknown> = {
      filter: { property: "object", value: "database" },
      page_size: parsed.pageSize ?? 50,
    };
    if (parsed.query !== undefined && parsed.query !== "") {
      body["query"] = parsed.query;
    }
    if (parsed.startCursor !== undefined && parsed.startCursor !== "") {
      body["start_cursor"] = parsed.startCursor;
    }
    const res = await notionFetch("/search", { method: "POST", body: JSON.stringify(body) });
    if (!res.ok) {
      throw new Error(`Notion ${String(res.status)}: ${res.text.slice(0, 400)}`);
    }
    return jsonResult(JSON.parse(res.text) as unknown);
  },
);

const notionDatabaseQuerySchema = z.object({
  databaseId: z.string().min(1),
  pageSize: z.number().int().min(1).max(100).optional(),
  startCursor: z.string().optional(),
});

reg(
  "notion_database_query",
  "Query a Notion database (POST /v1/databases/{id}/query).",
  notionDatabaseQuerySchema,
  async (parsed) => {
    const id = encodeURIComponent(parsed.databaseId);
    const body: Record<string, unknown> = {
      page_size: parsed.pageSize ?? 50,
    };
    if (parsed.startCursor !== undefined && parsed.startCursor !== "") {
      body["start_cursor"] = parsed.startCursor;
    }
    const res = await notionFetch(`/databases/${id}/query`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Notion ${String(res.status)}: ${res.text.slice(0, 400)}`);
    }
    return jsonResult(JSON.parse(res.text) as unknown);
  },
);

const notionBlockPagedSchema = z.object({
  blockId: z.string().min(1),
  pageSize: z.number().int().min(1).max(100).optional(),
  startCursor: z.string().optional(),
});

reg(
  "notion_block_children",
  "List child blocks of a block or page (GET /v1/blocks/{id}/children).",
  notionBlockPagedSchema,
  async (parsed) => {
    const id = encodeURIComponent(parsed.blockId);
    const qs = new URLSearchParams({
      page_size: String(parsed.pageSize ?? 50),
    });
    if (parsed.startCursor !== undefined && parsed.startCursor !== "") {
      qs.set("start_cursor", parsed.startCursor);
    }
    const res = await notionFetch(`/blocks/${id}/children?${qs.toString()}`);
    if (!res.ok) {
      throw new Error(`Notion ${String(res.status)}: ${res.text.slice(0, 400)}`);
    }
    return jsonResult(JSON.parse(res.text) as unknown);
  },
);

reg(
  "notion_comment_list",
  "List comments for a block or page (GET /v1/comments).",
  notionBlockPagedSchema,
  async (parsed) => {
    const qs = new URLSearchParams({
      block_id: parsed.blockId,
      page_size: String(parsed.pageSize ?? 50),
    });
    if (parsed.startCursor !== undefined && parsed.startCursor !== "") {
      qs.set("start_cursor", parsed.startCursor);
    }
    const res = await notionFetch(`/comments?${qs.toString()}`);
    if (!res.ok) {
      throw new Error(`Notion ${String(res.status)}: ${res.text.slice(0, 400)}`);
    }
    return jsonResult(JSON.parse(res.text) as unknown);
  },
);

const notionPageCreateSchema = z.object({
  parentPageId: z.string().min(1),
  title: z.string().min(1),
  titlePropertyName: z.string().min(1).optional(),
});

reg(
  "notion_page_create",
  "Create a page under a parent page (POST /v1/pages).",
  notionPageCreateSchema,
  async (parsed) => {
    const prop = parsed.titlePropertyName ?? "title";
    const body = {
      parent: { page_id: parsed.parentPageId },
      properties: {
        [prop]: {
          title: richText(parsed.title),
        },
      },
    };
    const res = await notionFetch("/pages", { method: "POST", body: JSON.stringify(body) });
    if (!res.ok) {
      throw new Error(`Notion ${String(res.status)}: ${res.text.slice(0, 400)}`);
    }
    return jsonResult(JSON.parse(res.text) as unknown);
  },
);

const notionPageUpdateSchema = z.object({
  pageId: z.string().min(1),
  propertiesJson: z.string().min(1),
});

reg(
  "notion_page_update",
  "Update page properties (PATCH /v1/pages/{id}). Pass properties JSON as string.",
  notionPageUpdateSchema,
  async (parsed) => {
    let props: unknown;
    try {
      props = JSON.parse(parsed.propertiesJson) as unknown;
    } catch {
      throw new Error("propertiesJson must be valid JSON");
    }
    if (props === null || typeof props !== "object" || Array.isArray(props)) {
      throw new Error("propertiesJson must be a JSON object");
    }
    const id = encodeURIComponent(parsed.pageId);
    const res = await notionFetch(`/pages/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ properties: props }),
    });
    if (!res.ok) {
      throw new Error(`Notion ${String(res.status)}: ${res.text.slice(0, 400)}`);
    }
    return jsonResult(JSON.parse(res.text) as unknown);
  },
);

const notionBlockAppendSchema = z.object({
  parentBlockId: z.string().min(1),
  childrenJson: z.string().min(1),
});

reg(
  "notion_block_append",
  "Append blocks to a parent block (PATCH /v1/blocks/{id}/children). childrenJson is a JSON array of block objects.",
  notionBlockAppendSchema,
  async (parsed) => {
    let children: unknown;
    try {
      children = JSON.parse(parsed.childrenJson) as unknown;
    } catch {
      throw new Error("childrenJson must be valid JSON");
    }
    if (!Array.isArray(children)) {
      throw new TypeError("childrenJson must be a JSON array");
    }
    const id = encodeURIComponent(parsed.parentBlockId);
    const res = await notionFetch(`/blocks/${id}/children`, {
      method: "PATCH",
      body: JSON.stringify({ children }),
    });
    if (!res.ok) {
      throw new Error(`Notion ${String(res.status)}: ${res.text.slice(0, 400)}`);
    }
    return jsonResult(JSON.parse(res.text) as unknown);
  },
);

const notionCommentCreateSchema = z.object({
  pageId: z.string().min(1),
  text: z.string().min(1),
});

reg(
  "notion_comment_create",
  "Create a comment thread on a page (POST /v1/comments).",
  notionCommentCreateSchema,
  async (parsed) => {
    const body = {
      parent: { page_id: parsed.pageId },
      rich_text: richText(parsed.text),
    };
    const res = await notionFetch("/comments", { method: "POST", body: JSON.stringify(body) });
    if (!res.ok) {
      throw new Error(`Notion ${String(res.status)}: ${res.text.slice(0, 400)}`);
    }
    return jsonResult(JSON.parse(res.text) as unknown);
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
