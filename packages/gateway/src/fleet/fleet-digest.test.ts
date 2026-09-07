import { describe, expect, test } from "bun:test";
import { compareSummaries } from "./fleet-digest.ts";

const s = (keys: string[], metrics: Record<string, number>) => ({ keys, metrics });

describe("compareSummaries", () => {
  test("identical summaries are unchanged", () => {
    const r = compareSummaries(s(["a"], { n: 1 }), s(["a"], { n: 1 }), 1);
    expect(r.status).toBe("unchanged");
    expect(r.keysAppeared).toEqual([]);
    expect(r.metrics).toEqual({});
  });

  test("keys appearing and resolving are both reported, sorted", () => {
    const r = compareSummaries(s(["a", "b"], {}), s(["b", "c"], {}), 1);
    expect(r.keysAppeared).toEqual(["c"]);
    expect(r.keysResolved).toEqual(["a"]);
    expect(r.status).toBe("changed");
  });

  test("a metric moving below minDelta is suppressed and the status says so", () => {
    const r = compareSummaries(s([], { n: 10 }), s([], { n: 12 }), 5);
    expect(r.metrics).toEqual({});
    expect(r.status).toBe("unchanged_within_threshold");
  });

  test("a metric at exactly minDelta reports", () => {
    const r = compareSummaries(s([], { n: 10 }), s([], { n: 15 }), 5);
    expect(r.metrics["n"]).toEqual({ before: 10, after: 15, delta: 5 });
    expect(r.status).toBe("changed");
  });

  test("a key change is NEVER suppressed by the threshold", () => {
    const r = compareSummaries(s(["a"], { n: 10 }), s(["a", "b"], { n: 11 }), 99);
    expect(r.keysAppeared).toEqual(["b"]);
    expect(r.status).toBe("changed");
  });

  test("a metric present on one side only is not synthesized into 0 -> N", () => {
    const added = compareSummaries(s([], {}), s([], { n: 7 }), 1);
    expect(added.metrics["n"]).toEqual({ before: null, after: 7, delta: null });
    const dropped = compareSummaries(s([], { n: 7 }), s([], {}), 1);
    expect(dropped.metrics["n"]).toEqual({ before: 7, after: null, delta: null });
  });

  test("a one-sided metric is reported regardless of minDelta", () => {
    const r = compareSummaries(s([], {}), s([], { n: 1 }), 1000);
    expect(r.metrics["n"]).toBeDefined();
    expect(r.status).toBe("changed");
  });

  test("a metric moving by exactly zero is not reported and does not mark suppression", () => {
    const r = compareSummaries(s([], { n: 10 }), s([], { n: 10 }), 1);
    expect(r.metrics).toEqual({});
    expect(r.status).toBe("unchanged");
  });

  test("a negative delta below the threshold in magnitude is suppressed the same as positive", () => {
    const r = compareSummaries(s([], { n: 12 }), s([], { n: 10 }), 5);
    expect(r.metrics).toEqual({});
    expect(r.status).toBe("unchanged_within_threshold");
  });

  test("a negative delta at or beyond the threshold reports the true signed value", () => {
    const r = compareSummaries(s([], { n: 15 }), s([], { n: 10 }), 5);
    expect(r.metrics["n"]).toEqual({ before: 15, after: 10, delta: -5 });
    expect(r.status).toBe("changed");
  });

  test("returned metrics record is frozen", () => {
    const r = compareSummaries(s([], { n: 10 }), s([], { n: 20 }), 1);
    expect(Object.isFrozen(r.metrics)).toBe(true);
  });

  test("keysAppeared and keysResolved are independently populated when both sides shrink/grow", () => {
    const r = compareSummaries(s(["a", "b", "c"], {}), s(["b"], {}), 1);
    expect(r.keysAppeared).toEqual([]);
    expect(r.keysResolved).toEqual(["a", "c"]);
    expect(r.status).toBe("changed");
  });

  test("one metric below threshold and another above both surface only the qualifying one, still changed", () => {
    const r = compareSummaries(s([], { small: 10, big: 10 }), s([], { small: 12, big: 20 }), 5);
    expect(r.metrics).toEqual({ big: { before: 10, after: 20, delta: 10 } });
    expect(r.status).toBe("changed");
  });
});
