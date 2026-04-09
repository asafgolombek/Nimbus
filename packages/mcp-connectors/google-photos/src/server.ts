/**
 * nimbus-mcp-google-photos — Google Photos Library API (metadata only; no binary downloads by default).
 * OAuth access token is injected by the Gateway as GOOGLE_OAUTH_ACCESS_TOKEN (never logged).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const PHOTOS_BASE = "https://photoslibrary.googleapis.com/v1";

function requireAccessToken(): string {
  const t = process.env["GOOGLE_OAUTH_ACCESS_TOKEN"];
  if (t === undefined || t === "") {
    throw new Error("GOOGLE_OAUTH_ACCESS_TOKEN is not set");
  }
  return t;
}

type ListResult = { content: Array<{ type: "text"; text: string }> };

async function photosFetch(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const url = path.startsWith("http") ? path : `${PHOTOS_BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
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

const server = new McpServer({ name: "nimbus-google-photos", version: "0.1.0" });

const registerSimpleTool = server.tool.bind(server) as (
  name: string,
  description: string,
  inputShape: Record<string, z.ZodTypeAny>,
  handler: (args: unknown) => Promise<ListResult>,
) => unknown;

const gphotosAlbumListArgs = z.object({
  pageSize: z.number().int().min(1).max(50).optional(),
  pageToken: z.string().optional(),
});

registerSimpleTool(
  "gphotos_album_list",
  "List Google Photos albums (metadata). Pagination via pageToken.",
  gphotosAlbumListArgs.shape,
  async (args: unknown): Promise<ListResult> => {
    const parsed = gphotosAlbumListArgs.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requireAccessToken();
    const u = new URL(`${PHOTOS_BASE}/albums`);
    u.searchParams.set("pageSize", String(parsed.data.pageSize ?? 25));
    if (parsed.data.pageToken !== undefined && parsed.data.pageToken !== "") {
      u.searchParams.set("pageToken", parsed.data.pageToken);
    }
    const r = await photosFetch(token, `${u.pathname}${u.search}`);
    if (!r.ok) {
      throw new Error(`Google Photos API ${String(r.status)}: ${r.text.slice(0, 200)}`);
    }
    return { content: [{ type: "text", text: JSON.stringify(r.json) }] };
  },
);

const gphotosAlbumGetArgs = z.object({
  albumId: z.string().min(1),
});

registerSimpleTool(
  "gphotos_album_get",
  "Get a single album by id (title, mediaItemsCount, coverPhotoBaseUrl).",
  gphotosAlbumGetArgs.shape,
  async (args: unknown): Promise<ListResult> => {
    const parsed = gphotosAlbumGetArgs.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requireAccessToken();
    const r = await photosFetch(token, `/albums/${encodeURIComponent(parsed.data.albumId)}`);
    if (!r.ok) {
      throw new Error(`Google Photos API ${String(r.status)}: ${r.text.slice(0, 200)}`);
    }
    return { content: [{ type: "text", text: JSON.stringify(r.json) }] };
  },
);

const gphotosMediaListArgs = z.object({
  albumId: z.string().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  pageToken: z.string().optional(),
});

registerSimpleTool(
  "gphotos_media_list",
  "List media items (metadata + baseUrl/productUrl only). Optional albumId scopes to one album.",
  gphotosMediaListArgs.shape,
  async (args: unknown): Promise<ListResult> => {
    const parsed = gphotosMediaListArgs.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requireAccessToken();
    const body: Record<string, unknown> = {
      pageSize: parsed.data.pageSize ?? 50,
    };
    if (parsed.data.pageToken !== undefined && parsed.data.pageToken !== "") {
      body["pageToken"] = parsed.data.pageToken;
    }
    if (parsed.data.albumId !== undefined && parsed.data.albumId !== "") {
      body["albumId"] = parsed.data.albumId;
    }
    const r = await photosFetch(token, "/mediaItems:search", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      throw new Error(`Google Photos API ${String(r.status)}: ${r.text.slice(0, 200)}`);
    }
    return { content: [{ type: "text", text: JSON.stringify(r.json) }] };
  },
);

const gphotosMediaGetArgs = z.object({
  mediaItemId: z.string().min(1),
});

registerSimpleTool(
  "gphotos_media_get",
  "Get a single media item metadata by id.",
  gphotosMediaGetArgs.shape,
  async (args: unknown): Promise<ListResult> => {
    const parsed = gphotosMediaGetArgs.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requireAccessToken();
    const r = await photosFetch(
      token,
      `/mediaItems/${encodeURIComponent(parsed.data.mediaItemId)}`,
    );
    if (!r.ok) {
      throw new Error(`Google Photos API ${String(r.status)}: ${r.text.slice(0, 200)}`);
    }
    return { content: [{ type: "text", text: JSON.stringify(r.json) }] };
  },
);

const gphotosMediaSearchArgs = z.object({
  albumId: z.string().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  pageToken: z.string().optional(),
  includeArchivedMedia: z.boolean().optional(),
  excludeNonAppCreatedData: z.boolean().optional(),
});

registerSimpleTool(
  "gphotos_media_search",
  "Search media items (metadata only). Optional album filter; supports pagination.",
  gphotosMediaSearchArgs.shape,
  async (args: unknown): Promise<ListResult> => {
    const parsed = gphotosMediaSearchArgs.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requireAccessToken();
    const body: Record<string, unknown> = {
      pageSize: parsed.data.pageSize ?? 50,
    };
    if (parsed.data.pageToken !== undefined && parsed.data.pageToken !== "") {
      body["pageToken"] = parsed.data.pageToken;
    }
    if (parsed.data.albumId !== undefined && parsed.data.albumId !== "") {
      body["albumId"] = parsed.data.albumId;
    }
    const filters: Record<string, unknown> = {};
    if (parsed.data.includeArchivedMedia === true) {
      filters["includeArchivedMedia"] = true;
    }
    if (parsed.data.excludeNonAppCreatedData === true) {
      filters["excludeNonAppCreatedData"] = true;
    }
    if (Object.keys(filters).length > 0) {
      body["filters"] = filters;
    }
    const r = await photosFetch(token, "/mediaItems:search", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      throw new Error(`Google Photos API ${String(r.status)}: ${r.text.slice(0, 200)}`);
    }
    return { content: [{ type: "text", text: JSON.stringify(r.json) }] };
  },
);

await server.connect(new StdioServerTransport());
