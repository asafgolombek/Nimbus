import type { NimbusFleetJobToml, NimbusFleetToml } from "../config/fleet-toml.ts";
import { asRecord } from "../connectors/unknown-record.ts";
import {
  FleetDisabledError,
  FleetJobNotFoundError,
  type FleetRunSummary,
  type FleetScheduler,
} from "../fleet/fleet-scheduler.ts";
import type { FleetBriefRow, FleetJobState, FleetStore } from "../fleet/fleet-store.ts";
import type { HostActivity, HostActivityProbe } from "../platform/host-activity.ts";
import {
  dispatchByMethod,
  type RpcMethodHandlerMap,
  type RpcMissOrHit,
} from "./_lib/dispatch-by-method.ts";

export class FleetRpcError extends Error {
  readonly rpcCode: number;
  constructor(rpcCode: number, message: string) {
    super(message);
    this.name = "FleetRpcError";
    this.rpcCode = rpcCode;
  }
}

/**
 * The dependency seam behind the `fleet.*` IPC namespace.
 *
 * `scheduler`/`store`/`jobs` are each independently optional so `fleet.status` can report the
 * truth (config + a live host probe) even when the fleet was never constructed at all — disabled
 * by `[fleet] enabled`, by org policy, or simply unconfigured (no `[[fleet.job]]` blocks). In
 * production (`platform/assemble.ts`) `store` and `jobs` are always present — pruning and
 * reporting must not hinge on whether the scheduler happens to be running right now — only
 * `scheduler` is genuinely absent when the fleet is off. The optional typing here is what lets a
 * unit test exercise `fleet.status` with none of them wired, matching how `fleet.status` is
 * documented to behave: "reports the live probe and config without running anything".
 */
export interface FleetRpcCtx {
  readonly scheduler?: FleetScheduler | undefined;
  readonly store?: FleetStore | undefined;
  readonly hostActivity: HostActivity;
  readonly config: NimbusFleetToml;
  readonly jobs?: readonly NimbusFleetJobToml[] | undefined;
  readonly now: () => number;
}

function optInt(params: unknown, key: string): number | undefined {
  const rec = asRecord(params);
  if (rec === undefined || !(key in rec)) return undefined;
  const v = rec[key];
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
    throw new FleetRpcError(-32602, `fleet: ${key} must be a non-negative integer`);
  }
  return v;
}

function optString(params: unknown, key: string): string | undefined {
  const rec = asRecord(params);
  if (rec === undefined || !(key in rec)) return undefined;
  const v = rec[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new FleetRpcError(-32602, `fleet: ${key} must be a non-empty string`);
  }
  return v;
}

function reqString(params: unknown, key: string): string {
  const v = optString(params, key);
  if (v === undefined) {
    throw new FleetRpcError(-32602, `fleet: ${key} (non-empty string) required`);
  }
  return v;
}

function requireStore(ctx: FleetRpcCtx): FleetStore {
  if (ctx.store === undefined) {
    throw new FleetRpcError(-32000, "fleet: store not available");
  }
  return ctx.store;
}

const DEFAULT_BRIEFS_LIMIT = 20;

export interface FleetStatusResult {
  readonly enabled: boolean;
  /** Whether a live `FleetScheduler` is actually ticking — distinct from `enabled`: a config with
   * `[fleet] enabled = true` but no `[[fleet.job]]` blocks is enabled and not running. */
  readonly running: boolean;
  readonly allowRemote: boolean;
  readonly remoteCallBudget: number;
  readonly minIdleSeconds: number;
  readonly requireAcPower: boolean;
  readonly retentionDays: number;
  readonly jobsConfigured: number;
  readonly probe: HostActivityProbe;
}

/** Reports config + a live host probe. Never touches the scheduler or the store. */
async function handleStatus(_params: unknown, ctx: FleetRpcCtx): Promise<FleetStatusResult> {
  const probe = await ctx.hostActivity.probe();
  return {
    enabled: ctx.config.enabled,
    running: ctx.scheduler !== undefined,
    allowRemote: ctx.config.allowRemote,
    remoteCallBudget: ctx.config.remoteCallBudget,
    minIdleSeconds: ctx.config.minIdleSeconds,
    requireAcPower: ctx.config.requireAcPower,
    retentionDays: ctx.config.retentionDays,
    jobsConfigured: ctx.jobs?.length ?? 0,
    probe,
  };
}

export interface FleetJobListEntry {
  readonly name: string;
  readonly agent: string;
  readonly intervalSeconds: number;
  /** `null` when the job has never run (no `fleet_job_state` row yet) or the store is unavailable. */
  readonly state: FleetJobState | null;
}

/** Lists every CONFIGURED job (from `[[fleet.job]]`), not just ones that have already run. */
function handleList(_params: unknown, ctx: FleetRpcCtx): { jobs: readonly FleetJobListEntry[] } {
  const jobs = ctx.jobs ?? [];
  return {
    jobs: jobs.map((j) => ({
      name: j.name,
      agent: j.agent,
      intervalSeconds: j.intervalSeconds,
      state: ctx.store?.loadJobState(j.name) ?? null,
    })),
  };
}

function handleBriefs(params: unknown, ctx: FleetRpcCtx): { briefs: readonly FleetBriefRow[] } {
  const store = requireStore(ctx);
  const limit = optInt(params, "limit") ?? DEFAULT_BRIEFS_LIMIT;
  const jobId = optString(params, "jobId");
  return {
    briefs: store.listBriefs({
      limit,
      now: ctx.now(),
      ...(jobId === undefined ? {} : { jobId }),
    }),
  };
}

/**
 * `brief: null` (never a thrown error) when the id does not resolve to a live brief — whether
 * because it never existed or because it has since expired. The caller cannot tell the two apart
 * from this response, which is deliberate: a distinguishable "it expired" answer would itself be a
 * retention disclosure the store's read-path filtering (`FleetStore.listBriefs`/`getBrief`) exists
 * to avoid.
 */
function handleShow(params: unknown, ctx: FleetRpcCtx): { brief: FleetBriefRow | null } {
  const store = requireStore(ctx);
  const id = reqString(params, "id");
  return { brief: store.getBrief(id, ctx.now()) ?? null };
}

/**
 * `jobName` is threaded straight from `params.job` — never dropped. Without it, `{}` would mean
 * "every configured job", so a mistyped job name would silently run the whole fleet rather than
 * erroring via `FleetJobNotFoundError`.
 */
async function handleRunNow(params: unknown, ctx: FleetRpcCtx): Promise<FleetRunSummary> {
  if (ctx.scheduler === undefined) {
    throw new FleetRpcError(
      -32000,
      "fleet: not running (disabled by config or policy, or no jobs configured)",
    );
  }
  const job = optString(params, "job");
  const force = asRecord(params)?.["force"] === true;
  try {
    return await ctx.scheduler.runOnce({ jobName: job, force });
  } catch (e) {
    if (e instanceof FleetDisabledError) throw new FleetRpcError(-32000, e.message);
    if (e instanceof FleetJobNotFoundError) throw new FleetRpcError(-32602, e.message);
    throw e;
  }
}

const HANDLERS: RpcMethodHandlerMap<FleetRpcCtx> = {
  "fleet.status": handleStatus,
  "fleet.list": handleList,
  "fleet.briefs": handleBriefs,
  "fleet.show": handleShow,
  "fleet.runNow": handleRunNow,
} as const;

export async function dispatchFleetRpc(
  method: string,
  params: unknown,
  ctx: FleetRpcCtx,
): Promise<RpcMissOrHit> {
  return dispatchByMethod<FleetRpcCtx>(method, params, ctx, HANDLERS);
}
