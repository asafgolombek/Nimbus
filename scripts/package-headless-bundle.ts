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
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
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
/** Pre-downloaded Xenova ONNX weights dir; also read from env `NIMBUS_EMBEDDING_MODEL_DIR`. */
const embeddingModelDir =
  parseArg("--embedding-model-dir") ?? process.env["NIMBUS_EMBEDDING_MODEL_DIR"];

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

if (embeddingModelDir !== undefined && embeddingModelDir.trim() !== "") {
  const src = resolve(embeddingModelDir.trim());
  if (existsSync(src)) {
    const dest = join(outDir, "embedding-model");
    cpSync(src, dest, { recursive: true });
    console.log(`Embedding weights copied to ${dest}`);
    console.log(
      "Set NIMBUS_EMBEDDING_MODEL_DIR to this directory on the target host (or pass the same path to --embedding-model-dir when packaging).",
    );
  } else {
    console.warn(
      `package-headless-bundle: NIMBUS_EMBEDDING_MODEL_DIR / --embedding-model-dir points to missing path: ${src}`,
    );
  }
} else {
  console.log(
    "Tip: pre-download MiniLM weights, then re-run with NIMBUS_EMBEDDING_MODEL_DIR=<dir> or --embedding-model-dir <dir> to embed them in the bundle.",
  );
}

console.log(`Headless bundle written to ${outDir}`);
console.log(`  ${gwDest}`);
console.log(`  ${cliDest}`);
