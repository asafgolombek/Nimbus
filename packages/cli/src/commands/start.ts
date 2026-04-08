import { spinner } from "@clack/prompts";

import {
  ensureGatewayDirs,
  gatewayStatePath,
  isProcessAlive,
  readGatewayState,
} from "../lib/gateway-process.ts";
import { getRepoRoot } from "../lib/repo-root.ts";
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

  const repoRoot = getRepoRoot();
  const logPath = `${paths.logDir}/gateway.log`;
  const logFile = Bun.file(logPath);

  const proc = Bun.spawn({
    cmd: [process.execPath, "run", "packages/gateway/src/index.ts"],
    cwd: repoRoot,
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
