import { type SpawnOptions, spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, writeSync } from "node:fs";
import { join } from "node:path";

import type { CliPlatformPaths } from "../paths.ts";
import { gatewayStatePath } from "./gateway-process.ts";
import { resolveGatewayLaunch } from "./resolve-gateway-launch.ts";

const PROFILE_FILENAME = ".nimbus-profile";

/** Local calendar date for log filenames (append same file for multiple starts on the same day). */
function gatewayLogBasename(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `gateway-${String(y)}-${m}-${day}.log`;
}

function readActiveProfileName(configDir: string): string | undefined {
  const p = join(configDir, PROFILE_FILENAME);
  if (!existsSync(p)) {
    return undefined;
  }
  try {
    const raw = readFileSync(p, "utf8").trim();
    return raw === "" || raw === "default" ? undefined : raw;
  } catch {
    return undefined;
  }
}

export type SpawnGatewayOptions = {
  /** Merged into the child environment (overrides duplicate keys). */
  readonly extraEnv?: Readonly<Record<string, string>>;
};

/**
 * Spawns the Gateway with the same model as `nimbus start` (detached on Windows, log append).
 * Writes `gateway.json` state on success.
 */
export async function spawnGateway(
  paths: CliPlatformPaths,
  opts: SpawnGatewayOptions = {},
): Promise<{ pid: number; logPath: string }> {
  const launch = resolveGatewayLaunch(process.execPath, import.meta.url);
  if (!launch.ok) {
    throw new Error(launch.message);
  }

  const logPath = join(paths.logDir, gatewayLogBasename());
  const executable = launch.cmd[0];
  if (executable === undefined || executable === "") {
    throw new Error("Gateway launch command is empty");
  }
  const spawnArgs = launch.cmd.slice(1);
  const logFd = openSync(logPath, "a");
  let pid: number;
  try {
    writeSync(
      logFd,
      `\n--- ${new Date().toISOString()} nimbus: spawning gateway (${launch.cmd.join(" ")}) ---\n`,
    );
    const childEnv: NodeJS.ProcessEnv = { ...process.env };
    const profile = readActiveProfileName(paths.configDir);
    if (profile !== undefined) {
      childEnv["NIMBUS_PROFILE"] = profile;
    }
    if (opts.extraEnv !== undefined) {
      for (const [k, v] of Object.entries(opts.extraEnv)) {
        childEnv[k] = v;
      }
    }
    const spawnOpts: SpawnOptions = {
      cwd: launch.cwd,
      stdio: ["ignore", logFd, logFd],
      windowsHide: true,
      env: childEnv,
    };
    if (process.platform === "win32") {
      spawnOpts.detached = true;
    }
    const child = spawn(executable, spawnArgs, spawnOpts);
    const p = child.pid;
    if (p === undefined) {
      throw new Error("Gateway spawn did not return a process id");
    }
    pid = p;
    child.unref();
  } finally {
    closeSync(logFd);
  }

  const state = {
    pid,
    socketPath: paths.socketPath,
    logPath,
  };
  await Bun.write(gatewayStatePath(paths), `${JSON.stringify(state, undefined, 2)}\n`);
  return { pid, logPath };
}
