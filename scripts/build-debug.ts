#!/usr/bin/env bun
/**
 * Debug-oriented build: bundled JS + sourcemaps (no `bun build --compile`).
 * Run from anywhere: `bun scripts/build-debug.ts`
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, run } from "./lib/root.ts";

mkdirSync(join(REPO_ROOT, "dist"), { recursive: true });
mkdirSync(join(REPO_ROOT, "packages/cli/dist"), { recursive: true });

const MCP_CONNECTORS: readonly { dir: string; outfileBase: string }[] = [
  { dir: "onedrive", outfileBase: "nimbus-mcp-onedrive" },
  { dir: "outlook", outfileBase: "nimbus-mcp-outlook" },
  { dir: "google-photos", outfileBase: "nimbus-mcp-google-photos" },
];
for (const { dir } of MCP_CONNECTORS) {
  mkdirSync(join(REPO_ROOT, "packages/mcp-connectors", dir, "dist"), {
    recursive: true,
  });
}

run([
  "bun",
  "build",
  "packages/gateway/src/index.ts",
  "--target",
  "bun",
  "--sourcemap=linked",
  "--outfile",
  "dist/nimbus-gateway.js",
]);

run([
  "bun",
  "build",
  "packages/cli/src/index.ts",
  "--target",
  "bun",
  "--sourcemap=linked",
  "--outfile",
  "packages/cli/dist/nimbus.js",
]);

run(["bun", "run", "--filter", "@nimbus-dev/sdk", "build"]);

run(["bunx", "vite", "build", "--mode", "development"], join(REPO_ROOT, "packages/ui"));

for (const { dir, outfileBase } of MCP_CONNECTORS) {
  const pkgRoot = join(REPO_ROOT, "packages/mcp-connectors", dir);
  run(
    [
      "bun",
      "build",
      "src/server.ts",
      "--target",
      "bun",
      "--sourcemap=linked",
      "--outfile",
      `dist/${outfileBase}.js`,
    ],
    pkgRoot,
  );
}
