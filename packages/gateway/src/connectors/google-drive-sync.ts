import { getValidGoogleAccessToken } from "../auth/google-access-token.ts";
import { deleteItemByServiceExternal, upsertIndexedItemForSync } from "../index/item-store.ts";
import { resolvePersonForSync } from "../people/linker.ts";
import type { Syncable, SyncContext, SyncResult } from "../sync/types.ts";
import { asUnknownObjectRecord } from "./json-unknown.ts";
import { decodeNimbusJsonCursorPayload, encodeNimbusJsonCursor } from "./nimbus-json-cursor.ts";

type DriveFileOwner = {
  displayName?: string;
  emailAddress?: string;
};

type DriveFile = {
  id?: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  webViewLink?: string;
  size?: string;
  description?: string;
  trashed?: boolean;
  owners?: DriveFileOwner[];
};

type DriveListResponse = {
  nextPageToken?: string;
  files?: DriveFile[];
};

type DriveChange = {
  fileId?: string;
  removed?: boolean;
  file?: DriveFile;
};

type DriveChangesListResponse = {
  nextPageToken?: string;
  newStartPageToken?: string;
  changes?: DriveChange[];
  incompleteSearch?: boolean;
};

type DriveStartTokenResponse = {
  startPageToken?: string;
};

export type DriveSyncCursorV1 =
  | { v: 1; phase: "init_list"; t0: string; listToken: string | null }
  | { v: 1; phase: "drain"; changePage: string }
  | { v: 1; phase: "delta"; pageToken: string };

const CURSOR_PREFIX = "nimbus-gdrv1:";
const LIST_PAGE_SIZE = 100;
const CHANGES_PAGE_SIZE = 100;
const SERVICE_ID = "google_drive";

function parseDriveList(json: unknown): DriveListResponse {
  return asUnknownObjectRecord(json) as DriveListResponse;
}

function parseDriveChanges(json: unknown): DriveChangesListResponse {
  return asUnknownObjectRecord(json) as DriveChangesListResponse;
}

function parseStartToken(json: unknown): DriveStartTokenResponse {
  return asUnknownObjectRecord(json) as DriveStartTokenResponse;
}

export function encodeDriveSyncCursor(c: DriveSyncCursorV1): string {
  return encodeNimbusJsonCursor(CURSOR_PREFIX, c);
}

function decodeDriveInitListPayload(r: Record<string, unknown>): DriveSyncCursorV1 | undefined {
  const t0 = r["t0"];
  const listToken = r["listToken"];
  if (typeof t0 !== "string" || t0 === "") {
    return undefined;
  }
  if (listToken !== null && typeof listToken !== "string") {
    return undefined;
  }
  return { v: 1, phase: "init_list", t0, listToken };
}

function decodeDriveDrainPayload(r: Record<string, unknown>): DriveSyncCursorV1 | undefined {
  const changePage = r["changePage"];
  if (typeof changePage !== "string" || changePage === "") {
    return undefined;
  }
  return { v: 1, phase: "drain", changePage };
}

function decodeDriveDeltaPayload(r: Record<string, unknown>): DriveSyncCursorV1 | undefined {
  const pageToken = r["pageToken"];
  if (typeof pageToken !== "string" || pageToken === "") {
    return undefined;
  }
  return { v: 1, phase: "delta", pageToken };
}

/** Exported for unit tests (cursor round-trip and migration). */
export function decodeDriveSyncCursor(raw: string): DriveSyncCursorV1 | undefined {
  const o = decodeNimbusJsonCursorPayload(raw, CURSOR_PREFIX);
  if (o == null || typeof o !== "object" || Array.isArray(o)) {
    return undefined;
  }
  const r = o as Record<string, unknown>;
  if (r["v"] !== 1) {
    return undefined;
  }
  const phase = r["phase"];
  if (phase === "init_list") {
    return decodeDriveInitListPayload(r);
  }
  if (phase === "drain") {
    return decodeDriveDrainPayload(r);
  }
  if (phase === "delta") {
    return decodeDriveDeltaPayload(r);
  }
  return undefined;
}

function listQueryForInitial(sinceIso: string): string {
  return `trashed = false and modifiedTime > '${sinceIso}'`;
}

function resolveDriveOwnerAuthorId(
  ctx: SyncContext,
  owners: DriveFileOwner[] | undefined,
): string | null {
  if (!Array.isArray(owners) || owners.length === 0) {
    return null;
  }
  const o = owners[0];
  if (o === undefined) {
    return null;
  }
  const email =
    typeof o.emailAddress === "string" && o.emailAddress !== "" ? o.emailAddress : undefined;
  const ownerName =
    typeof o.displayName === "string" && o.displayName !== "" ? o.displayName : undefined;
  if (email === undefined) {
    return null;
  }
  return resolvePersonForSync(ctx.db, {
    canonicalEmail: email,
    displayName: ownerName ?? email,
  });
}

function upsertDriveFile(ctx: SyncContext, f: DriveFile, now: number): void {
  const id = f.id;
  const name = f.name;
  if (id === undefined || id === "" || name === undefined) {
    return;
  }
  if (f.trashed === true) {
    deleteItemByServiceExternal(ctx.db, SERVICE_ID, id);
    return;
  }
  const mime = f.mimeType ?? "";
  const isFolder = mime === "application/vnd.google-apps.folder";
  const modifiedMs = f.modifiedTime === undefined ? now : Date.parse(f.modifiedTime);
  const safeModified = Number.isFinite(modifiedMs) ? modifiedMs : now;
  const desc = f.description ?? "";
  const previewBase = desc === "" ? name : desc;
  const bodyPreview = previewBase.length > 512 ? previewBase.slice(0, 512) : previewBase;
  const authorId = resolveDriveOwnerAuthorId(ctx, f.owners);
  upsertIndexedItemForSync(ctx, {
    service: SERVICE_ID,
    type: isFolder ? "folder" : "file",
    externalId: id,
    title: name,
    bodyPreview,
    url: f.webViewLink ?? null,
    canonicalUrl: f.webViewLink ?? null,
    modifiedAt: safeModified,
    authorId,
    metadata: {
      mimeType: mime,
      size: f.size,
    },
    pinned: false,
    syncedAt: now,
  });
}

function applyChange(ctx: SyncContext, ch: DriveChange, now: number): "upsert" | "delete" | "skip" {
  if (ch["removed"] === true) {
    const fid = typeof ch["fileId"] === "string" ? ch["fileId"] : "";
    if (fid !== "") {
      deleteItemByServiceExternal(ctx.db, SERVICE_ID, fid);
      return "delete";
    }
    return "skip";
  }
  const file = ch["file"];
  if (file === undefined) {
    return "skip";
  }
  const id = file.id;
  if (id === undefined || id === "") {
    return "skip";
  }
  if (file.trashed === true) {
    deleteItemByServiceExternal(ctx.db, SERVICE_ID, id);
    return "delete";
  }
  upsertDriveFile(ctx, file, now);
  return "upsert";
}

function countAppliedDriveChanges(
  ctx: SyncContext,
  changes: DriveChange[],
  now: number,
): { itemsUpserted: number; itemsDeleted: number } {
  let itemsUpserted = 0;
  let itemsDeleted = 0;
  for (const ch of changes) {
    const r = applyChange(ctx, ch, now);
    if (r === "upsert") {
      itemsUpserted += 1;
    } else if (r === "delete") {
      itemsDeleted += 1;
    }
  }
  return { itemsUpserted, itemsDeleted };
}

async function driveFetchJson(
  ctx: SyncContext,
  accessToken: string,
  url: string,
): Promise<{ json: unknown; bytes: number }> {
  await ctx.rateLimiter.acquire("google");
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await res.text();
  const bytes = Buffer.byteLength(text, "utf8");
  if (!res.ok) {
    throw new Error(`Google Drive sync failed: ${String(res.status)}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Google Drive sync failed: invalid JSON");
  }
  return { json, bytes };
}

async function getStartPageToken(ctx: SyncContext, accessToken: string): Promise<string> {
  const url = new URL("https://www.googleapis.com/drive/v3/changes/startPageToken");
  url.searchParams.set("fields", "startPageToken");
  const { json } = await driveFetchJson(ctx, accessToken, url.toString());
  const t = parseStartToken(json)["startPageToken"];
  if (typeof t !== "string" || t === "") {
    throw new Error("Google Drive sync failed: missing startPageToken");
  }
  return t;
}

async function listFilesPage(
  ctx: SyncContext,
  accessToken: string,
  q: string,
  pageToken: string | undefined,
): Promise<{ data: DriveListResponse; bytes: number }> {
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("pageSize", String(LIST_PAGE_SIZE));
  url.searchParams.set(
    "fields",
    "nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink, size, description, trashed, owners(emailAddress, displayName))",
  );
  url.searchParams.set("q", q);
  if (pageToken !== undefined && pageToken !== "") {
    url.searchParams.set("pageToken", pageToken);
  }
  const { json, bytes } = await driveFetchJson(ctx, accessToken, url.toString());
  return { data: parseDriveList(json), bytes };
}

async function listChangesPage(
  ctx: SyncContext,
  accessToken: string,
  pageToken: string,
): Promise<{ data: DriveChangesListResponse; bytes: number }> {
  const url = new URL("https://www.googleapis.com/drive/v3/changes");
  url.searchParams.set("pageSize", String(CHANGES_PAGE_SIZE));
  url.searchParams.set("pageToken", pageToken);
  url.searchParams.set(
    "fields",
    "nextPageToken,newStartPageToken,incompleteSearch,changes(removed,fileId,file(id,name,mimeType,modifiedTime,webViewLink,size,description,trashed,owners(emailAddress,displayName)))",
  );
  const { json, bytes } = await driveFetchJson(ctx, accessToken, url.toString());
  return { data: parseDriveChanges(json), bytes };
}

function countInitListFiles(files: DriveFile[]): number {
  let n = 0;
  for (const f of files) {
    if (f.id !== undefined && f.id !== "" && f.name !== undefined && f.trashed !== true) {
      n += 1;
    }
  }
  return n;
}

export type GoogleDriveSyncableOptions = {
  /** Called before sync / MCP spawn so the Drive process can start lazily. */
  ensureGoogleDriveRunning: () => Promise<void>;
};

/**
 * Google Drive {@link Syncable}: initial windowed `files.list`, then `changes.list` drain from
 * a captured start token, then incremental delta sync via `changes.list` + `newStartPageToken`.
 *
 * Cursor prefix `nimbus-gdrv1:` encodes JSON phases. Legacy opaque `files.list` page tokens from
 * older gateways are accepted for one migration path (capture start token on first resume).
 */
export function createGoogleDriveSyncable(options: GoogleDriveSyncableOptions): Syncable {
  const ensure = options.ensureGoogleDriveRunning;
  const initialSyncDepthDays = 30;
  return {
    serviceId: SERVICE_ID,
    defaultIntervalMs: 30 * 60 * 1000,
    initialSyncDepthDays,

    async sync(ctx: SyncContext, cursor: string | null): Promise<SyncResult> {
      await ensure();
      const startedAt = Date.now();
      const accessToken = await getValidGoogleAccessToken(ctx.vault, "google_drive");

      const sinceMs = Date.now() - initialSyncDepthDays * 86_400_000;
      const sinceIso = new Date(sinceMs).toISOString();
      const listQ = listQueryForInitial(sinceIso);
      const now = Date.now();

      let itemsUpserted = 0;
      let itemsDeleted = 0;
      let bytesTransferred = 0;

      const finishInitList = (t0: string, data: DriveListResponse, bytes: number): SyncResult => {
        bytesTransferred += bytes;
        const files = data.files ?? [];
        for (const f of files) {
          if (f.id !== undefined && f.id !== "" && f.name !== undefined && f.trashed !== true) {
            upsertDriveFile(ctx, f, now);
          }
        }
        itemsUpserted += countInitListFiles(files);
        const nextList = data.nextPageToken;
        const hasMoreList = nextList !== undefined && nextList !== "";
        if (hasMoreList) {
          return {
            cursor: encodeDriveSyncCursor({ v: 1, phase: "init_list", t0, listToken: nextList }),
            itemsUpserted,
            itemsDeleted,
            hasMore: true,
            durationMs: Date.now() - startedAt,
            bytesTransferred,
          };
        }
        return {
          cursor: encodeDriveSyncCursor({ v: 1, phase: "drain", changePage: t0 }),
          itemsUpserted,
          itemsDeleted,
          hasMore: true,
          durationMs: Date.now() - startedAt,
          bytesTransferred,
        };
      };

      if (cursor === null || cursor === "") {
        const t0 = await getStartPageToken(ctx, accessToken);
        const { data, bytes } = await listFilesPage(ctx, accessToken, listQ, undefined);
        return finishInitList(t0, data, bytes);
      }

      if (cursor.startsWith(CURSOR_PREFIX)) {
        const v1 = decodeDriveSyncCursor(cursor);
        if (v1 === undefined) {
          throw new Error("Google Drive sync: corrupt cursor");
        }

        if (v1.phase === "init_list") {
          const { data, bytes } = await listFilesPage(
            ctx,
            accessToken,
            listQ,
            v1.listToken ?? undefined,
          );
          return finishInitList(v1.t0, data, bytes);
        }

        if (v1.phase === "drain") {
          const { data, bytes } = await listChangesPage(ctx, accessToken, v1.changePage);
          bytesTransferred += bytes;
          if (data.incompleteSearch === true) {
            ctx.logger.warn({ service: SERVICE_ID }, "Drive changes.list incompleteSearch=true");
          }
          const changes = data.changes ?? [];
          const drainCounts = countAppliedDriveChanges(ctx, changes, now);
          itemsUpserted += drainCounts.itemsUpserted;
          itemsDeleted += drainCounts.itemsDeleted;
          const next = data.nextPageToken;
          if (next !== undefined && next !== "") {
            return {
              cursor: encodeDriveSyncCursor({ v: 1, phase: "drain", changePage: next }),
              itemsUpserted,
              itemsDeleted,
              hasMore: true,
              durationMs: Date.now() - startedAt,
              bytesTransferred,
            };
          }
          const newTok = data.newStartPageToken;
          if (typeof newTok !== "string" || newTok === "") {
            throw new Error("Google Drive sync failed: missing newStartPageToken after drain");
          }
          return {
            cursor: encodeDriveSyncCursor({ v: 1, phase: "delta", pageToken: newTok }),
            itemsUpserted,
            itemsDeleted,
            hasMore: false,
            durationMs: Date.now() - startedAt,
            bytesTransferred,
          };
        }

        const { data, bytes } = await listChangesPage(ctx, accessToken, v1.pageToken);
        bytesTransferred += bytes;
        if (data.incompleteSearch === true) {
          ctx.logger.warn({ service: SERVICE_ID }, "Drive changes.list incompleteSearch=true");
        }
        const changes = data.changes ?? [];
        const deltaCounts = countAppliedDriveChanges(ctx, changes, now);
        itemsUpserted += deltaCounts.itemsUpserted;
        itemsDeleted += deltaCounts.itemsDeleted;
        const next = data.nextPageToken;
        if (next !== undefined && next !== "") {
          return {
            cursor: encodeDriveSyncCursor({ v: 1, phase: "delta", pageToken: next }),
            itemsUpserted,
            itemsDeleted,
            hasMore: true,
            durationMs: Date.now() - startedAt,
            bytesTransferred,
          };
        }
        const newTok = data.newStartPageToken;
        if (typeof newTok !== "string" || newTok === "") {
          throw new Error("Google Drive sync failed: missing newStartPageToken");
        }
        return {
          cursor: encodeDriveSyncCursor({ v: 1, phase: "delta", pageToken: newTok }),
          itemsUpserted,
          itemsDeleted,
          hasMore: false,
          durationMs: Date.now() - startedAt,
          bytesTransferred,
        };
      }

      const t0 = await getStartPageToken(ctx, accessToken);
      const { data, bytes } = await listFilesPage(ctx, accessToken, listQ, cursor);
      return finishInitList(t0, data, bytes);
    },
  };
}
