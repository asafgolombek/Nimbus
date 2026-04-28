/**
 * S6-drive — Drive sync throughput. Spawns gateway with MSW handlers
 * serving synthetic Drive pages; calls `connector.sync { service: "drive", full: true }`
 * via IPC; measures items landed by counting rows in the local index
 * before vs after.
 *
 * Loop, IPC contract, MSW lifecycle, and items/sec calculation live in
 * `bench-sync-throughput-shared.ts`; this file supplies only the
 * connector identity.
 */

import { driveHandlers } from "../fixtures/msw-handlers.ts";
import type { BenchRunOptions } from "../types.ts";
import {
  type IpcCallFn,
  runSyncThroughputOnce,
  type SyncThroughputRunOptions,
} from "./bench-sync-throughput-shared.ts";

export type { IpcCallFn };
export type SyncThroughputDriveRunOptions = SyncThroughputRunOptions;

export function runSyncThroughputDriveOnce(
  opts: BenchRunOptions,
  runOpts: SyncThroughputDriveRunOptions = {},
): Promise<number[]> {
  return runSyncThroughputOnce(
    { service: "drive", tmpDirPrefix: "nimbus-bench-drive-", handlers: driveHandlers },
    opts,
    runOpts,
  );
}
