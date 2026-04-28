/**
 * docs/perf/history.jsonl line schema + append-only writer.
 * See docs/superpowers/specs/2026-04-26-perf-audit-design.md §4.4 for the
 * canonical schema and storage policy.
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type { BenchSurfaceId, RunnerKind } from "./types.ts";

export interface HistoryLineSurface {
  samples_count: number;
  p50_ms?: number;
  p95_ms?: number;
  p99_ms?: number;
  max_ms?: number;
  throughput_per_sec?: number;
  tokens_per_sec?: number;
  first_token_ms?: number;
  rss_bytes_p95?: number;
  raw_samples?: number[];
  /**
   * S10 only — sum of SQLITE_BUSY retries across the contention Workers.
   * Optional; downstream consumers ignore unknown fields. Spec §6.6.
   */
  busy_retries?: number;
  /**
   * If set, this surface was not actually measured. Examples: stub drivers
   * (S3, S5 — renderer instrumentation pending); reference-only surfaces
   * (S2-c, S7-c, S9) skipped on a non-reference run.
   */
  stub_reason?: string;
}

export interface HistoryLine {
  schema_version: 1;
  run_id: string;
  timestamp: string;
  runner: RunnerKind;
  os_version: string;
  nimbus_git_sha: string;
  bun_version: string;
  surfaces: Partial<Record<BenchSurfaceId, HistoryLineSurface>>;
  reference_protocol_compliant?: boolean;
  incomplete?: true;
  incomplete_reason?: string;
}

/** Append a single HistoryLine as one JSON line + trailing newline. Creates parent dirs. */
export function appendHistoryLine(path: string, line: HistoryLine): void {
  const parent = dirname(path);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }
  appendFileSync(path, `${JSON.stringify(line)}\n`, "utf8");
}
