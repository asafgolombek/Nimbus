import { upsertIndexedItemForSync } from "../index/item-store.ts";
import { stripTrailingSlashes } from "../string/strip-trailing-slashes.ts";
import {
  clampSyncTitle,
  syncPassCursorHttpEmpty,
  syncPassCursorParseEmpty,
  syncPassCursorSuccess,
} from "../sync/pass-cursor-sync-result.ts";
import { type Syncable, type SyncContext, type SyncResult, syncNoopResult } from "../sync/types.ts";
import { encodeNimbusJsonCursor } from "./nimbus-json-cursor.ts";
import { asRecord, stringField } from "./unknown-record.ts";

const SERVICE_ID = "sentry";
const CURSOR_PREFIX = "nimbus-sentry1:";

type SentryCursorV1 = { pass: number };

function encodeCursor(c: SentryCursorV1): string {
  return encodeNimbusJsonCursor(CURSOR_PREFIX, c);
}

function pass1Cursor(): string {
  return encodeCursor({ pass: 1 });
}

export type SentrySyncableOptions = {
  ensureSentryMcpRunning: () => Promise<void>;
};

export function createSentrySyncable(options: SentrySyncableOptions): Syncable {
  const initialSyncDepthDays = 1;
  return {
    serviceId: SERVICE_ID,
    defaultIntervalMs: 120 * 1000,
    initialSyncDepthDays,
    async sync(ctx: SyncContext, cursor: string | null): Promise<SyncResult> {
      const t0 = performance.now();
      await options.ensureSentryMcpRunning();
      const token = (await ctx.vault.get("sentry.auth_token"))?.trim() ?? "";
      const org = (await ctx.vault.get("sentry.org_slug"))?.trim() ?? "";
      if (token === "" || org === "") {
        return syncNoopResult(cursor, t0);
      }
      const baseRaw = await ctx.vault.get("sentry.url");
      const apiRoot =
        baseRaw !== null && baseRaw.trim() !== ""
          ? `${stripTrailingSlashes(baseRaw.trim())}/api/0`
          : "https://sentry.io/api/0";

      await ctx.rateLimiter.acquire("sentry");
      const u = `${apiRoot}/organizations/${encodeURIComponent(org)}/projects/`;
      const res = await fetch(u, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      const text = await res.text();
      if (!res.ok) {
        ctx.logger.warn(
          { serviceId: SERVICE_ID, status: res.status },
          "sentry sync: projects failed",
        );
        return syncPassCursorHttpEmpty(t0, text.length, cursor, pass1Cursor());
      }
      let root: unknown;
      try {
        root = JSON.parse(text) as unknown;
      } catch {
        return syncPassCursorParseEmpty(t0, text.length, pass1Cursor());
      }
      const list = Array.isArray(root) ? root : [];
      const now = Date.now();
      let upserted = 0;
      for (const item of list) {
        const row = asRecord(item);
        if (row === undefined) {
          continue;
        }
        const slug = stringField(row, "slug");
        const name = stringField(row, "name");
        const id = slug ?? name;
        if (id === undefined || id === "") {
          continue;
        }
        const title = name ?? id;
        upsertIndexedItemForSync(ctx, {
          service: SERVICE_ID,
          type: "project",
          externalId: id,
          title: clampSyncTitle(title),
          bodyPreview: slug ?? "",
          url: null,
          canonicalUrl: null,
          modifiedAt: now,
          authorId: null,
          metadata: { org, slug: slug ?? null },
          pinned: false,
          syncedAt: now,
        });
        upserted += 1;
      }

      return syncPassCursorSuccess(t0, text.length, pass1Cursor(), upserted);
    },
  };
}
