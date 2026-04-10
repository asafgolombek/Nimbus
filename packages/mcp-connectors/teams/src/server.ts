/**
 * nimbus-mcp-teams — Microsoft Graph Teams (channels + chats). Token: MICROSOFT_OAUTH_ACCESS_TOKEN.
 * Channel/chat posts require Gateway HITL (`teams.message.post`, `teams.message.postChat`).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { fetchBearerAuthorizedJson, resolveUrlWithBase } from "../../shared/fetch-bearer-json.ts";
import {
  createRegisterSimpleTool,
  type McpListResult,
  mcpJsonResult,
  requireProcessEnv,
} from "../../shared/mcp-tool-kit.ts";

const GRAPH = "https://graph.microsoft.com/v1.0";

async function graphRequest(
  token: string,
  pathOrUrl: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const url = resolveUrlWithBase(GRAPH, pathOrUrl);
  return fetchBearerAuthorizedJson(url, token, init);
}

const server = new McpServer({ name: "nimbus-teams", version: "0.1.0" });

const registerSimpleTool = createRegisterSimpleTool(server);

const teamsTeamListArgs = z.object({
  top: z.number().int().min(1).max(100).optional(),
  nextLink: z.string().url().optional(),
});

registerSimpleTool(
  "teams_team_list",
  "List Microsoft Teams the signed-in user has joined (pagination via nextLink).",
  teamsTeamListArgs.shape,
  async (args: unknown): Promise<McpListResult> => {
    const parsed = teamsTeamListArgs.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requireProcessEnv("MICROSOFT_OAUTH_ACCESS_TOKEN");
    let path: string;
    if (parsed.data.nextLink !== undefined && parsed.data.nextLink !== "") {
      path = parsed.data.nextLink;
    } else {
      const top = parsed.data.top ?? 50;
      path = `/me/joinedTeams?$top=${String(top)}`;
    }
    const r = await graphRequest(token, path);
    if (!r.ok) {
      throw new Error(`Graph ${String(r.status)}: ${r.text.slice(0, 200)}`);
    }
    return mcpJsonResult(r.json);
  },
);

const teamsChannelListArgs = z.object({
  teamId: z.string().min(1),
  top: z.number().int().min(1).max(100).optional(),
  nextLink: z.string().url().optional(),
});

registerSimpleTool(
  "teams_channel_list",
  "List channels in a team (standard + private the app can read).",
  teamsChannelListArgs.shape,
  async (args: unknown): Promise<McpListResult> => {
    const parsed = teamsChannelListArgs.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requireProcessEnv("MICROSOFT_OAUTH_ACCESS_TOKEN");
    let path: string;
    if (parsed.data.nextLink !== undefined && parsed.data.nextLink !== "") {
      path = parsed.data.nextLink;
    } else {
      const top = parsed.data.top ?? 50;
      const tid = encodeURIComponent(parsed.data.teamId);
      path = `/teams/${tid}/channels?$top=${String(top)}`;
    }
    const r = await graphRequest(token, path);
    if (!r.ok) {
      throw new Error(`Graph ${String(r.status)}: ${r.text.slice(0, 200)}`);
    }
    return mcpJsonResult(r.json);
  },
);

const teamsChannelMessagesArgs = z.object({
  teamId: z.string().min(1),
  channelId: z.string().min(1),
  top: z.number().int().min(1).max(50).optional(),
  nextLink: z.string().url().optional(),
});

registerSimpleTool(
  "teams_channel_messages",
  "List recent messages in a team channel (not delta; for interactive reads).",
  teamsChannelMessagesArgs.shape,
  async (args: unknown): Promise<McpListResult> => {
    const parsed = teamsChannelMessagesArgs.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requireProcessEnv("MICROSOFT_OAUTH_ACCESS_TOKEN");
    let path: string;
    if (parsed.data.nextLink !== undefined && parsed.data.nextLink !== "") {
      path = parsed.data.nextLink;
    } else {
      const top = parsed.data.top ?? 25;
      const tid = encodeURIComponent(parsed.data.teamId);
      const cid = encodeURIComponent(parsed.data.channelId);
      path = `/teams/${tid}/channels/${cid}/messages?$top=${String(top)}`;
    }
    const r = await graphRequest(token, path);
    if (!r.ok) {
      throw new Error(`Graph ${String(r.status)}: ${r.text.slice(0, 200)}`);
    }
    return mcpJsonResult(r.json);
  },
);

const teamsChatListArgs = z.object({
  top: z.number().int().min(1).max(50).optional(),
  nextLink: z.string().url().optional(),
});

registerSimpleTool(
  "teams_chat_list",
  "List 1:1 and group chats for the signed-in user.",
  teamsChatListArgs.shape,
  async (args: unknown): Promise<McpListResult> => {
    const parsed = teamsChatListArgs.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requireProcessEnv("MICROSOFT_OAUTH_ACCESS_TOKEN");
    let path: string;
    if (parsed.data.nextLink !== undefined && parsed.data.nextLink !== "") {
      path = parsed.data.nextLink;
    } else {
      const top = parsed.data.top ?? 25;
      path = `/me/chats?$top=${String(top)}`;
    }
    const r = await graphRequest(token, path);
    if (!r.ok) {
      throw new Error(`Graph ${String(r.status)}: ${r.text.slice(0, 200)}`);
    }
    return mcpJsonResult(r.json);
  },
);

const teamsChatMessagesArgs = z.object({
  chatId: z.string().min(1),
  top: z.number().int().min(1).max(50).optional(),
  nextLink: z.string().url().optional(),
});

registerSimpleTool(
  "teams_chat_messages",
  "List messages in a chat.",
  teamsChatMessagesArgs.shape,
  async (args: unknown): Promise<McpListResult> => {
    const parsed = teamsChatMessagesArgs.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requireProcessEnv("MICROSOFT_OAUTH_ACCESS_TOKEN");
    let path: string;
    if (parsed.data.nextLink !== undefined && parsed.data.nextLink !== "") {
      path = parsed.data.nextLink;
    } else {
      const top = parsed.data.top ?? 25;
      const id = encodeURIComponent(parsed.data.chatId);
      path = `/chats/${id}/messages?$top=${String(top)}`;
    }
    const r = await graphRequest(token, path);
    if (!r.ok) {
      throw new Error(`Graph ${String(r.status)}: ${r.text.slice(0, 200)}`);
    }
    return mcpJsonResult(r.json);
  },
);

const teamsMessagePostArgs = z.object({
  teamId: z.string().min(1),
  channelId: z.string().min(1),
  body: z.string().min(1),
  contentType: z.enum(["text", "html"]).optional(),
});

registerSimpleTool(
  "teams_message_post",
  "Post a message to a team channel (requires HITL teams.message.post).",
  teamsMessagePostArgs.shape,
  async (args: unknown): Promise<McpListResult> => {
    const parsed = teamsMessagePostArgs.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requireProcessEnv("MICROSOFT_OAUTH_ACCESS_TOKEN");
    const tid = encodeURIComponent(parsed.data.teamId);
    const cid = encodeURIComponent(parsed.data.channelId);
    const ct = parsed.data.contentType ?? "text";
    const r = await graphRequest(token, `/teams/${tid}/channels/${cid}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        body: {
          contentType: ct === "html" ? "html" : "text",
          content: parsed.data.body,
        },
      }),
    });
    if (!r.ok) {
      throw new Error(`Graph ${String(r.status)}: ${r.text.slice(0, 200)}`);
    }
    return mcpJsonResult(r.json);
  },
);

const teamsMessagePostChatArgs = z.object({
  chatId: z.string().min(1),
  body: z.string().min(1),
  contentType: z.enum(["text", "html"]).optional(),
});

registerSimpleTool(
  "teams_message_post_chat",
  "Post a message to a chat (requires HITL teams.message.postChat).",
  teamsMessagePostChatArgs.shape,
  async (args: unknown): Promise<McpListResult> => {
    const parsed = teamsMessagePostChatArgs.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requireProcessEnv("MICROSOFT_OAUTH_ACCESS_TOKEN");
    const id = encodeURIComponent(parsed.data.chatId);
    const ct = parsed.data.contentType ?? "text";
    const r = await graphRequest(token, `/chats/${id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        body: {
          contentType: ct === "html" ? "html" : "text",
          content: parsed.data.body,
        },
      }),
    });
    if (!r.ok) {
      throw new Error(`Graph ${String(r.status)}: ${r.text.slice(0, 200)}`);
    }
    return mcpJsonResult(r.json);
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
