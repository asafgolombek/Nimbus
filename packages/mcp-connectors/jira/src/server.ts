/**
 * nimbus-mcp-jira — Jira Cloud REST MCP server.
 * Credentials: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN (never logged).
 * Mutations require Gateway HITL (`jira.issue.create`, `jira.issue.update`, `jira.comment.add`).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  createRegisterSimpleTool,
  createZodToolRegistrar,
  encodeBasicAuthHeader,
  mcpJsonResult as jsonResult,
  mcpJsonResultFromTextIfOk,
} from "../../shared/mcp-tool-kit.ts";
import { stripTrailingSlashes } from "../../shared/strip-trailing-slashes.ts";

function normalizeBaseUrl(raw: string): string {
  const t = stripTrailingSlashes(raw);
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
    Authorization: encodeBasicAuthHeader(email, token),
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

const registerSimpleTool = createRegisterSimpleTool(server);
const reg = createZodToolRegistrar(registerSimpleTool);

const jiraIssueListSchema = z.object({
  jql: z.string().min(1).optional(),
  startAt: z.number().int().min(0).optional(),
  maxResults: z.number().int().min(1).max(100).optional(),
});

reg(
  "jira_issue_list",
  "Search Jira issues with JQL (Jira Cloud REST POST /rest/api/3/search).",
  jiraIssueListSchema,
  async (parsed) => {
    const { baseUrl, email, token } = requireJiraConfig();
    const jql = parsed.jql ?? "order by updated DESC";
    const body = JSON.stringify({
      jql,
      startAt: parsed.startAt ?? 0,
      maxResults: parsed.maxResults ?? 50,
      fields: ["summary", "description", "updated", "status", "issuetype", "priority", "assignee"],
    });
    const res = await jiraFetch(baseUrl, email, token, "/rest/api/3/search", {
      method: "POST",
      body,
    });
    return mcpJsonResultFromTextIfOk("Jira", res, {
      jsonParseErrorMessage: "Jira: invalid JSON from search",
    });
  },
);

const jiraIssueKeySchema = z.object({ issueKey: z.string().min(1) });

reg(
  "jira_issue_get",
  "Get a Jira issue by key or id (GET /rest/api/3/issue/{issueIdOrKey}).",
  jiraIssueKeySchema,
  async (parsed) => {
    const { baseUrl, email, token } = requireJiraConfig();
    const key = encodeURIComponent(parsed.issueKey);
    const res = await jiraFetch(
      baseUrl,
      email,
      token,
      `/rest/api/3/issue/${key}?fields=summary,description,updated,status,issuetype,priority,assignee,comment`,
    );
    return mcpJsonResultFromTextIfOk("Jira", res, {
      jsonParseErrorMessage: "Jira: invalid JSON from issue get",
    });
  },
);

const jiraIssueCreateSchema = z.object({
  projectKey: z.string().min(1),
  summary: z.string().min(1),
  description: z.string().optional(),
  issueTypeName: z.string().min(1).optional(),
});

reg(
  "jira_issue_create",
  "Create a Jira issue (POST /rest/api/3/issue). Requires project key and summary.",
  jiraIssueCreateSchema,
  async (parsed) => {
    const { baseUrl, email, token } = requireJiraConfig();
    const fields: Record<string, unknown> = {
      project: { key: parsed.projectKey },
      summary: parsed.summary,
      issuetype: { name: parsed.issueTypeName ?? "Task" },
    };
    if (parsed.description !== undefined && parsed.description !== "") {
      fields["description"] = plainToAdf(parsed.description);
    }
    const body = JSON.stringify({ fields });
    const res = await jiraFetch(baseUrl, email, token, "/rest/api/3/issue", {
      method: "POST",
      body,
    });
    return mcpJsonResultFromTextIfOk("Jira", res, {
      jsonParseErrorMessage: "Jira: invalid JSON from issue create",
    });
  },
);

const jiraIssueUpdateSchema = z.object({
  issueKey: z.string().min(1),
  summary: z.string().min(1).optional(),
  description: z.string().optional(),
});

reg(
  "jira_issue_update",
  "Update summary and/or description on a Jira issue (PUT /rest/api/3/issue/{key}).",
  jiraIssueUpdateSchema,
  async (parsed) => {
    if (parsed.summary === undefined && parsed.description === undefined) {
      throw new Error("Provide summary and/or description to update");
    }
    const { baseUrl, email, token } = requireJiraConfig();
    const fields: Record<string, unknown> = {};
    if (parsed.summary !== undefined) {
      fields["summary"] = parsed.summary;
    }
    if (parsed.description !== undefined) {
      fields["description"] = plainToAdf(parsed.description);
    }
    const key = encodeURIComponent(parsed.issueKey);
    const body = JSON.stringify({ fields });
    const res = await jiraFetch(baseUrl, email, token, `/rest/api/3/issue/${key}`, {
      method: "PUT",
      body,
    });
    if (!res.ok) {
      throw new Error(`Jira ${String(res.status)}: ${res.text.slice(0, 400)}`);
    }
    return jsonResult({ ok: true, issueKey: parsed.issueKey });
  },
);

const jiraCommentAddSchema = z.object({
  issueKey: z.string().min(1),
  body: z.string().min(1),
});

reg(
  "jira_comment_add",
  "Add a comment to a Jira issue (POST /rest/api/3/issue/{key}/comment).",
  jiraCommentAddSchema,
  async (parsed) => {
    const { baseUrl, email, token } = requireJiraConfig();
    const key = encodeURIComponent(parsed.issueKey);
    const payload = JSON.stringify({ body: plainToAdf(parsed.body) });
    const res = await jiraFetch(baseUrl, email, token, `/rest/api/3/issue/${key}/comment`, {
      method: "POST",
      body: payload,
    });
    return mcpJsonResultFromTextIfOk("Jira", res, {
      jsonParseErrorMessage: "Jira: invalid JSON from comment add",
    });
  },
);

const jiraBoardListSchema = z.object({
  startAt: z.number().int().min(0).optional(),
  maxResults: z.number().int().min(1).max(50).optional(),
});

reg(
  "jira_board_list",
  "List Jira boards (GET /rest/agile/1.0/board).",
  jiraBoardListSchema,
  async (parsed) => {
    const { baseUrl, email, token } = requireJiraConfig();
    const start = parsed.startAt ?? 0;
    const max = parsed.maxResults ?? 50;
    const res = await jiraFetch(
      baseUrl,
      email,
      token,
      `/rest/agile/1.0/board?startAt=${String(start)}&maxResults=${String(max)}`,
    );
    return mcpJsonResultFromTextIfOk("Jira", res, {
      jsonParseErrorMessage: "Jira: invalid JSON from board list",
    });
  },
);

const jiraSprintListSchema = z.object({
  boardId: z.number().int().min(1),
  startAt: z.number().int().min(0).optional(),
  maxResults: z.number().int().min(1).max(50).optional(),
});

reg(
  "jira_sprint_list",
  "List sprints for a board (GET /rest/agile/1.0/board/{boardId}/sprint).",
  jiraSprintListSchema,
  async (parsed) => {
    const { baseUrl, email, token } = requireJiraConfig();
    const start = parsed.startAt ?? 0;
    const max = parsed.maxResults ?? 50;
    const bid = String(parsed.boardId);
    const res = await jiraFetch(
      baseUrl,
      email,
      token,
      `/rest/agile/1.0/board/${bid}/sprint?startAt=${String(start)}&maxResults=${String(max)}`,
    );
    return mcpJsonResultFromTextIfOk("Jira", res, {
      jsonParseErrorMessage: "Jira: invalid JSON from sprint list",
    });
  },
);

const jiraEpicListSchema = z.object({
  projectKey: z.string().min(1),
  maxResults: z.number().int().min(1).max(100).optional(),
});

reg(
  "jira_epic_list",
  "List epics in a project via JQL search.",
  jiraEpicListSchema,
  async (parsed) => {
    const { baseUrl, email, token } = requireJiraConfig();
    const pk = parsed.projectKey;
    const jql = `project = ${pk} AND issuetype = Epic ORDER BY updated DESC`;
    const body = JSON.stringify({
      jql,
      startAt: 0,
      maxResults: parsed.maxResults ?? 50,
      fields: ["summary", "updated", "status"],
    });
    const res = await jiraFetch(baseUrl, email, token, "/rest/api/3/search", {
      method: "POST",
      body,
    });
    return mcpJsonResultFromTextIfOk("Jira", res, {
      jsonParseErrorMessage: "Jira: invalid JSON from epic search",
    });
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
