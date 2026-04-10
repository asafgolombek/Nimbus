/**
 * nimbus-mcp-slack — Slack Web API MCP server (user OAuth token).
 * Token is injected as SLACK_USER_ACCESS_TOKEN (never logged).
 * Posts require Gateway HITL (`slack.message.post`).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

function requireUserToken(): string {
  const t = process.env["SLACK_USER_ACCESS_TOKEN"];
  if (t === undefined || t === "") {
    throw new Error("SLACK_USER_ACCESS_TOKEN is not set");
  }
  return t;
}

type ListResult = { content: Array<{ type: "text"; text: string }> };

function jsonResult(data: unknown): ListResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

type SlackApiRecord = Record<string, unknown>;

async function slackApi(
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; json: SlackApiRecord; text: string }> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, json: {}, text };
  }
  const json =
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as SlackApiRecord)
      : {};
  const okField = json["ok"];
  return { ok: okField === true && res.ok, json, text };
}

const server = new McpServer({ name: "nimbus-slack", version: "0.1.0" });

const registerSimpleTool = server.tool.bind(server) as (
  name: string,
  description: string,
  inputShape: Record<string, z.ZodTypeAny>,
  handler: (args: unknown) => Promise<ListResult>,
) => unknown;

registerSimpleTool(
  "slack_channel_list",
  "List channels the user is a member of (public, private, mpim, im).",
  {
    types: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional(),
    cursor: z.string().optional(),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      types: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional(),
      cursor: z.string().optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requireUserToken();
    const body: Record<string, unknown> = {
      types: parsed.data.types ?? "public_channel,private_channel,mpim,im",
      limit: parsed.data.limit ?? 200,
      exclude_archived: true,
    };
    if (parsed.data.cursor !== undefined && parsed.data.cursor !== "") {
      body["cursor"] = parsed.data.cursor;
    }
    const res = await slackApi(token, "conversations.list", body);
    if (!res.ok) {
      throw new Error(`Slack conversations.list: ${res.text.slice(0, 400)}`);
    }
    return jsonResult(res.json);
  },
);

registerSimpleTool(
  "slack_channel_history",
  "Fetch message history for a channel, DM, or mpim.",
  {
    channel: z.string().min(1),
    limit: z.number().int().min(1).max(200).optional(),
    cursor: z.string().optional(),
    oldest: z.string().optional(),
    inclusive: z.boolean().optional(),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      channel: z.string().min(1),
      limit: z.number().int().min(1).max(200).optional(),
      cursor: z.string().optional(),
      oldest: z.string().optional(),
      inclusive: z.boolean().optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requireUserToken();
    const body: Record<string, unknown> = {
      channel: parsed.data.channel,
      limit: parsed.data.limit ?? 50,
    };
    if (parsed.data.cursor !== undefined && parsed.data.cursor !== "") {
      body["cursor"] = parsed.data.cursor;
    }
    if (parsed.data.oldest !== undefined && parsed.data.oldest !== "") {
      body["oldest"] = parsed.data.oldest;
    }
    if (parsed.data.inclusive !== undefined) {
      body["inclusive"] = parsed.data.inclusive;
    }
    const res = await slackApi(token, "conversations.history", body);
    if (!res.ok) {
      throw new Error(`Slack conversations.history: ${res.text.slice(0, 400)}`);
    }
    return jsonResult(res.json);
  },
);

registerSimpleTool(
  "slack_thread_replies",
  "Fetch replies in a thread (channel + thread parent ts).",
  {
    channel: z.string().min(1),
    ts: z.string().min(1),
    limit: z.number().int().min(1).max(200).optional(),
    cursor: z.string().optional(),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      channel: z.string().min(1),
      ts: z.string().min(1),
      limit: z.number().int().min(1).max(200).optional(),
      cursor: z.string().optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requireUserToken();
    const body: Record<string, unknown> = {
      channel: parsed.data.channel,
      ts: parsed.data.ts,
      limit: parsed.data.limit ?? 50,
    };
    if (parsed.data.cursor !== undefined && parsed.data.cursor !== "") {
      body["cursor"] = parsed.data.cursor;
    }
    const res = await slackApi(token, "conversations.replies", body);
    if (!res.ok) {
      throw new Error(`Slack conversations.replies: ${res.text.slice(0, 400)}`);
    }
    return jsonResult(res.json);
  },
);

registerSimpleTool(
  "slack_dm_list",
  "List direct message conversations (im + mpim).",
  {
    limit: z.number().int().min(1).max(200).optional(),
    cursor: z.string().optional(),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      limit: z.number().int().min(1).max(200).optional(),
      cursor: z.string().optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requireUserToken();
    const body: Record<string, unknown> = {
      types: "im,mpim",
      limit: parsed.data.limit ?? 200,
      exclude_archived: true,
    };
    if (parsed.data.cursor !== undefined && parsed.data.cursor !== "") {
      body["cursor"] = parsed.data.cursor;
    }
    const res = await slackApi(token, "conversations.list", body);
    if (!res.ok) {
      throw new Error(`Slack dm list: ${res.text.slice(0, 400)}`);
    }
    return jsonResult(res.json);
  },
);

registerSimpleTool(
  "slack_dm_history",
  "Fetch DM / mpim history (same as channel history; convenience alias).",
  {
    channel: z.string().min(1),
    limit: z.number().int().min(1).max(200).optional(),
    cursor: z.string().optional(),
    oldest: z.string().optional(),
    inclusive: z.boolean().optional(),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      channel: z.string().min(1),
      limit: z.number().int().min(1).max(200).optional(),
      cursor: z.string().optional(),
      oldest: z.string().optional(),
      inclusive: z.boolean().optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requireUserToken();
    const body: Record<string, unknown> = {
      channel: parsed.data.channel,
      limit: parsed.data.limit ?? 50,
    };
    if (parsed.data.cursor !== undefined && parsed.data.cursor !== "") {
      body["cursor"] = parsed.data.cursor;
    }
    if (parsed.data.oldest !== undefined && parsed.data.oldest !== "") {
      body["oldest"] = parsed.data.oldest;
    }
    if (parsed.data.inclusive !== undefined) {
      body["inclusive"] = parsed.data.inclusive;
    }
    const res = await slackApi(token, "conversations.history", body);
    if (!res.ok) {
      throw new Error(`Slack dm history: ${res.text.slice(0, 400)}`);
    }
    return jsonResult(res.json);
  },
);

registerSimpleTool(
  "slack_user_list",
  "List users in the workspace (paginated).",
  {
    limit: z.number().int().min(1).max(200).optional(),
    cursor: z.string().optional(),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      limit: z.number().int().min(1).max(200).optional(),
      cursor: z.string().optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requireUserToken();
    const body: Record<string, unknown> = { limit: parsed.data.limit ?? 100 };
    if (parsed.data.cursor !== undefined && parsed.data.cursor !== "") {
      body["cursor"] = parsed.data.cursor;
    }
    const res = await slackApi(token, "users.list", body);
    if (!res.ok) {
      throw new Error(`Slack users.list: ${res.text.slice(0, 400)}`);
    }
    return jsonResult(res.json);
  },
);

registerSimpleTool(
  "slack_user_get",
  "Get a single user profile by ID.",
  { user: z.string().min(1) },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({ user: z.string().min(1) });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requireUserToken();
    const res = await slackApi(token, "users.info", { user: parsed.data.user });
    if (!res.ok) {
      throw new Error(`Slack users.info: ${res.text.slice(0, 400)}`);
    }
    return jsonResult(res.json);
  },
);

registerSimpleTool(
  "slack_search",
  "Search messages (workspace search).",
  {
    query: z.string().min(1),
    count: z.number().int().min(1).max(100).optional(),
    page: z.number().int().min(1).optional(),
    sort: z.enum(["timestamp", "score"]).optional(),
    sort_dir: z.enum(["asc", "desc"]).optional(),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      query: z.string().min(1),
      count: z.number().int().min(1).max(100).optional(),
      page: z.number().int().min(1).optional(),
      sort: z.enum(["timestamp", "score"]).optional(),
      sort_dir: z.enum(["asc", "desc"]).optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requireUserToken();
    const body: Record<string, unknown> = {
      query: parsed.data.query,
      count: parsed.data.count ?? 20,
      page: parsed.data.page ?? 1,
    };
    if (parsed.data.sort !== undefined) {
      body["sort"] = parsed.data.sort;
    }
    if (parsed.data.sort_dir !== undefined) {
      body["sort_dir"] = parsed.data.sort_dir;
    }
    const res = await slackApi(token, "search.messages", body);
    if (!res.ok) {
      throw new Error(`Slack search.messages: ${res.text.slice(0, 400)}`);
    }
    return jsonResult(res.json);
  },
);

registerSimpleTool(
  "slack_message_post",
  "Post a message to a channel (requires HITL slack.message.post).",
  {
    channel: z.string().min(1),
    text: z.string().min(1),
    thread_ts: z.string().optional(),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      channel: z.string().min(1),
      text: z.string().min(1),
      thread_ts: z.string().optional(),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requireUserToken();
    const body: Record<string, unknown> = {
      channel: parsed.data.channel,
      text: parsed.data.text,
    };
    if (parsed.data.thread_ts !== undefined && parsed.data.thread_ts !== "") {
      body["thread_ts"] = parsed.data.thread_ts;
    }
    const res = await slackApi(token, "chat.postMessage", body);
    if (!res.ok) {
      throw new Error(`Slack chat.postMessage: ${res.text.slice(0, 400)}`);
    }
    return jsonResult(res.json);
  },
);

registerSimpleTool(
  "slack_message_post_dm",
  "Open or find a DM with user id(s) and send a message (requires HITL slack.message.post).",
  {
    user_ids: z.string().min(1),
    text: z.string().min(1),
  },
  async (args: unknown): Promise<ListResult> => {
    const schema = z.object({
      user_ids: z.string().min(1),
      text: z.string().min(1),
    });
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requireUserToken();
    const open = await slackApi(token, "conversations.open", {
      users: parsed.data.user_ids,
      return_im: true,
    });
    if (!open.ok) {
      throw new Error(`Slack conversations.open: ${open.text.slice(0, 400)}`);
    }
    const ch = open.json["channel"];
    const chRec =
      ch !== null && typeof ch === "object" && !Array.isArray(ch)
        ? (ch as SlackApiRecord)
        : undefined;
    const channelId = chRec !== undefined && typeof chRec["id"] === "string" ? chRec["id"] : "";
    if (channelId === "") {
      throw new Error("Slack conversations.open: missing channel id");
    }
    const post = await slackApi(token, "chat.postMessage", {
      channel: channelId,
      text: parsed.data.text,
    });
    if (!post.ok) {
      throw new Error(`Slack chat.postMessage (dm): ${post.text.slice(0, 400)}`);
    }
    return jsonResult({ open: open.json, post: post.json });
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
