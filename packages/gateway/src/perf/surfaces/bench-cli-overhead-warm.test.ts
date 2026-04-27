import { describe, expect, test } from "bun:test";
import { CLI_WARM_SAMPLES_PER_RUN, runCliOverheadWarmOnce } from "./bench-cli-overhead-warm.ts";

function fakeSpawnExitsClean(): typeof Bun.spawn {
  return ((..._args: unknown[]) => {
    return {
      stdout: new ReadableStream({
        start(c) {
          c.close();
        },
      }),
      stderr: new ReadableStream({
        start(c) {
          c.close();
        },
      }),
      exited: Promise.resolve(0),
      kill: () => undefined,
    } as unknown as ReturnType<typeof Bun.spawn>;
  }) as unknown as typeof Bun.spawn;
}

describe("runCliOverheadWarmOnce (S11-b)", () => {
  test("returns CLI_WARM_SAMPLES_PER_RUN finite samples", async () => {
    const samples = await runCliOverheadWarmOnce(
      { runs: 1, runner: "local-dev" },
      { spawn: fakeSpawnExitsClean() },
    );
    expect(samples.length).toBe(CLI_WARM_SAMPLES_PER_RUN);
    for (const s of samples) {
      expect(Number.isFinite(s)).toBe(true);
    }
  });
});
