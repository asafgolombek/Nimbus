import { IPCClient } from "../ipc-client/index.ts";
import { readGatewayState } from "../lib/gateway-process.ts";
import { getCliPlatformPaths } from "../paths.ts";

export async function runStatus(args: string[]): Promise<void> {
  const paths = getCliPlatformPaths();
  const state = await readGatewayState(paths);
  if (state === undefined) {
    console.log("Gateway: not running (no state file)");
    return;
  }

  const wantDrift = args.includes("--drift");

  const client = new IPCClient(state.socketPath);
  try {
    await client.connect();
    const ping = await client.call<{
      version: string;
      uptime: number;
      embeddingBackfill?: { done: number; total: number } | null;
      drift?: { lines: string[] };
    }>("gateway.ping", wantDrift ? { includeDrift: true } : {});
    console.log(`Gateway: running (pid ${String(state.pid)})`);
    console.log(`Version: ${ping.version}`);
    console.log(`Uptime:  ${String(Math.round(ping.uptime / 1000))}s`);
    const emb = ping.embeddingBackfill;
    if (emb !== undefined && emb !== null && emb.total > 0) {
      console.log(`Embedding backfill: ${String(emb.done)} / ${String(emb.total)}`);
    }
    if (wantDrift && ping.drift !== undefined && Array.isArray(ping.drift.lines)) {
      console.log("");
      console.log("Drift hints (indexed counts / IaC snapshot — not full state reconciliation):");
      for (const line of ping.drift.lines) {
        console.log(`  ${line}`);
      }
    }
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
