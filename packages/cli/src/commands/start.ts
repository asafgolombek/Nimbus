import { type SpawnOptions, spawn } from "node:child_process";
import { appendFileSync, closeSync, openSync } from "node:fs";
import { join } from "node:path";

import { spinner } from "@clack/prompts";

import {
  ensureGatewayDirs,
  gatewayStatePath,
  isProcessAlive,
  readGatewayState,
} from "../lib/gateway-process.ts";
import { resolveGatewayLaunch } from "../lib/resolve-gateway-launch.ts";
import { getCliPlatformPaths } from "../paths.ts";

/** Local calendar date for log filenames (append same file for multiple starts on the same day). */
function gatewayLogBasename(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `gateway-${String(y)}-${m}-${day}.log`;
}

export async function runStart(_args: string[]): Promise<void> {
  const paths = getCliPlatformPaths();
  await ensureGatewayDirs(paths);

  const existing = await readGatewayState(paths);
  if (existing !== undefined && isProcessAlive(existing.pid)) {
    console.log(`Gateway already running (pid ${String(existing.pid)}).`);
    return;
  }

  const s = spinner();
  s.start("Starting Gateway");

  const launch = resolveGatewayLaunch(process.execPath, import.meta.url);
  if (launch.ok) {
    const logPath = join(paths.logDir, gatewayLogBasename());
    appendFileSync(
      logPath,
      `\n--- ${new Date().toISOString()} nimbus: spawning gateway (${launch.cmd.join(" ")}) ---\n`,
    );

    /**
     * Use Node `spawn` with real append fds — `Bun.spawn` + inherited stdio is unreliable on Windows
     * (log stays empty, gateway often exits when the CLI process exits).
     * `detached: true` on Windows lets the gateway keep running and keep valid stdio handles after `unref`.
     */
    const executable = launch.cmd[0];
    if (executable === undefined || executable === "") {
      throw new Error("Gateway launch command is empty");
    }
    const spawnArgs = launch.cmd.slice(1);
    const outFd = openSync(logPath, "a");
    const errFd = openSync(logPath, "a");
    let pid: number;
    try {
      const opts: SpawnOptions = {
        cwd: launch.cwd,
        stdio: ["ignore", outFd, errFd],
        windowsHide: true,
      };
      if (process.platform === "win32") {
        opts.detached = true;
      }
      const child = spawn(executable, spawnArgs, opts);
      const p = child.pid;
      if (p === undefined) {
        throw new Error("Gateway spawn did not return a process id");
      }
      pid = p;
      child.unref();
    } finally {
      closeSync(outFd);
      closeSync(errFd);
    }

    const state = {
      pid,
      socketPath: paths.socketPath,
      logPath,
    };
    await Bun.write(gatewayStatePath(paths), `${JSON.stringify(state, undefined, 2)}\n`);

    s.stop(`Gateway started (pid ${String(pid)})`);
    console.log(`Socket: ${paths.socketPath}`);
    console.log(`Log:    ${logPath}`);
    return;
  }

  s.stop("Could not start Gateway");
  console.error(launch.message);
  process.exitCode = 1;
}
