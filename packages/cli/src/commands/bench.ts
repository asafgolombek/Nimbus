/**
 * `nimbus bench` — thin spawn wrapper.
 *
 * Spawns the gateway-side standalone entry script
 * `packages/gateway/src/perf/bench-runner.ts` so that all bench measurement
 * runs in a separate process. The CLI package is forbidden from importing
 * `gateway/src` — see ./index.ts JSDoc line 1.
 *
 * Subprocess startup is a one-time invocation cost (~50 ms); per-surface
 * aggregation (5 runs × 100 samples) dominates measurement time.
 *
 * Invocation forms (both produce identical output, per spec §6 criterion 1):
 *   bun packages/cli/src/index.ts bench --surface <id> --runs N --reference
 *   nimbus bench --surface <id> --runs N --gha
 */

import { resolve } from "node:path";

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

const HELP = `nimbus bench — perf bench harness (Phase 1A)

Usage:
  nimbus bench --surface <id> [--corpus small|medium|large] [--runs N] (--reference|--gha)
  nimbus bench --all [--corpus ...] [--runs N] (--reference|--gha)

Flags:
  --surface <id>      one of: S1, S2-a, S2-b, S2-c, S3, S4, S5, S11-a, S11-b
                      (cluster C — S6/S7/S8/S9/S10 — lands in PR-B-2b)
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

/**
 * Resolve the path to bench-runner.ts. In dev / source-tree invocation we
 * walk relative to this file's directory; in a built/bundled CLI a future
 * task can substitute a build-time-resolved constant.
 */
function resolveBenchRunnerPath(): string {
  // packages/cli/src/commands/bench.ts → packages/gateway/src/perf/bench-runner.ts
  return resolve(import.meta.dir, "..", "..", "..", "gateway", "src", "perf", "bench-runner.ts");
}

export interface RunBenchDeps {
  /** Test-injectable spawn (defaults to Bun.spawn). */
  spawn?: typeof Bun.spawn;
  /** Test-injectable stdout writer for the in-process --help branch. */
  stdout?: (s: string) => void;
}

export async function runBench(args: string[], deps: RunBenchDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? ((s: string) => process.stdout.write(s));
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    stdout(HELP);
    return 0;
  }

  const spawn = deps.spawn ?? Bun.spawn;
  const runner = resolveBenchRunnerPath();

  // Use the same `bun` executable that's running this CLI. When invoked as
  // `bun packages/cli/src/index.ts bench …`, `process.execPath` already
  // resolves to bun.
  const proc = spawn([process.execPath, runner, ...args], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;
  return typeof exitCode === "number" ? exitCode : 1;
}
