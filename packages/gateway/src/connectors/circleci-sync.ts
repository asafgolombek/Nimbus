import { upsertIndexedItemForSync } from "../index/item-store.ts";
import { type Syncable, type SyncContext, type SyncResult, syncNoopResult } from "../sync/types.ts";
import { decodeNimbusJsonCursorPayload, encodeNimbusJsonCursor } from "./nimbus-json-cursor.ts";
import { asRecord, numberField, stringField } from "./unknown-record.ts";

const SERVICE_ID = "circleci";
const CURSOR_PREFIX = "nimbus-cci1:";

type CircleciSyncCursorV1 = { projects: Record<string, number> };

function encodeCursor(c: CircleciSyncCursorV1): string {
  return encodeNimbusJsonCursor(CURSOR_PREFIX, c);
}

function decodeCursor(raw: string | null): CircleciSyncCursorV1 | null {
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
  const projectsRaw = rec["projects"];
  if (projectsRaw === null || typeof projectsRaw !== "object" || Array.isArray(projectsRaw)) {
    return { projects: {} };
  }
  const projects: Record<string, number> = {};
  for (const [k, v] of Object.entries(projectsRaw as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) {
      projects[k] = Math.floor(v);
    }
  }
  return { projects };
}

function listGithubReposFromIndex(db: import("bun:sqlite").Database): string[] {
  const rows = db
    .query(
      `SELECT DISTINCT json_extract(metadata, '$.repo') AS repo
       FROM item
       WHERE service = 'github'
         AND json_extract(metadata, '$.repo') IS NOT NULL
         AND length(trim(json_extract(metadata, '$.repo'))) > 0`,
    )
    .all() as { repo: string | null }[];
  const out: string[] = [];
  for (const r of rows) {
    const repo = typeof r.repo === "string" ? r.repo.trim() : "";
    if (repo !== "" && !out.includes(repo)) {
      out.push(repo);
    }
  }
  return out;
}

function githubRepoToCircleProjectSlug(full: string): string | null {
  const i = full.indexOf("/");
  if (i <= 0 || i >= full.length - 1) {
    return null;
  }
  const owner = full.slice(0, i);
  const repo = full.slice(i + 1);
  return `gh/${owner}/${repo}`;
}

function circleciProjectPath(slug: string): string {
  return slug
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => encodeURIComponent(s))
    .join("/");
}

/** App URL for GitHub-backed CircleCI projects only. */
function appPipelineUrl(projectSlug: string, pipelineNumber: number): string | null {
  const parts = projectSlug.split("/").filter((s) => s.trim() !== "");
  if (parts.length < 3 || parts[0] !== "gh") {
    return null;
  }
  const owner = parts[1] ?? "";
  const repo = parts[2] ?? "";
  if (owner === "" || repo === "") {
    return null;
  }
  return `https://app.circleci.com/pipelines/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${String(pipelineNumber)}`;
}

export type CircleciSyncableOptions = {
  ensureCircleciMcpRunning: () => Promise<void>;
};

export function createCircleciSyncable(options: CircleciSyncableOptions): Syncable {
  const initialSyncDepthDays = 14;
  return {
    serviceId: SERVICE_ID,
    defaultIntervalMs: 90 * 1000,
    initialSyncDepthDays,
    async sync(ctx: SyncContext, cursor: string | null): Promise<SyncResult> {
      const t0 = performance.now();
      await options.ensureCircleciMcpRunning();

      const apiTok = await ctx.vault.get("circleci.api_token");
      if (apiTok === null || apiTok.trim() === "") {
        return syncNoopResult(cursor, t0);
      }

      const repos = listGithubReposFromIndex(ctx.db);
      if (repos.length === 0) {
        return syncNoopResult(cursor, t0);
      }

      const prev = decodeCursor(cursor) ?? { projects: {} };
      const nextProjects: Record<string, number> = { ...prev.projects };
      let upserted = 0;
      let bytes = 0;
      const now = Date.now();
      const floorMs = now - initialSyncDepthDays * 86_400_000;
      const token = apiTok.trim();

      for (const full of repos) {
        const slug = githubRepoToCircleProjectSlug(full);
        if (slug === null) {
          continue;
        }
        const lastSeen = nextProjects[slug] ?? 0;
        await ctx.rateLimiter.acquire("circleci");
        const path = `https://circleci.com/api/v2/project/${circleciProjectPath(slug)}/pipeline`;
        const res = await fetch(path, {
          headers: {
            Accept: "application/json",
            "Circle-Token": token,
          },
        });
        const text = await res.text();
        bytes += text.length;
        if (!res.ok) {
          ctx.logger.warn(
            { serviceId: SERVICE_ID, projectSlug: slug, status: res.status },
            "circleci sync: failed to list pipelines",
          );
          continue;
        }
        let parsedRoot: unknown;
        try {
          parsedRoot = JSON.parse(text) as unknown;
        } catch {
          continue;
        }
        const root = asRecord(parsedRoot);
        if (root === undefined) {
          continue;
        }
        const items = root["items"];
        if (!Array.isArray(items)) {
          continue;
        }
        let maxNum = lastSeen;
        for (const item of items) {
          const row = asRecord(item);
          if (row === undefined) {
            continue;
          }
          const num = numberField(row, "number");
          if (num === undefined || num <= lastSeen) {
            continue;
          }
          const createdRaw = stringField(row, "created_at");
          const createdMs = createdRaw !== undefined ? Date.parse(createdRaw) : Number.NaN;
          if (Number.isFinite(createdMs) && createdMs < floorMs) {
            continue;
          }
          const state = stringField(row, "state");
          const id = stringField(row, "id");
          const vcs = asRecord(row["vcs"]);
          let branch: string | null = null;
          let revision: string | null = null;
          if (vcs !== undefined) {
            const br = stringField(vcs, "branch");
            const tag = stringField(vcs, "tag");
            branch = br ?? tag ?? null;
            revision = stringField(vcs, "revision") ?? null;
          }
          const titleBase = `Pipeline #${String(num)}`;
          const title = state !== undefined && state !== "" ? `${titleBase} — ${state}` : titleBase;
          const externalId = `${slug}#p${String(num)}`;
          const modifiedAt = Number.isFinite(createdMs) ? createdMs : now;
          const htmlUrl = appPipelineUrl(slug, num);
          const meta: Record<string, unknown> = {
            projectSlug: slug,
            pipelineNumber: num,
            pipelineId: id ?? null,
            state: state ?? null,
            branch,
            revision,
            githubRepo: full,
          };
          upsertIndexedItemForSync(ctx, {
            service: SERVICE_ID,
            type: "ci_run",
            externalId,
            title: title.length > 512 ? title.slice(0, 512) : title,
            bodyPreview: "",
            url: htmlUrl,
            canonicalUrl: htmlUrl,
            modifiedAt,
            authorId: null,
            metadata: meta,
            pinned: false,
            syncedAt: now,
          });
          upserted += 1;
          if (num > maxNum) {
            maxNum = num;
          }
        }
        nextProjects[slug] = maxNum;
      }

      return {
        cursor: encodeCursor({ projects: nextProjects }),
        itemsUpserted: upserted,
        itemsDeleted: 0,
        hasMore: false,
        durationMs: Math.round(performance.now() - t0),
        bytesTransferred: bytes,
      };
    },
  };
}
