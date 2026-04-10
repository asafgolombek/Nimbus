import { upsertIndexedItem } from "../index/item-store.ts";
import type { Syncable, SyncContext, SyncResult } from "../sync/types.ts";
import {
  asRecord,
  basicAuthHeader,
  normalizeAtlassianSiteBaseUrl,
  stringField,
} from "./atlassian-api-sync-helpers.ts";

const SERVICE_ID = "confluence";
const CURSOR_PREFIX = "nimbus-cfl1:";

type ConfluenceSyncCursorV1 = { v: 1; watermark: string | null };

function wikiApiBase(siteBase: string): string {
  const b = normalizeAtlassianSiteBaseUrl(siteBase);
  if (b === "") {
    return "";
  }
  const root = b.endsWith("/wiki") ? b : `${b}/wiki`;
  return `${root}/rest/api`;
}

function encodeCursor(c: ConfluenceSyncCursorV1): string {
  const payload = JSON.stringify(c);
  return `${CURSOR_PREFIX}${Buffer.from(payload, "utf8").toString("base64url")}`;
}

function decodeCursor(raw: string | null): ConfluenceSyncCursorV1 | null {
  if (raw === null || raw === "" || !raw.startsWith(CURSOR_PREFIX)) {
    return null;
  }
  try {
    const jsonText = Buffer.from(raw.slice(CURSOR_PREFIX.length), "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(jsonText);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const rec = parsed as Record<string, unknown>;
    if (rec["v"] !== 1) {
      return null;
    }
    const w = rec["watermark"];
    if (w !== null && w !== undefined && typeof w !== "string") {
      return null;
    }
    return { v: 1, watermark: w === null || w === undefined ? null : w };
  } catch {
    return null;
  }
}

function isoMs(s: string): number {
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

function maxIso(a: string, b: string): string {
  return isoMs(a) >= isoMs(b) ? a : b;
}

function lastModifiedFromContent(row: Record<string, unknown>): string | undefined {
  const hist = asRecord(row["history"]);
  const lu = hist !== undefined ? asRecord(hist["lastUpdated"]) : undefined;
  return lu !== undefined ? stringField(lu, "when") : undefined;
}

export type ConfluenceSyncableOptions = {
  ensureConfluenceMcpRunning: () => Promise<void>;
};

export function createConfluenceSyncable(options: ConfluenceSyncableOptions): Syncable {
  const initialSyncDepthDays = 30;
  return {
    serviceId: SERVICE_ID,
    defaultIntervalMs: 10 * 60 * 1000,
    initialSyncDepthDays,
    async sync(ctx: SyncContext, cursor: string | null): Promise<SyncResult> {
      const t0 = performance.now();
      await options.ensureConfluenceMcpRunning();
      const token = await ctx.vault.get("confluence.api_token");
      const email = await ctx.vault.get("confluence.email");
      const baseRaw = await ctx.vault.get("confluence.base_url");
      if (
        token === null ||
        token === "" ||
        email === null ||
        email === "" ||
        baseRaw === null ||
        baseRaw === ""
      ) {
        return {
          cursor,
          itemsUpserted: 0,
          itemsDeleted: 0,
          hasMore: false,
          durationMs: Math.round(performance.now() - t0),
        };
      }
      const apiBase = wikiApiBase(baseRaw);
      if (apiBase === "") {
        return {
          cursor,
          itemsUpserted: 0,
          itemsDeleted: 0,
          hasMore: false,
          durationMs: Math.round(performance.now() - t0),
        };
      }

      const prev = decodeCursor(cursor);
      const watermark = prev?.watermark ?? null;
      const watermarkMs = watermark !== null && watermark !== "" ? isoMs(watermark) : -1;

      const cqlBase =
        watermarkMs < 0
          ? `type = page AND lastModified >= now("-${String(initialSyncDepthDays)}d") order by lastModified desc`
          : `type = page AND lastModified > "${watermark}" order by lastModified desc`;

      await ctx.rateLimiter.acquire("confluence");

      let start = 0;
      const limit = 50;
      let upserted = 0;
      let bytesTransferred = 0;
      let maxEdited = watermark ?? "";
      const syncTime = Date.now();
      let shouldStop = false;

      for (;;) {
        const qs = new URLSearchParams({
          cql: cqlBase,
          limit: String(limit),
          start: String(start),
          expand: "history.lastUpdated,space,version",
        });
        const url = `${apiBase}/content/search?${qs.toString()}`;
        const res = await fetch(url, {
          headers: {
            Accept: "application/json",
            Authorization: basicAuthHeader(email, token),
          },
        });
        const text = await res.text();
        bytesTransferred += text.length;

        if (res.status === 429) {
          ctx.rateLimiter.penalise("confluence", 60_000);
          throw new Error("Confluence sync: rate limited");
        }
        if (!res.ok) {
          throw new Error(`Confluence sync HTTP ${String(res.status)}: ${text.slice(0, 200)}`);
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(text) as unknown;
        } catch {
          throw new Error("Confluence sync: invalid JSON");
        }
        const root = asRecord(parsed);
        const results = root?.["results"];
        if (!Array.isArray(results)) {
          throw new Error("Confluence sync: missing results");
        }

        for (const item of results) {
          const row = asRecord(item);
          if (row === undefined) {
            continue;
          }
          if (stringField(row, "type") !== "page") {
            continue;
          }
          const id = stringField(row, "id");
          if (id === undefined || id === "") {
            continue;
          }
          const title = stringField(row, "title") ?? id;
          const when = lastModifiedFromContent(row);
          if (when !== undefined && when !== "") {
            if (watermarkMs >= 0 && isoMs(when) <= watermarkMs) {
              shouldStop = true;
              break;
            }
            maxEdited = maxEdited === "" ? when : maxIso(maxEdited, when);
          }
          const site = normalizeAtlassianSiteBaseUrl(baseRaw);
          const webUi = `${site}/wiki/pages/viewpage.action?pageId=${encodeURIComponent(id)}`;
          const modified = when !== undefined && when !== "" ? isoMs(when) : syncTime;
          upserted += 1;
          upsertIndexedItem(ctx.db, {
            service: SERVICE_ID,
            type: "page",
            externalId: id,
            title: title.length > 512 ? title.slice(0, 512) : title,
            bodyPreview: "",
            url: webUi,
            canonicalUrl: webUi,
            modifiedAt: Number.isFinite(modified) ? modified : syncTime,
            authorId: null,
            metadata: { confluencePageId: id },
            pinned: false,
            syncedAt: syncTime,
          });
        }

        if (shouldStop || results.length === 0 || results.length < limit) {
          break;
        }
        start += limit;
      }

      const nextW = maxEdited !== "" ? maxEdited : watermark;
      return {
        cursor: encodeCursor({ v: 1, watermark: nextW }),
        itemsUpserted: upserted,
        itemsDeleted: 0,
        hasMore: false,
        durationMs: Math.round(performance.now() - t0),
        bytesTransferred,
      };
    },
  };
}
