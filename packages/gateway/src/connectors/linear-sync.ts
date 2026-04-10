import { upsertIndexedItem } from "../index/item-store.ts";
import type { Syncable, SyncContext, SyncResult } from "../sync/types.ts";
import { asRecord, stringField } from "./unknown-record.ts";

const SERVICE_ID = "linear";
const CURSOR_PREFIX = "nimbus-lnr1:";
const LINEAR_GQL = "https://api.linear.app/graphql";

const SYNC_QUERY = `
query LinearSync($first: Int!, $after: String, $gt: DateTimeOrDuration!) {
  issues(first: $first, after: $after, filter: { updatedAt: { gt: $gt } }, orderBy: updatedAt) {
    nodes {
      id
      identifier
      title
      description
      updatedAt
      url
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
`;

type LinearSyncCursorV1 = { since: string };

function encodeCursor(c: LinearSyncCursorV1): string {
  const payload = JSON.stringify(c);
  return `${CURSOR_PREFIX}${Buffer.from(payload, "utf8").toString("base64url")}`;
}

function decodeCursor(raw: string | null): LinearSyncCursorV1 | null {
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
    const since = rec["since"];
    return typeof since === "string" && since !== "" ? { since } : null;
  } catch {
    return null;
  }
}

type SyncPage = {
  issues: {
    nodes: ReadonlyArray<Record<string, unknown>>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

type GqlEnvelope = {
  data?: SyncPage;
  errors?: ReadonlyArray<{ message: string }>;
};

async function linearPost(
  apiKey: string,
  body: string,
): Promise<{ ok: boolean; status: number; json: GqlEnvelope | null; text: string }> {
  const res = await fetch(LINEAR_GQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body,
  });
  const text = await res.text();
  let json: GqlEnvelope | null = null;
  try {
    json = JSON.parse(text) as GqlEnvelope;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text };
}

function maxIso(a: string, b: string): string {
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

export type LinearSyncableOptions = {
  ensureLinearMcpRunning: () => Promise<void>;
};

export function createLinearSyncable(options: LinearSyncableOptions): Syncable {
  const initialSyncDepthDays = 30;
  return {
    serviceId: SERVICE_ID,
    defaultIntervalMs: 60 * 1000,
    initialSyncDepthDays,
    async sync(ctx: SyncContext, cursor: string | null): Promise<SyncResult> {
      const t0 = performance.now();
      await options.ensureLinearMcpRunning();
      const apiKey = await ctx.vault.get("linear.api_key");
      if (apiKey === null || apiKey === "") {
        return {
          cursor,
          itemsUpserted: 0,
          itemsDeleted: 0,
          hasMore: false,
          durationMs: Math.round(performance.now() - t0),
        };
      }

      const prev = decodeCursor(cursor);
      const now = Date.now();
      const floorMs = now - initialSyncDepthDays * 86_400_000;
      const sinceGt = prev?.since ?? new Date(floorMs).toISOString();

      await ctx.rateLimiter.acquire("linear");

      let pageAfter: string | null = null;
      let upserted = 0;
      let bytesTransferred = 0;
      let maxUpdated = prev?.since ?? sinceGt;

      for (;;) {
        const variables: Record<string, unknown> = {
          first: 50,
          gt: sinceGt,
        };
        if (pageAfter !== null) {
          variables["after"] = pageAfter;
        }
        const payload = JSON.stringify({
          query: SYNC_QUERY,
          variables,
        });
        const res = await linearPost(apiKey, payload);
        bytesTransferred += res.text.length;

        if (res.status === 429) {
          const retryAfter = 60_000;
          ctx.rateLimiter.penalise("linear", retryAfter);
          throw new Error("Linear sync: rate limited");
        }

        if (!res.ok || res.json === null) {
          throw new Error(`Linear sync HTTP ${String(res.status)}: ${res.text.slice(0, 200)}`);
        }
        if (res.json.errors !== undefined && res.json.errors.length > 0) {
          const msg = res.json.errors.map((e) => e.message).join("; ");
          throw new Error(`Linear sync: ${msg.slice(0, 200)}`);
        }
        const data = res.json.data;
        if (data === undefined) {
          throw new Error("Linear sync: missing data");
        }
        const issues = data.issues;
        const nodes = issues.nodes;
        const pageInfo = issues.pageInfo;
        const syncTime = Date.now();
        for (const node of nodes) {
          const row = asRecord(node);
          if (row === undefined) {
            continue;
          }
          const id = stringField(row, "id");
          const identifier = stringField(row, "identifier");
          if (id === undefined || identifier === undefined) {
            continue;
          }
          const title = stringField(row, "title") ?? identifier;
          const desc = stringField(row, "description");
          const updatedAt = stringField(row, "updatedAt");
          const url = stringField(row, "url");
          const modified =
            updatedAt !== undefined && updatedAt !== "" ? Date.parse(updatedAt) : syncTime;
          if (updatedAt !== undefined && updatedAt !== "") {
            maxUpdated = maxIso(maxUpdated, updatedAt);
          }
          upserted += 1;
          upsertIndexedItem(ctx.db, {
            service: SERVICE_ID,
            type: "issue",
            externalId: identifier,
            title: title.length > 512 ? title.slice(0, 512) : title,
            bodyPreview: (desc ?? "").slice(0, 512),
            url: url ?? null,
            canonicalUrl: url ?? null,
            modifiedAt: Number.isFinite(modified) ? modified : syncTime,
            authorId: null,
            metadata: { linearId: id, identifier },
            pinned: false,
            syncedAt: syncTime,
          });
        }

        if (pageInfo.hasNextPage && pageInfo.endCursor !== null && pageInfo.endCursor !== "") {
          pageAfter = pageInfo.endCursor;
          continue;
        }
        break;
      }

      const nextCursor = encodeCursor({ since: maxUpdated });

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
