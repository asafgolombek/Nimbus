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

function defaultSpawnProbe(
  runner: SandboxRunner,
  policy: ReturnType<typeof policyFromManifest>,
  cwd: string,
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
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? -1));
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
  const exit = await (deps.spawnProbe ?? defaultSpawnProbe)(deps.runner, policy, deps.cwd);
  if (exit !== PROBE_EXIT_FS_DENIED) {
    throw new ToolgenError(
      "ERR_TOOLGEN_CONFINEMENT_FAILED",
      `ERR_TOOLGEN_CONFINEMENT_FAILED: sandbox confinement probe returned exit ${exit}, expected ${PROBE_EXIT_FS_DENIED}`,
    );
  }
}
