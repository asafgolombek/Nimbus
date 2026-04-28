/**
 * RSS sampler for S7-a/b/c drivers. Polls `pidusage(pid)` at
 * `intervalMs` for `durationMs`; returns the sample array, p95, and
 * the count of polls that errored (process gone, permission denied,
 * etc.).
 *
 * Tests inject the pidusage function. Production callers omit it and
 * the helper imports the real npm package lazily.
 *
 * See docs/superpowers/specs/2026-04-27-perf-audit-cluster-c-design.md §5.2.
 */

import { computePercentiles } from "./percentiles.ts";

export interface SampleRssOptions {
  pid: number;
  /** 60_000 in production; tests pass 100–200. */
  durationMs: number;
  /** Default 1000. */
  intervalMs?: number;
  signal?: AbortSignal;
  /** Injectable for tests; defaults to a lazy `pidusage` import. */
  pidusage?: (pid: number) => Promise<{ memory: number }>;
}

export interface SampleRssResult {
  samples: number[];
  p95: number;
  intervalsMissed: number;
}

let cachedPidusage: ((pid: number) => Promise<{ memory: number }>) | undefined;

async function realPidusage(pid: number): Promise<{ memory: number }> {
  if (cachedPidusage === undefined) {
    const mod = await import("pidusage");
    cachedPidusage = mod.default as (pid: number) => Promise<{ memory: number }>;
  }
  return cachedPidusage(pid);
}

export async function sampleRss(opts: SampleRssOptions): Promise<SampleRssResult> {
  const intervalMs = opts.intervalMs ?? 1000;
  const sampler = opts.pidusage ?? realPidusage;
  const samples: number[] = [];
  let intervalsMissed = 0;
  const start = performance.now();
  const deadline = start + opts.durationMs;
  // Deadline-based scheduling — feedback F-2.2. Each tick fires at
  // start + intervalMs * tickIdx (not "now + intervalMs"), so the
  // sampler-call cost doesn't accumulate into cadence drift. If a
  // sampler call ran long enough that we missed a tick, we fire the
  // next one immediately (and continue to advance tickIdx by 1 each
  // iteration so we don't loop forever in the catch-up case).
  let tickIdx = 0;

  while (performance.now() < deadline) {
    if (opts.signal?.aborted === true) break;
    try {
      const { memory } = await sampler(opts.pid);
      samples.push(memory);
    } catch {
      intervalsMissed += 1;
    }
    tickIdx += 1;
    const nextTickAt = start + tickIdx * intervalMs;
    const wait = Math.max(
      0,
      Math.min(nextTickAt - performance.now(), deadline - performance.now()),
    );
    if (wait <= 0) continue;
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, wait);
      opts.signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          resolve();
        },
        { once: true },
      );
    });
  }

  if (samples.length === 0) {
    return { samples, p95: 0, intervalsMissed };
  }
  const p = computePercentiles(samples);
  return { samples, p95: p.p95 ?? 0, intervalsMissed };
}
