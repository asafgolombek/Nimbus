import { describe, expect, test } from "bun:test";
import { runHitlPopupOnce, S5_STUB_REASON } from "./bench-hitl-popup.ts";

describe("runHitlPopupOnce (S5 stub)", () => {
  test("returns an empty samples array", async () => {
    const samples = await runHitlPopupOnce({ runs: 1, runner: "local-dev" });
    expect(samples).toEqual([]);
  });

  test("exports a non-empty stub reason", () => {
    expect(typeof S5_STUB_REASON).toBe("string");
    expect(S5_STUB_REASON.length).toBeGreaterThan(0);
  });
});
