import { upsertIndexedItemForSync } from "../index/item-store.ts";
import { type Syncable, type SyncContext, type SyncResult, syncNoopResult } from "../sync/types.ts";
import { decodeNimbusJsonCursorPayload, encodeNimbusJsonCursor } from "./nimbus-json-cursor.ts";
import { asRecord, stringField } from "./unknown-record.ts";

const SERVICE_ID = "aws";
const CURSOR_PREFIX = "nimbus-aws1:";

type AwsCursorV1 = { nextMarker: string | null };

function encodeCursor(c: AwsCursorV1): string {
  return encodeNimbusJsonCursor(CURSOR_PREFIX, c);
}

function decodeCursor(raw: string | null): AwsCursorV1 | null {
  if (raw === null || raw === "") {
    return null;
  }
  const parsed = decodeNimbusJsonCursorPayload(raw, CURSOR_PREFIX);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const rec = parsed as Record<string, unknown>;
  const m = rec["nextMarker"];
  if (m !== null && m !== undefined && typeof m !== "string") {
    return null;
  }
  return { nextMarker: typeof m === "string" && m !== "" ? m : null };
}

async function awsProcessEnv(ctx: SyncContext): Promise<Record<string, string | undefined> | null> {
  const ak = (await ctx.vault.get("aws.access_key_id"))?.trim() ?? "";
  const sk = (await ctx.vault.get("aws.secret_access_key"))?.trim() ?? "";
  const reg = (await ctx.vault.get("aws.default_region"))?.trim() ?? "";
  const prof = (await ctx.vault.get("aws.profile"))?.trim() ?? "";
  const ok = (ak !== "" && sk !== "" && (reg !== "" || prof !== "")) || (prof !== "" && ak === "");
  if (!ok) {
    return null;
  }
  const e = { ...process.env } as Record<string, string | undefined>;
  if (ak !== "") {
    e["AWS_ACCESS_KEY_ID"] = ak;
  }
  if (sk !== "") {
    e["AWS_SECRET_ACCESS_KEY"] = sk;
  }
  if (reg !== "") {
    e["AWS_DEFAULT_REGION"] = reg;
  }
  if (prof !== "") {
    e["AWS_PROFILE"] = prof;
  }
  return e;
}

async function awsCliJson(
  ctx: SyncContext,
  args: string[],
): Promise<{ ok: boolean; text: string }> {
  const env = await awsProcessEnv(ctx);
  if (env === null) {
    return { ok: false, text: "" };
  }
  const proc = Bun.spawn(["aws", ...args, "--output", "json"], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  const out = await new Response(proc.stdout).text();
  return { ok: code === 0, text: out };
}

export type AwsSyncableOptions = {
  ensureAwsMcpRunning: () => Promise<void>;
};

export function createAwsSyncable(options: AwsSyncableOptions): Syncable {
  const initialSyncDepthDays = 1;
  return {
    serviceId: SERVICE_ID,
    defaultIntervalMs: 120 * 1000,
    initialSyncDepthDays,
    async sync(ctx: SyncContext, cursor: string | null): Promise<SyncResult> {
      const t0 = performance.now();
      await options.ensureAwsMcpRunning();
      const env = await awsProcessEnv(ctx);
      if (env === null) {
        return syncNoopResult(cursor, t0);
      }

      const prev = decodeCursor(cursor);
      const marker = prev?.nextMarker ?? null;

      await ctx.rateLimiter.acquire("aws");
      const args = ["lambda", "list-functions", "--max-items", "35"];
      if (marker !== null && marker !== "") {
        args.push("--starting-token", marker);
      }
      const res = await awsCliJson(ctx, args);
      if (!res.ok) {
        ctx.logger.warn({ serviceId: SERVICE_ID }, "aws sync: list-functions failed");
        return {
          cursor: cursor ?? encodeCursor({ nextMarker: null }),
          itemsUpserted: 0,
          itemsDeleted: 0,
          hasMore: false,
          durationMs: Math.round(performance.now() - t0),
          bytesTransferred: res.text.length,
        };
      }

      let root: unknown;
      try {
        root = JSON.parse(res.text) as unknown;
      } catch {
        return {
          cursor: encodeCursor({ nextMarker: null }),
          itemsUpserted: 0,
          itemsDeleted: 0,
          hasMore: false,
          durationMs: Math.round(performance.now() - t0),
          bytesTransferred: res.text.length,
        };
      }
      const rec = asRecord(root);
      const fns = rec !== undefined && Array.isArray(rec["Functions"]) ? rec["Functions"] : [];
      const now = Date.now();
      let upserted = 0;
      for (const item of fns) {
        const row = asRecord(item);
        if (row === undefined) {
          continue;
        }
        const name = stringField(row, "FunctionName");
        const arn = stringField(row, "FunctionArn");
        const id = arn ?? name;
        if (id === undefined || id === "") {
          continue;
        }
        const title = name ?? id;
        upsertIndexedItemForSync(ctx, {
          service: SERVICE_ID,
          type: "lambda_function",
          externalId: id,
          title: title.length > 512 ? title.slice(0, 512) : title,
          bodyPreview: arn ?? "",
          url: null,
          canonicalUrl: null,
          modifiedAt: now,
          authorId: null,
          metadata: { arn: arn ?? null, name: name ?? null },
          pinned: false,
          syncedAt: now,
        });
        upserted += 1;
      }
      const next = stringField(rec ?? {}, "NextMarker");
      const nextMarker = next !== undefined && next !== "" ? next : null;

      return {
        cursor: encodeCursor({ nextMarker }),
        itemsUpserted: upserted,
        itemsDeleted: 0,
        hasMore: nextMarker !== null,
        durationMs: Math.round(performance.now() - t0),
        bytesTransferred: res.text.length,
      };
    },
  };
}
