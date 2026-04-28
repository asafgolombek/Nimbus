import { describe, expect, test } from "bun:test";

import { runEmbeddingThroughputOnce } from "./bench-embedding-throughput.ts";

interface CallLog {
  texts: string[];
  beforeTimer: boolean;
}

function makeFakeEmbedder(perCallMs: number): {
  embedder: { model: string; dims: number; embed: (t: string[]) => Promise<Float32Array[]> };
  calls: CallLog[];
  startTime: number;
} {
  const calls: CallLog[] = [];
  const startTime = performance.now();
  let timerStarted = false;
  const embedder = {
    model: "fake-mini",
    dims: 384,
    async embed(texts: string[]): Promise<Float32Array[]> {
      calls.push({ texts: [...texts], beforeTimer: !timerStarted });
      // The driver flips this flag right before the timer starts.
      // We use the call-count == 1 → mark timer-started signal.
      if (calls.length === 1) {
        timerStarted = true;
      }
      await new Promise((r) => setTimeout(r, perCallMs));
      return texts.map(() => new Float32Array(384));
    },
  };
  return { embedder, calls, startTime };
}

describe("runEmbeddingThroughputOnce", () => {
  test("performs a warm-up embed before timing begins", async () => {
    const { embedder, calls } = makeFakeEmbedder(1);
    const samples = await runEmbeddingThroughputOnce({
      length: 50,
      batch: 4,
      embedder,
      totalItems: 16,
    });
    expect(samples.length).toBe(1);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]?.beforeTimer).toBe(true);
    expect(calls[0]?.texts.length).toBe(1); // warm-up sends 1 text
  });

  test("returns items/sec across the timed window", async () => {
    const { embedder } = makeFakeEmbedder(2);
    const samples = await runEmbeddingThroughputOnce({
      length: 50,
      batch: 4,
      embedder,
      totalItems: 16,
    });
    expect(samples[0]).toBeGreaterThan(0);
    // 16 items over ~8 ms ≈ 2000/s; sanity-check ceiling
    expect(samples[0]).toBeLessThan(20_000);
  });

  test("calls embed in batches of `batch`", async () => {
    const { embedder, calls } = makeFakeEmbedder(0);
    await runEmbeddingThroughputOnce({
      length: 50,
      batch: 8,
      embedder,
      totalItems: 32,
    });
    // Warm-up = 1 call, then 32 / 8 = 4 batched calls = 5 total
    expect(calls.length).toBe(5);
    expect(calls[0]?.texts.length).toBe(1);
    for (let i = 1; i < calls.length; i += 1) {
      expect(calls[i]?.texts.length).toBe(8);
    }
  });
});
