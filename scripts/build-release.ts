#!/usr/bin/env bun
/**
 * Production build for all workspaces (`bun build --compile` where defined).
 * Run from anywhere: `bun scripts/build-release.ts` or `scripts/linux/build-release.sh` / `scripts/windows/build-release.ps1`
 */
import { runCiTestSuite } from "./lib/ci-tests.ts";
import { REPO_ROOT, run } from "./lib/root.ts";

runCiTestSuite();
run(["bun", "run", "build"], REPO_ROOT);
