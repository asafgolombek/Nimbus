import { describe, expect, test } from "bun:test";

import { parseDurationToMs } from "./parse-duration.ts";

describe("parseDurationToMs", () => {
  test("parses common units", () => {
    expect(parseDurationToMs("500ms")).toBe(500);
    expect(parseDurationToMs("30s")).toBe(30_000);
    expect(parseDurationToMs("5m")).toBe(300_000);
    expect(parseDurationToMs("2h")).toBe(2 * 60 * 60 * 1000);
  });

  test("rejects invalid input", () => {
    expect(() => parseDurationToMs("")).toThrow(/Invalid duration/);
    expect(() => parseDurationToMs("5x")).toThrow(/Invalid duration/);
  });
});
