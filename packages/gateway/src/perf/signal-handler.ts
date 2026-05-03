/**
 * SIGTERM / SIGINT handler: writes an `incomplete: true` HistoryLine and
 * exits non-zero. Installed by the bench CLI before the surface loop begins.
 *
 * See the B2 perf audit design §10 PR-B-1
 * deliverables — SIGTERM behaviour.
 */

import { appendHistoryLine, type HistoryLine } from "./history-line.ts";
import type { RunnerKind } from "./types.ts";

export interface IncompleteContext {
  runId: string;
  runner: RunnerKind;
  reason: string;
  nimbusGitSha: string;
  bunVersion: string;
  osVersion: string;
}

export function writeIncompleteLine(historyPath: string, ctx: IncompleteContext): void {
  const line: HistoryLine = {
    schema_version: 1,
    run_id: ctx.runId,
    timestamp: new Date().toISOString(),
    runner: ctx.runner,
    os_version: ctx.osVersion,
    nimbus_git_sha: ctx.nimbusGitSha,
    bun_version: ctx.bunVersion,
    surfaces: {},
    incomplete: true,
    incomplete_reason: ctx.reason,
  };
  appendHistoryLine(historyPath, line);
}

/**
 * Install signal handlers for SIGINT / SIGTERM that flush an incomplete line
 * and exit non-zero. Returns an `uninstall` callback for tests.
 */
export function installIncompleteSignalHandler(
  historyPath: string,
  ctxFactory: () => IncompleteContext,
): () => void {
  const handler = (signal: NodeJS.Signals): void => {
    try {
      const ctx = ctxFactory();
      writeIncompleteLine(historyPath, { ...ctx, reason: `interrupted-by-${signal}` });
    } finally {
      // 130 = standard exit code for terminate-by-signal (SIGINT).
      process.exit(130);
    }
  };
  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);
  return () => {
    process.off("SIGINT", handler);
    process.off("SIGTERM", handler);
  };
}
