import { upsertIndexedItemForSync } from "../index/item-store.ts";
import { type Syncable, type SyncContext, type SyncResult, syncNoopResult } from "../sync/types.ts";
import { encodeNimbusJsonCursor } from "./nimbus-json-cursor.ts";
import { asRecord, stringField } from "./unknown-record.ts";

const SERVICE_ID = "kubernetes";
const CURSOR_PREFIX = "nimbus-k8s1:";

type K8sCursorV1 = { resourceVersion: string };

function encodeCursor(c: K8sCursorV1): string {
  return encodeNimbusJsonCursor(CURSOR_PREFIX, c);
}

async function kubectlDeploymentsJson(
  kubeconfig: string,
  context: string | null,
): Promise<{ ok: boolean; text: string }> {
  const args = ["kubectl"];
  if (context !== null && context.trim() !== "") {
    args.push("--context", context.trim());
  }
  args.push("get", "deployments", "-A", "-o", "json");
  const proc = Bun.spawn(args, {
    env: { ...process.env, KUBECONFIG: kubeconfig },
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  const out = await new Response(proc.stdout).text();
  return { ok: code === 0, text: out };
}

export type KubernetesSyncableOptions = {
  ensureKubernetesMcpRunning: () => Promise<void>;
};

export function createKubernetesSyncable(options: KubernetesSyncableOptions): Syncable {
  const initialSyncDepthDays = 1;
  return {
    serviceId: SERVICE_ID,
    defaultIntervalMs: 120 * 1000,
    initialSyncDepthDays,
    async sync(ctx: SyncContext, cursor: string | null): Promise<SyncResult> {
      const t0 = performance.now();
      await options.ensureKubernetesMcpRunning();
      const kubePath = await ctx.vault.get("kubernetes.kubeconfig");
      if (kubePath === null || kubePath.trim() === "") {
        return syncNoopResult(cursor, t0);
      }
      const kc = kubePath.trim();
      const ctxNameRaw = await ctx.vault.get("kubernetes.context");
      const kctx = ctxNameRaw !== null && ctxNameRaw.trim() !== "" ? ctxNameRaw.trim() : null;

      await ctx.rateLimiter.acquire("kubernetes");
      const res = await kubectlDeploymentsJson(kc, kctx);
      if (!res.ok) {
        ctx.logger.warn(
          { serviceId: SERVICE_ID },
          "kubernetes sync: kubectl get deployments failed",
        );
        return {
          cursor: cursor ?? encodeCursor({ resourceVersion: "0" }),
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
          cursor: encodeCursor({ resourceVersion: "0" }),
          itemsUpserted: 0,
          itemsDeleted: 0,
          hasMore: false,
          durationMs: Math.round(performance.now() - t0),
          bytesTransferred: res.text.length,
        };
      }
      const rec = asRecord(root);
      const listMeta = rec !== undefined ? asRecord(rec["metadata"]) : undefined;
      const rv = listMeta !== undefined ? stringField(listMeta, "resourceVersion") : undefined;
      const items = rec !== undefined && Array.isArray(rec["items"]) ? rec["items"] : [];
      const now = Date.now();
      let upserted = 0;
      for (const item of items) {
        const row = asRecord(item);
        if (row === undefined) {
          continue;
        }
        const meta = asRecord(row["metadata"]);
        const ns = meta !== undefined ? stringField(meta, "namespace") : undefined;
        const name = meta !== undefined ? stringField(meta, "name") : undefined;
        if (ns === undefined || name === undefined) {
          continue;
        }
        const extId = `deploy:${ns}/${name}`;
        upsertIndexedItemForSync(ctx, {
          service: SERVICE_ID,
          type: "k8s_workload",
          externalId: extId,
          title: `${ns}/${name}`,
          bodyPreview: "deployment",
          url: null,
          canonicalUrl: null,
          modifiedAt: now,
          authorId: null,
          metadata: { namespace: ns, name, kind: "Deployment" },
          pinned: false,
          syncedAt: now,
        });
        upserted += 1;
      }

      return {
        cursor: encodeCursor({ resourceVersion: rv ?? "0" }),
        itemsUpserted: upserted,
        itemsDeleted: 0,
        hasMore: false,
        durationMs: Math.round(performance.now() - t0),
        bytesTransferred: res.text.length,
      };
    },
  };
}
