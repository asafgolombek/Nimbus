import { upsertIndexedItem } from "../index/item-store.ts";
import { stripTrailingSlashes } from "../string/strip-trailing-slashes.ts";
import type { Syncable, SyncContext, SyncResult } from "../sync/types.ts";
import { asRecord, numberField, stringField } from "./unknown-record.ts";

const SERVICE_ID = "gitlab";
const CURSOR_PREFIX = "nimbus-glab1:";
const DEFAULT_API_BASE = "https://gitlab.com/api/v4";
const MAX_PAGES_PER_SYNC = 8;

type GitlabSyncCursorV1 = { after: string; page: number };

function encodeCursor(c: GitlabSyncCursorV1): string {
  const payload = JSON.stringify(c);
  return `${CURSOR_PREFIX}${Buffer.from(payload, "utf8").toString("base64url")}`;
}

function decodeCursor(raw: string | null): GitlabSyncCursorV1 | null {
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
    const after = rec["after"];
    const page = rec["page"];
    if (typeof after !== "string" || after === "") {
      return null;
    }
    const p = typeof page === "number" && Number.isInteger(page) && page >= 1 ? page : 1;
    return { after, page: p };
  } catch {
    return null;
  }
}

function webOriginFromApiBase(apiBase: string): string {
  const u = stripTrailingSlashes(apiBase);
  if (u.endsWith("/api/v4")) {
    return u.slice(0, -"/api/v4".length);
  }
  return "https://gitlab.com";
}

function upsertFromMergeRequestEvent(
  ctx: SyncContext,
  pathWithNamespace: string,
  iid: number,
  title: string,
  actionName: string,
  createdAt: string,
  now: number,
  webOrigin: string,
): void {
  const externalId = `${pathWithNamespace}!${String(iid)}`;
  const encPath = encodeURIComponent(pathWithNamespace);
  const url = `${webOrigin}/${pathWithNamespace}/-/merge_requests/${String(iid)}`;
  const modified = Date.parse(createdAt);
  const meta: Record<string, unknown> = {
    iid,
    project: pathWithNamespace,
    action: actionName,
  };
  upsertIndexedItem(ctx.db, {
    service: SERVICE_ID,
    type: "pr",
    externalId,
    title: title.length > 512 ? title.slice(0, 512) : title,
    bodyPreview: "",
    url,
    canonicalUrl: `${webOrigin}/${encPath}/-/merge_requests/${String(iid)}`,
    modifiedAt: Number.isFinite(modified) ? modified : now,
    authorId: null,
    metadata: meta,
    pinned: false,
    syncedAt: now,
  });
}

function upsertFromIssueEvent(
  ctx: SyncContext,
  pathWithNamespace: string,
  iid: number,
  title: string,
  actionName: string,
  createdAt: string,
  now: number,
  webOrigin: string,
): void {
  const externalId = `${pathWithNamespace}#${String(iid)}`;
  const encPath = encodeURIComponent(pathWithNamespace);
  const url = `${webOrigin}/${pathWithNamespace}/-/issues/${String(iid)}`;
  const modified = Date.parse(createdAt);
  const meta: Record<string, unknown> = {
    iid,
    project: pathWithNamespace,
    action: actionName,
  };
  upsertIndexedItem(ctx.db, {
    service: SERVICE_ID,
    type: "issue",
    externalId,
    title: title.length > 512 ? title.slice(0, 512) : title,
    bodyPreview: "",
    url,
    canonicalUrl: `${webOrigin}/${encPath}/-/issues/${String(iid)}`,
    modifiedAt: Number.isFinite(modified) ? modified : now,
    authorId: null,
    metadata: meta,
    pinned: false,
    syncedAt: now,
  });
}

function processEvent(
  ctx: SyncContext,
  ev: Record<string, unknown>,
  now: number,
  webOrigin: string,
): boolean {
  const targetType = stringField(ev, "target_type");
  const targetIid = numberField(ev, "target_iid");
  const title = stringField(ev, "target_title") ?? "(no title)";
  const actionName = stringField(ev, "action_name") ?? "unknown";
  const createdAt = stringField(ev, "created_at") ?? new Date(now).toISOString();
  const project = asRecord(ev["project"]);
  const pathWithNamespace =
    project !== undefined ? stringField(project, "path_with_namespace") : undefined;
  if (pathWithNamespace === undefined || pathWithNamespace === "" || targetIid === undefined) {
    return false;
  }
  if (targetType === "MergeRequest") {
    upsertFromMergeRequestEvent(
      ctx,
      pathWithNamespace,
      targetIid,
      title,
      actionName,
      createdAt,
      now,
      webOrigin,
    );
    return true;
  }
  if (targetType === "Issue") {
    upsertFromIssueEvent(
      ctx,
      pathWithNamespace,
      targetIid,
      title,
      actionName,
      createdAt,
      now,
      webOrigin,
    );
    return true;
  }
  return false;
}

function normalisedApiBase(raw: string | null): string {
  if (raw === null || raw.trim() === "") {
    return DEFAULT_API_BASE;
  }
  return stripTrailingSlashes(raw);
}

export type GitlabSyncableOptions = {
  ensureGitlabMcpRunning: () => Promise<void>;
};

export function createGitlabSyncable(options: GitlabSyncableOptions): Syncable {
  const initialSyncDepthDays = 30;
  return {
    serviceId: SERVICE_ID,
    defaultIntervalMs: 60 * 1000,
    initialSyncDepthDays,
    async sync(ctx: SyncContext, cursor: string | null): Promise<SyncResult> {
      const t0 = performance.now();
      await options.ensureGitlabMcpRunning();
      const pat = await ctx.vault.get("gitlab.pat");
      if (pat === null || pat === "") {
        return {
          cursor,
          itemsUpserted: 0,
          itemsDeleted: 0,
          hasMore: false,
          durationMs: Math.round(performance.now() - t0),
        };
      }

      const apiBase = normalisedApiBase(await ctx.vault.get("gitlab.api_base"));
      const webOrigin = webOriginFromApiBase(apiBase);

      const prev = decodeCursor(cursor);
      const nowMs = Date.now();
      const initialAfter =
        prev !== null
          ? prev.after
          : new Date(nowMs - initialSyncDepthDays * 86_400_000).toISOString();
      let page = prev !== null ? prev.page : 1;
      const floorAfter = prev !== null ? prev.after : initialAfter;

      let upserted = 0;
      let bytesTransferred = 0;
      let newestIso = floorAfter;

      for (let pagesThisRun = 0; pagesThisRun < MAX_PAGES_PER_SYNC; pagesThisRun += 1) {
        await ctx.rateLimiter.acquire("gitlab");
        const u = new URL(`${apiBase}/events`);
        u.searchParams.set("after", floorAfter);
        u.searchParams.set("sort", "asc");
        u.searchParams.set("per_page", "100");
        u.searchParams.set("page", String(page));

        const res = await fetch(u.toString(), {
          headers: { "PRIVATE-TOKEN": pat },
        });
        const text = await res.text();
        bytesTransferred += text.length;

        if (res.status === 429) {
          const ra = res.headers.get("retry-after");
          const sec = ra !== null ? Number.parseInt(ra, 10) : 60;
          const ms = Number.isFinite(sec) && sec > 0 ? sec * 1000 : 60_000;
          ctx.rateLimiter.penalise("gitlab", ms);
          throw new Error(`GitLab events 429: ${text.slice(0, 200)}`);
        }

        if (!res.ok) {
          throw new Error(`GitLab events ${String(res.status)}: ${text.slice(0, 200)}`);
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(text) as unknown;
        } catch {
          throw new Error("GitLab events: invalid JSON");
        }
        if (!Array.isArray(parsed)) {
          throw new Error("GitLab events: expected array");
        }

        const now = Date.now();
        for (const item of parsed) {
          const ev = asRecord(item);
          if (ev === undefined) {
            continue;
          }
          const ca = stringField(ev, "created_at");
          if (ca !== undefined && ca > newestIso) {
            newestIso = ca;
          }
          if (processEvent(ctx, ev, now, webOrigin)) {
            upserted += 1;
          }
        }

        const nextPageRaw = res.headers.get("x-next-page");
        const hasNext =
          nextPageRaw !== null &&
          nextPageRaw !== "" &&
          parsed.length > 0 &&
          nextPageRaw !== String(page);
        if (hasNext) {
          const np = Number.parseInt(nextPageRaw, 10);
          if (Number.isFinite(np) && np > 0) {
            page = np;
            if (pagesThisRun + 1 >= MAX_PAGES_PER_SYNC) {
              return {
                cursor: encodeCursor({ after: floorAfter, page }),
                itemsUpserted: upserted,
                itemsDeleted: 0,
                hasMore: true,
                durationMs: Math.round(performance.now() - t0),
                bytesTransferred,
              };
            }
            continue;
          }
        }
        break;
      }

      const nextCursor = encodeCursor({ after: newestIso, page: 1 });

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
