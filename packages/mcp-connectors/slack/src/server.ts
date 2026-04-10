/**
 * nimbus-mcp-slack — Slack Web API MCP server (user OAuth token).
 * Token is injected as SLACK_USER_ACCESS_TOKEN (never logged).
 * Posts require Gateway HITL (`slack.message.post`).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  createRegisterSimpleTool,
  mcpJsonResult as jsonResult,
  type McpListResult,
  registerZodTool,
  requireProcessEnv,
  type ZodObjectSchema,
} from "../../shared/mcp-tool-kit.ts";

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

const registerSimpleTool = createRegisterSimpleTool(server);

function reg<T>(
  name: string,
  description: string,
  schema: ZodObjectSchema<T>,
  handler: (args: T) => Promise<McpListResult>,
): void {
  registerZodTool(registerSimpleTool, name, description, schema, handler);
}

const slackChannelListSchema = z.object({
  types: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
});

reg(
  "slack_channel_list",
  "List channels the user is a member of (public, private, mpim, im).",
  slackChannelListSchema,
  async (parsed) => {
    const token = requireProcessEnv("SLACK_USER_ACCESS_TOKEN");
    const body: Record<string, unknown> = {
      types: parsed.types ?? "public_channel,private_channel,mpim,im",
      limit: parsed.limit ?? 200,
      exclude_archived: true,
    };
    if (parsed.cursor !== undefined && parsed.cursor !== "") {
      body["cursor"] = parsed.cursor;
    }
    const res = await slackApi(token, "conversations.list", body);
    if (!res.ok) {
      throw new Error(`Slack conversations.list: ${res.text.slice(0, 400)}`);
    }
    return jsonResult(res.json);
  },
);

const slackChannelHistorySchema = z.object({
  channel: z.string().min(1),
  limit: z.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
  oldest: z.string().optional(),
  inclusive: z.boolean().optional(),
});

reg(
  "slack_channel_history",
  "Fetch message history for a channel, DM, or mpim.",
  slackChannelHistorySchema,
  async (parsed) => {
    const token = requireProcessEnv("SLACK_USER_ACCESS_TOKEN");
    const body: Record<string, unknown> = {
      channel: parsed.channel,
      limit: parsed.limit ?? 50,
    };
    if (parsed.cursor !== undefined && parsed.cursor !== "") {
      body["cursor"] = parsed.cursor;
    }
    if (parsed.oldest !== undefined && parsed.oldest !== "") {
      body["oldest"] = parsed.oldest;
    }
    if (parsed.inclusive !== undefined) {
      body["inclusive"] = parsed.inclusive;
    }
    const res = await slackApi(token, "conversations.history", body);
    if (!res.ok) {
      throw new Error(`Slack conversations.history: ${res.text.slice(0, 400)}`);
    }
    return jsonResult(res.json);
  },
);

const slackThreadRepliesSchema = z.object({
  channel: z.string().min(1),
  ts: z.string().min(1),
  limit: z.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
});

reg(
  "slack_thread_replies",
  "Fetch replies in a thread (channel + thread parent ts).",
  slackThreadRepliesSchema,
  async (parsed) => {
    const token = requireProcessEnv("SLACK_USER_ACCESS_TOKEN");
    const body: Record<string, unknown> = {
      channel: parsed.channel,
      ts: parsed.ts,
      limit: parsed.limit ?? 50,
    };
    if (parsed.cursor !== undefined && parsed.cursor !== "") {
      body["cursor"] = parsed.cursor;
    }
    const res = await slackApi(token, "conversations.replies", body);
    if (!res.ok) {
      throw new Error(`Slack conversations.replies: ${res.text.slice(0, 400)}`);
    }
    return jsonResult(res.json);
  },
);

const slackDmListSchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
});

reg(
  "slack_dm_list",
  "List direct message conversations (im + mpim).",
  slackDmListSchema,
  async (parsed) => {
    const token = requireProcessEnv("SLACK_USER_ACCESS_TOKEN");
    const body: Record<string, unknown> = {
      types: "im,mpim",
      limit: parsed.limit ?? 200,
      exclude_archived: true,
    };
    if (parsed.cursor !== undefined && parsed.cursor !== "") {
      body["cursor"] = parsed.cursor;
    }
    const res = await slackApi(token, "conversations.list", body);
    if (!res.ok) {
      throw new Error(`Slack dm list: ${res.text.slice(0, 400)}`);
    }
    return jsonResult(res.json);
  },
);

const slackDmHistorySchema = z.object({
  channel: z.string().min(1),
  limit: z.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
  oldest: z.string().optional(),
  inclusive: z.boolean().optional(),
});

reg(
  "slack_dm_history",
  "Fetch DM / mpim history (same as channel history; convenience alias).",
  slackDmHistorySchema,
  async (parsed) => {
    const token = requireProcessEnv("SLACK_USER_ACCESS_TOKEN");
    const body: Record<string, unknown> = {
      channel: parsed.channel,
      limit: parsed.limit ?? 50,
    };
    if (parsed.cursor !== undefined && parsed.cursor !== "") {
      body["cursor"] = parsed.cursor;
    }
    if (parsed.oldest !== undefined && parsed.oldest !== "") {
      body["oldest"] = parsed.oldest;
    }
    if (parsed.inclusive !== undefined) {
      body["inclusive"] = parsed.inclusive;
    }
    const res = await slackApi(token, "conversations.history", body);
    if (!res.ok) {
      throw new Error(`Slack dm history: ${res.text.slice(0, 400)}`);
    }
    return jsonResult(res.json);
  },
);

const slackUserListSchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
});

reg(
  "slack_user_list",
  "List users in the workspace (paginated).",
  slackUserListSchema,
  async (parsed) => {
    const token = requireProcessEnv("SLACK_USER_ACCESS_TOKEN");
    const body: Record<string, unknown> = { limit: parsed.limit ?? 100 };
    if (parsed.cursor !== undefined && parsed.cursor !== "") {
      body["cursor"] = parsed.cursor;
    }
    const res = await slackApi(token, "users.list", body);
    if (!res.ok) {
      throw new Error(`Slack users.list: ${res.text.slice(0, 400)}`);
    }
    return jsonResult(res.json);
  },
);

const slackUserGetSchema = z.object({ user: z.string().min(1) });

reg("slack_user_get", "Get a single user profile by ID.", slackUserGetSchema, async (parsed) => {
  const token = requireProcessEnv("SLACK_USER_ACCESS_TOKEN");
  const res = await slackApi(token, "users.info", { user: parsed.user });
  if (!res.ok) {
    throw new Error(`Slack users.info: ${res.text.slice(0, 400)}`);
  }
  return jsonResult(res.json);
});

const slackSearchSchema = z.object({
  query: z.string().min(1),
  count: z.number().int().min(1).max(100).optional(),
  page: z.number().int().min(1).optional(),
  sort: z.enum(["timestamp", "score"]).optional(),
  sort_dir: z.enum(["asc", "desc"]).optional(),
});

reg("slack_search", "Search messages (workspace search).", slackSearchSchema, async (parsed) => {
  const token = requireProcessEnv("SLACK_USER_ACCESS_TOKEN");
  const body: Record<string, unknown> = {
    query: parsed.query,
    count: parsed.count ?? 20,
    page: parsed.page ?? 1,
  };
  if (parsed.sort !== undefined) {
    body["sort"] = parsed.sort;
  }
  if (parsed.sort_dir !== undefined) {
    body["sort_dir"] = parsed.sort_dir;
  }
  const res = await slackApi(token, "search.messages", body);
  if (!res.ok) {
    throw new Error(`Slack search.messages: ${res.text.slice(0, 400)}`);
  }
  return jsonResult(res.json);
});

const slackMessagePostSchema = z.object({
  channel: z.string().min(1),
  text: z.string().min(1),
  thread_ts: z.string().optional(),
});

reg(
  "slack_message_post",
  "Post a message to a channel (requires HITL slack.message.post).",
  slackMessagePostSchema,
  async (parsed) => {
    const token = requireProcessEnv("SLACK_USER_ACCESS_TOKEN");
    const body: Record<string, unknown> = {
      channel: parsed.channel,
      text: parsed.text,
    };
    if (parsed.thread_ts !== undefined && parsed.thread_ts !== "") {
      body["thread_ts"] = parsed.thread_ts;
    }
    const res = await slackApi(token, "chat.postMessage", body);
    if (!res.ok) {
      throw new Error(`Slack chat.postMessage: ${res.text.slice(0, 400)}`);
    }
    return jsonResult(res.json);
  },
);

const slackMessagePostDmSchema = z.object({
  user_ids: z.string().min(1),
  text: z.string().min(1),
});

reg(
  "slack_message_post_dm",
  "Open or find a DM with user id(s) and send a message (requires HITL slack.message.post).",
  slackMessagePostDmSchema,
  async (parsed) => {
    const token = requireProcessEnv("SLACK_USER_ACCESS_TOKEN");
    const open = await slackApi(token, "conversations.open", {
      users: parsed.user_ids,
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
      text: parsed.text,
    });
    if (!post.ok) {
      throw new Error(`Slack chat.postMessage (dm): ${post.text.slice(0, 400)}`);
    }
    return jsonResult({ open: open.json, post: post.json });
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
