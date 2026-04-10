/**
 * nimbus-mcp-bitbucket — Bitbucket Cloud REST MCP server (API 2.0).
 * Username + app password via BITBUCKET_USERNAME / BITBUCKET_APP_PASSWORD (never logged).
 * PR merge requires Gateway HITL (`repo.pr.merge`).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { joinApiPath } from "../../shared/join-api-path.ts";
import {
  createRegisterSimpleTool,
  mcpJsonResult as jsonResult,
  type McpListResult,
} from "../../shared/mcp-tool-kit.ts";

const BB_API = "https://api.bitbucket.org/2.0";

function requireUsername(): string {
  const t = process.env["BITBUCKET_USERNAME"];
  if (t === undefined || t === "") {
    throw new Error("BITBUCKET_USERNAME is not set");
  }
  return t;
}

function requireAppPassword(): string {
  const t = process.env["BITBUCKET_APP_PASSWORD"];
  if (t === undefined || t === "") {
    throw new Error("BITBUCKET_APP_PASSWORD is not set");
  }
  return t;
}

function basicAuthHeader(): string {
  const user = requireUsername();
  const pass = requireAppPassword();
  const b = Buffer.from(`${user}:${pass}`, "utf8").toString("base64");
  return `Basic ${b}`;
}

function splitRepoFull(full: string): { workspace: string; repoSlug: string } {
  const i = full.indexOf("/");
  if (i <= 0 || i === full.length - 1) {
    throw new Error("repoFull must be workspace/repo_slug");
  }
  return { workspace: full.slice(0, i), repoSlug: full.slice(i + 1) };
}

async function bbFetch(
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const url = joinApiPath(BB_API, path);
  const baseHeaders: Record<string, string> = {
    Authorization: basicAuthHeader(),
    Accept: "application/json",
  };
  const extra = init?.headers as Record<string, string> | undefined;
  const headers = extra === undefined ? baseHeaders : { ...baseHeaders, ...extra };
  const res = await fetch(url, {
    ...init,
    headers,
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

const server = new McpServer({ name: "nimbus-bitbucket", version: "0.1.0" });

const registerSimpleTool = createRegisterSimpleTool(server);

const repoFullArg = z.object({
  repoFull: z
    .string()
    .min(3)
    .describe("Repository full name: workspace/repo_slug (e.g. myteam/my-service)"),
});

registerSimpleTool(
  "bitbucket_repo_list",
  "List repositories where the authenticated user is a member.",
  {
    pagelen: z.number().int().min(1).max(100).optional(),
    page: z
      .string()
      .max(2000)
      .optional()
      .describe("Opaque page URL or token from a prior next link"),
  },
  async (args: unknown): Promise<McpListResult> => {
    const schema = z.object({
      pagelen: z.number().int().min(1).max(100).optional(),
      page: z.string().max(2000).optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    if (parsed.data.page?.startsWith("http")) {
      const res = await bbFetch(parsed.data.page);
      if (!res.ok) {
        throw new Error(`Bitbucket ${String(res.status)}: ${res.text.slice(0, 300)}`);
      }
      return jsonResult(res.json);
    }
    const qs = new URLSearchParams();
    qs.set("role", "member");
    qs.set("pagelen", String(parsed.data.pagelen ?? 30));
    const res = await bbFetch(`/repositories?${qs.toString()}`);
    if (!res.ok) {
      throw new Error(`Bitbucket ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.json);
  },
);

registerSimpleTool(
  "bitbucket_pr_list",
  "List pull requests for a repository.",
  {
    ...repoFullArg.shape,
    state: z.enum(["OPEN", "MERGED", "DECLINED", "SUPERSEDED"]).optional(),
    pagelen: z.number().int().min(1).max(100).optional(),
    page: z.string().max(2000).optional().describe("Opaque next URL from a prior response"),
  },
  async (args: unknown): Promise<McpListResult> => {
    const schema = z.object({
      repoFull: z.string().min(3),
      state: z.enum(["OPEN", "MERGED", "DECLINED", "SUPERSEDED"]).optional(),
      pagelen: z.number().int().min(1).max(100).optional(),
      page: z.string().max(2000).optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    if (parsed.data.page?.startsWith("http")) {
      const res = await bbFetch(parsed.data.page);
      if (!res.ok) {
        throw new Error(`Bitbucket ${String(res.status)}: ${res.text.slice(0, 300)}`);
      }
      return jsonResult(res.json);
    }
    const { workspace, repoSlug } = splitRepoFull(parsed.data.repoFull);
    const base = `/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/pullrequests`;
    const qs = new URLSearchParams();
    qs.set("pagelen", String(parsed.data.pagelen ?? 30));
    qs.set("sort", "-updated_on");
    if (parsed.data.state !== undefined) {
      qs.set("q", `state="${parsed.data.state}"`);
    }
    const res = await bbFetch(`${base}?${qs.toString()}`);
    if (!res.ok) {
      throw new Error(`Bitbucket ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.json);
  },
);

registerSimpleTool(
  "bitbucket_pr_get",
  "Get a single pull request by numeric id.",
  {
    ...repoFullArg.shape,
    pullRequestId: z.number().int().min(1),
  },
  async (args: unknown): Promise<McpListResult> => {
    const schema = z.object({
      repoFull: z.string().min(3),
      pullRequestId: z.number().int().min(1),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const { workspace, repoSlug } = splitRepoFull(parsed.data.repoFull);
    const path = `/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/pullrequests/${String(parsed.data.pullRequestId)}`;
    const res = await bbFetch(path);
    if (!res.ok) {
      throw new Error(`Bitbucket ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.json);
  },
);

registerSimpleTool(
  "bitbucket_pr_merge",
  "Merge a pull request (requires HITL repo.pr.merge).",
  {
    ...repoFullArg.shape,
    pullRequestId: z.number().int().min(1),
    mergeStrategy: z.enum(["merge_commit", "squash", "fast_forward"]).optional(),
    message: z.string().max(32_768).optional(),
  },
  async (args: unknown): Promise<McpListResult> => {
    const schema = z.object({
      repoFull: z.string().min(3),
      pullRequestId: z.number().int().min(1),
      mergeStrategy: z.enum(["merge_commit", "squash", "fast_forward"]).optional(),
      message: z.string().max(32_768).optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const { workspace, repoSlug } = splitRepoFull(parsed.data.repoFull);
    const path = `/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/pullrequests/${String(parsed.data.pullRequestId)}/merge`;
    const body: Record<string, unknown> = { type: "pullrequest" };
    if (parsed.data.mergeStrategy !== undefined) {
      body["merge_strategy"] = parsed.data.mergeStrategy;
    }
    if (parsed.data.message !== undefined) {
      body["message"] = parsed.data.message;
    }
    const res = await bbFetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Bitbucket ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.json);
  },
);

registerSimpleTool(
  "bitbucket_pipeline_list",
  "List Pipelines runs for a repository.",
  {
    ...repoFullArg.shape,
    pagelen: z.number().int().min(1).max(100).optional(),
    page: z.string().max(2000).optional(),
  },
  async (args: unknown): Promise<McpListResult> => {
    const schema = z.object({
      repoFull: z.string().min(3),
      pagelen: z.number().int().min(1).max(100).optional(),
      page: z.string().max(2000).optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    if (parsed.data.page?.startsWith("http")) {
      const res = await bbFetch(parsed.data.page);
      if (!res.ok) {
        throw new Error(`Bitbucket ${String(res.status)}: ${res.text.slice(0, 300)}`);
      }
      return jsonResult(res.json);
    }
    const { workspace, repoSlug } = splitRepoFull(parsed.data.repoFull);
    const base = `/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/pipelines/`;
    const qs = new URLSearchParams();
    qs.set("pagelen", String(parsed.data.pagelen ?? 30));
    const res = await bbFetch(`${base}?${qs.toString()}`);
    if (!res.ok) {
      throw new Error(`Bitbucket ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.json);
  },
);

registerSimpleTool(
  "bitbucket_pipeline_get",
  "Get a single pipeline run by UUID.",
  {
    ...repoFullArg.shape,
    pipelineUuid: z.string().min(8).max(128),
  },
  async (args: unknown): Promise<McpListResult> => {
    const schema = z.object({
      repoFull: z.string().min(3),
      pipelineUuid: z.string().min(8).max(128),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const { workspace, repoSlug } = splitRepoFull(parsed.data.repoFull);
    const encUuid = encodeURIComponent(parsed.data.pipelineUuid);
    const path = `/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/pipelines/${encUuid}`;
    const res = await bbFetch(path);
    if (!res.ok) {
      throw new Error(`Bitbucket ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.json);
  },
);

registerSimpleTool(
  "bitbucket_issue_list",
  "List issues for a repository (issue tracker must be enabled).",
  {
    ...repoFullArg.shape,
    pagelen: z.number().int().min(1).max(100).optional(),
    page: z.string().max(2000).optional(),
  },
  async (args: unknown): Promise<McpListResult> => {
    const schema = z.object({
      repoFull: z.string().min(3),
      pagelen: z.number().int().min(1).max(100).optional(),
      page: z.string().max(2000).optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    if (parsed.data.page?.startsWith("http")) {
      const res = await bbFetch(parsed.data.page);
      if (!res.ok) {
        throw new Error(`Bitbucket ${String(res.status)}: ${res.text.slice(0, 300)}`);
      }
      return jsonResult(res.json);
    }
    const { workspace, repoSlug } = splitRepoFull(parsed.data.repoFull);
    const base = `/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/issues`;
    const qs = new URLSearchParams();
    qs.set("pagelen", String(parsed.data.pagelen ?? 30));
    const res = await bbFetch(`${base}?${qs.toString()}`);
    if (!res.ok) {
      throw new Error(`Bitbucket ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.json);
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

await main();
