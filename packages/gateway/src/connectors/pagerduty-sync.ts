import { upsertIndexedItemForSync } from "../index/item-store.ts";
import { type Syncable, type SyncContext, type SyncResult, syncNoopResult } from "../sync/types.ts";
import { readConnectorSecret } from "./connector-vault.ts";
import { decodeNimbusJsonCursorPayload, encodeNimbusJsonCursor } from "./nimbus-json-cursor.ts";
import { asRecord, stringField } from "./unknown-record.ts";

const SERVICE_ID = "pagerduty";
const CURSOR_PREFIX = "nimbus-pd1:";

type PdCursorV1 = { lastUpdated: string };

function encodeCursor(c: PdCursorV1): string {
  return encodeNimbusJsonCursor(CURSOR_PREFIX, c);
}

function decodeCursor(raw: string | null): PdCursorV1 | null {
  if (raw === null || raw === "") {
    return null;
  }
  const parsed = decodeNimbusJsonCursorPayload(raw, CURSOR_PREFIX);
  if (parsed === undefined) {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const rec = parsed as Record<string, unknown>;
  const lu = rec["lastUpdated"];
  if (typeof lu !== "string" || lu === "") {
    return null;
  }
  return { lastUpdated: lu };
}

function parsePagerdutyIncidents(text: string): unknown[] | null {
  let root: unknown;
  try {
    root = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  const rec = asRecord(root);
  if (rec === undefined) {
    return null;
  }
  const raw = rec["incidents"];
  return Array.isArray(raw) ? raw : null;
}

function syncPagerdutyIncidentItems(
  ctx: SyncContext,
  incidents: unknown[],
  since: string,
  now: number,
): { upserted: number; maxUpdated: string } {
  let upserted = 0;
  let maxUpdated = since;
  for (const item of incidents) {
    const row = asRecord(item);
    if (row === undefined) {
      continue;
    }
    const id = stringField(row, "id");
    if (id === undefined || id === "") {
      continue;
    }
    const title = stringField(row, "title") ?? `Incident ${id}`;
    const status = stringField(row, "status");
    const htmlUrl = stringField(row, "html_url");
    const updated = stringField(row, "updated_at") ?? stringField(row, "created_at");
    if (updated !== undefined && updated > maxUpdated) {
      maxUpdated = updated;
    }
    const modifiedAt = updated === undefined ? now : Date.parse(updated);
    upsertIndexedItemForSync(ctx, {
      service: SERVICE_ID,
      type: "incident",
      externalId: id,
      title: title.length > 512 ? title.slice(0, 512) : title,
      bodyPreview: status ?? "",
      url: htmlUrl ?? null,
      canonicalUrl: htmlUrl ?? null,
      modifiedAt: Number.isFinite(modifiedAt) ? modifiedAt : now,
      authorId: null,
      metadata: { status: status ?? null, incidentId: id },
      pinned: false,
      syncedAt: now,
    });
    upserted += 1;
  }
  return { upserted, maxUpdated };
}

function pagerdutyListFailureResult(
  cursor: string | null,
  since: string,
  textLen: number,
  t0: number,
): SyncResult {
  return {
    cursor: cursor ?? encodeCursor({ lastUpdated: since }),
    itemsUpserted: 0,
    itemsDeleted: 0,
    hasMore: false,
    durationMs: Math.round(performance.now() - t0),
    bytesTransferred: textLen,
  };
}

export type PagerdutySyncableOptions = {
  ensurePagerdutyMcpRunning: () => Promise<void>;
};

export function createPagerdutySyncable(options: PagerdutySyncableOptions): Syncable {
  const initialSyncDepthDays = 14;
  return {
    serviceId: SERVICE_ID,
    defaultIntervalMs: 120 * 1000,
    initialSyncDepthDays,
    async sync(ctx: SyncContext, cursor: string | null): Promise<SyncResult> {
      const t0 = performance.now();
      await options.ensurePagerdutyMcpRunning();
      const token = await readConnectorSecret(ctx.vault, "pagerduty", "api_token");
      if (token === null || token.trim() === "") {
        return syncNoopResult(cursor, t0);
      }
      const prev = decodeCursor(cursor);
      const now = Date.now();
      const floorIso = new Date(now - initialSyncDepthDays * 86_400_000).toISOString();
      const since = prev?.lastUpdated ?? floorIso;

      await ctx.rateLimiter.acquire("pagerduty");
      const u = new URL("https://api.pagerduty.com/incidents");
      u.searchParams.set("limit", "50");
      u.searchParams.set("sort_by", "updated_at");
      u.searchParams.set("since", since);
      const res = await fetch(u.toString(), {
        headers: {
          Accept: "application/vnd.pagerduty+json;version=2",
          Authorization: `Token token=${token.trim()}`,
        },
      });
      const text = await res.text();
      if (!res.ok) {
        ctx.logger.warn(
          { serviceId: SERVICE_ID, status: res.status },
          "pagerduty sync: list failed",
        );
        return pagerdutyListFailureResult(cursor, since, text.length, t0);
      }
      const incidents = parsePagerdutyIncidents(text);
      if (incidents === null) {
        return {
          cursor: encodeCursor({ lastUpdated: since }),
          itemsUpserted: 0,
          itemsDeleted: 0,
          hasMore: false,
          durationMs: Math.round(performance.now() - t0),
          bytesTransferred: text.length,
        };
      }
      const { upserted, maxUpdated } = syncPagerdutyIncidentItems(ctx, incidents, since, now);

      return {
        cursor: encodeCursor({ lastUpdated: maxUpdated }),
        itemsUpserted: upserted,
        itemsDeleted: 0,
        hasMore: false,
        durationMs: Math.round(performance.now() - t0),
        bytesTransferred: text.length,
      };
    },
  };
}
