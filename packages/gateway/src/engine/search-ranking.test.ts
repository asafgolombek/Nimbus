import { describe, expect, test } from "bun:test";

import {
  compositeSearchScore,
  normalizeBm25LowerIsBetter,
  recencyScore,
  servicePriorityScore,
} from "./search-ranking.ts";

describe("search-ranking", () => {
  test("recencyScore decays with age", () => {
    const now = 1_000_000_000_000;
    expect(recencyScore(now, now)).toBe(1);
    expect(recencyScore(now - 86_400_000, now)).toBeCloseTo(0.5, 5);
  });

  test("servicePriorityScore uses map or defaults to 0.5", () => {
    const m = new Map([["github", 0.8]]);
    expect(servicePriorityScore("github", m)).toBe(0.8);
    expect(servicePriorityScore("slack", m)).toBe(0.5);
  });

  test("normalizeBm25LowerIsBetter maps lowest input to highest score", () => {
    expect(normalizeBm25LowerIsBetter([2, 4, 6])).toEqual([1, 0.5, 0]);
  });

  test("compositeSearchScore is weighted sum", () => {
    expect(compositeSearchScore(1, 1, 1)).toBe(1);
    expect(compositeSearchScore(0, 0, 0)).toBe(0);
  });
});
