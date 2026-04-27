/**
 * S5 — HITL popup latency (Tauri renderer).
 *
 * Stub driver. Same rationale as S3 — real measurement needs renderer-side
 * perf marks the bench harness can read across the Tauri IPC boundary.
 */

import type { BenchRunOptions } from "../types.ts";

export const S5_STUB_REASON = "renderer instrumentation pending (Tauri perf marks)";

export async function runHitlPopupOnce(
  _opts: BenchRunOptions,
  _runOpts: Record<string, unknown> = {},
): Promise<number[]> {
  return [];
}
