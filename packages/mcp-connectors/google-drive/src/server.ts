/**
 * nimbus-mcp-google-drive — Google Drive MCP server (read tools).
 * OAuth access token is injected by the Gateway as GOOGLE_OAUTH_ACCESS_TOKEN (never logged).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

function requireAccessToken(): string {
  // biome-ignore lint/complexity/useLiteralKeys: NodeJS.ProcessEnv is an index signature (TS4111).
  const t = process.env["GOOGLE_OAUTH_ACCESS_TOKEN"];
  if (t === undefined || t === "") {
    throw new Error("GOOGLE_OAUTH_ACCESS_TOKEN is not set");
  }
  return t;
}

async function driveListFiles(pageSize: number, pageToken: string | undefined): Promise<unknown> {
  const params = new URLSearchParams({
    pageSize: String(pageSize),
    fields: "nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink, size)",
    q: "trashed = false",
  });
  if (pageToken !== undefined && pageToken !== "") {
    params.set("pageToken", pageToken);
  }
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${requireAccessToken()}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Drive API ${String(res.status)}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as unknown;
}

const gdriveFileListArgs = z.object({
  pageSize: z.number().int().min(1).max(100).optional(),
  pageToken: z.string().optional(),
});

const server = new McpServer({ name: "nimbus-google-drive", version: "0.1.0" });

type GdriveListResult = { content: Array<{ type: "text"; text: string }> };

/** Narrow `McpServer.tool` so tsc does not recurse on SDK + Zod generics (TS2589). */
const registerSimpleTool = server.tool.bind(server) as (
  name: string,
  description: string,
  inputShape: typeof gdriveFileListArgs.shape,
  handler: (args: unknown) => Promise<GdriveListResult>,
) => unknown;

registerSimpleTool(
  "gdrive_file_list",
  "List Google Drive files (metadata only). Supports pagination via pageToken from the previous response.",
  gdriveFileListArgs.shape,
  async (args: unknown): Promise<GdriveListResult> => {
    const parsed = gdriveFileListArgs.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const pageSize = parsed.data.pageSize ?? 25;
    const data = await driveListFiles(pageSize, parsed.data.pageToken);
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
    };
  },
);

await server.connect(new StdioServerTransport());
