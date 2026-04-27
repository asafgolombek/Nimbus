/**
 * S4 — TUI first-paint (`nimbus tui` → first frame).
 *
 * Spawns `bun packages/cli/src/index.ts tui` per sample with NIMBUS_BENCH=1
 * set, and times to the `[tui] first-frame` stderr marker emitted from a
 * useEffect inside App.tsx — that effect fires after React's first commit,
 * which is *after* Ink has flushed the first frame to the TTY. Sends
 * SIGTERM after the marker.
 *
 * Note: a running gateway is a precondition — the TUI command exits early
 * if the gateway state is unreadable. The bench operator is responsible
 * for running `nimbus start` before invoking this surface; if the gateway
 * isn't running, the spawn-and-time helper's pre-marker exit guard will
 * throw and the bench-cli will record a per-surface stub_reason.
 */

import { resolve } from "node:path";

import { spawnAndTimeToMarker } from "../process-spawn-bench.ts";
import type { BenchRunOptions } from "../types.ts";

export const TUI_FIRST_PAINT_SAMPLES_PER_RUN = 5;
const FIRST_FRAME_MARKER = /\[tui\] first-frame/;
const TUI_TIMEOUT_MS = 15_000;

export interface RunOptions {
  spawn?: typeof Bun.spawn;
  cliEntry?: string;
}

function defaultCliEntry(): string {
  // packages/gateway/src/perf/surfaces/bench-tui-first-paint.ts
  //   → packages/cli/src/index.ts
  return resolve(import.meta.dir, "..", "..", "..", "..", "cli", "src", "index.ts");
}

export async function runTuiFirstPaintOnce(
  _opts: BenchRunOptions,
  runOpts: RunOptions = {},
): Promise<number[]> {
  const samples: number[] = [];
  const entry = runOpts.cliEntry ?? defaultCliEntry();
  for (let i = 0; i < TUI_FIRST_PAINT_SAMPLES_PER_RUN; i += 1) {
    const ms = await spawnAndTimeToMarker({
      cmd: process.execPath,
      args: [entry, "tui"],
      mode: "marker",
      marker: FIRST_FRAME_MARKER,
      timeoutMs: TUI_TIMEOUT_MS,
      env: { NIMBUS_BENCH: "1" },
      ...(runOpts.spawn !== undefined && { spawn: runOpts.spawn }),
    });
    samples.push(ms);
  }
  return samples;
}
