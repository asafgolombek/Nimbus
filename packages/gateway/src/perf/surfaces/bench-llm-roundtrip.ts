/**
 * S9 — LLM round-trip (stub).
 *
 * Mirrors the S3 / S5 / S7-c stub pattern: returns [] so the
 * bidirectional driver↔row mapping (parent spec §6 criterion 7)
 * holds. The bench-cli orchestrator places `S9` in both
 * `STUB_SURFACES` (always returns the stub_reason) and
 * `REFERENCE_ONLY` (semantic intent — the real driver in PR-B-2b-3
 * will require a loaded local LLM + GPU).
 */

import type { BenchRunOptions } from "../types.ts";

export const S9_STUB_REASON =
  "stub: Ollama-driven LLM round-trip lands in PR-B-2b-3 (reference-only when implemented)";

export async function runLlmRoundtripOnce(
  _opts: BenchRunOptions,
  _runOpts: Record<string, unknown> = {},
): Promise<number[]> {
  return [];
}
