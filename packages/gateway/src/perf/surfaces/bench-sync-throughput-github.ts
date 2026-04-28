/**
 * S6-github — GitHub sync throughput. The GitHub MCP connector uses
 * direct fetch (verified Task 2; no Octokit dep — verdict + version
 * recorded in fixtures/README.md), so MSW intercepts cleanly. See
 * bench-sync-throughput-shared.ts for the loop and MSW policy; this
 * file supplies only the connector identity.
 */

import { githubHandlers } from "../fixtures/msw-handlers.ts";
import type { BenchRunOptions } from "../types.ts";
import {
  type IpcCallFn,
  runSyncThroughputOnce,
  type SyncThroughputRunOptions,
} from "./bench-sync-throughput-shared.ts";

export type { IpcCallFn };
export type SyncThroughputGithubRunOptions = SyncThroughputRunOptions;

export function runSyncThroughputGithubOnce(
  opts: BenchRunOptions,
  runOpts: SyncThroughputGithubRunOptions = {},
): Promise<number[]> {
  return runSyncThroughputOnce(
    { service: "github", tmpDirPrefix: "nimbus-bench-github-", handlers: githubHandlers },
    opts,
    runOpts,
  );
}
