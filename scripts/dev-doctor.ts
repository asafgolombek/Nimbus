#!/usr/bin/env bun
/**
 * Nimbus Dev Doctor: Checks the development environment for prerequisites,
 * configuration issues, and common pitfalls.
 *
 * Usage: bun scripts/dev-doctor.ts
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./lib/root.ts";

const isLinux = process.platform === "linux";

type Status = "OK" | "WARN" | "ERROR";

const STATUS_COLORS: Record<Status, string> = {
  OK: "\x1b[32m",
  WARN: "\x1b[33m",
  ERROR: "\x1b[31m",
};

function log(status: Status, message: string): void {
  const color = STATUS_COLORS[status];
  const reset = "\x1b[0m";
  process.stdout.write(`[${color}${status}${reset}] ${message}\n`);
}

async function checkBun(): Promise<void> {
  const version = Bun.version;
  const [major, minor] = version.split(".").map(Number);
  if (major !== undefined && (major > 1 || (major === 1 && minor !== undefined && minor >= 2))) {
    log("OK", `Bun version: ${version} (>= 1.2 required)`);
  } else {
    log("ERROR", `Bun version: ${version} (< 1.2 is not supported)`);
  }
}

async function checkRust(): Promise<void> {
  try {
    const p = Bun.spawnSync(["rustc", "--version"], { stderr: "ignore" });
    if (p.exitCode === 0) {
      log("OK", `Rust version: ${p.stdout.toString().trim()}`);
    } else {
      log("WARN", "Rust (rustc) not found. Required for building Tauri UI.");
    }
  } catch {
    log("WARN", "Rust (rustc) not found. Required for building Tauri UI.");
  }
}

async function checkNodeModules(): Promise<void> {
  if (existsSync(join(REPO_ROOT, "node_modules"))) {
    log("OK", "Root node_modules found.");
  } else {
    log("ERROR", "Root node_modules missing. Run `bun install`.");
  }
}

async function checkPlatformDeps(): Promise<void> {
  if (isLinux) {
    const deps = ["libsecret-1-dev", "pkg-config", "build-essential"];
    for (const dep of deps) {
      const p = Bun.spawnSync(["dpkg", "-s", dep], { stderr: "ignore", stdout: "ignore" });
      if (p.exitCode === 0) {
        log("OK", `Linux dependency ${dep} is installed.`);
      } else {
        log("WARN", `Linux dependency ${dep} might be missing (check via apt).`);
      }
    }
  }
}

async function checkGcloud(): Promise<void> {
  try {
    const p = Bun.spawnSync(["gcloud", "--version"], { stderr: "ignore" });
    if (p.exitCode === 0) {
      log("OK", "Google Cloud SDK (gcloud) found.");
    } else {
      log("WARN", "Google Cloud SDK not found. Required for Google connectors dev.");
    }
  } catch {
    log("WARN", "Google Cloud SDK not found. Required for Google connectors dev.");
  }
}

async function main(): Promise<void> {
  process.stdout.write("--- Nimbus Dev Doctor ---\n");
  await checkBun();
  await checkNodeModules();
  await checkRust();
  await checkPlatformDeps();
  await checkGcloud();
  process.stdout.write("-------------------------\n");
}

await main();
