import { describe, expect, test } from "bun:test";
import { MIN_SYNC_INTERVAL_MS } from "./constants.ts";

describe("sync constants", () => {
  test("MIN_SYNC_INTERVAL_MS is 60 seconds", () => {
    expect(MIN_SYNC_INTERVAL_MS).toBe(60_000);
  });
});
