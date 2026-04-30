import { describe, expect, test } from "bun:test";
import { computePercentile } from "./get-git-churn.ts";

describe("computePercentile", () => {
  test("80th percentile of [1..10]", () => {
    expect(computePercentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 80)).toBe(8);
  });
  test("80th percentile of single value", () => {
    expect(computePercentile([5], 80)).toBe(5);
  });
  test("empty array returns 0", () => {
    expect(computePercentile([], 80)).toBe(0);
  });
});
