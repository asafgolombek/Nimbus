import { spawn } from "node:child_process";
import type { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { type ExtensionManifest, runContractTests } from "@nimbus-dev/sdk";

const MANIFEST = "nimbus.extension.json";

export async function runTest(args: string[]): Promise<void> {
  const rootArg = args[0]?.trim() ?? "";
  const root = rootArg === "" ? process.cwd() : rootArg;
  const manifestPath = join(root, MANIFEST);
  if (!existsSync(manifestPath)) {
    throw new Error(`No ${MANIFEST} in ${root}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
  } catch {
    throw new Error(`Invalid JSON in ${manifestPath}`);
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Invalid manifest root in ${manifestPath}`);
  }
  runContractTests(raw as ExtensionManifest);

  const pkgPath = join(root, "package.json");
  if (existsSync(pkgPath)) {
    const pkgRaw: unknown = JSON.parse(readFileSync(pkgPath, "utf8"));
    const scripts =
      pkgRaw !== null && typeof pkgRaw === "object" && !Array.isArray(pkgRaw)
        ? (pkgRaw as { scripts?: unknown }).scripts
        : undefined;
    const testScript =
      scripts !== null && typeof scripts === "object" && !Array.isArray(scripts)
        ? (scripts as { test?: unknown }).test
        : undefined;
    if (typeof testScript === "string" && testScript.trim() !== "") {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, ["test"], {
          cwd: root,
          stdio: "inherit",
          shell: false,
        });
        (child as unknown as EventEmitter).on("error", (err: Error) => {
          reject(err);
        });
        (child as unknown as EventEmitter).on("close", (code: number | null) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`bun test exited with code ${String(code)}`));
          }
        });
      });
    }
  }

  console.log("Extension contract OK.");
}
