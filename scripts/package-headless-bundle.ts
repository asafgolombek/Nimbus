#!/usr/bin/env bun
/**
 * Assembles a headless install directory with `nimbus` and `nimbus-gateway` binaries
 * (sibling layout expected by the CLI spawn resolver). Run after compiling both
 * binaries into `dist/` (same paths as `.github/workflows/release.yml`).
 *
 * Usage:
 *   bun scripts/package-headless-bundle.ts
 *   bun scripts/package-headless-bundle.ts --out dist/headless-bundle
 *   bun scripts/package-headless-bundle.ts --gateway dist/custom-gw --cli dist/custom-cli
 */
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const isWin = process.platform === "win32";
const ext = isWin ? ".exe" : "";

function parseArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1] !== undefined) {
    return process.argv[i + 1];
  }
  return undefined;
}

const repoRoot = resolve(import.meta.dir, "..");
const defaultGateway = join(repoRoot, "dist", `nimbus-gateway${ext}`);
const defaultCli = join(repoRoot, "dist", `nimbus${ext}`);

const outDir = resolve(repoRoot, parseArg("--out") ?? join("dist", "headless-bundle"));
const gatewaySrc = resolve(repoRoot, parseArg("--gateway") ?? defaultGateway);
const cliSrc = resolve(repoRoot, parseArg("--cli") ?? defaultCli);

for (const [label, p] of [
  ["gateway", gatewaySrc],
  ["cli", cliSrc],
] as const) {
  if (!existsSync(p)) {
    console.error(
      `package-headless-bundle: missing ${label} binary at ${p}\n` +
        `Build gateway and CLI first (see release workflow: bun build … --outfile ../../dist/…).`,
    );
    process.exit(1);
  }
}

if (existsSync(outDir)) {
  rmSync(outDir, { recursive: true, force: true });
}
mkdirSync(outDir, { recursive: true });

const gwDest = join(outDir, `nimbus-gateway${ext}`);
const cliDest = join(outDir, `nimbus${ext}`);
copyFileSync(gatewaySrc, gwDest);
copyFileSync(cliSrc, cliDest);

console.log(`Headless bundle written to ${outDir}`);
console.log(`  ${gwDest}`);
console.log(`  ${cliDest}`);
