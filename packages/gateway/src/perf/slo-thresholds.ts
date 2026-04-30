/**
 * Single source of truth for the SLO thresholds enforced by `_perf.yml`
 * and rendered into `docs/perf/slo.md` (via `scripts/regen-slo.ts`).
 *
 * UX rows (S1, S2-a/b/c, S3, S4, S5, S11-a/b) carry concrete values
 * from spec § 3.2. Workload rows (S6, S7, S8 cells, S9, S10) are
 * scaffolded with `ghaMax: "tbd-c2"` and `gated: false` until PR-C-2
 * fills them from the M1 Air reference run.
 *
 * The `slo.md` file in the repo is generated from this const — never
 * hand-edited. CI runs `bun scripts/regen-slo.ts --check` to fail the
 * build on drift.
 *
 * Spec source: docs/superpowers/specs/2026-04-26-perf-audit-design.md § 3.2.
 */

import { type BenchSurfaceId, S8_BATCHES, S8_LENGTHS } from "./types.ts";

export interface SloThreshold {
  surfaceId: BenchSurfaceId;
  metric:
    | "p95_ms"
    | "p50_ms"
    | "throughput_per_sec"
    | "rss_bytes_p95"
    | "tokens_per_sec"
    | "first_token_ms";
  /** Reference threshold (M1 Air); undefined if reference-only/skipped. */
  refMax?: number;
  /** Absolute GHA threshold; "tbd-c2" = workload row pending PR-C-2; "skipped" = reference-only on GHA. */
  ghaMax: number | "tbd-c2" | "skipped";
  /**
   * Whether this row gates the build. UX rows in C-1 are `true`. Workload
   * rows are `false` until C-2 fills `ghaMax` from the reference run.
   * Explicit boolean rather than inferring from the `ghaMax` sentinel
   * (D-K in the design spec).
   */
  gated: boolean;
  /** Delta-fail threshold (relative %, spec § 3.1). */
  noiseFloorPct: number;
  /** Delta-fail floor (absolute, units match `noiseFloorAbsUnit`). */
  noiseFloorAbs: number;
  noiseFloorAbsUnit: "ms" | "items_per_sec" | "bytes" | "tps";
  /** S7-a/b/c only — gate on Linux only (spec § 3.3). */
  linuxOnlyGate?: true;
}

const NON_S8_THRESHOLDS: readonly SloThreshold[] = [
  // ----- UX surfaces (gated) -----
  {
    surfaceId: "S1",
    metric: "p95_ms",
    refMax: 2_000,
    ghaMax: 10_000,
    gated: true,
    noiseFloorPct: 25,
    noiseFloorAbs: 200,
    noiseFloorAbsUnit: "ms",
  },
  {
    surfaceId: "S2-a",
    metric: "p95_ms",
    refMax: 30,
    ghaMax: 200,
    gated: true,
    noiseFloorPct: 25,
    noiseFloorAbs: 5,
    noiseFloorAbsUnit: "ms",
  },
  {
    surfaceId: "S2-b",
    metric: "p95_ms",
    refMax: 80,
    ghaMax: 500,
    gated: true,
    noiseFloorPct: 25,
    noiseFloorAbs: 10,
    noiseFloorAbsUnit: "ms",
  },
  {
    surfaceId: "S2-c",
    metric: "p95_ms",
    refMax: 300,
    ghaMax: "skipped",
    gated: true,
    noiseFloorPct: 25,
    noiseFloorAbs: 25,
    noiseFloorAbsUnit: "ms",
  },
  {
    surfaceId: "S3",
    metric: "p95_ms",
    refMax: 1_500,
    ghaMax: 7_500,
    gated: true,
    noiseFloorPct: 25,
    noiseFloorAbs: 100,
    noiseFloorAbsUnit: "ms",
  },
  {
    surfaceId: "S4",
    metric: "p95_ms",
    refMax: 500,
    ghaMax: 2_500,
    gated: true,
    noiseFloorPct: 25,
    noiseFloorAbs: 50,
    noiseFloorAbsUnit: "ms",
  },
  {
    surfaceId: "S5",
    metric: "p95_ms",
    refMax: 200,
    ghaMax: 1_000,
    gated: true,
    noiseFloorPct: 25,
    noiseFloorAbs: 25,
    noiseFloorAbsUnit: "ms",
  },
  {
    surfaceId: "S11-a",
    metric: "p95_ms",
    refMax: 300,
    ghaMax: 1_500,
    gated: true,
    noiseFloorPct: 25,
    noiseFloorAbs: 50,
    noiseFloorAbsUnit: "ms",
  },
  {
    surfaceId: "S11-b",
    metric: "p95_ms",
    refMax: 50,
    // Spec § 3.2 originally proposed `ghaMax: 250` (5× refMax). Empirical
    // GHA data on PR-C-1 / PR-C-2a shows Linux ~190-210 ms, macOS ~135-
    // 195 ms, and Windows 359-425 ms across recent runs — Bun process-spawn
    // overhead on `windows-2025` is intrinsically higher than on
    // `ubuntu-24.04`, and the runner exhibits ≈18 % p95-to-p95 variance
    // across same-sha runs (359 → 425 ms). The 5× rule of thumb breaks
    // down on fast UX surfaces where OS spawn cost dominates. Bumped to
    // 600 ms (12× refMax, ~40 % headroom over the observed Windows peak
    // of 425 ms) so the GHA threshold is achievable on all three runners
    // without false-failing on Windows infrastructure noise. Refines
    // spec § 3.2; the `refMax` budget is unchanged (PR-C-2 will
    // recalibrate from a real M1 Air measurement). The `gated: true`
    // delta check still catches a real regression.
    //
    // 2026-04-30: bumped `noiseFloorPct` from 25 % → 40 %. macOS-15 GHA
    // runners showed ~18 % p95-to-p95 variance across two same-sha runs
    // (135 → 144 → 170 ms on `22f6564`); the 25 % floor was tripping
    // delta-fail on noise alone. 40 % matches the empirical envelope
    // and still flags a real ≥40 % regression. `noiseFloorAbs: 10` is
    // unchanged — bumping it would loosen the M1 Air reference path
    // (where prev ≈ refMax = 50 ms) far more than intended.
    ghaMax: 600,
    gated: true,
    noiseFloorPct: 40,
    noiseFloorAbs: 10,
    noiseFloorAbsUnit: "ms",
  },

  // ----- Workload surfaces (record-only until C-2) -----
  // S6 is one logical SLO row covering Drive / Gmail / GitHub connectors
  // (spec § 3.2 lists S6 as a single surface; sub-connector drivers share this threshold).
  {
    surfaceId: "S6-drive",
    metric: "throughput_per_sec",
    ghaMax: "tbd-c2",
    gated: false,
    noiseFloorPct: 25,
    noiseFloorAbs: 5,
    noiseFloorAbsUnit: "items_per_sec",
  },
  {
    surfaceId: "S6-gmail",
    metric: "throughput_per_sec",
    ghaMax: "tbd-c2",
    gated: false,
    noiseFloorPct: 25,
    noiseFloorAbs: 5,
    noiseFloorAbsUnit: "items_per_sec",
  },
  {
    surfaceId: "S6-github",
    metric: "throughput_per_sec",
    ghaMax: "tbd-c2",
    gated: false,
    noiseFloorPct: 25,
    noiseFloorAbs: 5,
    noiseFloorAbsUnit: "items_per_sec",
  },
  {
    surfaceId: "S7-a",
    metric: "rss_bytes_p95",
    ghaMax: "tbd-c2",
    gated: false,
    noiseFloorPct: 20,
    noiseFloorAbs: 20 * 1024 * 1024,
    noiseFloorAbsUnit: "bytes",
    linuxOnlyGate: true,
  },
  {
    surfaceId: "S7-b",
    metric: "rss_bytes_p95",
    ghaMax: "tbd-c2",
    gated: false,
    noiseFloorPct: 20,
    noiseFloorAbs: 50 * 1024 * 1024,
    noiseFloorAbsUnit: "bytes",
    linuxOnlyGate: true,
  },
  {
    surfaceId: "S7-c",
    metric: "rss_bytes_p95",
    ghaMax: "skipped",
    gated: false,
    noiseFloorPct: 20,
    noiseFloorAbs: 50 * 1024 * 1024,
    noiseFloorAbsUnit: "bytes",
    linuxOnlyGate: true,
  },
  {
    surfaceId: "S9",
    metric: "tokens_per_sec",
    ghaMax: "skipped",
    gated: false,
    noiseFloorPct: 30,
    noiseFloorAbs: 2,
    noiseFloorAbsUnit: "tps",
  },
  {
    surfaceId: "S10",
    metric: "throughput_per_sec",
    ghaMax: "tbd-c2",
    gated: false,
    noiseFloorPct: 25,
    noiseFloorAbs: 100,
    noiseFloorAbsUnit: "items_per_sec",
  },
];

function buildS8Cells(): readonly SloThreshold[] {
  const out: SloThreshold[] = [];
  for (const length of S8_LENGTHS) {
    for (const batch of S8_BATCHES) {
      out.push({
        surfaceId: `S8-l${length}-b${batch}` as BenchSurfaceId,
        metric: "throughput_per_sec",
        ghaMax: "tbd-c2",
        gated: false,
        noiseFloorPct: 25,
        noiseFloorAbs: 5,
        noiseFloorAbsUnit: "items_per_sec",
      });
    }
  }
  return out;
}

export const SLO_THRESHOLDS: readonly SloThreshold[] = [...NON_S8_THRESHOLDS, ...buildS8Cells()];

export function thresholdsBySurface(): ReadonlyMap<BenchSurfaceId, SloThreshold> {
  return new Map(SLO_THRESHOLDS.map((row) => [row.surfaceId, row]));
}
