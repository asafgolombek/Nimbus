#!/usr/bin/env bun
/**
 * CI-parity tests (same sequence as .github/workflows/ci.yml).
 * On Linux, unit+coverage and vault gate use `dbus-run-session` when available.
 * Run from anywhere: `bun scripts/run-tests.ts` or `bun run test:ci`
 */
import { runCiTestSuite } from "./lib/ci-tests.ts";

runCiTestSuite();
