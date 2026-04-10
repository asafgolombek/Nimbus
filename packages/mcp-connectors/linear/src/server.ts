/**
 * nimbus-mcp-linear — Linear GraphQL MCP server.
 * API key is injected as LINEAR_API_KEY (never logged).
 * Mutations require Gateway HITL (`linear.issue.create`, `linear.issue.update`, `linear.comment.create`).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  createRegisterSimpleTool,
  mcpJsonResult as jsonResult,
  type McpListResult,
  requireProcessEnv,
} from "../../shared/mcp-tool-kit.ts";

const LINEAR_GQL = "https://api.linear.app/graphql";

type LinearGqlResponse<T> = {
  data?: T;
  errors?: ReadonlyArray<{ message: string }>;
};

async function linearGraphql<T>(
  apiKey: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<{ ok: true; data: T; text: string } | { ok: false; status: number; text: string }> {
  const res = await fetch(LINEAR_GQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, text };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, status: res.status, text: "invalid JSON" };
  }
  const body = parsed as LinearGqlResponse<T>;
  if (body.errors !== undefined && body.errors.length > 0) {
    const msg = body.errors.map((e) => e.message).join("; ");
    throw new Error(`Linear GraphQL: ${msg.slice(0, 400)}`);
  }
  if (body.data === undefined) {
    throw new Error("Linear GraphQL: missing data");
  }
  return { ok: true, data: body.data, text };
}

const server = new McpServer({ name: "nimbus-linear", version: "0.1.0" });

const registerSimpleTool = createRegisterSimpleTool(server);

registerSimpleTool(
  "linear_issue_list",
  "List Linear issues with optional filters (team id, state name, assignee id).",
  {
    first: z.number().int().min(1).max(100).optional(),
    teamId: z.string().min(1).optional(),
    stateName: z.string().min(1).optional(),
    assigneeId: z.string().min(1).optional(),
  },
  async (args: unknown): Promise<McpListResult> => {
    const schema = z.object({
      first: z.number().int().min(1).max(100).optional(),
      teamId: z.string().min(1).optional(),
      stateName: z.string().min(1).optional(),
      assigneeId: z.string().min(1).optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const apiKey = requireProcessEnv("LINEAR_API_KEY");
    const filter: Record<string, unknown> = {};
    if (parsed.data.teamId !== undefined) {
      filter["team"] = { id: { eq: parsed.data.teamId } };
    }
    if (parsed.data.stateName !== undefined) {
      filter["state"] = { name: { eq: parsed.data.stateName } };
    }
    if (parsed.data.assigneeId !== undefined) {
      filter["assignee"] = { id: { eq: parsed.data.assigneeId } };
    }
    const hasFilter = Object.keys(filter).length > 0;
    const q = hasFilter
      ? `
      query IssueList($first: Int!, $filter: IssueFilter!) {
        issues(first: $first, filter: $filter, orderBy: updatedAt) {
          nodes {
            id
            identifier
            title
            updatedAt
            url
            state { id name type }
            team { id name key }
          }
        }
      }
    `
      : `
      query IssueList($first: Int!) {
        issues(first: $first, orderBy: updatedAt) {
          nodes {
            id
            identifier
            title
            updatedAt
            url
            state { id name type }
            team { id name key }
          }
        }
      }
    `;
    type Out = {
      issues: {
        nodes: ReadonlyArray<Record<string, unknown>>;
      };
    };
    const vars: Record<string, unknown> = { first: parsed.data.first ?? 50 };
    if (hasFilter) {
      vars["filter"] = filter;
    }
    const res = await linearGraphql<Out>(apiKey, q, vars);
    if (!res.ok) {
      throw new Error(`Linear ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.data);
  },
);

registerSimpleTool(
  "linear_issue_get",
  "Get a single Linear issue by UUID id.",
  { issueId: z.string().min(1) },
  async (args: unknown): Promise<McpListResult> => {
    const schema = z.object({ issueId: z.string().min(1) });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const apiKey = requireProcessEnv("LINEAR_API_KEY");
    const q = `
      query IssueGet($id: String!) {
        issue(id: $id) {
          id
          identifier
          title
          description
          updatedAt
          createdAt
          url
          priority
          state { id name type }
          team { id name key }
          assignee { id name displayName }
        }
      }
    `;
    type Out = { issue: Record<string, unknown> | null };
    const res = await linearGraphql<Out>(apiKey, q, { id: parsed.data.issueId });
    if (!res.ok) {
      throw new Error(`Linear ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.data);
  },
);

registerSimpleTool(
  "linear_issue_create",
  "Create a Linear issue (requires teamId and title).",
  {
    teamId: z.string().min(1),
    title: z.string().min(1),
    description: z.string().optional(),
    priority: z.number().int().min(0).max(4).optional(),
    stateId: z.string().min(1).optional(),
    assigneeId: z.string().min(1).optional(),
  },
  async (args: unknown): Promise<McpListResult> => {
    const schema = z.object({
      teamId: z.string().min(1),
      title: z.string().min(1),
      description: z.string().optional(),
      priority: z.number().int().min(0).max(4).optional(),
      stateId: z.string().min(1).optional(),
      assigneeId: z.string().min(1).optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const apiKey = requireProcessEnv("LINEAR_API_KEY");
    const input: Record<string, unknown> = {
      teamId: parsed.data.teamId,
      title: parsed.data.title,
    };
    if (parsed.data.description !== undefined) {
      input["description"] = parsed.data.description;
    }
    if (parsed.data.priority !== undefined) {
      input["priority"] = parsed.data.priority;
    }
    if (parsed.data.stateId !== undefined) {
      input["stateId"] = parsed.data.stateId;
    }
    if (parsed.data.assigneeId !== undefined) {
      input["assigneeId"] = parsed.data.assigneeId;
    }
    const q = `
      mutation IssueCreate($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue { id identifier url title }
        }
      }
    `;
    type Out = { issueCreate: { success: boolean; issue: Record<string, unknown> | null } };
    const res = await linearGraphql<Out>(apiKey, q, { input });
    if (!res.ok) {
      throw new Error(`Linear ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.data);
  },
);

registerSimpleTool(
  "linear_issue_update",
  "Update a Linear issue by id.",
  {
    issueId: z.string().min(1),
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    stateId: z.string().min(1).optional(),
    priority: z.number().int().min(0).max(4).optional(),
    assigneeId: z.string().min(1).optional(),
  },
  async (args: unknown): Promise<McpListResult> => {
    const schema = z.object({
      issueId: z.string().min(1),
      title: z.string().min(1).optional(),
      description: z.string().optional(),
      stateId: z.string().min(1).optional(),
      priority: z.number().int().min(0).max(4).optional(),
      assigneeId: z.string().min(1).optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const apiKey = requireProcessEnv("LINEAR_API_KEY");
    const input: Record<string, unknown> = {};
    if (parsed.data.title !== undefined) {
      input["title"] = parsed.data.title;
    }
    if (parsed.data.description !== undefined) {
      input["description"] = parsed.data.description;
    }
    if (parsed.data.stateId !== undefined) {
      input["stateId"] = parsed.data.stateId;
    }
    if (parsed.data.priority !== undefined) {
      input["priority"] = parsed.data.priority;
    }
    if (parsed.data.assigneeId !== undefined) {
      input["assigneeId"] = parsed.data.assigneeId;
    }
    const q = `
      mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
          issue { id identifier url title updatedAt }
        }
      }
    `;
    type Out = {
      issueUpdate: { success: boolean; issue: Record<string, unknown> | null };
    };
    const res = await linearGraphql<Out>(apiKey, q, {
      id: parsed.data.issueId,
      input,
    });
    if (!res.ok) {
      throw new Error(`Linear ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.data);
  },
);

registerSimpleTool(
  "linear_comment_create",
  "Add a comment to a Linear issue.",
  { issueId: z.string().min(1), body: z.string().min(1) },
  async (args: unknown): Promise<McpListResult> => {
    const schema = z.object({
      issueId: z.string().min(1),
      body: z.string().min(1),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const apiKey = requireProcessEnv("LINEAR_API_KEY");
    const q = `
      mutation CommentCreate($input: CommentCreateInput!) {
        commentCreate(input: $input) {
          success
          comment { id body createdAt }
        }
      }
    `;
    type Out = {
      commentCreate: { success: boolean; comment: Record<string, unknown> | null };
    };
    const res = await linearGraphql<Out>(apiKey, q, {
      input: { issueId: parsed.data.issueId, body: parsed.data.body },
    });
    if (!res.ok) {
      throw new Error(`Linear ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.data);
  },
);

registerSimpleTool(
  "linear_project_list",
  "List Linear projects.",
  { first: z.number().int().min(1).max(100).optional() },
  async (args: unknown): Promise<McpListResult> => {
    const schema = z.object({
      first: z.number().int().min(1).max(100).optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const apiKey = requireProcessEnv("LINEAR_API_KEY");
    const q = `
      query ProjectList($first: Int!) {
        projects(first: $first) {
          nodes {
            id
            name
            description
            slugId
            url
            updatedAt
            state
          }
        }
      }
    `;
    type Out = { projects: { nodes: ReadonlyArray<Record<string, unknown>> } };
    const res = await linearGraphql<Out>(apiKey, q, { first: parsed.data.first ?? 50 });
    if (!res.ok) {
      throw new Error(`Linear ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.data);
  },
);

registerSimpleTool(
  "linear_project_get",
  "Get a Linear project by id.",
  { projectId: z.string().min(1) },
  async (args: unknown): Promise<McpListResult> => {
    const schema = z.object({ projectId: z.string().min(1) });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const apiKey = requireProcessEnv("LINEAR_API_KEY");
    const q = `
      query ProjectGet($id: String!) {
        project(id: $id) {
          id
          name
          description
          slugId
          url
          updatedAt
          state
          lead { id displayName }
        }
      }
    `;
    type Out = { project: Record<string, unknown> | null };
    const res = await linearGraphql<Out>(apiKey, q, { id: parsed.data.projectId });
    if (!res.ok) {
      throw new Error(`Linear ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.data);
  },
);

registerSimpleTool(
  "linear_cycle_list",
  "List Linear cycles for a team.",
  { teamId: z.string().min(1), first: z.number().int().min(1).max(50).optional() },
  async (args: unknown): Promise<McpListResult> => {
    const schema = z.object({
      teamId: z.string().min(1),
      first: z.number().int().min(1).max(50).optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const apiKey = requireProcessEnv("LINEAR_API_KEY");
    const q = `
      query CycleList($teamId: ID!, $first: Int!) {
        team(id: $teamId) {
          id
          cycles(first: $first) {
            nodes {
              id
              name
              number
              startsAt
              endsAt
              completedAt
            }
          }
        }
      }
    `;
    type Out = {
      team: {
        id: string;
        cycles: { nodes: ReadonlyArray<Record<string, unknown>> };
      } | null;
    };
    const res = await linearGraphql<Out>(apiKey, q, {
      teamId: parsed.data.teamId,
      first: parsed.data.first ?? 20,
    });
    if (!res.ok) {
      throw new Error(`Linear ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.data);
  },
);

registerSimpleTool(
  "linear_roadmap_list",
  "List Linear initiatives (roadmap).",
  { first: z.number().int().min(1).max(50).optional() },
  async (args: unknown): Promise<McpListResult> => {
    const schema = z.object({
      first: z.number().int().min(1).max(50).optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const apiKey = requireProcessEnv("LINEAR_API_KEY");
    const q = `
      query InitiativeList($first: Int!) {
        initiatives(first: $first) {
          nodes {
            id
            name
            description
            targetDate
            updatedAt
            url
          }
        }
      }
    `;
    type Out = { initiatives: { nodes: ReadonlyArray<Record<string, unknown>> } };
    const res = await linearGraphql<Out>(apiKey, q, { first: parsed.data.first ?? 30 });
    if (!res.ok) {
      throw new Error(`Linear ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.data);
  },
);

registerSimpleTool(
  "linear_member_list",
  "List users in the workspace.",
  { first: z.number().int().min(1).max(100).optional() },
  async (args: unknown): Promise<McpListResult> => {
    const schema = z.object({
      first: z.number().int().min(1).max(100).optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const apiKey = requireProcessEnv("LINEAR_API_KEY");
    const q = `
      query Users($first: Int!) {
        users(first: $first) {
          nodes {
            id
            name
            displayName
            email
            active
          }
        }
      }
    `;
    type Out = { users: { nodes: ReadonlyArray<Record<string, unknown>> } };
    const res = await linearGraphql<Out>(apiKey, q, { first: parsed.data.first ?? 50 });
    if (!res.ok) {
      throw new Error(`Linear ${String(res.status)}: ${res.text.slice(0, 300)}`);
    }
    return jsonResult(res.data);
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

void main();
