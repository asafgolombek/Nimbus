import { describe, expect, test } from "bun:test";

import { AnomalyDetectorStub } from "./anomaly-detector.ts";

describe("AnomalyDetectorStub", () => {
  test("low sample count yields zero score", () => {
    const d = new AnomalyDetectorStub({ windowSize: 8 });
    expect(d.deviationScore("x", 10)).toBe(0);
    d.recordSample("x", 1, 1);
    d.recordSample("x", 2, 2);
    expect(d.deviationScore("x", 100)).toBe(0);
  });

  test("extreme value increases deviation score", () => {
    const d = new AnomalyDetectorStub({ windowSize: 20 });
    for (let i = 0; i < 10; i += 1) {
      d.recordSample("latency", 100 + i, i);
    }
    const s = d.deviationScore("latency", 500);
    expect(s).toBeGreaterThan(2);
  });

  test("notify fires once score threshold reached", () => {
    let seen = 0;
    const d = new AnomalyDetectorStub({
      windowSize: 10,
      onNotify: () => {
        seen += 1;
      },
    });
    for (let i = 0; i < 8; i += 1) {
      d.recordSample("k", 10, i);
    }
    d.recordSample("k", 10_000, 9);
    expect(seen).toBe(1);
  });
});
