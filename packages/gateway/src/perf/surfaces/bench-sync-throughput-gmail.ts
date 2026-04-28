/**
 * S6-gmail — Gmail sync throughput. Same pattern as S6-drive: MSW
 * intercepts gmail.googleapis.com; bench measures items landed in the
 * index via SELECT COUNT(*) WHERE service = 'gmail' delta.
 *
 * See bench-sync-throughput-drive.ts header for MSW policy and IPC
 * wiring rationale (applies identically here).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { type SetupServer, setupServer } from "msw/node";

import { gmailHandlers } from "../fixtures/msw-handlers.ts";
import { spawnGatewayForBench } from "../gateway-spawn-bench.ts";
import type { BenchRunOptions } from "../types.ts";

const READY_MARKER = /\[gateway\] ready/;
const SAMPLES_PER_RUN = 5;
const COUNT_SQL = "SELECT COUNT(*) AS c FROM item WHERE service = 'gmail'";

export type IpcCallFn = (method: string, params: unknown) => Promise<unknown>;

export interface SyncThroughputGmailRunOptions {
  spawn?: typeof Bun.spawn;
  gatewayEntry?: string;
  ipcCall?: IpcCallFn;
  mswServer?: SetupServer;
}

function defaultGatewayEntry(): string {
  return resolve(import.meta.dir, "..", "..", "index.ts");
}
async function defaultIpcCall(_m: string, _p: unknown): Promise<unknown> {
  throw new Error("IPC client wiring deferred; pass runOpts.ipcCall in tests");
}

export async function runSyncThroughputGmailOnce(
  opts: BenchRunOptions,
  runOpts: SyncThroughputGmailRunOptions = {},
): Promise<number[]> {
  const tier = opts.corpus ?? "small";
  const entry = runOpts.gatewayEntry ?? defaultGatewayEntry();
  const ipc = runOpts.ipcCall ?? defaultIpcCall;

  const samples: number[] = [];
  for (let i = 0; i < SAMPLES_PER_RUN; i += 1) {
    const home = mkdtempSync(join(tmpdir(), "nimbus-bench-gmail-"));
    const server = runOpts.mswServer ?? setupServer(...gmailHandlers(tier));
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
            sql: COUNT_SQL,
            params: [],
          })) as Array<{ c: number }>;
          const t0 = performance.now();
          await ipc("connector.sync", { service: "gmail", full: true });
          const ms = performance.now() - t0;
          const after = (await ipc("index.querySql", {
            sql: COUNT_SQL,
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
