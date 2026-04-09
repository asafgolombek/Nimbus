import { getValidMicrosoftAccessToken } from "../auth/microsoft-access-token.ts";
import { deleteItemByServiceExternal, upsertIndexedItem } from "../index/item-store.ts";
import type { Syncable, SyncContext, SyncResult } from "../sync/types.ts";

const SERVICE_ID = "onedrive";
const CURSOR_PREFIX = "nimbus-odrv1:";
const GRAPH = "https://graph.microsoft.com/v1.0";
const PAGE_SIZE = 100;

type DriveItem = {
  id?: string;
  name?: string;
  file?: unknown;
  folder?: unknown;
  webUrl?: string;
  lastModifiedDateTime?: string;
  size?: number;
  deleted?: { state?: string };
  "@removed"?: { reason?: string };
};

type DeltaResponse = {
  value?: DriveItem[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
};

export type OneDriveSyncCursorV1 = { v: 1; nextUrl: string | null };

export function encodeOneDriveSyncCursor(c: OneDriveSyncCursorV1): string {
  return CURSOR_PREFIX + Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

export function decodeOneDriveSyncCursor(raw: string): OneDriveSyncCursorV1 | undefined {
  if (!raw.startsWith(CURSOR_PREFIX)) {
    return undefined;
  }
  try {
    const json = Buffer.from(raw.slice(CURSOR_PREFIX.length), "base64url").toString("utf8");
    const o: unknown = JSON.parse(json);
    if (o === null || typeof o !== "object" || Array.isArray(o)) {
      return undefined;
    }
    const r = o as Record<string, unknown>;
    if (r["v"] !== 1) {
      return undefined;
    }
    const nextUrl = r["nextUrl"];
    if (nextUrl !== null && typeof nextUrl !== "string") {
      return undefined;
    }
    return { v: 1, nextUrl: nextUrl === null ? null : nextUrl };
  } catch {
    return undefined;
  }
}

function parseDelta(json: unknown): DeltaResponse {
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    return {};
  }
  return json as DeltaResponse;
}

function modifiedMs(iso: string | undefined, fallback: number): number {
  if (typeof iso !== "string" || iso === "") {
    return fallback;
  }
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : fallback;
}

function upsertDriveItem(ctx: SyncContext, d: DriveItem, now: number): void {
  const id = d.id;
  if (id === undefined || id === "") {
    return;
  }
  const title = typeof d.name === "string" && d.name !== "" ? d.name : `item_${id}`;
  const isFolder = d.folder !== undefined && d.folder !== null;
  const type = isFolder ? "folder" : "file";
  const url = typeof d.webUrl === "string" ? d.webUrl : null;
  const modified = modifiedMs(d.lastModifiedDateTime, now);
  const meta: Record<string, unknown> = {
    size: d.size,
    mimeType:
      d.file !== null &&
      d.file !== undefined &&
      typeof d.file === "object" &&
      !Array.isArray(d.file)
        ? (d.file as Record<string, unknown>)["mimeType"]
        : undefined,
  };

  upsertIndexedItem(ctx.db, {
    service: SERVICE_ID,
    type,
    externalId: id,
    title: title.length > 512 ? title.slice(0, 512) : title,
    bodyPreview: "",
    url,
    canonicalUrl: url,
    modifiedAt: modified,
    authorId: null,
    metadata: meta,
    pinned: false,
    syncedAt: now,
  });
}

async function graphDeltaFetch(
  ctx: SyncContext,
  token: string,
  nextUrl: string | null,
): Promise<{ json: unknown; bytes: number }> {
  await ctx.rateLimiter.acquire("microsoft");
  const url =
    nextUrl !== null && nextUrl !== ""
      ? nextUrl
      : `${GRAPH}/me/drive/root/delta?$top=${String(PAGE_SIZE)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  const bytes = Buffer.byteLength(text, "utf8");
  if (!res.ok) {
    throw new Error(`OneDrive sync failed: ${String(res.status)}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    throw new Error("OneDrive sync failed: invalid JSON");
  }
  return { json, bytes };
}

export type OneDriveSyncableOptions = {
  ensureMicrosoftMcpRunning: () => Promise<void>;
};

export function createOneDriveSyncable(options: OneDriveSyncableOptions): Syncable {
  return {
    serviceId: SERVICE_ID,
    defaultIntervalMs: 30 * 60 * 1000,
    initialSyncDepthDays: 30,
    async sync(ctx: SyncContext, cursor: string | null): Promise<SyncResult> {
      const t0 = performance.now();
      await options.ensureMicrosoftMcpRunning();
      const token = await getValidMicrosoftAccessToken(ctx.vault);

      let nextUrl: string | null = null;
      if (cursor !== null && cursor !== "") {
        const dec = decodeOneDriveSyncCursor(cursor);
        nextUrl = dec?.nextUrl ?? null;
      }

      const { json, bytes } = await graphDeltaFetch(ctx, token, nextUrl);
      const parsed = parseDelta(json);
      const values = parsed.value ?? [];
      const now = Date.now();
      let upserted = 0;
      let deleted = 0;

      for (const item of values) {
        const removed = item["@removed"] !== undefined && item["@removed"] !== null;
        const id = item.id;
        if (removed && id !== undefined && id !== "") {
          deleteItemByServiceExternal(ctx.db, SERVICE_ID, id);
          deleted += 1;
          continue;
        }
        if (item.deleted !== undefined && item.deleted?.state === "deleted") {
          if (id !== undefined && id !== "") {
            deleteItemByServiceExternal(ctx.db, SERVICE_ID, id);
            deleted += 1;
          }
          continue;
        }
        upsertDriveItem(ctx, item, now);
        upserted += 1;
      }

      const nextLink = parsed["@odata.nextLink"];
      const deltaLink = parsed["@odata.deltaLink"];
      let stored: string | null;
      let hasMore: boolean;
      if (typeof nextLink === "string" && nextLink !== "") {
        stored = encodeOneDriveSyncCursor({ v: 1, nextUrl: nextLink });
        hasMore = true;
      } else if (typeof deltaLink === "string" && deltaLink !== "") {
        stored = encodeOneDriveSyncCursor({ v: 1, nextUrl: deltaLink });
        hasMore = false;
      } else {
        stored = null;
        hasMore = false;
      }

      return {
        cursor: stored,
        itemsUpserted: upserted,
        itemsDeleted: deleted,
        hasMore,
        durationMs: Math.round(performance.now() - t0),
        bytesTransferred: bytes,
      };
    },
  };
}
