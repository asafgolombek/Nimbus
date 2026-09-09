import { describe, expect, test } from "bun:test";
import { assertToolConfinement, resolveProbeScriptForTest } from "./toolgen-confinement.ts";
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
