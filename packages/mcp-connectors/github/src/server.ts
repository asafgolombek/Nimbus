/**
 * nimbus-mcp-github — GitHub REST MCP server.
 * Personal access token is injected as GITHUB_PAT (never logged).
 * Mutating repo operations require Gateway HITL (`repo.pr.merge`, `repo.pr.close`, …).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { fetchBearerAuthorizedJson } from "../../shared/fetch-bearer-json.ts";

const GH_API = "https://api.github.com";
const GH_HEADERS: Record<string, string> = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

function requirePat(): string {
  const t = process.env["GITHUB_PAT"];
  if (t === undefined || t === "") {
    throw new Error("GITHUB_PAT is not set");
  }
  return t;
}

type ListResult = { content: Array<{ type: "text"; text: string }> };

function jsonResult(data: unknown): ListResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

async function ghFetch(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const url = path.startsWith("http") ? path : `${GH_API}${path}`;
  return fetchBearerAuthorizedJson(url, token, init, GH_HEADERS);
}

const server = new McpServer({ name: "nimbus-github", version: "0.1.0" });

const registerSimpleTool = server.tool.bind(server) as (
  name: string,
  description: string,
  inputShape: Record<string, z.ZodTypeAny>,
  handler: (args: unknown) => Promise<ListResult>,
) => unknown;

const repoSlugArgs = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
});

registerSimpleTool(
  "github_repo_list",
  "List repositories for the authenticated user (affiliation: owner, collaborator, organization_member).",
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
    const u = new URL(`${GH_API}/user/repos`);
    u.searchParams.set("per_page", String(parsed.data.perPage ?? 30));
    if (parsed.data.page !== undefined) {
      u.searchParams.set("page", String(parsed.data.page));
    }
    u.searchParams.set("sort", "updated");
    u.searchParams.set("affiliation", "owner,collaborator,organization_member");
    const res = await ghFetch(token, `${u.pathname}${u.search}`);
    if (!res.ok) {
      throw new Error(`GitHub ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.json);
  },
);

registerSimpleTool(
  "github_repo_get",
  "Get repository metadata (owner/repo).",
  repoSlugArgs.shape,
  async (args: unknown): Promise<ListResult> => {
    const parsed = repoSlugArgs.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requirePat();
    const path = `/repos/${encodeURIComponent(parsed.data.owner)}/${encodeURIComponent(parsed.data.repo)}`;
    const res = await ghFetch(token, path);
    if (!res.ok) {
      throw new Error(`GitHub ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.json);
  },
);

registerSimpleTool(
  "github_pr_list",
  "List pull requests for a repository.",
  {
    ...repoSlugArgs.shape,
    state: z.enum(["open", "closed", "all"]).optional(),
    perPage: z.number().int().min(1).max(100).optional(),
    page: z.number().int().min(1).optional(),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      owner: z.string().min(1),
      repo: z.string().min(1),
      state: z.enum(["open", "closed", "all"]).optional(),
      perPage: z.number().int().min(1).max(100).optional(),
      page: z.number().int().min(1).optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requirePat();
    const u = new URL(
      `${GH_API}/repos/${encodeURIComponent(parsed.data.owner)}/${encodeURIComponent(parsed.data.repo)}/pulls`,
    );
    u.searchParams.set("state", parsed.data.state ?? "open");
    u.searchParams.set("per_page", String(parsed.data.perPage ?? 30));
    if (parsed.data.page !== undefined) {
      u.searchParams.set("page", String(parsed.data.page));
    }
    u.searchParams.set("sort", "updated");
    u.searchParams.set("direction", "desc");
    const res = await ghFetch(token, `${u.pathname}${u.search}`);
    if (!res.ok) {
      throw new Error(`GitHub ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.json);
  },
);

registerSimpleTool(
  "github_pr_get",
  "Get a single pull request by number.",
  {
    ...repoSlugArgs.shape,
    pullNumber: z.number().int().min(1),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      owner: z.string().min(1),
      repo: z.string().min(1),
      pullNumber: z.number().int().min(1),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requirePat();
    const path = `/repos/${encodeURIComponent(parsed.data.owner)}/${encodeURIComponent(parsed.data.repo)}/pulls/${String(parsed.data.pullNumber)}`;
    const res = await ghFetch(token, path);
    if (!res.ok) {
      throw new Error(`GitHub ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.json);
  },
);

registerSimpleTool(
  "github_pr_merge",
  "Merge a pull request (requires HITL repo.pr.merge).",
  {
    ...repoSlugArgs.shape,
    pullNumber: z.number().int().min(1),
    mergeMethod: z.enum(["merge", "squash", "rebase"]).optional(),
    commitTitle: z.string().max(500).optional(),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      owner: z.string().min(1),
      repo: z.string().min(1),
      pullNumber: z.number().int().min(1),
      mergeMethod: z.enum(["merge", "squash", "rebase"]).optional(),
      commitTitle: z.string().max(500).optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requirePat();
    const path = `/repos/${encodeURIComponent(parsed.data.owner)}/${encodeURIComponent(parsed.data.repo)}/pulls/${String(parsed.data.pullNumber)}/merge`;
    const body: Record<string, string> = {};
    if (parsed.data.mergeMethod !== undefined) {
      body["merge_method"] = parsed.data.mergeMethod;
    }
    if (parsed.data.commitTitle !== undefined && parsed.data.commitTitle !== "") {
      body["commit_title"] = parsed.data.commitTitle;
    }
    const res = await ghFetch(token, path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`GitHub ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.json);
  },
);

registerSimpleTool(
  "github_pr_close",
  "Close a pull request without merging (requires HITL repo.pr.close).",
  {
    ...repoSlugArgs.shape,
    pullNumber: z.number().int().min(1),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      owner: z.string().min(1),
      repo: z.string().min(1),
      pullNumber: z.number().int().min(1),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requirePat();
    const path = `/repos/${encodeURIComponent(parsed.data.owner)}/${encodeURIComponent(parsed.data.repo)}/pulls/${String(parsed.data.pullNumber)}`;
    const res = await ghFetch(token, path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: "closed" }),
    });
    if (!res.ok) {
      throw new Error(`GitHub ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.json);
  },
);

registerSimpleTool(
  "github_issue_list",
  "List issues for a repository.",
  {
    ...repoSlugArgs.shape,
    state: z.enum(["open", "closed", "all"]).optional(),
    perPage: z.number().int().min(1).max(100).optional(),
    page: z.number().int().min(1).optional(),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      owner: z.string().min(1),
      repo: z.string().min(1),
      state: z.enum(["open", "closed", "all"]).optional(),
      perPage: z.number().int().min(1).max(100).optional(),
      page: z.number().int().min(1).optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requirePat();
    const u = new URL(
      `${GH_API}/repos/${encodeURIComponent(parsed.data.owner)}/${encodeURIComponent(parsed.data.repo)}/issues`,
    );
    u.searchParams.set("state", parsed.data.state ?? "open");
    u.searchParams.set("per_page", String(parsed.data.perPage ?? 30));
    if (parsed.data.page !== undefined) {
      u.searchParams.set("page", String(parsed.data.page));
    }
    u.searchParams.set("sort", "updated");
    u.searchParams.set("direction", "desc");
    const res = await ghFetch(token, `${u.pathname}${u.search}`);
    if (!res.ok) {
      throw new Error(`GitHub ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.json);
  },
);

registerSimpleTool(
  "github_issue_get",
  "Get a single issue by number.",
  {
    ...repoSlugArgs.shape,
    issueNumber: z.number().int().min(1),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      owner: z.string().min(1),
      repo: z.string().min(1),
      issueNumber: z.number().int().min(1),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requirePat();
    const path = `/repos/${encodeURIComponent(parsed.data.owner)}/${encodeURIComponent(parsed.data.repo)}/issues/${String(parsed.data.issueNumber)}`;
    const res = await ghFetch(token, path);
    if (!res.ok) {
      throw new Error(`GitHub ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.json);
  },
);

registerSimpleTool(
  "github_issue_create",
  "Create a new issue in a repository.",
  {
    ...repoSlugArgs.shape,
    title: z.string().min(1).max(500),
    body: z.string().max(65_000).optional(),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      owner: z.string().min(1),
      repo: z.string().min(1),
      title: z.string().min(1).max(500),
      body: z.string().max(65_000).optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requirePat();
    const path = `/repos/${encodeURIComponent(parsed.data.owner)}/${encodeURIComponent(parsed.data.repo)}/issues`;
    const res = await ghFetch(token, path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: parsed.data.title,
        body: parsed.data.body,
      }),
    });
    if (!res.ok) {
      throw new Error(`GitHub ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.json);
  },
);

registerSimpleTool(
  "github_ci_runs",
  "List GitHub Actions workflow runs for a repository.",
  {
    ...repoSlugArgs.shape,
    perPage: z.number().int().min(1).max(100).optional(),
    page: z.number().int().min(1).optional(),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      owner: z.string().min(1),
      repo: z.string().min(1),
      perPage: z.number().int().min(1).max(100).optional(),
      page: z.number().int().min(1).optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requirePat();
    const u = new URL(
      `${GH_API}/repos/${encodeURIComponent(parsed.data.owner)}/${encodeURIComponent(parsed.data.repo)}/actions/runs`,
    );
    u.searchParams.set("per_page", String(parsed.data.perPage ?? 30));
    if (parsed.data.page !== undefined) {
      u.searchParams.set("page", String(parsed.data.page));
    }
    const res = await ghFetch(token, `${u.pathname}${u.search}`);
    if (!res.ok) {
      throw new Error(`GitHub ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.json);
  },
);

registerSimpleTool(
  "github_ci_run_get",
  "Get a single workflow run including jobs URL reference.",
  {
    ...repoSlugArgs.shape,
    runId: z.number().int().min(1),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      owner: z.string().min(1),
      repo: z.string().min(1),
      runId: z.number().int().min(1),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requirePat();
    const path = `/repos/${encodeURIComponent(parsed.data.owner)}/${encodeURIComponent(parsed.data.repo)}/actions/runs/${String(parsed.data.runId)}`;
    const res = await ghFetch(token, path);
    if (!res.ok) {
      throw new Error(`GitHub ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.json);
  },
);

registerSimpleTool(
  "github_branch_delete",
  "Delete a branch by ref name (requires HITL repo.branch.delete).",
  {
    ...repoSlugArgs.shape,
    branch: z.string().min(1).max(255),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      owner: z.string().min(1),
      repo: z.string().min(1),
      branch: z.string().min(1).max(255),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requirePat();
    const ref = `heads/${parsed.data.branch}`;
    const path = `/repos/${encodeURIComponent(parsed.data.owner)}/${encodeURIComponent(parsed.data.repo)}/git/refs/${encodeURIComponent(ref)}`;
    const res = await ghFetch(token, path, { method: "DELETE" });
    if (!res.ok && res.status !== 204) {
      throw new Error(`GitHub ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult({ ok: true, deleted: ref });
  },
);

registerSimpleTool(
  "github_tag_create",
  "Create a lightweight tag pointing at a commit SHA (requires HITL repo.tag.create).",
  {
    ...repoSlugArgs.shape,
    tag: z.string().min(1).max(255),
    sha: z.string().min(7).max(40),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      owner: z.string().min(1),
      repo: z.string().min(1),
      tag: z.string().min(1).max(255),
      sha: z.string().min(7).max(40),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requirePat();
    const path = `/repos/${encodeURIComponent(parsed.data.owner)}/${encodeURIComponent(parsed.data.repo)}/git/refs`;
    const res = await ghFetch(token, path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ref: `refs/tags/${parsed.data.tag}`,
        sha: parsed.data.sha,
      }),
    });
    if (!res.ok) {
      throw new Error(`GitHub ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.json);
  },
);

registerSimpleTool(
  "github_commit_push",
  "Push commits is not available via this tool — use local git with your own remote credentials (requires HITL repo.commit.push if ever implemented).",
  {
    ...repoSlugArgs.shape,
    branch: z.string().min(1).optional(),
  },
  async (_args: unknown): Promise<ListResult> => {
    return jsonResult({
      code: "NOT_IMPLEMENTED",
      message:
        "Pushing commits requires local git and is not executed by this MCP server. Clone the repo and push with git.",
    });
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

await main();
