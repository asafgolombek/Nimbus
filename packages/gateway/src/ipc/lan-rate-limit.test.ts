import { describe, expect, test } from "bun:test";
import { LanRateLimiter } from "./lan-rate-limit.ts";

describe("LanRateLimiter", () => {
  test("allows the first N attempts per IP", () => {
    const now = 1_000;
    const l = new LanRateLimiter(
      { maxFailures: 3, windowMs: 60_000, lockoutMs: 60_000 },
      () => now,
    );
    expect(l.checkAllowed("192.0.2.1")).toBe(true);
    l.recordFailure("192.0.2.1");
    l.recordFailure("192.0.2.1");
    expect(l.checkAllowed("192.0.2.1")).toBe(true);
    l.recordFailure("192.0.2.1");
    expect(l.checkAllowed("192.0.2.1")).toBe(false);
  });

  test("lockout expires after lockoutMs", () => {
    let now = 1_000;
    const l = new LanRateLimiter(
      { maxFailures: 2, windowMs: 60_000, lockoutMs: 60_000 },
      () => now,
    );
    l.recordFailure("192.0.2.1");
    l.recordFailure("192.0.2.1");
    expect(l.checkAllowed("192.0.2.1")).toBe(false);
    now += 61_000;
    expect(l.checkAllowed("192.0.2.1")).toBe(true);
  });

  test("per-IP isolation", () => {
    const now = 1_000;
    const l = new LanRateLimiter(
      { maxFailures: 2, windowMs: 60_000, lockoutMs: 60_000 },
      () => now,
    );
    l.recordFailure("1.1.1.1");
    l.recordFailure("1.1.1.1");
    expect(l.checkAllowed("1.1.1.1")).toBe(false);
    expect(l.checkAllowed("2.2.2.2")).toBe(true);
  });

  test("success resets counter", () => {
    const now = 1_000;
    const l = new LanRateLimiter(
      { maxFailures: 3, windowMs: 60_000, lockoutMs: 60_000 },
      () => now,
    );
    l.recordFailure("1.1.1.1");
    l.recordFailure("1.1.1.1");
    l.recordSuccess("1.1.1.1");
    l.recordFailure("1.1.1.1");
    l.recordFailure("1.1.1.1");
    expect(l.checkAllowed("1.1.1.1")).toBe(true);
  });
});
