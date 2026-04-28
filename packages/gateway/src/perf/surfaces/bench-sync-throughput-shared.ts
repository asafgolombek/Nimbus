/**
 * Shared driver for the S6-* sync-throughput surfaces (Drive / Gmail /
 * GitHub). Each per-service file in this directory is a thin wrapper
 * that supplies the connector identity (service name + MSW handler
 * factory + tmp-dir prefix); the loop, IPC contract, MSW lifecycle, and
 * items/sec calculation live here.
 *
 * The COUNT(*) before/after queries are O(log N) — `idx_item_service`
 * (packages/gateway/src/index/unified-item-v3-sql.ts:37) covers them
 * — so the count overhead is negligible inside the timed window.
 *
 * MSW unhandled-request policy is `"warn"` here (not `"error"` as in
 * unit tests). Rationale: the spawned gateway emits unrelated HTTP
 * during steady-state — telemetry post, update-manifest probe — that
 * would crash the bench under `"error"`. Unit tests use `"error"` as
 * a sentinel against connector drift since they don't spawn a real
 * gateway. (feedback F-1.3)
 *
 * Production IPC wiring (deferred to PR-C / PR-B-2b-3): see
 * bench-rss-heavy-sync.ts header for the recommended NimbusClient
 * pattern (feedback F-1.1).
 *
 * resultKind = "throughput" → per-run samples are items/sec; harness
 * returns median across runs as throughputPerSec.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { RequestHandler } from "msw";
import { type SetupServer, setupServer } from "msw/node";

import { spawnGatewayForBench } from "../gateway-spawn-bench.ts";
import type { BenchRunOptions, CorpusTier } from "../types.ts";

const READY_MARKER = /\[gateway\] ready/;
export const SAMPLES_PER_RUN = 5;

export type IpcCallFn = (method: string, params: unknown) => Promise<unknown>;

export interface SyncThroughputRunOptions {
  spawn?: typeof Bun.spawn;
  gatewayEntry?: string;
  /** Test injection. In production constructed against the spawned socket. */
  ipcCall?: IpcCallFn;
  /** Test injection — a custom MSW server used in place of fixture-driven setupServer. */
  mswServer?: SetupServer;
}

interface SyncThroughputServiceConfig {
  service: string;
  tmpDirPrefix: string;
  handlers: (tier: CorpusTier) => RequestHandler[];
}

function defaultGatewayEntry(): string {
  return resolve(import.meta.dir, "..", "..", "index.ts");
}

async function defaultIpcCall(_method: string, _params: unknown): Promise<unknown> {
  throw new Error("IPC client wiring deferred; pass runOpts.ipcCall in tests");
}

export async function runSyncThroughputOnce(
  config: SyncThroughputServiceConfig,
  opts: BenchRunOptions,
  runOpts: SyncThroughputRunOptions = {},
): Promise<number[]> {
  const tier = opts.corpus ?? "small";
  const entry = runOpts.gatewayEntry ?? defaultGatewayEntry();
  const ipc = runOpts.ipcCall ?? defaultIpcCall;
  const countSql = `SELECT COUNT(*) AS c FROM item WHERE service = '${config.service}'`;

  const samples: number[] = [];
  for (let i = 0; i < SAMPLES_PER_RUN; i += 1) {
    const home = mkdtempSync(join(tmpdir(), config.tmpDirPrefix));
    const server = runOpts.mswServer ?? setupServer(...config.handlers(tier));
    server.listen({ onUnhandledRequest: "warn" });
    try {
      const result = await spawnGatewayForBench<{ items: number; ms: number }, void>({
        cmd: process.execPath,
        args: [entry],
        readyMarker: READY_MARKER,
        env: { NIMBUS_HOME: home },
        ...(runOpts.spawn !== undefined && { spawn: runOpts.spawn }),
        workload: async () => {
          const before = (await ipc("index.querySql", {
            sql: countSql,
            params: [],
          })) as Array<{ c: number }>;
          const t0 = performance.now();
          await ipc("connector.sync", { service: config.service, full: true });
          const ms = performance.now() - t0;
          const after = (await ipc("index.querySql", {
            sql: countSql,
            params: [],
          })) as Array<{ c: number }>;
          return {
            items: (after[0]?.c ?? 0) - (before[0]?.c ?? 0),
            ms,
          };
        },
      });
      const itemsPerSec =
        result.workloadResult.ms <= 0
          ? 0
          : result.workloadResult.items / (result.workloadResult.ms / 1000);
      samples.push(itemsPerSec);
    } finally {
      server.close();
      rmSync(home, { recursive: true, force: true });
    }
  }
  return samples;
}
