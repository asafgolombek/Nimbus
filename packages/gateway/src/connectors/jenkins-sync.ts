import { upsertIndexedItemForSync } from "../index/item-store.ts";
import { stripTrailingSlashes } from "../string/strip-trailing-slashes.ts";
import { clampSyncTitle } from "../sync/pass-cursor-sync-result.ts";
import { type Syncable, type SyncContext, type SyncResult, syncNoopResult } from "../sync/types.ts";
import {
  flattenJenkinsApiJobs,
  JENKINS_JOBS_API_TREE,
  type JenkinsApiJobNode,
} from "./jenkins-api-jobs.ts";
import { decodeNimbusJsonCursorPayload, encodeNimbusJsonCursor } from "./nimbus-json-cursor.ts";
import { asRecord, numberField, stringField } from "./unknown-record.ts";

const SERVICE_ID = "jenkins";
const CURSOR_PREFIX = "nimbus-jnk1:";

type JenkinsSyncCursorV1 = { jobs: Record<string, number> };

function encodeCursor(c: JenkinsSyncCursorV1): string {
  return encodeNimbusJsonCursor(CURSOR_PREFIX, c);
}

function decodeCursor(raw: string | null): JenkinsSyncCursorV1 | null {
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
  const jobsRaw = rec["jobs"];
  if (jobsRaw === null || typeof jobsRaw !== "object" || Array.isArray(jobsRaw)) {
    return { jobs: {} };
  }
  const jobs: Record<string, number> = {};
  for (const [k, v] of Object.entries(jobsRaw as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) {
      jobs[k] = Math.floor(v);
    }
  }
  return { jobs };
}

function jobPathFromFullName(fullName: string): string {
  const segs = fullName
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (segs.length === 0) {
    return "";
  }
  return segs.map((s) => encodeURIComponent(s)).join("/job/");
}

function jenkinsJobRoot(base: string, fullName: string): string {
  const path = jobPathFromFullName(fullName);
  return `${base}/job/${path}`;
}

function basicAuthHeader(user: string, token: string): string {
  const b64 = Buffer.from(`${user}:${token}`, "utf8").toString("base64");
  return `Basic ${b64}`;
}

async function jenkinsGetJson(
  url: string,
  auth: string,
): Promise<{ ok: boolean; status: number; text: string; json: unknown }> {
  const res = await fetch(url, {
    headers: { Authorization: auth, Accept: "application/json" },
  });
  const text = await res.text();
  let parsedBody: unknown = null;
  try {
    parsedBody = JSON.parse(text) as unknown;
  } catch {
    parsedBody = null;
  }
  return { ok: res.ok, status: res.status, text, json: parsedBody };
}

function buildTitle(
  jobFullName: string,
  num: number,
  result: string | undefined,
  building: boolean,
): string {
  let suffix = "";
  if (result !== undefined && result !== "") {
    suffix = ` — ${result}`;
  } else if (building) {
    suffix = " (running)";
  }
  return `${jobFullName} #${String(num)}${suffix}`;
}

function upsertJenkinsBuildRowIfNew(
  ctx: SyncContext,
  job: { fullName: string; url?: string },
  br: unknown,
  lastSeen: number,
  floorMs: number,
  now: number,
): { upserted: boolean; num: number } | null {
  const b = asRecord(br);
  if (b === undefined) {
    return null;
  }
  const num = numberField(b, "number");
  if (num === undefined || num <= lastSeen) {
    return null;
  }
  const ts = numberField(b, "timestamp");
  const modifiedAt = ts !== undefined && Number.isFinite(ts) ? Math.floor(ts) : now;
  if (modifiedAt < floorMs) {
    return null;
  }
  const result = stringField(b, "result");
  const building = b["building"] === true;
  const url = stringField(b, "url") ?? job.url ?? null;
  const duration = numberField(b, "duration");
  const titleRaw = buildTitle(job.fullName, num, result, building);
  const externalId = `${job.fullName}#${String(num)}`;
  const meta: Record<string, unknown> = {
    jobName: job.fullName,
    buildNumber: num,
    result: result ?? null,
    building,
    duration_ms: duration ?? null,
  };
  upsertIndexedItemForSync(ctx, {
    service: SERVICE_ID,
    type: "ci_run",
    externalId,
    title: clampSyncTitle(titleRaw),
    bodyPreview: "",
    url,
    canonicalUrl: url,
    modifiedAt,
    authorId: null,
    metadata: meta,
    pinned: false,
    syncedAt: now,
  });
  return { upserted: true, num };
}

async function syncJenkinsJobBuilds(
  ctx: SyncContext,
  job: { fullName: string; url?: string },
  base: string,
  auth: string,
  lastSeen: number,
  floorMs: number,
  now: number,
): Promise<{ upserted: number; bytes: number; maxNum: number }> {
  const tree = encodeURIComponent("builds[number,url,result,duration,timestamp,building]{0,25}");
  const bUrl = `${jenkinsJobRoot(base, job.fullName)}/api/json?tree=${tree}`;
  const bRes = await jenkinsGetJson(bUrl, auth);
  const bytes = bRes.text.length;
  if (!bRes.ok || bRes.json === null || typeof bRes.json !== "object") {
    return { upserted: 0, bytes, maxNum: lastSeen };
  }
  const buildsRaw = (bRes.json as Record<string, unknown>)["builds"];
  if (!Array.isArray(buildsRaw)) {
    return { upserted: 0, bytes, maxNum: lastSeen };
  }
  let maxNum = lastSeen;
  let upserted = 0;
  for (const br of buildsRaw) {
    const r = upsertJenkinsBuildRowIfNew(ctx, job, br, lastSeen, floorMs, now);
    if (r === null) {
      continue;
    }
    upserted += 1;
    if (r.num > maxNum) {
      maxNum = r.num;
    }
  }
  return { upserted, bytes, maxNum };
}

async function runJenkinsSyncAfterAuth(
  ctx: SyncContext,
  cursor: string | null,
  base: string,
  auth: string,
  initialSyncDepthDays: number,
  t0: number,
): Promise<SyncResult> {
  const prev = decodeCursor(cursor) ?? { jobs: {} };
  const nextJobs: Record<string, number> = { ...prev.jobs };
  let upserted = 0;
  let bytes = 0;

  await ctx.rateLimiter.acquire("jenkins");

  const jobsUrl = `${base}/api/json?tree=${encodeURIComponent(JENKINS_JOBS_API_TREE)}`;
  const jobsRes = await jenkinsGetJson(jobsUrl, auth);
  bytes += jobsRes.text.length;
  if (!jobsRes.ok || jobsRes.json === null || typeof jobsRes.json !== "object") {
    ctx.logger.warn(
      { serviceId: SERVICE_ID, status: jobsRes.status },
      "jenkins sync: failed to list jobs",
    );
    return {
      cursor: encodeCursor(prev),
      itemsUpserted: 0,
      itemsDeleted: 0,
      hasMore: false,
      durationMs: Math.round(performance.now() - t0),
      bytesTransferred: bytes,
    };
  }

  const jobsRoot = jobsRes.json as Record<string, unknown>;
  const jobsArr = jobsRoot["jobs"];
  const flat: { fullName: string; url?: string }[] = [];
  flattenJenkinsApiJobs(
    Array.isArray(jobsArr) ? (jobsArr as JenkinsApiJobNode[]) : undefined,
    flat,
  );

  const now = Date.now();
  const floorMs = now - initialSyncDepthDays * 86_400_000;

  for (const job of flat) {
    const lastSeen = nextJobs[job.fullName] ?? 0;
    const r = await syncJenkinsJobBuilds(ctx, job, base, auth, lastSeen, floorMs, now);
    bytes += r.bytes;
    upserted += r.upserted;
    nextJobs[job.fullName] = r.maxNum;
  }

  return {
    cursor: encodeCursor({ jobs: nextJobs }),
    itemsUpserted: upserted,
    itemsDeleted: 0,
    hasMore: false,
    durationMs: Math.round(performance.now() - t0),
    bytesTransferred: bytes,
  };
}

export type JenkinsSyncableOptions = {
  ensureJenkinsMcpRunning: () => Promise<void>;
};

export function createJenkinsSyncable(options: JenkinsSyncableOptions): Syncable {
  const initialSyncDepthDays = 14;
  return {
    serviceId: SERVICE_ID,
    defaultIntervalMs: 120 * 1000,
    initialSyncDepthDays,
    async sync(ctx: SyncContext, cursor: string | null): Promise<SyncResult> {
      const t0 = performance.now();
      await options.ensureJenkinsMcpRunning();

      const baseRaw = await ctx.vault.get("jenkins.base_url");
      const user = await ctx.vault.get("jenkins.username");
      const token = await ctx.vault.get("jenkins.api_token");
      if (
        baseRaw === null ||
        baseRaw.trim() === "" ||
        user === null ||
        user.trim() === "" ||
        token === null ||
        token.trim() === ""
      ) {
        return syncNoopResult(cursor, t0);
      }
      const base = stripTrailingSlashes(baseRaw);
      const auth = basicAuthHeader(user.trim(), token.trim());

      return runJenkinsSyncAfterAuth(ctx, cursor, base, auth, initialSyncDepthDays, t0);
    },
  };
}
