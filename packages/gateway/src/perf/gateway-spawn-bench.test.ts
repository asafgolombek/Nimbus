import { describe, expect, test } from "bun:test";
import { spawnGatewayForBench } from "./gateway-spawn-bench.ts";
import { fakeSpawnEmitsMarker } from "./surfaces/spawn-test-helpers.ts";

describe("spawnGatewayForBench", () => {
  test("waits for ready marker, runs workload, returns workloadResult", async () => {
    let workloadPid = -1;
    const result = await spawnGatewayForBench<{ ok: true }, void>({
      cmd: "fake",
      args: [],
      readyMarker: /\[gateway\] ready/,
      spawn: fakeSpawnEmitsMarker({
        pid: 999,
        stdoutChunks: ["[gateway] ready /tmp/sock\n"],
      }),
      workload: async (ctx) => {
        workloadPid = ctx.pid;
        return { ok: true };
      },
    });
    expect(workloadPid).toBe(999);
    expect(result.workloadResult).toEqual({ ok: true });
    expect(result.totalMs).toBeGreaterThanOrEqual(0);
  });

  test("runs sampler concurrently with workload", async () => {
    const samplerCalls: number[] = [];
    const result = await spawnGatewayForBench<number, number>({
      cmd: "fake",
      args: [],
      readyMarker: /\[gateway\] ready/,
      spawn: fakeSpawnEmitsMarker({ pid: 1, stdoutChunks: ["[gateway] ready\n"] }),
      workload: async () => {
        await new Promise((r) => setTimeout(r, 30));
        return 42;
      },
      sampler: async (ctx) => {
        samplerCalls.push(ctx.pid);
        await new Promise((r) => setTimeout(r, 10));
        return 7;
      },
    });
    expect(result.workloadResult).toBe(42);
    expect(result.samplerResult).toBe(7);
    expect(samplerCalls).toEqual([1]);
  });

  test("ready-marker timeout includes captured stderr tail in the error", async () => {
    const promise = spawnGatewayForBench<void, void>({
      cmd: "fake",
      args: [],
      readyMarker: /\[never matches\]/,
      readyTimeoutMs: 50,
      spawn: fakeSpawnEmitsMarker({
        stderrChunks: ["fatal: port already in use 7474\n", "shutting down\n"],
      }),
      workload: async () => {},
    });
    await expect(promise).rejects.toThrow(/ready.*50ms.*port already in use/s);
  });

  test("workload throwing still SIGTERMs the child and rethrows", async () => {
    const spawn = fakeSpawnEmitsMarker({
      pid: 1,
      stdoutChunks: ["[gateway] ready\n"],
    });
    await expect(
      spawnGatewayForBench<void, void>({
        cmd: "fake",
        args: [],
        readyMarker: /\[gateway\] ready/,
        spawn,
        workload: async () => {
          throw new Error("boom");
        },
      }),
    ).rejects.toThrow("boom");
  });

  test("child exits before marker → throws", async () => {
    const spawn = fakeSpawnEmitsMarker({
      stderrChunks: ["fatal: missing dep\n"],
      waitForKill: false,
      exitCode: 1,
    });
    await expect(
      spawnGatewayForBench<void, void>({
        cmd: "fake",
        args: [],
        readyMarker: /\[gateway\] ready/,
        spawn,
        workload: async () => {},
      }),
    ).rejects.toThrow();
  });
});
