#!/usr/bin/env bun
/**
 * Deep Clean: Runs the root `clean` script, then wipes all `node_modules`
 * and lockfiles across the monorepo for a truly fresh start.
 *
 * Usage: bun scripts/clean-deep.ts
 */
import { rmSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, run } from "./lib/root.ts";

process.stdout.write("--- Nimbus Deep Clean ---\n");

// 1. Run standard clean (removes dist/ folders)
process.stdout.write("Running bun run clean...\n");
run(["bun", "run", "clean"], REPO_ROOT);

// 2. Remove root node_modules and lockfile
process.stdout.write("Removing root node_modules and bun.lock...\n");
rmSync(join(REPO_ROOT, "node_modules"), { recursive: true, force: true });
rmSync(join(REPO_ROOT, "bun.lock"), { force: true });

// 3. Find all package-level node_modules (optional but thorough)
// Since bun uses a single root node_modules mostly, this might be overkill
// but some packages might have their own.
const packages = [
  "packages/gateway",
  "packages/cli",
  "packages/ui",
  "packages/sdk",
  "packages/client",
  "packages/docs",
];

for (const pkg of packages) {
  const pkgDir = join(REPO_ROOT, pkg, "node_modules");
  process.stdout.write(`Removing ${pkg}/node_modules...\n`);
  rmSync(pkgDir, { recursive: true, force: true });
}

process.stdout.write("\nDone. Run `bun install` to restore dependencies.\n");
process.stdout.write("-------------------------\n");
