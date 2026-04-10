/**
 * nimbus-mcp-gitlab — GitLab REST MCP server (API v4).
 * PAT is injected as GITLAB_PAT (PRIVATE-TOKEN). Optional GITLAB_API_BASE_URL for self-hosted.
 * MR merge requires Gateway HITL (`repo.pr.merge`).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

type ListResult = { content: Array<{ type: "text"; text: string }> };

function jsonResult(data: unknown): ListResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function requirePat(): string {
  const t = process.env["GITLAB_PAT"];
  if (t === undefined || t === "") {
    throw new Error("GITLAB_PAT is not set");
  }
  return t;
}

function apiBase(): string {
  const b = process.env["GITLAB_API_BASE_URL"];
  if (b !== undefined && b.trim() !== "") {
    return b.replace(/\/+$/, "");
  }
  return "https://gitlab.com/api/v4";
}

async function glFetch(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const base = apiBase();
  const url = path.startsWith("http") ? path : `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "PRIVATE-TOKEN": token,
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text };
}

const server = new McpServer({ name: "nimbus-gitlab", version: "0.1.0" });

const registerSimpleTool = server.tool.bind(server) as (
  name: string,
  description: string,
  inputShape: Record<string, z.ZodTypeAny>,
  handler: (args: unknown) => Promise<ListResult>,
) => unknown;

const projectPathArg = z.object({
  projectPath: z
    .string()
    .min(1)
    .describe("URL-encoded path or numeric project id, e.g. group/repo"),
});

registerSimpleTool(
  "gitlab_project_list",
  "List projects visible to the authenticated user (membership).",
  {
    perPage: z.number().int().min(1).max(100).optional(),
    page: z.number().int().min(1).optional(),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      perPage: z.number().int().min(1).max(100).optional(),
      page: z.number().int().min(1).optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requirePat();
    const u = new URL(`${apiBase()}/projects`);
    u.searchParams.set("membership", "true");
    u.searchParams.set("order_by", "last_activity_at");
    u.searchParams.set("sort", "desc");
    u.searchParams.set("per_page", String(parsed.data.perPage ?? 30));
    if (parsed.data.page !== undefined) {
      u.searchParams.set("page", String(parsed.data.page));
    }
    const res = await glFetch(token, `${u.pathname}${u.search}`);
    if (!res.ok) {
      throw new Error(`GitLab ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.json);
  },
);

registerSimpleTool(
  "gitlab_mr_list",
  "List merge requests for a project.",
  {
    ...projectPathArg.shape,
    state: z.enum(["opened", "closed", "locked", "merged", "all"]).optional(),
    perPage: z.number().int().min(1).max(100).optional(),
    page: z.number().int().min(1).optional(),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      projectPath: z.string().min(1),
      state: z.enum(["opened", "closed", "locked", "merged", "all"]).optional(),
      perPage: z.number().int().min(1).max(100).optional(),
      page: z.number().int().min(1).optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requirePat();
    const enc = encodeURIComponent(parsed.data.projectPath);
    const u = new URL(`${apiBase()}/projects/${enc}/merge_requests`);
    u.searchParams.set("state", parsed.data.state ?? "opened");
    u.searchParams.set("per_page", String(parsed.data.perPage ?? 30));
    if (parsed.data.page !== undefined) {
      u.searchParams.set("page", String(parsed.data.page));
    }
    const res = await glFetch(token, `${u.pathname}${u.search}`);
    if (!res.ok) {
      throw new Error(`GitLab ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.json);
  },
);

registerSimpleTool(
  "gitlab_mr_get",
  "Get a single merge request by IID.",
  {
    ...projectPathArg.shape,
    mergeRequestIid: z.number().int().min(1),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      projectPath: z.string().min(1),
      mergeRequestIid: z.number().int().min(1),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requirePat();
    const enc = encodeURIComponent(parsed.data.projectPath);
    const path = `/projects/${enc}/merge_requests/${String(parsed.data.mergeRequestIid)}`;
    const res = await glFetch(token, path);
    if (!res.ok) {
      throw new Error(`GitLab ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.json);
  },
);

registerSimpleTool(
  "gitlab_mr_merge",
  "Merge a merge request (requires HITL repo.pr.merge).",
  {
    ...projectPathArg.shape,
    mergeRequestIid: z.number().int().min(1),
    mergeCommitMessage: z.string().max(10_000).optional(),
    squash: z.boolean().optional(),
    shouldRemoveSourceBranch: z.boolean().optional(),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      projectPath: z.string().min(1),
      mergeRequestIid: z.number().int().min(1),
      mergeCommitMessage: z.string().max(10_000).optional(),
      squash: z.boolean().optional(),
      shouldRemoveSourceBranch: z.boolean().optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requirePat();
    const enc = encodeURIComponent(parsed.data.projectPath);
    const path = `/projects/${enc}/merge_requests/${String(parsed.data.mergeRequestIid)}/merge`;
    const body: Record<string, unknown> = {};
    if (parsed.data.mergeCommitMessage !== undefined) {
      body["merge_commit_message"] = parsed.data.mergeCommitMessage;
    }
    if (parsed.data.squash !== undefined) {
      body["squash"] = parsed.data.squash;
    }
    if (parsed.data.shouldRemoveSourceBranch !== undefined) {
      body["should_remove_source_branch"] = parsed.data.shouldRemoveSourceBranch;
    }
    const res = await glFetch(token, path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`GitLab ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.json);
  },
);

registerSimpleTool(
  "gitlab_issue_list",
  "List issues for a project.",
  {
    ...projectPathArg.shape,
    state: z.enum(["opened", "closed", "all"]).optional(),
    perPage: z.number().int().min(1).max(100).optional(),
    page: z.number().int().min(1).optional(),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      projectPath: z.string().min(1),
      state: z.enum(["opened", "closed", "all"]).optional(),
      perPage: z.number().int().min(1).max(100).optional(),
      page: z.number().int().min(1).optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requirePat();
    const enc = encodeURIComponent(parsed.data.projectPath);
    const u = new URL(`${apiBase()}/projects/${enc}/issues`);
    u.searchParams.set("state", parsed.data.state ?? "opened");
    u.searchParams.set("per_page", String(parsed.data.perPage ?? 30));
    if (parsed.data.page !== undefined) {
      u.searchParams.set("page", String(parsed.data.page));
    }
    const res = await glFetch(token, `${u.pathname}${u.search}`);
    if (!res.ok) {
      throw new Error(`GitLab ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.json);
  },
);

registerSimpleTool(
  "gitlab_issue_get",
  "Get a single issue by IID.",
  {
    ...projectPathArg.shape,
    issueIid: z.number().int().min(1),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      projectPath: z.string().min(1),
      issueIid: z.number().int().min(1),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requirePat();
    const enc = encodeURIComponent(parsed.data.projectPath);
    const path = `/projects/${enc}/issues/${String(parsed.data.issueIid)}`;
    const res = await glFetch(token, path);
    if (!res.ok) {
      throw new Error(`GitLab ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.json);
  },
);

registerSimpleTool(
  "gitlab_pipeline_list",
  "List CI pipelines for a project.",
  {
    ...projectPathArg.shape,
    ref: z.string().max(500).optional(),
    status: z.string().max(64).optional(),
    perPage: z.number().int().min(1).max(100).optional(),
    page: z.number().int().min(1).optional(),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      projectPath: z.string().min(1),
      ref: z.string().max(500).optional(),
      status: z.string().max(64).optional(),
      perPage: z.number().int().min(1).max(100).optional(),
      page: z.number().int().min(1).optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requirePat();
    const enc = encodeURIComponent(parsed.data.projectPath);
    const u = new URL(`${apiBase()}/projects/${enc}/pipelines`);
    u.searchParams.set("per_page", String(parsed.data.perPage ?? 30));
    if (parsed.data.page !== undefined) {
      u.searchParams.set("page", String(parsed.data.page));
    }
    if (parsed.data.ref !== undefined) {
      u.searchParams.set("ref", parsed.data.ref);
    }
    if (parsed.data.status !== undefined) {
      u.searchParams.set("status", parsed.data.status);
    }
    const res = await glFetch(token, `${u.pathname}${u.search}`);
    if (!res.ok) {
      throw new Error(`GitLab ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.json);
  },
);

registerSimpleTool(
  "gitlab_pipeline_get",
  "Get a single pipeline by id.",
  {
    ...projectPathArg.shape,
    pipelineId: z.number().int().min(1),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      projectPath: z.string().min(1),
      pipelineId: z.number().int().min(1),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requirePat();
    const enc = encodeURIComponent(parsed.data.projectPath);
    const path = `/projects/${enc}/pipelines/${String(parsed.data.pipelineId)}`;
    const res = await glFetch(token, path);
    if (!res.ok) {
      throw new Error(`GitLab ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.json);
  },
);

registerSimpleTool(
  "gitlab_job_trace",
  "Download plain-text trace for a CI job (by job id).",
  {
    ...projectPathArg.shape,
    jobId: z.number().int().min(1),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      projectPath: z.string().min(1),
      jobId: z.number().int().min(1),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requirePat();
    const enc = encodeURIComponent(parsed.data.projectPath);
    const url = `${apiBase()}/projects/${enc}/jobs/${String(parsed.data.jobId)}/trace`;
    const res = await fetch(url, { headers: { "PRIVATE-TOKEN": token } });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`GitLab ${String(res.status)}: ${text.slice(0, 300)}`);
    }
    return jsonResult({ trace: text });
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

await main();
