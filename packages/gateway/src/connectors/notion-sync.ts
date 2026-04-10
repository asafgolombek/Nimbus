import { getValidNotionAccessToken } from "../auth/notion-access-token.ts";
import { upsertIndexedItem } from "../index/item-store.ts";
import type { Syncable, SyncContext, SyncResult } from "../sync/types.ts";
import { isoMs, maxIso } from "./sync-iso-helpers.ts";
import {
  decodeWatermarkCursorV1,
  encodeWatermarkCursorV1,
  type WatermarkCursorV1,
} from "./sync-watermark-cursor-v1.ts";
import { asRecord, stringField } from "./unknown-record.ts";

const SERVICE_ID = "notion";
const CURSOR_PREFIX = "nimbus-ntn1:";
const NOTION_VERSION = "2022-06-28";
const SEARCH_URL = "https://api.notion.com/v1/search";

function encodeCursor(c: WatermarkCursorV1): string {
  return encodeWatermarkCursorV1(CURSOR_PREFIX, c);
}

function decodeCursor(raw: string | null): WatermarkCursorV1 | null {
  return decodeWatermarkCursorV1(raw, CURSOR_PREFIX);
}

function extractTitleFromProperties(properties: unknown): string {
  const rec = asRecord(properties);
  if (rec === undefined) {
    return "Untitled";
  }
  for (const val of Object.values(rec)) {
    const p = asRecord(val);
    if (p === undefined) {
      continue;
    }
    if (stringField(p, "type") !== "title") {
      continue;
    }
    const titleArr = p["title"];
    if (!Array.isArray(titleArr)) {
      continue;
    }
    const parts: string[] = [];
    for (const item of titleArr) {
      const ir = asRecord(item);
      if (ir === undefined) {
        continue;
      }
      if (stringField(ir, "type") !== "text") {
        continue;
      }
      const tx = asRecord(ir["text"]);
      const c = tx !== undefined ? stringField(tx, "content") : undefined;
      if (c !== undefined && c !== "") {
        parts.push(c);
      }
    }
    const joined = parts.join("");
    if (joined !== "") {
      return joined;
    }
  }
  return "Untitled";
}

export type NotionSyncableOptions = {
  ensureNotionMcpRunning: () => Promise<void>;
};

export function createNotionSyncable(options: NotionSyncableOptions): Syncable {
  const initialSyncDepthDays = 30;
  return {
    serviceId: SERVICE_ID,
    defaultIntervalMs: 5 * 60 * 1000,
    initialSyncDepthDays,
    async sync(ctx: SyncContext, cursor: string | null): Promise<SyncResult> {
      const t0 = performance.now();
      await options.ensureNotionMcpRunning();
      const rawVault = await ctx.vault.get("notion.oauth");
      if (rawVault === null || rawVault === "") {
        return {
          cursor,
          itemsUpserted: 0,
          itemsDeleted: 0,
          hasMore: false,
          durationMs: Math.round(performance.now() - t0),
        };
      }

      let accessToken: string;
      try {
        accessToken = await getValidNotionAccessToken(ctx.vault);
      } catch {
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

      await ctx.rateLimiter.acquire("notion");

      let nextCursor: string | undefined;
      let upserted = 0;
      let bytesTransferred = 0;
      let maxEdited = watermark ?? "";
      const syncTime = Date.now();
      let shouldStop = false;

      for (;;) {
        const body: Record<string, unknown> = {
          filter: { property: "object", value: "page" },
          sort: { direction: "descending", timestamp: "last_edited_time" },
          page_size: 100,
        };
        if (nextCursor !== undefined && nextCursor !== "") {
          body["start_cursor"] = nextCursor;
        }

        const res = await fetch(SEARCH_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
        const text = await res.text();
        bytesTransferred += text.length;

        if (res.status === 429) {
          ctx.rateLimiter.penalise("notion", 60_000);
          throw new Error("Notion sync: rate limited");
        }
        if (!res.ok) {
          throw new Error(`Notion sync HTTP ${String(res.status)}: ${text.slice(0, 200)}`);
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(text) as unknown;
        } catch {
          throw new Error("Notion sync: invalid JSON");
        }
        const root = asRecord(parsed);
        if (root === undefined) {
          throw new Error("Notion sync: invalid response");
        }
        const results = root["results"];
        if (!Array.isArray(results)) {
          throw new Error("Notion sync: missing results");
        }

        const hasMore = root["has_more"] === true;
        const startNext = stringField(root, "next_cursor");
        nextCursor = startNext !== undefined && startNext !== "" ? startNext : undefined;

        for (const item of results) {
          const row = asRecord(item);
          if (row === undefined) {
            continue;
          }
          if (stringField(row, "object") !== "page") {
            continue;
          }
          const id = stringField(row, "id");
          if (id === undefined || id === "") {
            continue;
          }
          const edited = stringField(row, "last_edited_time");
          if (edited !== undefined && edited !== "") {
            if (watermarkMs >= 0 && isoMs(edited) <= watermarkMs) {
              shouldStop = true;
              break;
            }
            maxEdited = maxEdited === "" ? edited : maxIso(maxEdited, edited);
          }
          const title = extractTitleFromProperties(row["properties"]);
          const url = `https://www.notion.so/${id.replace(/-/g, "")}`;
          const modified = edited !== undefined && edited !== "" ? isoMs(edited) : syncTime;
          upserted += 1;
          upsertIndexedItem(ctx.db, {
            service: SERVICE_ID,
            type: "page",
            externalId: id,
            title: title.length > 512 ? title.slice(0, 512) : title,
            bodyPreview: "",
            url,
            canonicalUrl: url,
            modifiedAt: Number.isFinite(modified) ? modified : syncTime,
            authorId: null,
            metadata: { notionPageId: id },
            pinned: false,
            syncedAt: syncTime,
          });
        }

        if (shouldStop || !hasMore || nextCursor === undefined || nextCursor === "") {
          break;
        }
      }

      const nextW = maxEdited !== "" ? maxEdited : watermark;
      const nextEnc = encodeCursor({ v: 1, watermark: nextW });

      return {
        cursor: nextEnc,
        itemsUpserted: upserted,
        itemsDeleted: 0,
        hasMore: false,
        durationMs: Math.round(performance.now() - t0),
        bytesTransferred,
      };
    },
  };
}
