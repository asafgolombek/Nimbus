import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { policyFromManifest } from "../platform/sandbox/sandbox-policy.ts";
import {
  assertToolConfinement,
  defaultSpawnProbe,
  resolveProbeScriptForTest,
} from "./toolgen-confinement.ts";
import { buildGeneratedManifest } from "./toolgen-stub.ts";
import { ToolgenError } from "./toolgen-types.ts";

const runner = {
  canConfine: () => null,
} as unknown as import("../platform/sandbox/sandbox-runner.ts").SandboxRunner;

describe("assertToolConfinement", () => {
  test("passes when the probe reports fs-denied (exit 10)", async () => {
    await expect(
      assertToolConfinement({
        runner,
        manifest: buildGeneratedManifest("tg_a"),
        cwd: process.cwd(),
        spawnProbe: async () => 10,
      }),
    ).resolves.toBeUndefined();
  });

  test("REFUSES when the probe read the protected path — the unsandboxed signature", async () => {
    await expect(
      assertToolConfinement({
        runner,
        manifest: buildGeneratedManifest("tg_a"),
        cwd: process.cwd(),
        spawnProbe: async () => 2,
      }),
    ).rejects.toMatchObject({ code: "ERR_TOOLGEN_CONFINEMENT_FAILED" });
  });

  test("the probe script resolves to a real file — a bad path reports as a sandbox failure", async () => {
    const { existsSync } = await import("node:fs");
    // Guards the trap the SDK documents on its own `probePath`: a missing probe is a PACKAGING
    // problem, but surfaces as though confinement failed.
    expect(existsSync(resolveProbeScriptForTest())).toBe(true);
  });

  test("refuses BEFORE probing when the runner cannot confine the policy", async () => {
    let probed = false;
    const degraded = {
      canConfine: () => "bwrap not found",
    } as unknown as import("../platform/sandbox/sandbox-runner.ts").SandboxRunner;
    await expect(
      assertToolConfinement({
        runner: degraded,
        manifest: buildGeneratedManifest("tg_a"),
        cwd: process.cwd(),
        spawnProbe: async () => {
          probed = true;
          return 10;
        },
      }),
    ).rejects.toThrow(ToolgenError);
    expect(probed).toBe(false);
  });
});

describe("the DEFAULT probe spawn — the path production actually takes", () => {
  // Every test above injects `spawnProbe`, so the real `defaultSpawnProbe` closure — the one
  // production uses, and the only place the probe's exit code is turned into a number — was never
  // executed. These drive it through a fake `SandboxRunner.spawn`, so the argv, the close/error
  // wiring and the exit-code normalisation are exercised without an OS sandbox.
  function runnerSpawning(emit: (child: EventEmitter) => void): {
    runner: import("../platform/sandbox/sandbox-runner.ts").SandboxRunner;
    spawns: Array<{ cmd: string; args: string[] }>;
  } {
    const spawns: Array<{ cmd: string; args: string[] }> = [];
    const runner = {
      canConfine: () => null,
      spawn: (cmd: string, args: string[]) => {
        spawns.push({ cmd, args });
        const child = new EventEmitter();
        // Emit on a later turn: production attaches its listeners AFTER `spawn` returns, so a
        // synchronous emit here would be missed and the promise would hang forever.
        setTimeout(() => emit(child), 0);
        return child as unknown as import("node:child_process").ChildProcess;
      },
    } as unknown as import("../platform/sandbox/sandbox-runner.ts").SandboxRunner;
    return { runner, spawns };
  }

  test("spawns the resolved probe script with --probe=fs-denied and passes on exit 10", async () => {
    const { runner, spawns } = runnerSpawning((c) => c.emit("close", 10));
    await expect(
      assertToolConfinement({
        runner,
        manifest: buildGeneratedManifest("tg_a"),
        cwd: process.cwd(),
      }),
    ).resolves.toBeUndefined();
    expect(spawns).toHaveLength(1);
    expect(spawns[0]?.args[0]).toBe(resolveProbeScriptForTest());
    expect(spawns[0]?.args).toContain("--probe=fs-denied");
  });

  test("a NULL exit code (killed by a signal) is normalised to -1 and REFUSED, not read as success", async () => {
    // The `code ?? -1` arm. A signal-killed probe proved nothing about confinement, so it must
    // land on the refusal side rather than resolving because `code` was falsy-but-not-10.
    const { runner } = runnerSpawning((c) => c.emit("close", null));
    await expect(
      assertToolConfinement({
        runner,
        manifest: buildGeneratedManifest("tg_a"),
        cwd: process.cwd(),
      }),
    ).rejects.toMatchObject({ code: "ERR_TOOLGEN_CONFINEMENT_FAILED" });
  });

  test("a spawn 'error' event REJECTS rather than hanging the gate forever", async () => {
    const { runner } = runnerSpawning((c) => c.emit("error", new Error("ENOENT")));
    await expect(
      assertToolConfinement({
        runner,
        manifest: buildGeneratedManifest("tg_a"),
        cwd: process.cwd(),
      }),
    ).rejects.toThrow(/ENOENT/);
  });
});

describe("the probe is BOUNDED and its pipes are drained", () => {
  function stallingRunner(opts: { emitClose?: boolean } = {}): {
    runner: import("../platform/sandbox/sandbox-runner.ts").SandboxRunner;
    killed: () => Array<string | number | undefined>;
    resumed: () => string[];
  } {
    const killed: Array<string | number | undefined> = [];
    const resumed: string[] = [];
    const runner = {
      canConfine: () => null,
      spawn: () => {
        const child = new EventEmitter() as EventEmitter & {
          stdout?: { resume: () => void };
          stderr?: { resume: () => void };
          kill: (s?: string | number) => void;
        };
        child.stdout = {
          resume: () => {
            resumed.push("stdout");
          },
        };
        child.stderr = {
          resume: () => {
            resumed.push("stderr");
          },
        };
        child.kill = (s) => {
          killed.push(s);
        };
        if (opts.emitClose === true) setTimeout(() => child.emit("close", 10), 0);
        // Otherwise: never emits anything, standing in for a stalled sandbox helper.
        return child as unknown as import("node:child_process").ChildProcess;
      },
    } as unknown as import("../platform/sandbox/sandbox-runner.ts").SandboxRunner;
    return { runner, killed: () => killed, resumed: () => resumed };
  }

  test("a probe that never exits is KILLED and resolves to a non-pass code, rather than hanging", async () => {
    // Without the bound this call never returns, and `createGeneratedTool` hangs BEFORE the owner
    // is prompted -- no approval, no refusal, nothing to see.
    const r = stallingRunner();
    const exit = await defaultSpawnProbe(
      r.runner,
      policyFromManifest(buildGeneratedManifest("tg_a")),
      process.cwd(),
      25,
    );
    expect(exit).not.toBe(10);
    expect(r.killed()).toEqual(["SIGKILL"]);
  });

  test("a timed-out probe surfaces as a confinement REFUSAL through the gate", async () => {
    const r = stallingRunner();
    await expect(
      assertToolConfinement({
        runner: r.runner,
        manifest: buildGeneratedManifest("tg_a"),
        cwd: process.cwd(),
        spawnProbe: (runner, policy, cwd) => defaultSpawnProbe(runner, policy, cwd, 25),
      }),
    ).rejects.toMatchObject({ code: "ERR_TOOLGEN_CONFINEMENT_FAILED" });
  });

  test("both pipes are drained, so a chatty probe cannot block on a write nobody reads", () => {
    const r = stallingRunner({ emitClose: true });
    void defaultSpawnProbe(
      r.runner,
      policyFromManifest(buildGeneratedManifest("tg_a")),
      process.cwd(),
      50,
    );
    expect(r.resumed().sort()).toEqual(["stderr", "stdout"]);
  });

  test("a probe that exits in time is NOT killed -- the bound is the exception, not the path", async () => {
    const r = stallingRunner({ emitClose: true });
    const exit = await defaultSpawnProbe(
      r.runner,
      policyFromManifest(buildGeneratedManifest("tg_a")),
      process.cwd(),
      5_000,
    );
    expect(exit).toBe(10);
    expect(r.killed()).toEqual([]);
  });
});
