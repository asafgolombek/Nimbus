import { getValidMicrosoftAccessToken } from "../auth/microsoft-access-token.ts";
import { deleteItemByServiceExternal, upsertIndexedItem } from "../index/item-store.ts";
import type { Syncable, SyncContext, SyncResult } from "../sync/types.ts";

const SERVICE_ID = "outlook";
const CURSOR_PREFIX = "nimbus-outl1:";
const GRAPH = "https://graph.microsoft.com/v1.0";
const PAGE_SIZE = 50;

type GraphMessage = {
  id?: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  lastModifiedDateTime?: string;
  webLink?: string;
  "@removed"?: { reason?: string };
};

type DeltaResponse = {
  value?: GraphMessage[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
};

export type OutlookSyncCursorV1 = { v: 1; nextUrl: string | null };

export function encodeOutlookSyncCursor(c: OutlookSyncCursorV1): string {
  return CURSOR_PREFIX + Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

export function decodeOutlookSyncCursor(raw: string): OutlookSyncCursorV1 | undefined {
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

function upsertMessage(ctx: SyncContext, m: GraphMessage, now: number): void {
  const id = m.id;
  if (id === undefined || id === "") {
    return;
  }
  const subject = typeof m.subject === "string" && m.subject !== "" ? m.subject : "(no subject)";
  const preview = typeof m.bodyPreview === "string" ? m.bodyPreview.slice(0, 512) : "";
  const url = typeof m.webLink === "string" ? m.webLink : null;
  const modified = modifiedMs(m.lastModifiedDateTime ?? m.receivedDateTime, now);

  upsertIndexedItem(ctx.db, {
    service: SERVICE_ID,
    type: "email",
    externalId: id,
    title: subject.length > 512 ? subject.slice(0, 512) : subject,
    bodyPreview: preview,
    url,
    canonicalUrl: url,
    modifiedAt: modified,
    authorId: null,
    metadata: {
      receivedDateTime: m.receivedDateTime,
    },
    pinned: false,
    syncedAt: now,
  });
}

async function graphMailDeltaFetch(
  ctx: SyncContext,
  token: string,
  nextUrl: string | null,
): Promise<{ json: unknown; bytes: number }> {
  await ctx.rateLimiter.acquire("microsoft");
  const url =
    nextUrl !== null && nextUrl !== ""
      ? nextUrl
      : `${GRAPH}/me/messages/delta?$top=${String(PAGE_SIZE)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  const bytes = Buffer.byteLength(text, "utf8");
  if (!res.ok) {
    throw new Error(`Outlook sync failed: ${String(res.status)}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Outlook sync failed: invalid JSON");
  }
  return { json, bytes };
}

export type OutlookSyncableOptions = {
  ensureMicrosoftMcpRunning: () => Promise<void>;
};

export function createOutlookSyncable(options: OutlookSyncableOptions): Syncable {
  return {
    serviceId: SERVICE_ID,
    defaultIntervalMs: 5 * 60 * 1000,
    initialSyncDepthDays: 30,
    async sync(ctx: SyncContext, cursor: string | null): Promise<SyncResult> {
      const t0 = performance.now();
      await options.ensureMicrosoftMcpRunning();
      const token = await getValidMicrosoftAccessToken(ctx.vault);

      let nextUrl: string | null = null;
      if (cursor !== null && cursor !== "") {
        const dec = decodeOutlookSyncCursor(cursor);
        nextUrl = dec?.nextUrl ?? null;
      }

      const { json, bytes } = await graphMailDeltaFetch(ctx, token, nextUrl);
      const parsed = parseDelta(json);
      const values = parsed.value ?? [];
      const now = Date.now();
      let upserted = 0;
      let deleted = 0;

      for (const msg of values) {
        const removed = msg["@removed"] !== undefined && msg["@removed"] !== null;
        const id = msg.id;
        if (removed && id !== undefined && id !== "") {
          deleteItemByServiceExternal(ctx.db, SERVICE_ID, id);
          deleted += 1;
          continue;
        }
        upsertMessage(ctx, msg, now);
        upserted += 1;
      }

      const nextLink = parsed["@odata.nextLink"];
      const deltaLink = parsed["@odata.deltaLink"];
      let stored: string | null;
      let hasMore: boolean;
      if (typeof nextLink === "string" && nextLink !== "") {
        stored = encodeOutlookSyncCursor({ v: 1, nextUrl: nextLink });
        hasMore = true;
      } else if (typeof deltaLink === "string" && deltaLink !== "") {
        stored = encodeOutlookSyncCursor({ v: 1, nextUrl: deltaLink });
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
