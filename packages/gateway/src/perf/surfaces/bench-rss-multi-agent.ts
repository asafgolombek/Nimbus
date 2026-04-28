/**
 * S7-c — Memory RSS during a 3-sub-agent decomposition.
 *
 * REFERENCE_ONLY: requires a loaded local LLM + GPU. On --gha the
 * bench-cli orchestrator skips this surface via the REFERENCE_ONLY
 * set and writes a per-surface stub_reason. The driver function
 * itself is a no-op (returns []) so the bidirectional driver↔row
 * mapping (parent spec §6 criterion 7) holds even on non-reference
 * runners.
 *
 * On reference runs (when implemented in PR-B-2b-3), this driver will
 * spawn the gateway, fire `agent.ask` with a 3-step plan, and sample
 * RSS over the workflow's lifetime.
 */

import type { BenchRunOptions } from "../types.ts";

export const S7C_REFERENCE_ONLY_REASON =
  "reference-only; requires loaded LLM + GPU (real driver in PR-B-2b-3)";

export async function runRssMultiAgentOnce(
  _opts: BenchRunOptions,
  _runOpts: Record<string, unknown> = {},
): Promise<number[]> {
  return [];
}
