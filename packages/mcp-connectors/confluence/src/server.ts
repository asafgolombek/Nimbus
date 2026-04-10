/**
 * nimbus-mcp-confluence — Confluence Cloud REST MCP server.
 * CONFLUENCE_BASE_URL (e.g. https://site.atlassian.net), CONFLUENCE_EMAIL, CONFLUENCE_API_TOKEN.
 * Mutations require Gateway HITL.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

type ListResult = { content: Array<{ type: "text"; text: string }> };

function jsonResult(data: unknown): ListResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function normalizeSiteBase(raw: string): string {
  const t = raw.trim().replace(/\/+$/, "");
  if (t === "") {
    throw new Error("CONFLUENCE_BASE_URL is empty");
  }
  return t.startsWith("http") ? t : `https://${t}`;
}

function wikiRoot(siteBase: string): string {
  const b = normalizeSiteBase(siteBase);
  return b.endsWith("/wiki") ? b : `${b}/wiki`;
}

function requireConfluenceConfig(): { wikiApi: string; email: string; token: string } {
  const baseRaw = process.env["CONFLUENCE_BASE_URL"];
  const email = process.env["CONFLUENCE_EMAIL"];
  const token = process.env["CONFLUENCE_API_TOKEN"];
  if (baseRaw === undefined || baseRaw.trim() === "") {
    throw new Error("CONFLUENCE_BASE_URL is not set");
  }
  if (email === undefined || email.trim() === "") {
    throw new Error("CONFLUENCE_EMAIL is not set");
  }
  if (token === undefined || token.trim() === "") {
    throw new Error("CONFLUENCE_API_TOKEN is not set");
  }
  return {
    wikiApi: `${wikiRoot(baseRaw)}/rest/api`,
    email: email.trim(),
    token: token.trim(),
  };
}

function basicAuthHeader(email: string, token: string): string {
  const raw = `${email}:${token}`;
  const b64 = Buffer.from(raw, "utf8").toString("base64");
  return `Basic ${b64}`;
}

async function confFetch(
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; text: string }> {
  const { wikiApi, email, token } = requireConfluenceConfig();
  const url = path.startsWith("http")
    ? path
    : `${wikiApi}${path.startsWith("/") ? path : `/${path}`}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: basicAuthHeader(email, token),
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

const server = new McpServer({ name: "nimbus-confluence", version: "0.1.0" });

const registerSimpleTool = server.tool.bind(server) as (
  name: string,
  description: string,
  inputShape: Record<string, z.ZodTypeAny>,
  handler: (args: unknown) => Promise<ListResult>,
) => unknown;

registerSimpleTool(
  "confluence_space_list",
  "List Confluence spaces (GET /space).",
  { limit: z.number().int().min(1).max(100).optional(), start: z.number().int().min(0).optional() },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      limit: z.number().int().min(1).max(100).optional(),
      start: z.number().int().min(0).optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const qs = new URLSearchParams({
      limit: String(parsed.data.limit ?? 25),
      start: String(parsed.data.start ?? 0),
    });
    const res = await confFetch(`/space?${qs.toString()}`);
    if (!res.ok) {
      throw new Error(`Confluence ${String(res.status)}: ${res.text.slice(0, 400)}`);
    }
    return jsonResult(JSON.parse(res.text) as unknown);
  },
);

registerSimpleTool(
  "confluence_page_list",
  "List pages in a space (GET /content, type=page).",
  {
    spaceKey: z.string().min(1),
    limit: z.number().int().min(1).max(100).optional(),
    start: z.number().int().min(0).optional(),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      spaceKey: z.string().min(1),
      limit: z.number().int().min(1).max(100).optional(),
      start: z.number().int().min(0).optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const qs = new URLSearchParams({
      type: "page",
      spaceKey: parsed.data.spaceKey,
      limit: String(parsed.data.limit ?? 50),
      start: String(parsed.data.start ?? 0),
      expand: "history.lastUpdated,version",
    });
    const res = await confFetch(`/content?${qs.toString()}`);
    if (!res.ok) {
      throw new Error(`Confluence ${String(res.status)}: ${res.text.slice(0, 400)}`);
    }
    return jsonResult(JSON.parse(res.text) as unknown);
  },
);

registerSimpleTool(
  "confluence_page_get",
  "Get a Confluence page with body.storage (GET /content/{id}).",
  { pageId: z.string().min(1) },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({ pageId: z.string().min(1) });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const id = encodeURIComponent(parsed.data.pageId);
    const res = await confFetch(
      `/content/${id}?expand=body.storage,version,history.lastUpdated,space`,
    );
    if (!res.ok) {
      throw new Error(`Confluence ${String(res.status)}: ${res.text.slice(0, 400)}`);
    }
    return jsonResult(JSON.parse(res.text) as unknown);
  },
);

registerSimpleTool(
  "confluence_blogpost_list",
  "List blog posts in a space (GET /content, type=blogpost).",
  {
    spaceKey: z.string().min(1),
    limit: z.number().int().min(1).max(100).optional(),
    start: z.number().int().min(0).optional(),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      spaceKey: z.string().min(1),
      limit: z.number().int().min(1).max(100).optional(),
      start: z.number().int().min(0).optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const qs = new URLSearchParams({
      type: "blogpost",
      spaceKey: parsed.data.spaceKey,
      limit: String(parsed.data.limit ?? 25),
      start: String(parsed.data.start ?? 0),
      expand: "history.lastUpdated,version",
    });
    const res = await confFetch(`/content?${qs.toString()}`);
    if (!res.ok) {
      throw new Error(`Confluence ${String(res.status)}: ${res.text.slice(0, 400)}`);
    }
    return jsonResult(JSON.parse(res.text) as unknown);
  },
);

registerSimpleTool(
  "confluence_blogpost_get",
  "Get a blog post by id (GET /content/{id}).",
  { postId: z.string().min(1) },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({ postId: z.string().min(1) });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const id = encodeURIComponent(parsed.data.postId);
    const res = await confFetch(
      `/content/${id}?expand=body.storage,version,history.lastUpdated,space`,
    );
    if (!res.ok) {
      throw new Error(`Confluence ${String(res.status)}: ${res.text.slice(0, 400)}`);
    }
    return jsonResult(JSON.parse(res.text) as unknown);
  },
);

registerSimpleTool(
  "confluence_comment_list",
  "List footer comments on a page (GET /content/{id}/child/comment).",
  {
    pageId: z.string().min(1),
    limit: z.number().int().min(1).max(100).optional(),
    start: z.number().int().min(0).optional(),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      pageId: z.string().min(1),
      limit: z.number().int().min(1).max(100).optional(),
      start: z.number().int().min(0).optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const id = encodeURIComponent(parsed.data.pageId);
    const qs = new URLSearchParams({
      limit: String(parsed.data.limit ?? 50),
      start: String(parsed.data.start ?? 0),
      expand: "body.storage,version",
    });
    const res = await confFetch(`/content/${id}/child/comment?${qs.toString()}`);
    if (!res.ok) {
      throw new Error(`Confluence ${String(res.status)}: ${res.text.slice(0, 400)}`);
    }
    return jsonResult(JSON.parse(res.text) as unknown);
  },
);

registerSimpleTool(
  "confluence_page_create",
  "Create a page in a space (POST /content). Optional parentPageId.",
  {
    spaceKey: z.string().min(1),
    title: z.string().min(1),
    storageHtml: z.string().min(1),
    parentPageId: z.string().min(1).optional(),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      spaceKey: z.string().min(1),
      title: z.string().min(1),
      storageHtml: z.string().min(1),
      parentPageId: z.string().min(1).optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const body: Record<string, unknown> = {
      type: "page",
      title: parsed.data.title,
      space: { key: parsed.data.spaceKey },
      body: {
        storage: {
          value: parsed.data.storageHtml,
          representation: "storage",
        },
      },
    };
    if (parsed.data.parentPageId !== undefined) {
      body["ancestors"] = [{ id: parsed.data.parentPageId }];
    }
    const res = await confFetch("/content", { method: "POST", body: JSON.stringify(body) });
    if (!res.ok) {
      throw new Error(`Confluence ${String(res.status)}: ${res.text.slice(0, 400)}`);
    }
    return jsonResult(JSON.parse(res.text) as unknown);
  },
);

registerSimpleTool(
  "confluence_page_update",
  "Update page body and bump version (PUT /content/{id}). Pass current version number and title.",
  {
    pageId: z.string().min(1),
    versionNumber: z.number().int().min(1),
    title: z.string().min(1),
    storageHtml: z.string().min(1),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      pageId: z.string().min(1),
      versionNumber: z.number().int().min(1),
      title: z.string().min(1),
      storageHtml: z.string().min(1),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const id = encodeURIComponent(parsed.data.pageId);
    const body: Record<string, unknown> = {
      type: "page",
      title: parsed.data.title,
      version: { number: parsed.data.versionNumber + 1, message: "nimbus" },
      body: {
        storage: {
          value: parsed.data.storageHtml,
          representation: "storage",
        },
      },
    };
    const res = await confFetch(`/content/${id}`, { method: "PUT", body: JSON.stringify(body) });
    if (!res.ok) {
      throw new Error(`Confluence ${String(res.status)}: ${res.text.slice(0, 400)}`);
    }
    return jsonResult(JSON.parse(res.text) as unknown);
  },
);

registerSimpleTool(
  "confluence_comment_add",
  "Add a footer comment to a page (POST /content/{id}/child/comment).",
  { pageId: z.string().min(1), storageHtml: z.string().min(1) },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      pageId: z.string().min(1),
      storageHtml: z.string().min(1),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const id = encodeURIComponent(parsed.data.pageId);
    const body = {
      type: "comment",
      container: { id: parsed.data.pageId, type: "page" },
      body: {
        storage: {
          value: parsed.data.storageHtml,
          representation: "storage",
        },
      },
    };
    const res = await confFetch(`/content/${id}/child/comment`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Confluence ${String(res.status)}: ${res.text.slice(0, 400)}`);
    }
    return jsonResult(JSON.parse(res.text) as unknown);
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

void main();
