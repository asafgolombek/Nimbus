#!/usr/bin/env bun
/**
 * `nimbus bench` standalone entry script.
 *
 * Invoked by `packages/cli/src/commands/bench.ts` via `Bun.spawn` so the
 * CLI package does not have to import gateway source (IPC-only rule —
 * see packages/cli/src/commands/index.ts JSDoc line 1). Subprocess
 * startup is a one-time invocation cost; per-surface aggregation
 * (5 runs × 100 samples) dominates.
 *
 * Generates the run UUID at the top, threads it through both the
 * orchestrator and the signal-handler context factory, so an interrupted
 * run records the same run_id it would have on success.
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { runBenchCli } from "./bench-cli.ts";
import { type IncompleteContext, installIncompleteSignalHandler } from "./signal-handler.ts";
import type { RunnerKind } from "./types.ts";

function takeFlag(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i < 0 || i + 1 >= args.length) return undefined;
  return args[i + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.indexOf(flag) >= 0;
}

const HELP = `nimbus bench — perf bench harness (Phase 1A)

Usage:
  nimbus bench --surface <id> [--corpus small|medium|large] [--runs N] (--reference|--gha)
  nimbus bench --all [--corpus ...] [--runs N] (--reference|--gha)

Flags:
  --surface <id>      surface id (S2-a is the only registered driver in PR-B-1)
  --all               run every registered surface
  --corpus <tier>     small | medium | large
  --runs <N>          per-surface invocations (default 5)
  --reference         tag as reference-m1air (requires interactive protocol confirm)
  --gha               tag as gha-<os> (auto-derived from process.platform)
  --history <path>    history.jsonl override
  --fixture-cache <p> fixture cache dir override
  --help              this message

See docs/superpowers/specs/2026-04-26-perf-audit-design.md for the surface table.
`;

function detectRunner(args: string[]): RunnerKind {
  if (hasFlag(args, "--reference")) return "reference-m1air";
  if (hasFlag(args, "--gha")) {
    if (process.platform === "darwin") return "gha-macos";
    if (process.platform === "win32") return "gha-windows";
    return "gha-ubuntu";
  }
  return "local-dev";
}

export interface BenchRunnerDeps {
  stdout?: (s: string) => void;
  /** Override default `<cwd>/docs/perf/history.jsonl`. Tests inject a tmp dir. */
  historyPath?: string;
}

export async function runBenchRunnerMain(
  args: string[],
  deps: BenchRunnerDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? ((s: string) => process.stdout.write(`${s}\n`));
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    stdout(HELP);
    return 0;
  }

  const historyPath =
    deps.historyPath ??
    takeFlag(args, "--history") ??
    join(process.cwd(), "docs/perf/history.jsonl");
  const fixtureCacheDir = takeFlag(args, "--fixture-cache");

  const runId = randomUUID();
  const runner = detectRunner(args);

  const ctxFactory = (): IncompleteContext => ({
    runId,
    runner,
    reason: "interrupted",
    nimbusGitSha: process.env["GITHUB_SHA"] ?? "unknown",
    bunVersion: typeof Bun !== "undefined" ? Bun.version : "unknown",
    osVersion: `${process.platform} ${process.arch}`,
  });
  const uninstall = installIncompleteSignalHandler(historyPath, ctxFactory);

  try {
    return await runBenchCli(args, {
      runId,
      historyPath,
      ...(fixtureCacheDir !== undefined ? { fixtureCacheDir } : {}),
      stdout,
      stderr: (s) => process.stderr.write(`${s}\n`),
    });
  } finally {
    uninstall();
  }
}

// `bun packages/gateway/src/perf/bench-runner.ts ...` enters here.
if (import.meta.main) {
  process.exitCode = await runBenchRunnerMain(process.argv.slice(2));
}
