import { upsertIndexedItemForSync } from "../index/item-store.ts";
import { type Syncable, type SyncContext, type SyncResult, syncNoopResult } from "../sync/types.ts";
import { encodeNimbusJsonCursor } from "./nimbus-json-cursor.ts";
import { asRecord } from "./unknown-record.ts";

const SERVICE_ID = "grafana";
const CURSOR_PREFIX = "nimbus-grafana1:";

type GrafanaCursorV1 = { pass: number };

function encodeCursor(c: GrafanaCursorV1): string {
  return encodeNimbusJsonCursor(CURSOR_PREFIX, c);
}

export type GrafanaSyncableOptions = {
  ensureGrafanaMcpRunning: () => Promise<void>;
};

export function createGrafanaSyncable(options: GrafanaSyncableOptions): Syncable {
  const initialSyncDepthDays = 1;
  return {
    serviceId: SERVICE_ID,
    defaultIntervalMs: 120 * 1000,
    initialSyncDepthDays,
    async sync(ctx: SyncContext, cursor: string | null): Promise<SyncResult> {
      const t0 = performance.now();
      await options.ensureGrafanaMcpRunning();
      const base = (await ctx.vault.get("grafana.url"))?.trim() ?? "";
      const tok = (await ctx.vault.get("grafana.api_token"))?.trim() ?? "";
      if (base === "" || tok === "") {
        return syncNoopResult(cursor, t0);
      }
      const rootUrl = base.replace(/\/$/, "");

      await ctx.rateLimiter.acquire("grafana");
      const u = `${rootUrl}/api/search?type=dash-db&limit=30`;
      const res = await fetch(u, {
        headers: { Authorization: `Bearer ${tok}`, Accept: "application/json" },
      });
      const text = await res.text();
      if (!res.ok) {
        ctx.logger.warn(
          { serviceId: SERVICE_ID, status: res.status },
          "grafana sync: search failed",
        );
        return {
          cursor: cursor ?? encodeCursor({ pass: 1 }),
          itemsUpserted: 0,
          itemsDeleted: 0,
          hasMore: false,
          durationMs: Math.round(performance.now() - t0),
          bytesTransferred: text.length,
        };
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        return {
          cursor: encodeCursor({ pass: 1 }),
          itemsUpserted: 0,
          itemsDeleted: 0,
          hasMore: false,
          durationMs: Math.round(performance.now() - t0),
          bytesTransferred: text.length,
        };
      }
      const arr = Array.isArray(parsed) ? parsed : [];
      const now = Date.now();
      let upserted = 0;
      for (const item of arr) {
        const row = asRecord(item);
        if (row === undefined) {
          continue;
        }
        const uid = row["uid"];
        const title = row["title"];
        if (typeof uid !== "string" || uid === "") {
          continue;
        }
        const t = typeof title === "string" && title !== "" ? title : uid;
        upsertIndexedItemForSync(ctx, {
          service: SERVICE_ID,
          type: "dashboard",
          externalId: uid,
          title: t.length > 512 ? t.slice(0, 512) : t,
          bodyPreview: "",
          url: null,
          canonicalUrl: null,
          modifiedAt: now,
          authorId: null,
          metadata: { uid },
          pinned: false,
          syncedAt: now,
        });
        upserted += 1;
      }

      return {
        cursor: encodeCursor({ pass: 1 }),
        itemsUpserted: upserted,
        itemsDeleted: 0,
        hasMore: false,
        durationMs: Math.round(performance.now() - t0),
        bytesTransferred: text.length,
      };
    },
  };
}
