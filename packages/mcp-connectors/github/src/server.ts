/**
 * nimbus-mcp-github — GitHub REST MCP server.
 * Personal access token is injected as GITHUB_PAT (never logged).
 * Mutating repo operations require Gateway HITL (`repo.pr.merge`, `repo.pr.close`, …).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { fetchBearerAuthorizedJson } from "../../shared/fetch-bearer-json.ts";
import {
  createRegisterSimpleTool,
  mcpJsonResult as jsonResult,
  type McpListResult,
  registerZodTool,
  requireProcessEnv,
  type ZodObjectSchema,
} from "../../shared/mcp-tool-kit.ts";

const GH_API = "https://api.github.com";
const GH_HEADERS: Record<string, string> = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

async function ghFetch(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const url = path.startsWith("http") ? path : `${GH_API}${path}`;
  return fetchBearerAuthorizedJson(url, token, init, GH_HEADERS);
}

const server = new McpServer({ name: "nimbus-github", version: "0.1.0" });

const registerSimpleTool = createRegisterSimpleTool(server);

function reg<T>(
  name: string,
  description: string,
  schema: ZodObjectSchema<T>,
  handler: (args: T) => Promise<McpListResult>,
): void {
  registerZodTool(registerSimpleTool, name, description, schema, handler);
}

const repoSlugArgs = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
});

const githubRepoListSchema = z.object({
  perPage: z.number().int().min(1).max(100).optional(),
  page: z.number().int().min(1).optional(),
});

reg(
  "github_repo_list",
  "List repositories for the authenticated user (affiliation: owner, collaborator, organization_member).",
  githubRepoListSchema,
  async (parsed) => {
    const token = requireProcessEnv("GITHUB_PAT");
    const u = new URL(`${GH_API}/user/repos`);
    u.searchParams.set("per_page", String(parsed.perPage ?? 30));
    if (parsed.page !== undefined) {
      u.searchParams.set("page", String(parsed.page));
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

reg("github_repo_get", "Get repository metadata (owner/repo).", repoSlugArgs, async (parsed) => {
  const token = requireProcessEnv("GITHUB_PAT");
  const path = `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`;
  const res = await ghFetch(token, path);
  if (!res.ok) {
    throw new Error(`GitHub ${String(res.status)}: ${res.text.slice(0, 300)}`);
  }
  return jsonResult(res.json);
});

const githubPrListSchema = repoSlugArgs.extend({
  state: z.enum(["open", "closed", "all"]).optional(),
  perPage: z.number().int().min(1).max(100).optional(),
  page: z.number().int().min(1).optional(),
});

reg(
  "github_pr_list",
  "List pull requests for a repository.",
  githubPrListSchema,
  async (parsed) => {
    const token = requireProcessEnv("GITHUB_PAT");
    const u = new URL(
      `${GH_API}/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/pulls`,
    );
    u.searchParams.set("state", parsed.state ?? "open");
    u.searchParams.set("per_page", String(parsed.perPage ?? 30));
    if (parsed.page !== undefined) {
      u.searchParams.set("page", String(parsed.page));
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

const githubPrNumberSchema = repoSlugArgs.extend({
  pullNumber: z.number().int().min(1),
});

reg(
  "github_pr_get",
  "Get a single pull request by number.",
  githubPrNumberSchema,
  async (parsed) => {
    const token = requireProcessEnv("GITHUB_PAT");
    const path = `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/pulls/${String(parsed.pullNumber)}`;
    const res = await ghFetch(token, path);
    if (!res.ok) {
      throw new Error(`GitHub ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.json);
  },
);

const githubPrMergeSchema = repoSlugArgs.extend({
  pullNumber: z.number().int().min(1),
  mergeMethod: z.enum(["merge", "squash", "rebase"]).optional(),
  commitTitle: z.string().max(500).optional(),
});

reg(
  "github_pr_merge",
  "Merge a pull request (requires HITL repo.pr.merge).",
  githubPrMergeSchema,
  async (parsed) => {
    const token = requireProcessEnv("GITHUB_PAT");
    const path = `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/pulls/${String(parsed.pullNumber)}/merge`;
    const body: Record<string, string> = {};
    if (parsed.mergeMethod !== undefined) {
      body["merge_method"] = parsed.mergeMethod;
    }
    if (parsed.commitTitle !== undefined && parsed.commitTitle !== "") {
      body["commit_title"] = parsed.commitTitle;
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

reg(
  "github_pr_close",
  "Close a pull request without merging (requires HITL repo.pr.close).",
  githubPrNumberSchema,
  async (parsed) => {
    const token = requireProcessEnv("GITHUB_PAT");
    const path = `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/pulls/${String(parsed.pullNumber)}`;
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

const githubIssueListSchema = repoSlugArgs.extend({
  state: z.enum(["open", "closed", "all"]).optional(),
  perPage: z.number().int().min(1).max(100).optional(),
  page: z.number().int().min(1).optional(),
});

reg("github_issue_list", "List issues for a repository.", githubIssueListSchema, async (parsed) => {
  const token = requireProcessEnv("GITHUB_PAT");
  const u = new URL(
    `${GH_API}/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/issues`,
  );
  u.searchParams.set("state", parsed.state ?? "open");
  u.searchParams.set("per_page", String(parsed.perPage ?? 30));
  if (parsed.page !== undefined) {
    u.searchParams.set("page", String(parsed.page));
  }
  u.searchParams.set("sort", "updated");
  u.searchParams.set("direction", "desc");
  const res = await ghFetch(token, `${u.pathname}${u.search}`);
  if (!res.ok) {
    throw new Error(`GitHub ${String(res.status)}: ${res.text.slice(0, 300)}`);
  }
  return jsonResult(res.json);
});

const githubIssueGetSchema = repoSlugArgs.extend({
  issueNumber: z.number().int().min(1),
});

reg("github_issue_get", "Get a single issue by number.", githubIssueGetSchema, async (parsed) => {
  const token = requireProcessEnv("GITHUB_PAT");
  const path = `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/issues/${String(parsed.issueNumber)}`;
  const res = await ghFetch(token, path);
  if (!res.ok) {
    throw new Error(`GitHub ${String(res.status)}: ${res.text.slice(0, 300)}`);
  }
  return jsonResult(res.json);
});

const githubIssueCreateSchema = repoSlugArgs.extend({
  title: z.string().min(1).max(500),
  body: z.string().max(65_000).optional(),
});

reg(
  "github_issue_create",
  "Create a new issue in a repository.",
  githubIssueCreateSchema,
  async (parsed) => {
    const token = requireProcessEnv("GITHUB_PAT");
    const path = `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/issues`;
    const res = await ghFetch(token, path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: parsed.title,
        body: parsed.body,
      }),
    });
    if (!res.ok) {
      throw new Error(`GitHub ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.json);
  },
);

const githubCiRunsSchema = repoSlugArgs.extend({
  perPage: z.number().int().min(1).max(100).optional(),
  page: z.number().int().min(1).optional(),
});

reg(
  "github_ci_runs",
  "List GitHub Actions workflow runs for a repository.",
  githubCiRunsSchema,
  async (parsed) => {
    const token = requireProcessEnv("GITHUB_PAT");
    const u = new URL(
      `${GH_API}/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/actions/runs`,
    );
    u.searchParams.set("per_page", String(parsed.perPage ?? 30));
    if (parsed.page !== undefined) {
      u.searchParams.set("page", String(parsed.page));
    }
    const res = await ghFetch(token, `${u.pathname}${u.search}`);
    if (!res.ok) {
      throw new Error(`GitHub ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.json);
  },
);

const githubCiRunGetSchema = repoSlugArgs.extend({
  runId: z.number().int().min(1),
});

reg(
  "github_ci_run_get",
  "Get a single workflow run including jobs URL reference.",
  githubCiRunGetSchema,
  async (parsed) => {
    const token = requireProcessEnv("GITHUB_PAT");
    const path = `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/actions/runs/${String(parsed.runId)}`;
    const res = await ghFetch(token, path);
    if (!res.ok) {
      throw new Error(`GitHub ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.json);
  },
);

const githubBranchDeleteSchema = repoSlugArgs.extend({
  branch: z.string().min(1).max(255),
});

reg(
  "github_branch_delete",
  "Delete a branch by ref name (requires HITL repo.branch.delete).",
  githubBranchDeleteSchema,
  async (parsed) => {
    const token = requireProcessEnv("GITHUB_PAT");
    const ref = `heads/${parsed.branch}`;
    const path = `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/git/refs/${encodeURIComponent(ref)}`;
    const res = await ghFetch(token, path, { method: "DELETE" });
    if (!res.ok && res.status !== 204) {
      throw new Error(`GitHub ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult({ ok: true, deleted: ref });
  },
);

const githubTagCreateSchema = repoSlugArgs.extend({
  tag: z.string().min(1).max(255),
  sha: z.string().min(7).max(40),
});

reg(
  "github_tag_create",
  "Create a lightweight tag pointing at a commit SHA (requires HITL repo.tag.create).",
  githubTagCreateSchema,
  async (parsed) => {
    const token = requireProcessEnv("GITHUB_PAT");
    const path = `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/git/refs`;
    const res = await ghFetch(token, path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ref: `refs/tags/${parsed.tag}`,
        sha: parsed.sha,
      }),
    });
    if (!res.ok) {
      throw new Error(`GitHub ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.json);
  },
);

const githubCommitPushSchema = repoSlugArgs.extend({
  branch: z.string().min(1).optional(),
});

reg(
  "github_commit_push",
  "Push commits is not available via this tool — use local git with your own remote credentials (requires HITL repo.commit.push if ever implemented).",
  githubCommitPushSchema,
  async () =>
    jsonResult({
      code: "NOT_IMPLEMENTED",
      message:
        "Pushing commits requires local git and is not executed by this MCP server. Clone the repo and push with git.",
    }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
