import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { policyFromManifest } from "../platform/sandbox/sandbox-policy.ts";
import { assertToolConfinement, defaultSpawnProbe } from "./toolgen-confinement.ts";
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

  test("the sentinel it hands the probe is a real, parent-readable file OUTSIDE the manifest's grants", async () => {
    // The probe reads a path the parent just wrote and treats ANY failure as a denial, so the
    // whole check is vacuous unless that file genuinely exists and is genuinely readable here.
    // This is the positive control for the positive control: it asserts on what the probe RECEIVED.
    const scriptDir = join(mkdtempSync(join(tmpdir(), "nimbus-toolgen-sentinel-")), "tg_s");
    let target = "";
    await assertToolConfinement({
      runner,
      manifest: buildGeneratedManifest("tg_s", { scriptDir }),
      cwd: process.cwd(),
      spawnProbe: async (_r, _p, _cwd, t) => {
        target = t;
        expect(readFileSync(t, "utf8")).not.toBe("");
        return 10;
      },
    });
    expect(target).not.toBe("");
    expect(target.startsWith(scriptDir)).toBe(false);
    expect(target.startsWith(process.cwd())).toBe(false);
  });

  test("a sentinel that cannot be created REFUSES fail-closed — it never probes and never prompts", async () => {
    // Without this the gate would carry on to a probe with nothing to read, the probe would report
    // "denied" for the wrong reason, and `assertToolConfinement` would return successfully having
    // measured nothing at all. Forced by pointing the temp directory at a path that cannot be
    // created under (`os.tmpdir()` reads these on every call, so the override is enough).
    const keys = ["TMPDIR", "TEMP", "TMP"] as const;
    const saved = keys.map((k) => [k, process.env[k]] as const);
    let probed = false;
    try {
      for (const k of keys) process.env[k] = join(process.cwd(), "no-such-dir-nimbus", "nope");
      await expect(
        assertToolConfinement({
          runner,
          manifest: buildGeneratedManifest("tg_a"),
          cwd: process.cwd(),
          spawnProbe: async () => {
            probed = true;
            return 10;
          },
        }),
      ).rejects.toMatchObject({ code: "ERR_TOOLGEN_CONFINEMENT_FAILED" });
    } finally {
      for (const [k, v] of saved) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
    expect(probed).toBe(false);
  });

  test("the sentinel is REMOVED once the probe has answered — no temp-dir litter per create", async () => {
    let target = "";
    await assertToolConfinement({
      runner,
      manifest: buildGeneratedManifest("tg_s"),
      cwd: process.cwd(),
      spawnProbe: async (_r, _p, _cwd, t) => {
        target = t;
        return 10;
      },
    });
    expect(existsSync(target)).toBe(false);
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

describe("assertToolConfinement creates the manifest's granted directories before probing", () => {
  // POSIX only: Windows models no `mode` bits on `mkdir` (NTFS ACLs are the real Windows-side
  // control, unrelated to this call), so a mode assertion there would either be vacuous or flaky
  // depending on inherited ACLs -- not a property this call establishes on that platform.
  test.skipIf(process.platform === "win32")(
    "creates a not-yet-existing scriptDir OWNER-ONLY (0o700), matching writeToolScript's own mode",
    async () => {
      const base = mkdtempSync(join(tmpdir(), "nimbus-toolgen-confinement-mode-"));
      const scriptDir = join(base, "toolgen", "ephemeral", "tg_mode_test");
      expect(existsSync(scriptDir)).toBe(false);

      await assertToolConfinement({
        runner,
        manifest: buildGeneratedManifest("tg_mode_test", { scriptDir }),
        cwd: process.cwd(),
        spawnProbe: async () => 10,
      });

      expect(existsSync(scriptDir)).toBe(true);
      // `mkdir(dir, { recursive: true })` on a directory that ALREADY EXISTS is a no-op -- it does
      // not retroactively chmod -- so a regression here means `writeToolScript`'s later
      // `mode: 0o700` silently stopped taking effect, not that this call forgot its own mode.
      // `& 0o777` masks off the file-type bits `statSync().mode` also carries.
      expect(statSync(scriptDir).mode & 0o777).toBe(0o700);
    },
  );
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

  test("spawns the INLINE probe via -e, carrying the sentinel as a bare argument, and passes on exit 10", async () => {
    const { runner, spawns } = runnerSpawning((c) => c.emit("close", 10));
    await expect(
      assertToolConfinement({
        runner,
        manifest: buildGeneratedManifest("tg_a"),
        cwd: process.cwd(),
      }),
    ).resolves.toBeUndefined();
    expect(spawns).toHaveLength(1);
    // `-e`, not a file path: the file-entry-point shape is what the Windows AppContainer refuses
    // (`CouldntReadCurrentDirectory`), and a probe SCRIPT would additionally sit under
    // `node_modules/`, which no generated-tool manifest grants read to.
    expect(spawns[0]?.args[0]).toBe("-e");
    expect(spawns[0]?.args[1]).toContain("node:fs/promises");
    // BARE, not `--flag value`: bun's own `-e` argument parser eats a `--`-prefixed token before
    // the script sees it, leaving only the value at an index indistinguishable from a positional.
    const target = spawns[0]?.args[2] ?? "";
    expect(target.startsWith("nimbus-probe-target=")).toBe(true);
    expect(target.startsWith("--")).toBe(false);
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

  test("the FIRST outcome wins — a second event after settling is ignored, not a double-resolve", async () => {
    // The `if (settled) return;` guard. A child that closes and then errors (or emits close twice
    // — both happen when a sandbox helper tears down noisily) must not turn one probe into two
    // verdicts. Without the guard the later `reject` lands on an already-resolved promise, which
    // Bun ignores silently today, so the failure mode is an unhandled rejection on some other
    // runtime rather than a wrong answer here — worth pinning either way.
    const { runner } = runnerSpawning((c) => {
      c.emit("close", 10);
      c.emit("close", 2);
      c.emit("error", new Error("teardown noise"));
    });
    await expect(
      assertToolConfinement({
        runner,
        manifest: buildGeneratedManifest("tg_a"),
        cwd: process.cwd(),
      }),
    ).resolves.toBeUndefined();
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
      "/nonexistent/sentinel",
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
        spawnProbe: (runner, policy, cwd, target) =>
          defaultSpawnProbe(runner, policy, cwd, target, 25),
      }),
    ).rejects.toMatchObject({ code: "ERR_TOOLGEN_CONFINEMENT_FAILED" });
  });

  test("both pipes are drained, so a chatty probe cannot block on a write nobody reads", () => {
    const r = stallingRunner({ emitClose: true });
    void defaultSpawnProbe(
      r.runner,
      policyFromManifest(buildGeneratedManifest("tg_a")),
      process.cwd(),
      "/nonexistent/sentinel",
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
      "/nonexistent/sentinel",
      5_000,
    );
    expect(exit).toBe(10);
    expect(r.killed()).toEqual([]);
  });
});
