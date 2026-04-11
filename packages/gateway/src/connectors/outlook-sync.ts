import { getValidMicrosoftAccessToken } from "../auth/microsoft-access-token.ts";
import { deleteItemByServiceExternal, upsertIndexedItem } from "../index/item-store.ts";
import { resolvePersonForSync } from "../people/linker.ts";
import type { Syncable, SyncContext, SyncResult } from "../sync/types.ts";
import {
  decodeMicrosoftGraphDeltaCursor,
  encodeMicrosoftGraphDeltaCursor,
  fetchMicrosoftGraphJson,
  type MicrosoftGraphDeltaCursorV1,
  modifiedMsFromIso,
  nextCursorFromODataDeltaLinks,
  parseODataDeltaPage,
} from "./microsoft-graph-sync-shared.ts";

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
  from?: { emailAddress?: { name?: string; address?: string } };
  "@removed"?: { reason?: string };
};

export type OutlookSyncCursorV1 = MicrosoftGraphDeltaCursorV1;

export function encodeOutlookSyncCursor(c: OutlookSyncCursorV1): string {
  return encodeMicrosoftGraphDeltaCursor(CURSOR_PREFIX, c);
}

export function decodeOutlookSyncCursor(raw: string): OutlookSyncCursorV1 | undefined {
  return decodeMicrosoftGraphDeltaCursor(raw, CURSOR_PREFIX);
}

function upsertMessage(ctx: SyncContext, m: GraphMessage, now: number): void {
  const id = m.id;
  if (id === undefined || id === "") {
    return;
  }
  const subject = typeof m.subject === "string" && m.subject !== "" ? m.subject : "(no subject)";
  const preview = typeof m.bodyPreview === "string" ? m.bodyPreview.slice(0, 512) : "";
  const url = typeof m.webLink === "string" ? m.webLink : null;
  const modified = modifiedMsFromIso(m.lastModifiedDateTime ?? m.receivedDateTime, now);
  const addr = m.from?.emailAddress?.address;
  const fromName = m.from?.emailAddress?.name;
  const authorId =
    addr !== undefined && addr !== ""
      ? resolvePersonForSync(ctx.db, {
          canonicalEmail: addr,
          displayName:
            fromName !== undefined && fromName !== "" ? fromName : addr,
        })
      : null;

  upsertIndexedItem(ctx.db, {
    service: SERVICE_ID,
    type: "email",
    externalId: id,
    title: subject.length > 512 ? subject.slice(0, 512) : subject,
    bodyPreview: preview,
    url,
    canonicalUrl: url,
    modifiedAt: modified,
    authorId,
    metadata: {
      receivedDateTime: m.receivedDateTime,
    },
    pinned: false,
    syncedAt: now,
  });
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

      const { json, bytes } = await fetchMicrosoftGraphJson(
        ctx,
        token,
        nextUrl,
        `${GRAPH}/me/messages/delta?$top=${String(PAGE_SIZE)}`,
        "Outlook",
      );
      const parsed = parseODataDeltaPage(json);
      const values = (parsed.value ?? []) as GraphMessage[];
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

      const { stored, hasMore } = nextCursorFromODataDeltaLinks(parsed, encodeOutlookSyncCursor);

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
