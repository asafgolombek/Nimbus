import { upsertIndexedItem } from "../index/item-store.ts";
import type { Syncable, SyncContext, SyncResult } from "../sync/types.ts";

const SERVICE_ID = "github";
const CURSOR_PREFIX = "nimbus-ghub1:";
const EVENTS_PATH = "/user/events?per_page=100";

type GithubSyncCursorV1 = { etag: string | null };

function encodeCursor(c: GithubSyncCursorV1): string {
  const payload = JSON.stringify(c);
  return `${CURSOR_PREFIX}${Buffer.from(payload, "utf8").toString("base64url")}`;
}

function decodeCursor(raw: string | null): GithubSyncCursorV1 | null {
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
    const etag = rec["etag"];
    return { etag: typeof etag === "string" ? etag : null };
  } catch {
    return null;
  }
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return undefined;
}

function stringField(r: Record<string, unknown>, key: string): string | undefined {
  const v = r[key];
  return typeof v === "string" ? v : undefined;
}

function numberField(r: Record<string, unknown>, key: string): number | undefined {
  const v = r[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
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
  const updatedAt = stringField(pr, "updated_at");
  const modified =
    updatedAt !== undefined
      ? Date.parse(updatedAt)
      : stringField(pr, "created_at") !== undefined
        ? Date.parse(stringField(pr, "created_at") ?? "")
        : now;
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
    modifiedAt: Number.isFinite(modified) ? modified : now,
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
  const updatedAt = stringField(issue, "updated_at");
  const modified =
    updatedAt !== undefined
      ? Date.parse(updatedAt)
      : stringField(issue, "created_at") !== undefined
        ? Date.parse(stringField(issue, "created_at") ?? "")
        : now;
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
    modifiedAt: Number.isFinite(modified) ? modified : now,
    authorId: null,
    metadata: meta,
    pinned: false,
    syncedAt: now,
  });
}

function processEvent(ctx: SyncContext, ev: Record<string, unknown>, now: number): boolean {
  const repo = asRecord(ev["repo"]);
  const fullName =
    repo !== undefined ? (stringField(repo, "full_name") ?? stringField(repo, "name")) : undefined;
  if (fullName === undefined || fullName === "") {
    return false;
  }
  const type = stringField(ev, "type");
  const payload = asRecord(ev["payload"]);
  if (payload === undefined) {
    return false;
  }
  if (type === "PullRequestEvent") {
    const pr = asRecord(payload["pull_request"]);
    if (pr !== undefined) {
      upsertFromPullRequest(ctx, fullName, pr, now);
      return true;
    }
    return false;
  }
  if (type === "IssuesEvent") {
    const issue = asRecord(payload["issue"]);
    if (issue !== undefined && issue["pull_request"] === undefined) {
      upsertFromIssue(ctx, fullName, issue, now);
      return true;
    }
  }
  return false;
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

      await ctx.rateLimiter.acquire("github");

      const prev = decodeCursor(cursor);
      const etag = prev?.etag ?? null;
      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        Authorization: `Bearer ${pat}`,
      };
      if (etag !== null && etag !== "") {
        headers["If-None-Match"] = etag;
      }

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

      const remaining = res.headers.get("x-ratelimit-remaining");
      if (res.status === 403 && (remaining === "0" || remaining === null)) {
        const retryAfter = res.headers.get("retry-after");
        const sec = retryAfter !== null ? Number.parseInt(retryAfter, 10) : 60;
        const ms = Number.isFinite(sec) && sec > 0 ? sec * 1000 : 60_000;
        ctx.rateLimiter.penalise("github", ms);
      }

      if (!res.ok) {
        throw new Error(`GitHub events ${String(res.status)}: ${text.slice(0, 200)}`);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        throw new Error("GitHub events: invalid JSON");
      }
      if (!Array.isArray(parsed)) {
        throw new Error("GitHub events: expected array");
      }

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
    },
  };
}
