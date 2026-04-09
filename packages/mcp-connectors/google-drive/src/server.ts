/**
 * nimbus-mcp-google-drive — Google Drive MCP server (read tools).
 * OAuth access token is injected by the Gateway as GOOGLE_OAUTH_ACCESS_TOKEN (never logged).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { escapeDriveQueryLiteral } from "./drive-query.ts";

function requireAccessToken(): string {
  const t = process.env["GOOGLE_OAUTH_ACCESS_TOKEN"];
  if (t === undefined || t === "") {
    throw new Error("GOOGLE_OAUTH_ACCESS_TOKEN is not set");
  }
  return t;
}

const METADATA_FIELDS =
  "id, name, mimeType, description, starred, trashed, parents, webViewLink, webContentLink, size, createdTime, modifiedTime, owners(displayName,emailAddress), shared";

const GOOGLE_APPS_EXPORT_MIME: Readonly<Record<string, string>> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
};

type GdriveListResult = { content: Array<{ type: "text"; text: string }> };

async function driveListFiles(
  token: string,
  pageSize: number,
  pageToken: string | undefined,
  q: string,
): Promise<unknown> {
  const params = new URLSearchParams({
    pageSize: String(pageSize),
    fields: "nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink, size)",
    q,
  });
  if (pageToken !== undefined && pageToken !== "") {
    params.set("pageToken", pageToken);
  }
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Drive API ${String(res.status)}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as unknown;
}

async function driveGetFileMetadata(token: string, fileId: string): Promise<unknown> {
  const params = new URLSearchParams({ fields: METADATA_FIELDS });
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Drive API ${String(res.status)}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as unknown;
}

type DownloadOk = {
  fileId: string;
  name: string;
  mimeType: string;
  encoding: "base64" | "utf-8";
  exportMimeType?: string;
  truncated: boolean;
  content: string;
};

async function driveDownloadFile(
  token: string,
  fileId: string,
  maxBytes: number,
): Promise<{ ok: true; payload: DownloadOk } | { ok: false; message: string }> {
  const params = new URLSearchParams({
    fields: "id,name,mimeType,size,webViewLink",
  });
  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!metaRes.ok) {
    const body = await metaRes.text();
    return { ok: false, message: `metadata ${String(metaRes.status)}: ${body.slice(0, 200)}` };
  }
  const metaUnknown: unknown = await metaRes.json();
  if (metaUnknown === null || typeof metaUnknown !== "object" || Array.isArray(metaUnknown)) {
    return { ok: false, message: "metadata: invalid response" };
  }
  const meta = metaUnknown as Record<string, unknown>;
  const mimeType = typeof meta["mimeType"] === "string" ? meta["mimeType"] : "";
  const name = typeof meta["name"] === "string" ? meta["name"] : fileId;

  if (mimeType.startsWith("application/vnd.google-apps.")) {
    const exportMime = GOOGLE_APPS_EXPORT_MIME[mimeType];
    if (exportMime === undefined) {
      const webViewLink = typeof meta["webViewLink"] === "string" ? meta["webViewLink"] : null;
      return {
        ok: false,
        message: JSON.stringify({
          code: "EXPORT_NOT_SUPPORTED",
          mimeType,
          webViewLink,
          message:
            "This Google Workspace type is not exported as text here; use gdrive_file_metadata for webViewLink.",
        }),
      };
    }
    const exportUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportMime)}`;
    const res = await fetch(exportUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, message: `export ${String(res.status)}: ${body.slice(0, 200)}` };
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    const truncated = buf.byteLength > maxBytes;
    const slice = truncated ? buf.slice(0, maxBytes) : buf;
    const text = new TextDecoder("utf-8", { fatal: false }).decode(slice);
    return {
      ok: true,
      payload: {
        fileId,
        name,
        mimeType,
        encoding: "utf-8",
        exportMimeType: exportMime,
        truncated,
        content: text,
      },
    };
  }

  const sizeStr = meta["size"];
  if (typeof sizeStr === "string" && sizeStr !== "") {
    const n = Number.parseInt(sizeStr, 10);
    if (Number.isFinite(n) && n > maxBytes) {
      return {
        ok: false,
        message: JSON.stringify({
          code: "FILE_TOO_LARGE",
          sizeBytes: n,
          maxBytes,
          message: "File exceeds maxBytes.",
        }),
      };
    }
  }

  const mediaUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const res = await fetch(mediaUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.text();
    return { ok: false, message: `download ${String(res.status)}: ${body.slice(0, 200)}` };
  }
  const contentLength = res.headers.get("content-length");
  if (contentLength !== null && contentLength !== "") {
    const n = Number.parseInt(contentLength, 10);
    if (Number.isFinite(n) && n > maxBytes) {
      return {
        ok: false,
        message: JSON.stringify({
          code: "FILE_TOO_LARGE",
          sizeBytes: n,
          maxBytes,
          message: "File exceeds maxBytes.",
        }),
      };
    }
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) {
    return {
      ok: false,
      message: JSON.stringify({
        code: "FILE_TOO_LARGE",
        sizeBytes: buf.byteLength,
        maxBytes,
        message: "Downloaded content exceeds maxBytes.",
      }),
    };
  }
  const isTextLike = mimeType === "text/plain" || mimeType.startsWith("text/");
  if (isTextLike) {
    return {
      ok: true,
      payload: {
        fileId,
        name,
        mimeType,
        encoding: "utf-8",
        truncated: false,
        content: new TextDecoder("utf-8", { fatal: false }).decode(buf),
      },
    };
  }
  return {
    ok: true,
    payload: {
      fileId,
      name,
      mimeType,
      encoding: "base64",
      truncated: false,
      content: Buffer.from(buf).toString("base64"),
    },
  };
}

const server = new McpServer({ name: "nimbus-google-drive", version: "0.1.0" });

const registerSimpleTool = server.tool.bind(server) as (
  name: string,
  description: string,
  inputShape: Record<string, z.ZodTypeAny>,
  handler: (args: unknown) => Promise<GdriveListResult>,
) => unknown;

const gdriveFileListArgs = z.object({
  pageSize: z.number().int().min(1).max(100).optional(),
  pageToken: z.string().optional(),
});

registerSimpleTool(
  "gdrive_file_list",
  "List Google Drive files (metadata only). Supports pagination via pageToken from the previous response.",
  gdriveFileListArgs.shape,
  async (args: unknown): Promise<GdriveListResult> => {
    const parsed = gdriveFileListArgs.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requireAccessToken();
    const pageSize = parsed.data.pageSize ?? 25;
    const data = await driveListFiles(token, pageSize, parsed.data.pageToken, "trashed = false");
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
    };
  },
);

const gdriveFileMetadataArgs = z.object({
  fileId: z.string().min(1),
});

registerSimpleTool(
  "gdrive_file_metadata",
  "Get metadata for a single Drive file or folder (owners, parents, links, mimeType, description).",
  gdriveFileMetadataArgs.shape,
  async (args: unknown): Promise<GdriveListResult> => {
    const parsed = gdriveFileMetadataArgs.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requireAccessToken();
    const data = await driveGetFileMetadata(token, parsed.data.fileId);
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
    };
  },
);

const gdriveFileSearchArgs = z.object({
  query: z.string().min(1).max(500),
  pageSize: z.number().int().min(1).max(100).optional(),
  pageToken: z.string().optional(),
});

registerSimpleTool(
  "gdrive_file_search",
  "Full-text search over Drive using the Drive search API (fullText contains your phrase). Non-trashed files only.",
  gdriveFileSearchArgs.shape,
  async (args: unknown): Promise<GdriveListResult> => {
    const parsed = gdriveFileSearchArgs.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requireAccessToken();
    const escaped = escapeDriveQueryLiteral(parsed.data.query);
    const q = `fullText contains '${escaped}' and trashed = false`;
    const pageSize = parsed.data.pageSize ?? 25;
    const data = await driveListFiles(token, pageSize, parsed.data.pageToken, q);
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
    };
  },
);

const gdriveFileDownloadArgs = z.object({
  fileId: z.string().min(1),
  maxBytes: z
    .number()
    .int()
    .min(1024)
    .max(16 * 1024 * 1024)
    .optional(),
});

registerSimpleTool(
  "gdrive_file_download",
  "Download file bytes (base64) or text (utf-8 for text/*). Google Docs → plain text export; Sheets → CSV. Capped by maxBytes (default 256 KiB, max 16 MiB).",
  gdriveFileDownloadArgs.shape,
  async (args: unknown): Promise<GdriveListResult> => {
    const parsed = gdriveFileDownloadArgs.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const token = requireAccessToken();
    const maxBytes = parsed.data.maxBytes ?? 256 * 1024;
    const result = await driveDownloadFile(token, parsed.data.fileId, maxBytes);
    if (!result.ok) {
      throw new Error(result.message);
    }
    return {
      content: [{ type: "text", text: JSON.stringify(result.payload) }],
    };
  },
);

await server.connect(new StdioServerTransport());
