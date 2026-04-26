import { describe, expect, test } from "bun:test";
import { runBench } from "./bench-harness.ts";

describe("runBench", () => {
  test("invokes the surface fn `runs` times and returns median-of-medians", async () => {
    let calls = 0;
    // Each invocation returns 100 deterministic samples.
    const fn = async (): Promise<number[]> => {
      calls += 1;
      return Array.from({ length: 100 }, (_, i) => i + calls);
    };
    const result = await runBench("S2-a", fn, {
      runs: 5,
      runner: "local-dev",
      corpus: "small",
    });
    expect(calls).toBe(5);
    expect(result.surfaceId).toBe("S2-a");
    expect(result.samplesCount).toBe(500);
    // Across-runs aggregate is median of [p95(samples + 1), …, p95(samples + 5)]
    // which is p95(samples + 3) ≈ 98.
    expect(result.p95Ms).toBeGreaterThan(95);
    expect(result.p95Ms).toBeLessThan(105);
  });

  test("propagates surface errors with surface id context", async () => {
    const fn = async (): Promise<number[]> => {
      throw new Error("synthetic failure");
    };
    await expect(runBench("S1", fn, { runs: 1, runner: "local-dev" })).rejects.toThrow(
      /S1.*synthetic failure/,
    );
  });

  test("emits per-run failure context to stderr before throwing", async () => {
    const fn = async (): Promise<number[]> => {
      throw new Error("inner failure detail");
    };
    const stderrLines: string[] = [];
    await expect(
      runBench(
        "S2-a",
        fn,
        { runs: 3, runner: "local-dev" },
        {
          stderr: (s) => stderrLines.push(s),
        },
      ),
    ).rejects.toThrow();
    expect(stderrLines.length).toBeGreaterThanOrEqual(1);
    expect(stderrLines[0]).toMatch(/\[bench:S2-a\] run 1\/3 failed: inner failure detail/);
  });

  test("rejects runs < 1 with a clear error", async () => {
    const fn = async (): Promise<number[]> => [1];
    await expect(runBench("S1", fn, { runs: 0, runner: "local-dev" })).rejects.toThrow(
      /runs must be >= 1/,
    );
  });
});
