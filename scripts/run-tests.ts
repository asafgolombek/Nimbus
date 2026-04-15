#!/usr/bin/env bun
/**
 * CI-parity tests (same sequence as `.github/workflows/_test-suite.yml` test steps).
 * On Linux, unit+coverage and vault gate use `scripts/linux/linux-dbus-tests.sh` when
 * `dbus-run-session` is available (starts gnome-keyring for Secret Service).
 * Run from anywhere: `bun scripts/run-tests.ts`, `bun run test:ci`, or `scripts/linux/run-tests.sh`
 */
import { runCiTestSuite } from "./lib/ci-tests.ts";

await runCiTestSuite();
