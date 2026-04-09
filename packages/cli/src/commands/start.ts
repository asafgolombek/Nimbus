import { spinner } from "@clack/prompts";

import {
  ensureGatewayDirs,
  gatewayStatePath,
  isProcessAlive,
  readGatewayState,
} from "../lib/gateway-process.ts";
import { resolveGatewayLaunch } from "../lib/resolve-gateway-launch.ts";
import { getCliPlatformPaths } from "../paths.ts";

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
  if (!launch.ok) {
    s.stop("Could not start Gateway");
    console.error(launch.message);
    process.exitCode = 1;
    return;
  }

  const logPath = `${paths.logDir}/gateway.log`;
  const logFile = Bun.file(logPath);

  const proc = Bun.spawn({
    cmd: launch.cmd,
    ...(launch.cwd !== undefined ? { cwd: launch.cwd } : {}),
    stdin: "ignore",
    stdout: logFile,
    stderr: logFile,
  });

  proc.unref();

  const state = {
    pid: proc.pid,
    socketPath: paths.socketPath,
  };
  await Bun.write(gatewayStatePath(paths), `${JSON.stringify(state, undefined, 2)}\n`);

  s.stop(`Gateway started (pid ${String(proc.pid)})`);
  console.log(`Socket: ${paths.socketPath}`);
  console.log(`Log:    ${logPath}`);
}
