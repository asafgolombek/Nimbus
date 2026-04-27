import { describe, expect, test } from "bun:test";
import { runDashboardFirstPaintOnce, S3_STUB_REASON } from "./bench-dashboard-first-paint.ts";

describe("runDashboardFirstPaintOnce (S3 stub)", () => {
  test("returns an empty samples array", async () => {
    const samples = await runDashboardFirstPaintOnce({ runs: 1, runner: "local-dev" });
    expect(samples).toEqual([]);
  });

  test("exports a non-empty stub reason", () => {
    expect(typeof S3_STUB_REASON).toBe("string");
    expect(S3_STUB_REASON.length).toBeGreaterThan(0);
  });
});
