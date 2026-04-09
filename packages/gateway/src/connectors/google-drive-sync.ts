import { getValidGoogleAccessToken } from "../auth/google-access-token.ts";
import { upsertIndexedItem } from "../index/item-store.ts";
import type { Syncable, SyncContext, SyncResult } from "../sync/types.ts";

type DriveFile = {
  id?: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  webViewLink?: string;
  size?: string;
};

type DriveListResponse = {
  nextPageToken?: string;
  files?: DriveFile[];
};

function parseDriveList(json: unknown): DriveListResponse {
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    return {};
  }
  return json as DriveListResponse;
}

export type GoogleDriveSyncableOptions = {
  /** Called before sync / MCP spawn so the Drive process can start lazily. */
  ensureGoogleDriveRunning: () => Promise<void>;
};

export function createGoogleDriveSyncable(options: GoogleDriveSyncableOptions): Syncable {
  const ensure = options.ensureGoogleDriveRunning;
  const initialSyncDepthDays = 30;
  return {
    serviceId: "google_drive",
    defaultIntervalMs: 30 * 60 * 1000,
    initialSyncDepthDays,

    async sync(ctx: SyncContext, cursor: string | null): Promise<SyncResult> {
      await ensure();
      const startedAt = Date.now();
      const accessToken = await getValidGoogleAccessToken(ctx.vault);

      const sinceMs = Date.now() - initialSyncDepthDays * 86_400_000;
      const sinceIso = new Date(sinceMs).toISOString();
      const q = `trashed = false and modifiedTime > '${sinceIso}'`;

      let pageToken: string | undefined;
      if (cursor !== null && cursor !== "") {
        pageToken = cursor;
      }

      await ctx.rateLimiter.acquire("google");

      const url = new URL("https://www.googleapis.com/drive/v3/files");
      url.searchParams.set("pageSize", "100");
      url.searchParams.set(
        "fields",
        "nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink, size)",
      );
      url.searchParams.set("q", q);
      if (pageToken !== undefined) {
        url.searchParams.set("pageToken", pageToken);
      }

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) {
        await res.text().catch(() => undefined);
        throw new Error("Google Drive sync failed");
      }

      const json: unknown = await res.json();
      const data = parseDriveList(json);
      const files = data.files ?? [];
      const now = Date.now();
      let itemsUpserted = 0;

      for (const f of files) {
        const id = f.id;
        const name = f.name;
        if (id === undefined || id === "" || name === undefined) {
          continue;
        }
        const mime = f.mimeType ?? "";
        const isFolder = mime === "application/vnd.google-apps.folder";
        const modifiedMs = f.modifiedTime !== undefined ? Date.parse(f.modifiedTime) : now;
        const safeModified = Number.isFinite(modifiedMs) ? modifiedMs : now;
        upsertIndexedItem(ctx.db, {
          service: "google_drive",
          type: isFolder ? "folder" : "file",
          externalId: id,
          title: name,
          bodyPreview: name,
          url: f.webViewLink ?? null,
          canonicalUrl: f.webViewLink ?? null,
          modifiedAt: safeModified,
          authorId: null,
          metadata: {
            mimeType: mime,
            size: f.size,
          },
          pinned: false,
          syncedAt: now,
        });
        itemsUpserted += 1;
      }

      const next = data.nextPageToken;
      const hasMore = next !== undefined && next !== "";

      return {
        cursor: hasMore ? next : null,
        itemsUpserted,
        itemsDeleted: 0,
        hasMore,
        durationMs: Date.now() - startedAt,
      };
    },
  };
}
