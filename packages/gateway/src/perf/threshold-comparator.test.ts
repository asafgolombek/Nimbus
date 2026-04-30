import { describe, expect, test } from "bun:test";

import type { HistoryLine } from "./history-line.ts";
import { SLO_THRESHOLDS } from "./slo-thresholds.ts";
import { compareAgainstHistory, isFailingComparison } from "./threshold-comparator.ts";

function fakeLine(runner: HistoryLine["runner"], surfaces: HistoryLine["surfaces"]): HistoryLine {
  return {
    schema_version: 1,
    run_id: "test-run",
    timestamp: "2026-04-29T00:00:00Z",
    runner,
    os_version: "test",
    nimbus_git_sha: "abc",
    bun_version: "1.0.0",
    surfaces,
  };
}

describe("compareAgainstHistory", () => {
  test("returns one entry per gated SLO row even when missing from current", () => {
    const current = fakeLine("gha-ubuntu", {});
    const out = compareAgainstHistory(current, null, SLO_THRESHOLDS, "gha-ubuntu");
    // 29 rows total — every row should produce one comparison entry.
    expect(out.length).toBe(SLO_THRESHOLDS.length);
  });

  test("first run on main: previous=null → every gated row → no-baseline", () => {
    const current = fakeLine("gha-ubuntu", { S1: { samples_count: 100, p95_ms: 800 } });
    const out = compareAgainstHistory(current, null, SLO_THRESHOLDS, "gha-ubuntu");
    const s1 = out.find((c) => c.surfaceId === "S1");
    expect(s1?.status).toEqual({ kind: "no-baseline", current: 800 });
  });

  test("absolute-fail when current exceeds ghaMax (UX row)", () => {
    const current = fakeLine("gha-ubuntu", { S1: { samples_count: 100, p95_ms: 12_000 } });
    const previous = fakeLine("gha-ubuntu", { S1: { samples_count: 100, p95_ms: 800 } });
    const out = compareAgainstHistory(current, previous, SLO_THRESHOLDS, "gha-ubuntu");
    const s1 = out.find((c) => c.surfaceId === "S1");
    expect(s1?.status).toEqual({ kind: "absolute-fail", measured: 12_000, threshold: 10_000 });
  });

  test("delta-fail when delta > floorPct AND > floorAbs/previous*100", () => {
    // S2-a: ghaMax 200ms, floorPct 25, floorAbs 5ms.
    // Previous: 50ms → +30% = 65ms is delta-fail (within absolute, fails delta).
    const current = fakeLine("gha-ubuntu", { "S2-a": { samples_count: 500, p95_ms: 65 } });
    const previous = fakeLine("gha-ubuntu", { "S2-a": { samples_count: 500, p95_ms: 50 } });
    const out = compareAgainstHistory(current, previous, SLO_THRESHOLDS, "gha-ubuntu");
    const s2a = out.find((c) => c.surfaceId === "S2-a");
    expect(s2a?.status).toMatchObject({ kind: "delta-fail", previous: 50, current: 65 });
  });

  test("delta-fail floor protects small previous values", () => {
    // S2-a: floorAbs 5ms. Previous 4ms → +50% = 6ms is +2ms abs, BELOW the 5ms floor → pass.
    const current = fakeLine("gha-ubuntu", { "S2-a": { samples_count: 500, p95_ms: 6 } });
    const previous = fakeLine("gha-ubuntu", { "S2-a": { samples_count: 500, p95_ms: 4 } });
    const out = compareAgainstHistory(current, previous, SLO_THRESHOLDS, "gha-ubuntu");
    const s2a = out.find((c) => c.surfaceId === "S2-a");
    expect(s2a?.status).toEqual({ kind: "pass" });
  });

  test("workload row with ghaMax === 'tbd-c2' resolves to skipped(tbd-c2)", () => {
    const current = fakeLine("gha-ubuntu", {
      "S6-drive": { samples_count: 5, throughput_per_sec: 999_999 },
    });
    const out = compareAgainstHistory(current, null, SLO_THRESHOLDS, "gha-ubuntu");
    const s6 = out.find((c) => c.surfaceId === "S6-drive");
    expect(s6?.status).toEqual({ kind: "skipped", reason: "tbd-c2" });
  });

  test("S2-c on gha-ubuntu resolves to skipped(reference-only)", () => {
    const current = fakeLine("gha-ubuntu", {});
    const out = compareAgainstHistory(current, null, SLO_THRESHOLDS, "gha-ubuntu");
    const s2c = out.find((c) => c.surfaceId === "S2-c");
    expect(s2c?.status).toEqual({ kind: "skipped", reason: "reference-only" });
  });

  test("S7-a on gha-macos resolves to skipped(linux-only-gate)", () => {
    const current = fakeLine("gha-macos", {
      "S7-a": { samples_count: 60, rss_bytes_p95: 100_000_000 },
    });
    const out = compareAgainstHistory(current, null, SLO_THRESHOLDS, "gha-macos");
    const s7a = out.find((c) => c.surfaceId === "S7-a");
    expect(s7a?.status).toEqual({ kind: "skipped", reason: "linux-only-gate" });
  });

  test("stub surface (samples_count=0) resolves to skipped(stub)", () => {
    const current = fakeLine("gha-ubuntu", {
      S3: { samples_count: 0, stub_reason: "renderer instrumentation pending" },
    });
    const out = compareAgainstHistory(current, null, SLO_THRESHOLDS, "gha-ubuntu");
    const s3 = out.find((c) => c.surfaceId === "S3");
    expect(s3?.status).toEqual({ kind: "skipped", reason: "stub" });
  });
});

describe("isFailingComparison", () => {
  test("returns false for any kind when slo.gated === false", () => {
    const slo = SLO_THRESHOLDS.find((r) => r.surfaceId === "S6-drive")!;
    expect(slo.gated).toBe(false);
    expect(
      isFailingComparison(
        {
          surfaceId: "S6-drive",
          metric: "throughput_per_sec",
          status: { kind: "absolute-fail", measured: 999, threshold: 100 },
        },
        slo,
      ),
    ).toBe(false);
  });

  test("returns true only for absolute-fail / delta-fail when gated", () => {
    const slo = SLO_THRESHOLDS.find((r) => r.surfaceId === "S1")!;
    expect(
      isFailingComparison(
        {
          surfaceId: "S1",
          metric: "p95_ms",
          status: { kind: "absolute-fail", measured: 12_000, threshold: 10_000 },
        },
        slo,
      ),
    ).toBe(true);
    expect(
      isFailingComparison(
        {
          surfaceId: "S1",
          metric: "p95_ms",
          status: { kind: "delta-fail", previous: 100, current: 200, deltaPct: 100, floorPct: 25 },
        },
        slo,
      ),
    ).toBe(true);
    expect(
      isFailingComparison({ surfaceId: "S1", metric: "p95_ms", status: { kind: "pass" } }, slo),
    ).toBe(false);
    expect(
      isFailingComparison(
        { surfaceId: "S1", metric: "p95_ms", status: { kind: "no-baseline", current: 100 } },
        slo,
      ),
    ).toBe(false);
    expect(
      isFailingComparison(
        { surfaceId: "S1", metric: "p95_ms", status: { kind: "skipped", reason: "stub" } },
        slo,
      ),
    ).toBe(false);
  });
});
