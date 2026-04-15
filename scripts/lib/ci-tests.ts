/**
 * CI-parity test sequence (see `.github/workflows/_test-suite.yml` test steps).
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

function sleepFiveSeconds(): void {
  Bun.spawnSync(
    process.platform === "win32"
      ? ["powershell", "-NoProfile", "-Command", "Start-Sleep -Seconds 5"]
      : ["sleep", "5"],
    { stdout: "ignore", stderr: "ignore" },
  );
}

function runBunTest(args: readonly string[], wrapDbus: boolean): void {
  const cmd = ["bun", "test", ...args];
  if (wrapDbus && dbusAvailable()) {
    run(["bash", LINUX_DBUS_TESTS, ...cmd], REPO_ROOT, CI_ENV);
  } else {
    run(cmd, REPO_ROOT, CI_ENV);
  }
}

/** First unit batch: same as CI; macOS/Windows retry once on failure (matches CI). */
function runInitialUnitTestsWithCoverage(): void {
  const cmd = ["bun", "test", "packages/gateway", "packages/cli", "packages/sdk", "--coverage"];
  const runOnce = (): number => {
    if (process.platform === "linux" && dbusAvailable()) {
      const p = Bun.spawnSync(["bash", LINUX_DBUS_TESTS, ...cmd], {
        cwd: REPO_ROOT,
        stdio: ["inherit", "inherit", "inherit"],
        env: { ...process.env, ...CI_ENV.env },
      });
      return p.exitCode ?? 1;
    }
    const p = Bun.spawnSync([...cmd], {
      cwd: REPO_ROOT,
      stdio: ["inherit", "inherit", "inherit"],
      env: { ...process.env, ...CI_ENV.env },
    });
    return p.exitCode ?? 1;
  };

  if (process.platform === "linux") {
    const code = runOnce();
    if (code !== 0) {
      process.exit(code);
    }
    return;
  }

  for (let attempt = 1; attempt <= 2; attempt++) {
    const code = runOnce();
    if (code === 0) {
      return;
    }
    if (attempt === 2) {
      process.exit(code);
    }
    process.stderr.write(`Attempt ${String(attempt)} failed, retrying in 5 s...\n`);
    sleepFiveSeconds();
  }
}

/** Run the same test steps as `_test-suite.yml` (gates, integration, e2e, UI Vitest with coverage). */
export async function runCiTestSuite(): Promise<void> {
  runInitialUnitTestsWithCoverage();

  runBunTest(["packages/gateway/src/engine", "--coverage", "--coverage-threshold-lines=85"], false);

  runBunTest(["packages/gateway/src/vault", "--coverage", "--coverage-threshold-lines=90"], true);

  runBunTest(
    ["packages/gateway/src/sync/scheduler.test.ts", "--coverage", "--coverage-threshold-lines=80"],
    false,
  );

  runBunTest(
    [
      "packages/gateway/src/sync/rate-limiter.test.ts",
      "--coverage",
      "--coverage-threshold-lines=85",
    ],
    false,
  );

  runBunTest(["packages/gateway/src/people", "--coverage", "--coverage-threshold-lines=80"], false);

  runBunTest(
    ["packages/gateway/src/embedding", "--coverage", "--coverage-threshold-lines=80"],
    false,
  );

  runBunTest(
    [
      "packages/gateway/src/automation/workflow-store.test.ts",
      "packages/gateway/src/automation/workflow-runner.test.ts",
      "packages/gateway/src/automation/workflow-runner-execution.test.ts",
      "--coverage",
      "--coverage-threshold-lines=80",
    ],
    false,
  );

  runBunTest(
    [
      "packages/gateway/src/automation/watcher-store.test.ts",
      "packages/gateway/src/automation/watcher-engine.test.ts",
      "packages/gateway/src/watcher/anomaly-detector.test.ts",
      "--coverage",
      "--coverage-threshold-lines=80",
    ],
    false,
  );

  runBunTest(
    [
      "packages/gateway/src/extensions/install-from-local.test.ts",
      "packages/gateway/src/extensions/manifest.test.ts",
      "packages/gateway/src/extensions/spawn-env.test.ts",
      "packages/gateway/src/extensions/verify-extensions.test.ts",
      "packages/gateway/src/automation/extension-store.test.ts",
      "--coverage",
      "--coverage-threshold-lines=85",
    ],
    false,
  );

  run(["bun", "run", "test:coverage:config"], REPO_ROOT, CI_ENV);
  run(["bun", "run", "test:coverage:client"], REPO_ROOT, CI_ENV);
  run(["bun", "run", "test:coverage:telemetry"], REPO_ROOT, CI_ENV);
  run(["bun", "run", "test:coverage:db"], REPO_ROOT, CI_ENV);

  runBunTest(["packages/gateway/test/integration/", "packages/cli/test/integration/"], false);

  runBunTest(["packages/gateway/test/e2e/"], false);

  runBunTest(["packages/cli/test/e2e/"], false);

  run(["bun", "run", "--filter", "@nimbus/ui", "test:coverage"], REPO_ROOT, CI_ENV);
}
