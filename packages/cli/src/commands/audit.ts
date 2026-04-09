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

function parseAuditListLimit(args: string[]): number {
  let limit = 50;
  const q = [...args];
  while (q.length > 0) {
    const a = q.shift();
    if (a === "--limit") {
      const v = q.shift();
      if (v !== undefined) {
        limit = Number.parseInt(v, 10);
      }
      continue;
    }
  }
  if (!Number.isFinite(limit) || limit < 1) {
    return 50;
  }
  return limit;
}

export async function runAudit(args: string[]): Promise<void> {
  const limit = parseAuditListLimit(args);

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
        // Skip malformed action_json; keep default reason.
      }
      console.log(
        `${ts.padEnd(20)} ${r.actionType.padEnd(22)} ${r.hitlStatus.padEnd(14)} ${reason}`,
      );
    }
  } finally {
    await client.disconnect();
  }
}
