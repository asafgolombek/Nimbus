#!/usr/bin/env bun
/**
 * Stop the Nimbus gateway: gateway.json PID + state file, then terminate any stray
 * `nimbus-gateway` / `nimbus-gateway.exe` process (covers missing state file).
 *
 * Run from repo root: `bun scripts/kill-gateway.ts`
 * Or: `bun run kill-gateway`
 */
import { unlink } from "node:fs/promises";

import { gatewayStatePath, readGatewayState } from "../packages/cli/src/lib/gateway-process.ts";
import { getCliPlatformPaths } from "../packages/cli/src/paths.ts";
import { terminateCompiledGatewayBinary } from "../packages/gateway/terminate-gateway-binary.ts";

async function main(): Promise<void> {
  const paths = getCliPlatformPaths();
  const state = await readGatewayState(paths);
  if (state === undefined) {
    process.stdout.write("No gateway state file (gateway.json).\n");
  } else {
    try {
      process.kill(state.pid, "SIGTERM");
      process.stdout.write(`Stop signal sent to gateway (pid ${String(state.pid)})\n`);
    } catch {
      /* process may already be gone */
    }
    try {
      await unlink(gatewayStatePath(paths));
    } catch {
      /* ignore */
    }
  }

  const t = terminateCompiledGatewayBinary();
  process.stdout.write(`${t.message}\n`);
}

await main();
