/**
 * S6-gmail — Gmail sync throughput. See bench-sync-throughput-shared.ts
 * for the loop and MSW policy; this file supplies only the connector
 * identity.
 */

import { gmailHandlers } from "../fixtures/msw-handlers.ts";
import type { BenchRunOptions } from "../types.ts";
import {
  type IpcCallFn,
  runSyncThroughputOnce,
  type SyncThroughputRunOptions,
} from "./bench-sync-throughput-shared.ts";

export type { IpcCallFn };
export type SyncThroughputGmailRunOptions = SyncThroughputRunOptions;

export function runSyncThroughputGmailOnce(
  opts: BenchRunOptions,
  runOpts: SyncThroughputGmailRunOptions = {},
): Promise<number[]> {
  return runSyncThroughputOnce(
    { service: "gmail", tmpDirPrefix: "nimbus-bench-gmail-", handlers: gmailHandlers },
    opts,
    runOpts,
  );
}
