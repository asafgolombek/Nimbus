/**
 * CI-parity test sequence (see .github/workflows/ci.yml test steps).
 * On Linux, unit+coverage and vault coverage run via `scripts/linux/linux-dbus-tests.sh` when
 * `dbus-run-session` is available (D-Bus session + Secret Service for secret-tool tests).
 */
import { join } from "node:path";

import { REPO_ROOT, run } from "./root.ts";

const LINUX_DBUS_TESTS = join(REPO_ROOT, "scripts", "linux", "linux-dbus-tests.sh");

const CI_ENV = { env: { CI: "true" as const } };

function dbusAvailable(): boolean {
  if (process.platform !== "linux") {
    return false;
  }
  const w = Bun.spawnSync(["which", "dbus-run-session"], {
    stdout: "ignore",
    stderr: "ignore",
  });
  return w.exitCode === 0;
}

function runBunTest(args: readonly string[], wrapDbus: boolean): void {
  const cmd = ["bun", "test", ...args];
  if (wrapDbus && dbusAvailable()) {
    run(["bash", LINUX_DBUS_TESTS, ...cmd], REPO_ROOT, CI_ENV);
  } else {
    run(cmd, REPO_ROOT, CI_ENV);
  }
}

/** Run the same test steps as CI (unit+coverage, gates, integration, e2e, UI Vitest). */
export function runCiTestSuite(): void {
  runBunTest(["packages/gateway", "packages/cli", "packages/sdk", "--coverage"], true);

  runBunTest(["packages/gateway/src/engine", "--coverage", "--coverage-threshold-lines=85"], false);

  runBunTest(["packages/gateway/src/vault", "--coverage", "--coverage-threshold-lines=90"], true);

  runBunTest(["packages/gateway/test/integration/", "packages/cli/test/integration/"], false);

  runBunTest(["packages/cli/test/e2e/"], false);

  run(["bun", "run", "--filter", "@nimbus/ui", "test"], REPO_ROOT, CI_ENV);
}
