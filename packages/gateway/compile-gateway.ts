#!/usr/bin/env bun
/**
 * Windows: `bun build --compile` cannot replace `dist/nimbus-gateway.exe` while it is running (EPERM).
 * Terminate the compiled gateway process, rotate the existing binary aside, then compile.
 */
import { spawnSync } from "node:child_process";
import { existsSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { terminateCompiledGatewayBinary } from "./terminate-gateway-binary.ts";

const gatewayPkgDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(gatewayPkgDir, "../..");
const distDir = join(repoRoot, "dist");
const binaryName = process.platform === "win32" ? "nimbus-gateway.exe" : "nimbus-gateway";
const outfileAbs = join(distDir, binaryName);
const prevAbs = `${outfileAbs}.prev`;

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function rotateExistingBinaryOrThrow(): void {
  if (existsSync(prevAbs)) {
    try {
      unlinkSync(prevAbs);
    } catch {
      /* previous rotation may still be executing; ignore */
    }
  }
  if (existsSync(outfileAbs)) {
    renameSync(outfileAbs, prevAbs);
  }
}

async function main(): Promise<void> {
  terminateCompiledGatewayBinary();
  await sleepMs(process.platform === "win32" ? 600 : 200);

  try {
    rotateExistingBinaryOrThrow();
  } catch {
    terminateCompiledGatewayBinary();
    await sleepMs(process.platform === "win32" ? 600 : 200);
    try {
      rotateExistingBinaryOrThrow();
    } catch (e) {
      process.stderr.write(
        "Could not rotate existing gateway binary. Run `bun run kill-gateway` or stop nimbus-gateway, then retry.\n\n",
      );
      throw e;
    }
  }

  const r = spawnSync(
    process.execPath,
    [
      "build",
      "src/index.ts",
      "--target",
      "bun",
      "--compile",
      "--outfile",
      join("..", "..", "dist", "nimbus-gateway"),
    ],
    { cwd: gatewayPkgDir, stdio: "inherit", env: process.env },
  );

  process.exit(r.status === null ? 1 : r.status);
}

await main();
