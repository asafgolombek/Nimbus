/**
 * S3 — Dashboard first-paint (Tauri renderer).
 *
 * Stub driver. Real measurement needs renderer-side perf marks the bench
 * harness can read across the Tauri IPC boundary; that instrumentation
 * lands in a separate follow-up PR scoped to packages/ui/.
 *
 * The driver returns [] so the harness records `samples_count: 0`; the
 * orchestrator (bench-cli.ts) reads STUB_SURFACES[id] and writes the
 * per-surface stub_reason field.
 */

import type { BenchRunOptions } from "../types.ts";

export const S3_STUB_REASON = "renderer instrumentation pending (Tauri perf marks)";

export async function runDashboardFirstPaintOnce(
  _opts: BenchRunOptions,
  _runOpts: Record<string, unknown> = {},
): Promise<number[]> {
  return [];
}
