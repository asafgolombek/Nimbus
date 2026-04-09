import { unlink } from "node:fs/promises";

import { spinner } from "@clack/prompts";

import { gatewayStatePath, readGatewayState } from "../lib/gateway-process.ts";
import { getCliPlatformPaths } from "../paths.ts";

export async function runStop(_args: string[]): Promise<void> {
  const paths = getCliPlatformPaths();
  const state = await readGatewayState(paths);
  if (state === undefined) {
    console.log("No gateway state found (is it running?).");
    return;
  }

  const s = spinner();
  s.start("Stopping Gateway");

  try {
    process.kill(state.pid, "SIGTERM");
  } catch {
    /* process may already be gone */
  }

  try {
    await unlink(gatewayStatePath(paths));
  } catch {
    /* ignore */
  }

  s.stop("Stop signal sent");
}
