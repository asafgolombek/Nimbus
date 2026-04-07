#!/usr/bin/env bun
/**
 * Unit tests for gateway, cli, and sdk (same as `bun run test` at repo root).
 * Run from anywhere: `bun scripts/run-tests.ts`
 */
import { REPO_ROOT, run } from "./lib/root.ts";

run(["bun", "run", "test"], REPO_ROOT);
