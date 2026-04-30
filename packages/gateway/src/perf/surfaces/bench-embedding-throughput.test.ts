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
      batch: 8,
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
      batch: 8,
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

  // CI matrix budget: when --corpus small is passed, S8 cells must downscale
  // their workload so all 12 cells fit in the 45-min job timeout. The
  // canonical 1000×batch workload is reserved for reference / --corpus large.
  // Empirically the l5000-b{32,64} cells dominate at multiplier ≥ 50 because
  // ONNX MiniLM per-batch time grows with both length and batch (l5000-b32
  // measured at ~2.7 s/batch on ubuntu-24.04 GHA), so the multiplier must
  // be small enough that 5 runs × multiplier × per-batch-time stays bounded.
  test("scales totalItems to 10 × batch when corpus is 'small'", async () => {
    const { embedder, calls } = makeFakeEmbedder(0);
    await runEmbeddingThroughputOnce({
      length: 50,
      batch: 8,
      corpus: "small",
      embedder,
    });
    // 10 × 8 = 80 items / batch 8 = 10 batched calls + 1 warm-up = 11
    expect(calls.length).toBe(11);
  });

  test("scales totalItems to 100 × batch when corpus is 'medium'", async () => {
    const { embedder, calls } = makeFakeEmbedder(0);
    await runEmbeddingThroughputOnce({
      length: 50,
      batch: 1,
      corpus: "medium",
      embedder,
    });
    // 100 × 1 = 100 items / batch 1 = 100 batched calls + 1 warm-up = 101
    expect(calls.length).toBe(101);
  });

  // 1001 fake-embed calls (each yielding to the event loop) exceed the
  // 5 s default test timeout on slower CI runners; this test exercises a
  // path with no real I/O so a longer cap is harmless.
  test("preserves the canonical 1000 × batch default when corpus is unset", async () => {
    const { embedder, calls } = makeFakeEmbedder(0);
    await runEmbeddingThroughputOnce({
      length: 50,
      batch: 1,
      embedder,
    });
    // 1000 × 1 = 1000 items / batch 1 = 1000 batched calls + 1 warm-up
    expect(calls.length).toBe(1001);
  }, 30_000);

  test("explicit totalItems overrides the corpus-derived default", async () => {
    const { embedder, calls } = makeFakeEmbedder(0);
    await runEmbeddingThroughputOnce({
      length: 50,
      batch: 8,
      corpus: "small",
      totalItems: 16,
      embedder,
    });
    // totalItems wins over corpus: 16 / 8 = 2 batched calls + 1 warm-up = 3
    expect(calls.length).toBe(3);
  });
});
