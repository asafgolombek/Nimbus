import { describe, expect, test } from "bun:test";

import { retryAfterDateFromHeader } from "../../../src/sync/types.ts";

describe("retryAfterDateFromHeader", () => {
  test("uses fallback seconds when header is null", () => {
    const t0 = Date.now();
    const d = retryAfterDateFromHeader(null, 42);
    expect(d.getTime()).toBeGreaterThanOrEqual(t0 + 42_000 - 50);
    expect(d.getTime()).toBeLessThanOrEqual(t0 + 42_000 + 50);
  });

  test("parses delay-seconds", () => {
    const t0 = Date.now();
    const d = retryAfterDateFromHeader("  120  ", 1);
    expect(d.getTime()).toBeGreaterThanOrEqual(t0 + 120_000 - 50);
    expect(d.getTime()).toBeLessThanOrEqual(t0 + 120_000 + 50);
  });

  test("parses HTTP-date", () => {
    const d = retryAfterDateFromHeader("Wed, 21 Oct 2015 07:28:00 GMT", 1);
    expect(d.getTime()).toBe(Date.parse("Wed, 21 Oct 2015 07:28:00 GMT"));
  });

  test("invalid numeric-looking string falls back (not pure digits)", () => {
    const t0 = Date.now();
    const d = retryAfterDateFromHeader("12abc", 30);
    expect(d.getTime()).toBeGreaterThanOrEqual(t0 + 30_000 - 50);
  });

  test("empty string uses fallback", () => {
    const t0 = Date.now();
    const d = retryAfterDateFromHeader("   ", 15);
    expect(d.getTime()).toBeGreaterThanOrEqual(t0 + 15_000 - 50);
  });
});
