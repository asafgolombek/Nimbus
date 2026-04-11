import { upsertIndexedItemForSync } from "../index/item-store.ts";
import { resolvePersonForSync } from "../people/linker.ts";
import { stripTrailingSlashes } from "../string/strip-trailing-slashes.ts";
import { type Syncable, type SyncContext, type SyncResult, syncNoopResult } from "../sync/types.ts";
import { decodeNimbusJsonCursorPayload, encodeNimbusJsonCursor } from "./nimbus-json-cursor.ts";
import { asRecord, numberField, stringField } from "./unknown-record.ts";

const SERVICE_ID = "gitlab";
const CURSOR_PREFIX = "nimbus-glab1:";
const DEFAULT_API_BASE = "https://gitlab.com/api/v4";
const MAX_PAGES_PER_SYNC = 8;

type GitlabSyncCursorV1 = { after: string; page: number };

function encodeCursor(c: GitlabSyncCursorV1): string {
  return encodeNimbusJsonCursor(CURSOR_PREFIX, c);
}

function decodeCursor(raw: string | null): GitlabSyncCursorV1 | null {
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
  const after = rec["after"];
  const page = rec["page"];
  if (typeof after !== "string" || after === "") {
    return null;
  }
  const p = typeof page === "number" && Number.isInteger(page) && page >= 1 ? page : 1;
  return { after, page: p };
}

function webOriginFromApiBase(apiBase: string): string {
  const u = stripTrailingSlashes(apiBase);
  if (u.endsWith("/api/v4")) {
    return u.slice(0, -"/api/v4".length);
  }
  return "https://gitlab.com";
}

type GitlabEventUpsertFields = {
  ctx: SyncContext;
  pathWithNamespace: string;
  iid: number;
  title: string;
  actionName: string;
  createdAt: string;
  now: number;
  webOrigin: string;
  authorUsername: string | undefined;
  authorName: string | undefined;
};

function upsertFromMergeRequestEvent(f: GitlabEventUpsertFields): void {
  const {
    ctx,
    pathWithNamespace,
    iid,
    title,
    actionName,
    createdAt,
    now,
    webOrigin,
    authorUsername,
    authorName,
  } = f;
  const externalId = `${pathWithNamespace}!${String(iid)}`;
  const encPath = encodeURIComponent(pathWithNamespace);
  const url = `${webOrigin}/${pathWithNamespace}/-/merge_requests/${String(iid)}`;
  const modified = Date.parse(createdAt);
  const meta: Record<string, unknown> = {
    iid,
    project: pathWithNamespace,
    action: actionName,
  };
  const authorId =
    authorUsername !== undefined && authorUsername !== ""
      ? resolvePersonForSync(ctx.db, {
          gitlabLogin: authorUsername,
          displayName: authorName ?? authorUsername,
        })
      : null;
  upsertIndexedItemForSync(ctx, {
    service: SERVICE_ID,
    type: "pr",
    externalId,
    title: title.length > 512 ? title.slice(0, 512) : title,
    bodyPreview: "",
    url,
    canonicalUrl: `${webOrigin}/${encPath}/-/merge_requests/${String(iid)}`,
    modifiedAt: Number.isFinite(modified) ? modified : now,
    authorId,
    metadata: meta,
    pinned: false,
    syncedAt: now,
  });
}

function upsertFromIssueEvent(f: GitlabEventUpsertFields): void {
  const {
    ctx,
    pathWithNamespace,
    iid,
    title,
    actionName,
    createdAt,
    now,
    webOrigin,
    authorUsername,
    authorName,
  } = f;
  const externalId = `${pathWithNamespace}#${String(iid)}`;
  const encPath = encodeURIComponent(pathWithNamespace);
  const url = `${webOrigin}/${pathWithNamespace}/-/issues/${String(iid)}`;
  const modified = Date.parse(createdAt);
  const meta: Record<string, unknown> = {
    iid,
    project: pathWithNamespace,
    action: actionName,
  };
  const authorId =
    authorUsername !== undefined && authorUsername !== ""
      ? resolvePersonForSync(ctx.db, {
          gitlabLogin: authorUsername,
          displayName: authorName ?? authorUsername,
        })
      : null;
  upsertIndexedItemForSync(ctx, {
    service: SERVICE_ID,
    type: "issue",
    externalId,
    title: title.length > 512 ? title.slice(0, 512) : title,
    bodyPreview: "",
    url,
    canonicalUrl: `${webOrigin}/${encPath}/-/issues/${String(iid)}`,
    modifiedAt: Number.isFinite(modified) ? modified : now,
    authorId,
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
  const authorUsername = stringField(ev, "author_username");
  const authorName = stringField(ev, "author_name");
  const project = asRecord(ev["project"]);
  const pathWithNamespace =
    project === undefined ? undefined : stringField(project, "path_with_namespace");
  if (pathWithNamespace !== undefined && pathWithNamespace !== "" && targetIid !== undefined) {
    if (targetType === "MergeRequest") {
      upsertFromMergeRequestEvent({
        ctx,
        pathWithNamespace,
        iid: targetIid,
        title,
        actionName,
        createdAt,
        now,
        webOrigin,
        authorUsername,
        authorName,
      });
      return true;
    }
    if (targetType === "Issue") {
      upsertFromIssueEvent({
        ctx,
        pathWithNamespace,
        iid: targetIid,
        title,
        actionName,
        createdAt,
        now,
        webOrigin,
        authorUsername,
        authorName,
      });
      return true;
    }
  }
  return false;
}

function normalisedApiBase(raw: string | null): string {
  if (raw === null || raw.trim() === "") {
    return DEFAULT_API_BASE;
  }
  return stripTrailingSlashes(raw);
}

type GitlabFetchedEventsPage = {
  items: unknown[];
  textLength: number;
  res: Response;
};

async function gitlabFetchEventsPage(
  ctx: SyncContext,
  pat: string,
  apiBase: string,
  floorAfter: string,
  page: number,
): Promise<GitlabFetchedEventsPage> {
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
  if (res.status === 429) {
    const ra = res.headers.get("retry-after");
    const sec = ra === null ? 60 : Number.parseInt(ra, 10);
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
    throw new TypeError("GitLab events: expected array");
  }
  return { items: parsed, textLength: text.length, res };
}

function gitlabApplyEventsPage(
  ctx: SyncContext,
  items: unknown[],
  webOrigin: string,
  newestIso: string,
): { upsertedDelta: number; newestIso: string } {
  const now = Date.now();
  let nextNewest = newestIso;
  let upsertedDelta = 0;
  for (const item of items) {
    const ev = asRecord(item);
    if (ev === undefined) {
      continue;
    }
    const ca = stringField(ev, "created_at");
    if (ca !== undefined && ca > nextNewest) {
      nextNewest = ca;
    }
    if (processEvent(ctx, ev, now, webOrigin)) {
      upsertedDelta += 1;
    }
  }
  return { upsertedDelta, newestIso: nextNewest };
}

function gitlabShouldContinuePaging(
  res: Response,
  page: number,
  itemCount: number,
): { nextPage: number } | null {
  const nextPageRaw = res.headers.get("x-next-page");
  const hasNext =
    nextPageRaw !== null && nextPageRaw !== "" && itemCount > 0 && nextPageRaw !== String(page);
  if (!hasNext) {
    return null;
  }
  const np = Number.parseInt(nextPageRaw, 10);
  if (!Number.isFinite(np) || np <= 0) {
    return null;
  }
  return { nextPage: np };
}

async function gitlabSyncEventsPages(
  ctx: SyncContext,
  pat: string,
  apiBase: string,
  webOrigin: string,
  floorAfter: string,
  startPage: number,
  t0: number,
): Promise<SyncResult> {
  let page = startPage;
  let upserted = 0;
  let bytesTransferred = 0;
  let newestIso = floorAfter;

  for (let pagesThisRun = 0; pagesThisRun < MAX_PAGES_PER_SYNC; pagesThisRun += 1) {
    const fetched = await gitlabFetchEventsPage(ctx, pat, apiBase, floorAfter, page);
    bytesTransferred += fetched.textLength;
    const applied = gitlabApplyEventsPage(ctx, fetched.items, webOrigin, newestIso);
    upserted += applied.upsertedDelta;
    newestIso = applied.newestIso;

    const cont = gitlabShouldContinuePaging(fetched.res, page, fetched.items.length);
    if (cont === null) {
      break;
    }
    page = cont.nextPage;
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
  }

  return {
    cursor: encodeCursor({ after: newestIso, page: 1 }),
    itemsUpserted: upserted,
    itemsDeleted: 0,
    hasMore: false,
    durationMs: Math.round(performance.now() - t0),
    bytesTransferred,
  };
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
        return syncNoopResult(cursor, t0);
      }

      const apiBase = normalisedApiBase(await ctx.vault.get("gitlab.api_base"));
      const webOrigin = webOriginFromApiBase(apiBase);

      const prev = decodeCursor(cursor);
      const nowMs = Date.now();
      const initialAfter =
        prev === null
          ? new Date(nowMs - initialSyncDepthDays * 86_400_000).toISOString()
          : prev.after;
      const page = prev === null ? 1 : prev.page;
      const floorAfter = prev === null ? initialAfter : prev.after;

      return gitlabSyncEventsPages(ctx, pat, apiBase, webOrigin, floorAfter, page, t0);
    },
  };
}
