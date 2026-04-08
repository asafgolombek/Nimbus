import { IPCClient } from "../ipc-client/index.ts";
import { readGatewayState } from "../lib/gateway-process.ts";
import { getCliPlatformPaths } from "../paths.ts";

type AuditRow = {
  id: number;
  actionType: string;
  hitlStatus: string;
  actionJson: string;
  timestamp: number;
};

export async function runAudit(args: string[]): Promise<void> {
  let limit = 50;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--limit" && args[i + 1] !== undefined) {
      limit = Number.parseInt(args[i + 1] ?? "", 10);
      i += 1;
    }
  }
  if (!Number.isFinite(limit) || limit < 1) {
    limit = 50;
  }

  const paths = getCliPlatformPaths();
  const state = await readGatewayState(paths);
  if (state === undefined) {
    throw new Error("Gateway is not running. Start with: nimbus start");
  }
  const client = new IPCClient(state.socketPath);
  await client.connect();
  try {
    const rows = await client.call<AuditRow[]>("audit.list", { limit });
    console.log(`${"Timestamp".padEnd(20)} ${"Action".padEnd(22)} ${"Status".padEnd(14)} Reason`);
    console.log("-".repeat(72));
    for (const r of rows) {
      const ts = new Date(r.timestamp).toISOString().replace("T", " ").slice(0, 19);
      let reason = "—";
      try {
        const j: unknown = JSON.parse(r.actionJson) as unknown;
        if (j !== null && typeof j === "object" && !Array.isArray(j)) {
          const hitl = (j as { hitlRejectReason?: unknown }).hitlRejectReason;
          if (typeof hitl === "string") {
            reason = hitl;
          }
        }
      } catch {
        /* ignore */
      }
      console.log(
        `${ts.padEnd(20)} ${r.actionType.padEnd(22)} ${r.hitlStatus.padEnd(14)} ${reason}`,
      );
    }
  } finally {
    await client.disconnect();
  }
}
