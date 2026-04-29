/**
 * Pure comparator — given a current `HistoryLine`, an optional previous
 * `HistoryLine` for the same runner, and the SLO_THRESHOLDS table,
 * returns one `SurfaceComparison` per SLO row. No I/O.
 *
 * Spec § 3.1 fail conditions:
 *   (a) measured > absolute threshold (`refMax` for reference, `ghaMax`
 *       for GHA — selected by `runner`)
 *   (b) delta_pct > max(noiseFloorPct, noiseFloorAbs / previous * 100)
 *
 * Workload rows have `gated: false`; `isFailingComparison()` short-
 * circuits to `false` for them regardless of status. C-1 callers
 * exit non-zero only on `kind: "absolute-fail"` or `kind: "delta-fail"`
 * for gated rows.
 */

import type { HistoryLine, HistoryLineSurface } from "./history-line.ts";
import type { SloThreshold } from "./slo-thresholds.ts";
import type { BenchSurfaceId, RunnerKind } from "./types.ts";

export type ComparisonStatus =
  | { kind: "pass" }
  | { kind: "absolute-fail"; measured: number; threshold: number }
  | { kind: "delta-fail"; previous: number; current: number; deltaPct: number; floorPct: number }
  | { kind: "skipped"; reason: "tbd-c2" | "linux-only-gate" | "reference-only" | "stub" }
  | { kind: "no-baseline"; current: number };

export interface SurfaceComparison {
  surfaceId: BenchSurfaceId;
  metric: SloThreshold["metric"];
  status: ComparisonStatus;
}

function readMetric(
  s: HistoryLineSurface | undefined,
  metric: SloThreshold["metric"],
): number | undefined {
  if (s === undefined) return undefined;
  // Map SloThreshold.metric to the corresponding HistoryLineSurface field.
  switch (metric) {
    case "p95_ms":
      return s.p95_ms;
    case "p50_ms":
      return s.p50_ms;
    case "throughput_per_sec":
      return s.throughput_per_sec;
    case "rss_bytes_p95":
      return s.rss_bytes_p95;
    case "tokens_per_sec":
      return s.tokens_per_sec;
    case "first_token_ms":
      return s.first_token_ms;
  }
}

function isStub(s: HistoryLineSurface | undefined): boolean {
  return s !== undefined && s.samples_count === 0;
}

function classifySkip(slo: SloThreshold, runner: RunnerKind): ComparisonStatus | null {
  // S2-c, S7-c, S9 — `ghaMax === "skipped"` means reference-only.
  if (slo.ghaMax === "skipped" && runner !== "reference-m1air") {
    return { kind: "skipped", reason: "reference-only" };
  }
  // S7-a/b/c — only Linux gates; macOS/Windows record but skip.
  if (slo.linuxOnlyGate === true && runner !== "gha-ubuntu" && runner !== "reference-m1air") {
    return { kind: "skipped", reason: "linux-only-gate" };
  }
  // Workload rows — `ghaMax === "tbd-c2"` until C-2.
  if (slo.ghaMax === "tbd-c2") {
    return { kind: "skipped", reason: "tbd-c2" };
  }
  return null;
}

function compareOne(
  slo: SloThreshold,
  current: HistoryLineSurface | undefined,
  previous: HistoryLineSurface | undefined | null,
  runner: RunnerKind,
): ComparisonStatus {
  const skipReason = classifySkip(slo, runner);
  if (skipReason !== null) return skipReason;
  if (isStub(current)) return { kind: "skipped", reason: "stub" };

  const measured = readMetric(current, slo.metric);
  if (measured === undefined) {
    // Surface present in slo but not in current — treat as pass when no
    // baseline to compare to, otherwise fall through to delta logic.
    return previous == null ? { kind: "no-baseline", current: 0 } : { kind: "pass" };
  }

  // Absolute check — only meaningful when ghaMax is numeric.
  const threshold =
    runner === "reference-m1air"
      ? slo.refMax
      : typeof slo.ghaMax === "number"
        ? slo.ghaMax
        : undefined;
  if (threshold !== undefined && measured > threshold) {
    return { kind: "absolute-fail", measured, threshold };
  }

  // Delta check requires previous.
  if (previous == null) return { kind: "no-baseline", current: measured };
  const prev = readMetric(previous, slo.metric);
  if (prev === undefined || prev <= 0) return { kind: "no-baseline", current: measured };

  const deltaPct = ((measured - prev) / prev) * 100;
  const floorAbsAsPct = (slo.noiseFloorAbs / prev) * 100;
  const effectiveFloorPct = Math.max(slo.noiseFloorPct, floorAbsAsPct);
  if (deltaPct > effectiveFloorPct) {
    return {
      kind: "delta-fail",
      previous: prev,
      current: measured,
      deltaPct,
      floorPct: effectiveFloorPct,
    };
  }
  return { kind: "pass" };
}

export function compareAgainstHistory(
  current: HistoryLine,
  previous: HistoryLine | null,
  slo: readonly SloThreshold[],
  runner: RunnerKind,
): SurfaceComparison[] {
  const out: SurfaceComparison[] = [];
  for (const row of slo) {
    const cur = current.surfaces[row.surfaceId];
    const prev = previous?.surfaces[row.surfaceId];
    out.push({
      surfaceId: row.surfaceId,
      metric: row.metric,
      status: compareOne(row, cur, prev, runner),
    });
  }
  return out;
}

export function isFailingComparison(c: SurfaceComparison, slo: SloThreshold): boolean {
  if (!slo.gated) return false;
  return c.status.kind === "absolute-fail" || c.status.kind === "delta-fail";
}
