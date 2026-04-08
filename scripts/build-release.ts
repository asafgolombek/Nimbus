#!/usr/bin/env bun
/**
 * Production build for all workspaces (`bun build --compile` where defined).
 * Run from anywhere: `bun scripts/build-release.ts`
 */
import { runCiTestSuite } from "./lib/ci-tests.ts";
import { REPO_ROOT, run } from "./lib/root.ts";

runCiTestSuite();
run(["bun", "run", "build"], REPO_ROOT);
