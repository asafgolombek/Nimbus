/**
 * nimbus-mcp-jira — Jira Cloud REST MCP server.
 * Credentials: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN (never logged).
 * Mutations require Gateway HITL (`jira.issue.create`, `jira.issue.update`, `jira.comment.add`).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

type ListResult = { content: Array<{ type: "text"; text: string }> };

function jsonResult(data: unknown): ListResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function normalizeBaseUrl(raw: string): string {
  const t = raw.trim().replace(/\/+$/, "");
  if (t === "") {
    throw new Error("JIRA_BASE_URL is empty");
  }
  return t.startsWith("http") ? t : `https://${t}`;
}

function requireJiraConfig(): { baseUrl: string; email: string; token: string } {
  const baseRaw = process.env["JIRA_BASE_URL"];
  const email = process.env["JIRA_EMAIL"];
  const token = process.env["JIRA_API_TOKEN"];
  if (baseRaw === undefined || baseRaw.trim() === "") {
    throw new Error("JIRA_BASE_URL is not set");
  }
  if (email === undefined || email.trim() === "") {
    throw new Error("JIRA_EMAIL is not set");
  }
  if (token === undefined || token.trim() === "") {
    throw new Error("JIRA_API_TOKEN is not set");
  }
  return { baseUrl: normalizeBaseUrl(baseRaw), email: email.trim(), token: token.trim() };
}

function basicAuthHeader(email: string, token: string): string {
  const raw = `${email}:${token}`;
  const b64 = Buffer.from(raw, "utf8").toString("base64");
  return `Basic ${b64}`;
}

async function jiraFetch(
  baseUrl: string,
  email: string,
  token: string,
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; text: string }> {
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
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

function plainToAdf(text: string): Record<string, unknown> {
  return {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text }],
      },
    ],
  };
}

const server = new McpServer({ name: "nimbus-jira", version: "0.1.0" });

const registerSimpleTool = server.tool.bind(server) as (
  name: string,
  description: string,
  inputShape: Record<string, z.ZodTypeAny>,
  handler: (args: unknown) => Promise<ListResult>,
) => unknown;

registerSimpleTool(
  "jira_issue_list",
  "Search Jira issues with JQL (Jira Cloud REST POST /rest/api/3/search).",
  {
    jql: z.string().min(1).optional(),
    startAt: z.number().int().min(0).optional(),
    maxResults: z.number().int().min(1).max(100).optional(),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      jql: z.string().min(1).optional(),
      startAt: z.number().int().min(0).optional(),
      maxResults: z.number().int().min(1).max(100).optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const { baseUrl, email, token } = requireJiraConfig();
    const jql = parsed.data.jql ?? "order by updated DESC";
    const body = JSON.stringify({
      jql,
      startAt: parsed.data.startAt ?? 0,
      maxResults: parsed.data.maxResults ?? 50,
      fields: ["summary", "description", "updated", "status", "issuetype", "priority", "assignee"],
    });
    const res = await jiraFetch(baseUrl, email, token, "/rest/api/3/search", {
      method: "POST",
      body,
    });
    if (!res.ok) {
      throw new Error(`Jira ${String(res.status)}: ${res.text.slice(0, 400)}`);
    }
    let data: unknown;
    try {
      data = JSON.parse(res.text) as unknown;
    } catch {
      throw new Error("Jira: invalid JSON from search");
    }
    return jsonResult(data);
  },
);

registerSimpleTool(
  "jira_issue_get",
  "Get a Jira issue by key or id (GET /rest/api/3/issue/{issueIdOrKey}).",
  { issueKey: z.string().min(1) },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({ issueKey: z.string().min(1) });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const { baseUrl, email, token } = requireJiraConfig();
    const key = encodeURIComponent(parsed.data.issueKey);
    const res = await jiraFetch(
      baseUrl,
      email,
      token,
      `/rest/api/3/issue/${key}?fields=summary,description,updated,status,issuetype,priority,assignee,comment`,
    );
    if (!res.ok) {
      throw new Error(`Jira ${String(res.status)}: ${res.text.slice(0, 400)}`);
    }
    let data: unknown;
    try {
      data = JSON.parse(res.text) as unknown;
    } catch {
      throw new Error("Jira: invalid JSON from issue get");
    }
    return jsonResult(data);
  },
);

registerSimpleTool(
  "jira_issue_create",
  "Create a Jira issue (POST /rest/api/3/issue). Requires project key and summary.",
  {
    projectKey: z.string().min(1),
    summary: z.string().min(1),
    description: z.string().optional(),
    issueTypeName: z.string().min(1).optional(),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      projectKey: z.string().min(1),
      summary: z.string().min(1),
      description: z.string().optional(),
      issueTypeName: z.string().min(1).optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const { baseUrl, email, token } = requireJiraConfig();
    const fields: Record<string, unknown> = {
      project: { key: parsed.data.projectKey },
      summary: parsed.data.summary,
      issuetype: { name: parsed.data.issueTypeName ?? "Task" },
    };
    if (parsed.data.description !== undefined && parsed.data.description !== "") {
      fields["description"] = plainToAdf(parsed.data.description);
    }
    const body = JSON.stringify({ fields });
    const res = await jiraFetch(baseUrl, email, token, "/rest/api/3/issue", {
      method: "POST",
      body,
    });
    if (!res.ok) {
      throw new Error(`Jira ${String(res.status)}: ${res.text.slice(0, 400)}`);
    }
    let data: unknown;
    try {
      data = JSON.parse(res.text) as unknown;
    } catch {
      throw new Error("Jira: invalid JSON from issue create");
    }
    return jsonResult(data);
  },
);

registerSimpleTool(
  "jira_issue_update",
  "Update summary and/or description on a Jira issue (PUT /rest/api/3/issue/{key}).",
  {
    issueKey: z.string().min(1),
    summary: z.string().min(1).optional(),
    description: z.string().optional(),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      issueKey: z.string().min(1),
      summary: z.string().min(1).optional(),
      description: z.string().optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    if (parsed.data.summary === undefined && parsed.data.description === undefined) {
      throw new Error("Provide summary and/or description to update");
    }
    const { baseUrl, email, token } = requireJiraConfig();
    const fields: Record<string, unknown> = {};
    if (parsed.data.summary !== undefined) {
      fields["summary"] = parsed.data.summary;
    }
    if (parsed.data.description !== undefined) {
      fields["description"] = plainToAdf(parsed.data.description);
    }
    const key = encodeURIComponent(parsed.data.issueKey);
    const body = JSON.stringify({ fields });
    const res = await jiraFetch(baseUrl, email, token, `/rest/api/3/issue/${key}`, {
      method: "PUT",
      body,
    });
    if (!res.ok) {
      throw new Error(`Jira ${String(res.status)}: ${res.text.slice(0, 400)}`);
    }
    return jsonResult({ ok: true, issueKey: parsed.data.issueKey });
  },
);

registerSimpleTool(
  "jira_comment_add",
  "Add a comment to a Jira issue (POST /rest/api/3/issue/{key}/comment).",
  { issueKey: z.string().min(1), body: z.string().min(1) },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      issueKey: z.string().min(1),
      body: z.string().min(1),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const { baseUrl, email, token } = requireJiraConfig();
    const key = encodeURIComponent(parsed.data.issueKey);
    const payload = JSON.stringify({ body: plainToAdf(parsed.data.body) });
    const res = await jiraFetch(baseUrl, email, token, `/rest/api/3/issue/${key}/comment`, {
      method: "POST",
      body: payload,
    });
    if (!res.ok) {
      throw new Error(`Jira ${String(res.status)}: ${res.text.slice(0, 400)}`);
    }
    let data: unknown;
    try {
      data = JSON.parse(res.text) as unknown;
    } catch {
      throw new Error("Jira: invalid JSON from comment add");
    }
    return jsonResult(data);
  },
);

registerSimpleTool(
  "jira_board_list",
  "List Jira boards (GET /rest/agile/1.0/board).",
  {
    startAt: z.number().int().min(0).optional(),
    maxResults: z.number().int().min(1).max(50).optional(),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      startAt: z.number().int().min(0).optional(),
      maxResults: z.number().int().min(1).max(50).optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const { baseUrl, email, token } = requireJiraConfig();
    const start = parsed.data.startAt ?? 0;
    const max = parsed.data.maxResults ?? 50;
    const res = await jiraFetch(
      baseUrl,
      email,
      token,
      `/rest/agile/1.0/board?startAt=${String(start)}&maxResults=${String(max)}`,
    );
    if (!res.ok) {
      throw new Error(`Jira ${String(res.status)}: ${res.text.slice(0, 400)}`);
    }
    let data: unknown;
    try {
      data = JSON.parse(res.text) as unknown;
    } catch {
      throw new Error("Jira: invalid JSON from board list");
    }
    return jsonResult(data);
  },
);

registerSimpleTool(
  "jira_sprint_list",
  "List sprints for a board (GET /rest/agile/1.0/board/{boardId}/sprint).",
  {
    boardId: z.number().int().min(1),
    startAt: z.number().int().min(0).optional(),
    maxResults: z.number().int().min(1).max(50).optional(),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      boardId: z.number().int().min(1),
      startAt: z.number().int().min(0).optional(),
      maxResults: z.number().int().min(1).max(50).optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const { baseUrl, email, token } = requireJiraConfig();
    const start = parsed.data.startAt ?? 0;
    const max = parsed.data.maxResults ?? 50;
    const bid = String(parsed.data.boardId);
    const res = await jiraFetch(
      baseUrl,
      email,
      token,
      `/rest/agile/1.0/board/${bid}/sprint?startAt=${String(start)}&maxResults=${String(max)}`,
    );
    if (!res.ok) {
      throw new Error(`Jira ${String(res.status)}: ${res.text.slice(0, 400)}`);
    }
    let data: unknown;
    try {
      data = JSON.parse(res.text) as unknown;
    } catch {
      throw new Error("Jira: invalid JSON from sprint list");
    }
    return jsonResult(data);
  },
);

registerSimpleTool(
  "jira_epic_list",
  "List epics in a project via JQL search.",
  {
    projectKey: z.string().min(1),
    maxResults: z.number().int().min(1).max(100).optional(),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      projectKey: z.string().min(1),
      maxResults: z.number().int().min(1).max(100).optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const { baseUrl, email, token } = requireJiraConfig();
    const pk = parsed.data.projectKey;
    const jql = `project = ${pk} AND issuetype = Epic ORDER BY updated DESC`;
    const body = JSON.stringify({
      jql,
      startAt: 0,
      maxResults: parsed.data.maxResults ?? 50,
      fields: ["summary", "updated", "status"],
    });
    const res = await jiraFetch(baseUrl, email, token, "/rest/api/3/search", {
      method: "POST",
      body,
    });
    if (!res.ok) {
      throw new Error(`Jira ${String(res.status)}: ${res.text.slice(0, 400)}`);
    }
    let data: unknown;
    try {
      data = JSON.parse(res.text) as unknown;
    } catch {
      throw new Error("Jira: invalid JSON from epic search");
    }
    return jsonResult(data);
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

void main();
