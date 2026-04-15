import { spinner } from "@clack/prompts";

import { ensureGatewayDirs, isProcessAlive, readGatewayState } from "../lib/gateway-process.ts";
import { spawnGateway } from "../lib/spawn-gateway.ts";
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

  try {
    const { pid, logPath } = await spawnGateway(paths);
    s.stop(`Gateway started (pid ${String(pid)})`);
    console.log(`Socket: ${paths.socketPath}`);
    console.log(`Log:    ${logPath}`);
  } catch (e) {
    s.stop("Could not start Gateway");
    const msg = e instanceof Error ? e.message : String(e);
    console.error(msg);
    process.exitCode = 1;
  }
}
