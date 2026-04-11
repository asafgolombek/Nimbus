import { IPCClient } from "../ipc-client/index.ts";
import { readGatewayState } from "../lib/gateway-process.ts";
import { getCliPlatformPaths } from "../paths.ts";

export async function runStatus(_args: string[]): Promise<void> {
  const paths = getCliPlatformPaths();
  const state = await readGatewayState(paths);
  if (state === undefined) {
    console.log("Gateway: not running (no state file)");
    return;
  }

  const client = new IPCClient(state.socketPath);
  try {
    await client.connect();
    const ping = await client.call<{ version: string; uptime: number }>("gateway.ping");
    console.log(`Gateway: running (pid ${String(state.pid)})`);
    console.log(`Version: ${ping.version}`);
    console.log(`Uptime:  ${String(Math.round(ping.uptime / 1000))}s`);
    console.log(`Socket:  ${state.socketPath}`);
    if (state.logPath !== undefined && state.logPath !== "") {
      console.log(`Log:     ${state.logPath}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`Gateway: state exists but IPC failed — ${msg}`);
  } finally {
    await client.disconnect().catch(() => {});
  }
}
