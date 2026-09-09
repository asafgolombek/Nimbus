import { mkdir } from "node:fs/promises";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionManifest } from "../extensions/manifest.ts";
import { extensionProcessEnv } from "../extensions/spawn-env.ts";
import { policyFromManifest } from "../platform/sandbox/sandbox-policy.ts";
import type { SandboxRunner } from "../platform/sandbox/sandbox-runner.ts";
import { ToolgenError } from "./toolgen-types.ts";

/** The SDK probe's exit code for "the protected read was denied", i.e. confinement worked. */
const PROBE_EXIT_FS_DENIED = 10;

/**
 * Locate the SDK's probe script ourselves.
 *
 * `probePath` IS exported from `sandbox-contract.ts` but is NOT re-exported by the package entry
 * `@nimbus-dev/sdk/testing`, whose surface is exactly `runSandboxContractTests`,
 * `expectNoRejectedDiagnostics` and `MockGateway` — so importing it fails typecheck. Resolving it
 * here also means the extension follows whichever copy is executing: `src/` carries only
 * `sandbox-probe.ts`, the published `dist/` only `sandbox-probe.js`, and a hardcoded extension is
 * wrong from one side or the other.
 */
export function resolveProbeScriptForTest(): string {
  return resolveProbeScript();
}

function resolveProbeScript(): string {
  const entry = fileURLToPath(import.meta.resolve("@nimbus-dev/sdk/testing"));
  const file = entry.endsWith(".ts") ? "sandbox-probe.ts" : "sandbox-probe.js";
  return resolvePath(dirname(entry), file);
}

export interface ToolConfinementDeps {
  readonly runner: SandboxRunner;
  readonly manifest: ExtensionManifest;
  readonly cwd: string;
  /** Injected for tests. Production spawns the probe through the real runner. */
  readonly spawnProbe?: (
    runner: SandboxRunner,
    policy: ReturnType<typeof policyFromManifest>,
    cwd: string,
  ) => Promise<number>;
}

/**
 * How long the confinement probe may take before it is killed and treated as a failure.
 *
 * `assertToolConfinement` runs BEFORE the owner is prompted, so a probe that never exits does not
 * merely slow the gate down — it hangs `createGeneratedTool` outright, with no prompt and no
 * refusal. Two reachable ways that happens: the sandbox helper itself stalls (a Windows
 * AppContainer ACL grant over a large tree is a recorded case), or the probe outgrows the pipe
 * buffer and blocks on a write nothing is reading.
 */
const PROBE_TIMEOUT_MS = 30_000;

/** Not `PROBE_EXIT_FS_DENIED`, so a timed-out probe lands on the refusal side by construction. */
const PROBE_EXIT_TIMEOUT = -2;

/**
 * Exported, and taking `timeoutMs`, purely so the timeout and drain paths are testable without a
 * 30-second test — the same seam `wireToolProtocol` already uses for its own request timeout.
 * Production always calls it through the `deps.spawnProbe ?? defaultSpawnProbe` default below,
 * with the real bound.
 */
export function defaultSpawnProbe(
  runner: SandboxRunner,
  policy: ReturnType<typeof policyFromManifest>,
  cwd: string,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = runner.spawn(
      process.execPath,
      [resolveProbeScript(), "--probe=fs-denied", "--arg="],
      {
        policy,
        env: extensionProcessEnv({}),
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    // DRAIN both pipes. `stdio: ["ignore", "pipe", "pipe"]` creates pipes with no reader, so a
    // probe that prints more than one buffer's worth blocks on write and never reaches `close` —
    // the hang this timeout exists to bound, arriving by the most ordinary route there is. The
    // output itself is discarded: the probe's verdict is its EXIT CODE, and nothing here should
    // start parsing what an unconfined process chose to print.
    child.stdout?.resume();
    child.stderr?.resume();

    const timer = setTimeout(() => {
      finish(() => {
        child.kill("SIGKILL");
        resolve(PROBE_EXIT_TIMEOUT);
      });
    }, timeoutMs);

    child.on("error", (err) => finish(() => reject(err)));
    child.on("close", (code) => finish(() => resolve(code ?? -1)));
  });
}

/**
 * Prove THIS machine's sandbox confines THIS manifest, before the owner is prompted.
 *
 * Two checks, in order. `canConfine(policy)` asks the PAL about the policy that will actually
 * spawn — never `degradedReason()` (non-null on Windows even when the runner is fully active) and
 * never `isFullyActive()` (reports the Linux per-host helper an empty-network policy never touches,
 * and CI does not install it). Then the probe actually runs under that policy, because a runner
 * saying it *can* confine is a claim and the probe is a measurement.
 *
 * Called BEFORE `writeScript` (`toolgen-gate.ts` step 6, ahead of step 9), so the manifest's own
 * `scriptDir` grant NEVER exists on disk yet at this point — by design, since nothing may be
 * written before the owner approves. A grant target that does not exist is fine for `bwrap`'s and
 * `sandbox-exec`'s bind mechanisms, but the Windows helper's ACL grant
 * (`GetNamedSecurityInfoW`/`SetNamedSecurityInfoW`) requires the target to exist first and fails
 * closed with exit 66 (`ERROR_PATH_NOT_FOUND`) otherwise — turning EVERY confinement check on
 * Windows into a false `ERR_TOOLGEN_CONFINEMENT_FAILED`, regardless of what program the probe
 * spawns. Creating the empty directory here (never its contents — the body is written only after
 * approval, unchanged) is what lets the grant call target a real path on every platform.
 *
 * `mode: 0o700` matches `writeToolScript`'s own OWNER-ONLY mode (`toolgen-script-store.ts`)
 * exactly, and is load-bearing, not decorative: `mkdir(dir, { recursive: true })` on a directory
 * that ALREADY EXISTS is a no-op — it does not retroactively chmod — so creating this directory
 * without a mode here would have `writeToolScript`'s later `mode: 0o700` silently do nothing,
 * leaving the directory that will hold the owner-approved tool body at the process umask default
 * (world-listable on a typical shared Linux/macOS box) instead of owner-only.
 */
export async function assertToolConfinement(deps: ToolConfinementDeps): Promise<void> {
  const policy = policyFromManifest(deps.manifest);
  const cannot = deps.runner.canConfine(policy);
  if (cannot !== null) {
    throw new ToolgenError(
      "ERR_TOOLGEN_SANDBOX_DEGRADED",
      `refusing to generate a tool that could not be confined: ${cannot}`,
    );
  }
  for (const dir of [
    ...deps.manifest.permissions.filesystem.read,
    ...deps.manifest.permissions.filesystem.write,
  ]) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
  }
  const exit = await (deps.spawnProbe ?? defaultSpawnProbe)(deps.runner, policy, deps.cwd);
  if (exit !== PROBE_EXIT_FS_DENIED) {
    throw new ToolgenError(
      "ERR_TOOLGEN_CONFINEMENT_FAILED",
      `sandbox confinement probe returned exit ${exit}, expected ${PROBE_EXIT_FS_DENIED}`,
    );
  }
}
