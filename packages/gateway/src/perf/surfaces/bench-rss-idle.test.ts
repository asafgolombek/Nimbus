import { describe, expect, test } from "bun:test";
import { runRssIdleOnce } from "./bench-rss-idle.ts";
import { fakeSpawnEmitsMarker } from "./spawn-test-helpers.ts";

describe("runRssIdleOnce", () => {
  test("returns the sampler's RSS samples (bytes)", async () => {
    let pidCalls = 0;
    const samples = await runRssIdleOnce(
      { runs: 1, runner: "local-dev" },
      {
        spawn: fakeSpawnEmitsMarker({
          pid: 4242,
          stdoutChunks: ["[gateway] ready /tmp/sock\n"],
        }),
        durationMs: 100,
        intervalMs: 20,
        pidusage: async () => {
          pidCalls += 1;
          return { memory: 100_000_000 + pidCalls * 1_000 };
        },
      },
    );
    expect(samples.length).toBeGreaterThanOrEqual(3);
    expect(pidCalls).toBeGreaterThanOrEqual(3);
    expect(samples[0]).toBeGreaterThan(99_000_000);
  });
});
