import { upsertIndexedItem } from "../index/item-store.ts";
import type { Syncable, SyncContext, SyncResult } from "../sync/types.ts";
import { decodeNimbusJsonCursorPayload, encodeNimbusJsonCursor } from "./nimbus-json-cursor.ts";
import { asRecord, numberField, stringField } from "./unknown-record.ts";

const SERVICE_ID = "github";
const CURSOR_PREFIX = "nimbus-ghub1:";
const EVENTS_PATH = "/user/events?per_page=100";

type GithubSyncCursorV1 = { etag: string | null };

function encodeCursor(c: GithubSyncCursorV1): string {
  return encodeNimbusJsonCursor(CURSOR_PREFIX, c);
}

function decodeCursor(raw: string | null): GithubSyncCursorV1 | null {
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
  const etag = rec["etag"];
  return { etag: typeof etag === "string" ? etag : null };
}

function modifiedMsFromGithubTimestamps(
  record: Record<string, unknown>,
  fallbackMs: number,
): number {
  const updatedRaw = stringField(record, "updated_at");
  if (updatedRaw !== undefined) {
    const t = Date.parse(updatedRaw);
    if (Number.isFinite(t)) {
      return t;
    }
  }
  const createdRaw = stringField(record, "created_at");
  if (createdRaw !== undefined) {
    const t = Date.parse(createdRaw);
    if (Number.isFinite(t)) {
      return t;
    }
  }
  return fallbackMs;
}

function upsertFromPullRequest(
  ctx: SyncContext,
  repoFull: string,
  pr: Record<string, unknown>,
  now: number,
): void {
  const num = numberField(pr, "number");
  if (num === undefined) {
    return;
  }
  const title = stringField(pr, "title") ?? `PR #${String(num)}`;
  const body = stringField(pr, "body");
  const htmlUrl = stringField(pr, "html_url");
  const modified = modifiedMsFromGithubTimestamps(pr, now);
  const user = asRecord(pr["user"]);
  const login = user !== undefined ? stringField(user, "login") : undefined;
  const meta: Record<string, unknown> = {
    number: num,
    repo: repoFull,
    state: stringField(pr, "state"),
    draft: pr["draft"] === true,
    merged: pr["merged"] === true,
    user: login,
  };
  const externalId = `${repoFull}#${String(num)}`;
  upsertIndexedItem(ctx.db, {
    service: SERVICE_ID,
    type: "pr",
    externalId,
    title: title.length > 512 ? title.slice(0, 512) : title,
    bodyPreview: (body ?? "").slice(0, 512),
    url: htmlUrl ?? null,
    canonicalUrl: htmlUrl ?? null,
    modifiedAt: modified,
    authorId: null,
    metadata: meta,
    pinned: false,
    syncedAt: now,
  });
}

function upsertFromIssue(
  ctx: SyncContext,
  repoFull: string,
  issue: Record<string, unknown>,
  now: number,
): void {
  const num = numberField(issue, "number");
  if (num === undefined) {
    return;
  }
  const title = stringField(issue, "title") ?? `Issue #${String(num)}`;
  const body = stringField(issue, "body");
  const htmlUrl = stringField(issue, "html_url");
  const modified = modifiedMsFromGithubTimestamps(issue, now);
  const user = asRecord(issue["user"]);
  const login = user !== undefined ? stringField(user, "login") : undefined;
  const meta: Record<string, unknown> = {
    number: num,
    repo: repoFull,
    state: stringField(issue, "state"),
    user: login,
  };
  const externalId = `${repoFull}#issue-${String(num)}`;
  upsertIndexedItem(ctx.db, {
    service: SERVICE_ID,
    type: "issue",
    externalId,
    title: title.length > 512 ? title.slice(0, 512) : title,
    bodyPreview: (body ?? "").slice(0, 512),
    url: htmlUrl ?? null,
    canonicalUrl: htmlUrl ?? null,
    modifiedAt: modified,
    authorId: null,
    metadata: meta,
    pinned: false,
    syncedAt: now,
  });
}

function processPullRequestPayload(
  ctx: SyncContext,
  fullName: string,
  payload: Record<string, unknown>,
  now: number,
): boolean {
  const pr = asRecord(payload["pull_request"]);
  if (pr === undefined) {
    return false;
  }
  upsertFromPullRequest(ctx, fullName, pr, now);
  return true;
}

function processIssuesPayload(
  ctx: SyncContext,
  fullName: string,
  payload: Record<string, unknown>,
  now: number,
): boolean {
  const issue = asRecord(payload["issue"]);
  if (issue === undefined) {
    return false;
  }
  if (issue["pull_request"] !== undefined) {
    return false;
  }
  upsertFromIssue(ctx, fullName, issue, now);
  return true;
}

function processEvent(ctx: SyncContext, ev: Record<string, unknown>, now: number): boolean {
  const repo = asRecord(ev["repo"]);
  if (repo === undefined) {
    return false;
  }
  const fullName = stringField(repo, "full_name") ?? stringField(repo, "name");
  if (fullName === undefined || fullName === "") {
    return false;
  }
  const type = stringField(ev, "type");
  const payload = asRecord(ev["payload"]);
  if (payload === undefined) {
    return false;
  }
  if (type === "PullRequestEvent") {
    return processPullRequestPayload(ctx, fullName, payload, now);
  }
  if (type === "IssuesEvent") {
    return processIssuesPayload(ctx, fullName, payload, now);
  }
  return false;
}

function buildGithubEventHeaders(pat: string, etag: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    Authorization: `Bearer ${pat}`,
  };
  if (etag !== null && etag !== "") {
    headers["If-None-Match"] = etag;
  }
  return headers;
}

function applyGithubRateLimitPenaltyIfNeeded(ctx: SyncContext, res: Response): void {
  if (res.status !== 403) {
    return;
  }
  const remaining = res.headers.get("x-ratelimit-remaining");
  if (remaining !== "0" && remaining !== null) {
    return;
  }
  const retryAfter = res.headers.get("retry-after");
  const sec = retryAfter !== null ? Number.parseInt(retryAfter, 10) : 60;
  const ms = Number.isFinite(sec) && sec > 0 ? sec * 1000 : 60_000;
  ctx.rateLimiter.penalise("github", ms);
}

function parseGithubEventsPayload(text: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new TypeError("GitHub events: invalid JSON");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("GitHub events: expected array");
  }
  return parsed;
}

async function syncGithubUserEvents(
  ctx: SyncContext,
  cursor: string | null,
  pat: string,
  t0: number,
): Promise<SyncResult> {
  await ctx.rateLimiter.acquire("github");

  const prev = decodeCursor(cursor);
  const etag = prev?.etag ?? null;
  const headers = buildGithubEventHeaders(pat, etag);

  const res = await fetch(`https://api.github.com${EVENTS_PATH}`, { headers });
  const text = await res.text();
  const bytesTransferred = text.length;

  if (res.status === 304) {
    return {
      cursor,
      itemsUpserted: 0,
      itemsDeleted: 0,
      hasMore: false,
      durationMs: Math.round(performance.now() - t0),
      bytesTransferred,
    };
  }

  applyGithubRateLimitPenaltyIfNeeded(ctx, res);

  if (!res.ok) {
    throw new Error(`GitHub events ${String(res.status)}: ${text.slice(0, 200)}`);
  }

  const parsed = parseGithubEventsPayload(text);
  const now = Date.now();
  let upserted = 0;
  for (const item of parsed) {
    const ev = asRecord(item);
    if (ev === undefined) {
      continue;
    }
    if (processEvent(ctx, ev, now)) {
      upserted += 1;
    }
  }

  const newEtag = res.headers.get("etag");
  const nextCursor = encodeCursor({ etag: newEtag });

  return {
    cursor: nextCursor,
    itemsUpserted: upserted,
    itemsDeleted: 0,
    hasMore: false,
    durationMs: Math.round(performance.now() - t0),
    bytesTransferred,
  };
}

export type GithubSyncableOptions = {
  ensureGithubMcpRunning: () => Promise<void>;
};

export function createGithubSyncable(options: GithubSyncableOptions): Syncable {
  return {
    serviceId: SERVICE_ID,
    defaultIntervalMs: 60 * 1000,
    initialSyncDepthDays: 30,
    async sync(ctx: SyncContext, cursor: string | null): Promise<SyncResult> {
      const t0 = performance.now();
      await options.ensureGithubMcpRunning();
      const pat = await ctx.vault.get("github.pat");
      if (pat === null || pat === "") {
        return {
          cursor,
          itemsUpserted: 0,
          itemsDeleted: 0,
          hasMore: false,
          durationMs: Math.round(performance.now() - t0),
        };
      }

      return syncGithubUserEvents(ctx, cursor, pat, t0);
    },
  };
}
