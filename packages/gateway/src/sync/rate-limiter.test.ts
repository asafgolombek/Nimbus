import { describe, expect, test } from "bun:test";

import { ProviderRateLimiter } from "./rate-limiter.ts";

describe("ProviderRateLimiter", () => {
  test("parallel acquires for the same provider serialize to the token refill rate", async () => {
    const limiter = new ProviderRateLimiter({
      google: { requestsPerMinute: 60, burstSize: 1 },
    });
    const t0 = performance.now();
    await Promise.all([limiter.acquire("google"), limiter.acquire("google")]);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(900);
  });

  test("different providers do not block each other on the same limiter", async () => {
    const limiter = new ProviderRateLimiter({
      google: { requestsPerMinute: 60, burstSize: 1 },
      microsoft: { requestsPerMinute: 60, burstSize: 1 },
    });
    const t0 = performance.now();
    await Promise.all([limiter.acquire("google"), limiter.acquire("microsoft")]);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(200);
  });

  test("penalise delays the next acquire by approximately retryAfterMs", async () => {
    const limiter = new ProviderRateLimiter({
      google: { requestsPerMinute: 60_000, burstSize: 100 },
    });
    await limiter.acquire("google", 1);
    limiter.penalise("google", 150);
    const t0 = performance.now();
    await limiter.acquire("google", 1);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(120);
    expect(elapsed).toBeLessThan(400);
  });

  test("acquire rejects when tokens exceed burstSize", async () => {
    const limiter = new ProviderRateLimiter({
      google: { requestsPerMinute: 60, burstSize: 2 },
    });
    await expect(limiter.acquire("google", 3)).rejects.toThrow(/burstSize/);
  });
});
