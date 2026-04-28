import { describe, expect, test } from "bun:test";
import { sampleRss } from "./rss-sampler.ts";

function fakePidusage(seq: (number | "throw")[]): (pid: number) => Promise<{ memory: number }> {
  let i = 0;
  return async () => {
    const v = seq[i++ % seq.length];
    if (v === "throw") throw new Error("process gone");
    return { memory: v as number };
  };
}

describe("sampleRss", () => {
  test("collects samples for the requested duration; computes p95", async () => {
    const result = await sampleRss({
      pid: 1,
      durationMs: 100,
      intervalMs: 20,
      pidusage: fakePidusage([100, 200, 300, 400, 500]),
    });
    expect(result.samples.length).toBeGreaterThanOrEqual(4);
    expect(result.samples.length).toBeLessThanOrEqual(6);
    expect(result.p95).toBeGreaterThanOrEqual(400);
    expect(result.intervalsMissed).toBe(0);
  });

  test("intervalsMissed increments when pidusage throws", async () => {
    const result = await sampleRss({
      pid: 1,
      durationMs: 100,
      intervalMs: 20,
      pidusage: fakePidusage([100, "throw", 200, "throw", 300]),
    });
    expect(result.intervalsMissed).toBeGreaterThan(0);
    expect(result.samples.length).toBeGreaterThanOrEqual(2);
  });

  test("respects abort signal", async () => {
    const ac = new AbortController();
    const promise = sampleRss({
      pid: 1,
      durationMs: 10_000,
      intervalMs: 20,
      pidusage: fakePidusage([100]),
      signal: ac.signal,
    });
    setTimeout(() => ac.abort(), 60);
    const result = await promise;
    expect(result.samples.length).toBeGreaterThanOrEqual(1);
    expect(result.samples.length).toBeLessThan(20);
  });

  test("empty sample set returns p95 = 0 (no division by zero)", async () => {
    const result = await sampleRss({
      pid: 1,
      durationMs: 50,
      intervalMs: 20,
      pidusage: fakePidusage(["throw"]),
    });
    expect(result.samples).toEqual([]);
    expect(result.p95).toBe(0);
    expect(result.intervalsMissed).toBeGreaterThan(0);
  });
});
