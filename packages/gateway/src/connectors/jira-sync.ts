import { upsertIndexedItem } from "../index/item-store.ts";
import type { Syncable, SyncContext, SyncResult } from "../sync/types.ts";
import {
  asRecord,
  basicAuthHeader,
  normalizeAtlassianSiteBaseUrl,
  stringField,
} from "./atlassian-api-sync-helpers.ts";

const SERVICE_ID = "jira";
const CURSOR_PREFIX = "nimbus-jra1:";

type JiraSyncCursorV1 = { v: 1; floorJql: string | null };

function encodeCursor(c: JiraSyncCursorV1): string {
  const payload = JSON.stringify(c);
  return `${CURSOR_PREFIX}${Buffer.from(payload, "utf8").toString("base64url")}`;
}

function decodeCursor(raw: string | null): JiraSyncCursorV1 | null {
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
    const fj = rec["floorJql"];
    if (fj !== null && fj !== undefined && typeof fj !== "string") {
      return null;
    }
    return { v: 1, floorJql: fj === null || fj === undefined ? null : fj };
  } catch {
    return null;
  }
}

/** Jira JQL datetime literal after `updated >` (exclusive), one second after API `fields.updated`. */
function isoToJqlExclusiveFloor(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) {
    return "1970/01/01 00:00";
  }
  d.setUTCSeconds(d.getUTCSeconds() + 1);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${String(y)}/${mo}/${da} ${h}:${mi}`;
}

function maxIso(a: string, b: string): string {
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

function descriptionPreview(fields: Record<string, unknown>): string {
  const d = fields["description"];
  if (d === null || d === undefined) {
    return "";
  }
  if (typeof d === "string") {
    return d.slice(0, 512);
  }
  try {
    return JSON.stringify(d).slice(0, 512);
  } catch {
    return "";
  }
}

type SearchEnvelope = {
  issues?: ReadonlyArray<Record<string, unknown>>;
  startAt?: number;
  maxResults?: number;
  total?: number;
};

export type JiraSyncableOptions = {
  ensureJiraMcpRunning: () => Promise<void>;
};

export function createJiraSyncable(options: JiraSyncableOptions): Syncable {
  const initialSyncDepthDays = 30;
  return {
    serviceId: SERVICE_ID,
    defaultIntervalMs: 60 * 1000,
    initialSyncDepthDays,
    async sync(ctx: SyncContext, cursor: string | null): Promise<SyncResult> {
      const t0 = performance.now();
      await options.ensureJiraMcpRunning();
      const token = await ctx.vault.get("jira.api_token");
      const email = await ctx.vault.get("jira.email");
      const baseRaw = await ctx.vault.get("jira.base_url");
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
      const baseUrl = normalizeAtlassianSiteBaseUrl(baseRaw);
      if (baseUrl === "") {
        return {
          cursor,
          itemsUpserted: 0,
          itemsDeleted: 0,
          hasMore: false,
          durationMs: Math.round(performance.now() - t0),
        };
      }

      const prev = decodeCursor(cursor);
      const jqlBase =
        prev?.floorJql !== null && prev?.floorJql !== undefined && prev.floorJql !== ""
          ? `updated > "${prev.floorJql}"`
          : `updated >= -${String(initialSyncDepthDays)}d`;
      const jql = `${jqlBase} ORDER BY updated ASC`;

      await ctx.rateLimiter.acquire("jira");

      let startAt = 0;
      const pageSize = 50;
      let upserted = 0;
      let bytesTransferred = 0;
      let maxUpdatedIso = "";
      const syncTime = Date.now();

      for (;;) {
        const body = JSON.stringify({
          jql,
          startAt,
          maxResults: pageSize,
          fields: ["summary", "description", "updated", "issuetype", "status"],
        });
        const res = await fetch(`${baseUrl}/rest/api/3/search`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: basicAuthHeader(email, token),
          },
          body,
        });
        const text = await res.text();
        bytesTransferred += text.length;

        if (res.status === 429) {
          ctx.rateLimiter.penalise("jira", 60_000);
          throw new Error("Jira sync: rate limited");
        }

        if (!res.ok) {
          throw new Error(`Jira sync HTTP ${String(res.status)}: ${text.slice(0, 200)}`);
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(text) as unknown;
        } catch {
          throw new Error("Jira sync: invalid JSON");
        }
        const env = asRecord(parsed) as SearchEnvelope | undefined;
        const issues = env?.issues;
        if (issues === undefined || !Array.isArray(issues)) {
          throw new Error("Jira sync: missing issues array");
        }

        for (const issue of issues) {
          const row = asRecord(issue);
          if (row === undefined) {
            continue;
          }
          const key = stringField(row, "key");
          const id = stringField(row, "id");
          if (key === undefined || key === "") {
            continue;
          }
          const fields = asRecord(row["fields"]);
          const summary = fields !== undefined ? (stringField(fields, "summary") ?? key) : key;
          const updatedRaw = fields !== undefined ? stringField(fields, "updated") : undefined;
          const modified =
            updatedRaw !== undefined && updatedRaw !== "" ? Date.parse(updatedRaw) : syncTime;
          if (updatedRaw !== undefined && updatedRaw !== "") {
            maxUpdatedIso = maxUpdatedIso === "" ? updatedRaw : maxIso(maxUpdatedIso, updatedRaw);
          }
          const bodyPrev = fields !== undefined ? descriptionPreview(fields) : "";
          const browseUrl = `${baseUrl}/browse/${key}`;
          upserted += 1;
          upsertIndexedItem(ctx.db, {
            service: SERVICE_ID,
            type: "issue",
            externalId: key,
            title: summary.length > 512 ? summary.slice(0, 512) : summary,
            bodyPreview: bodyPrev.slice(0, 512),
            url: browseUrl,
            canonicalUrl: browseUrl,
            modifiedAt: Number.isFinite(modified) ? modified : syncTime,
            authorId: null,
            metadata: { jiraId: id ?? key, key },
            pinned: false,
            syncedAt: syncTime,
          });
        }

        if (issues.length === 0) {
          break;
        }
        const reportedTotal =
          typeof env?.total === "number" && Number.isFinite(env.total) ? env.total : undefined;
        startAt += pageSize;
        if (reportedTotal !== undefined) {
          if (startAt >= reportedTotal) {
            break;
          }
        } else if (issues.length < pageSize) {
          break;
        }
      }

      const nextFloor =
        maxUpdatedIso !== "" ? isoToJqlExclusiveFloor(maxUpdatedIso) : (prev?.floorJql ?? null);
      const nextCursor = encodeCursor({ v: 1, floorJql: nextFloor });

      return {
        cursor: nextCursor,
        itemsUpserted: upserted,
        itemsDeleted: 0,
        hasMore: false,
        durationMs: Math.round(performance.now() - t0),
        bytesTransferred,
      };
    },
  };
}
