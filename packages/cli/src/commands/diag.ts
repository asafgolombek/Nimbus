import { parseSinceDurationToMs } from "../lib/parse-since.ts";
import { withGatewayIpc } from "../lib/with-gateway-ipc.ts";

function takeFlag(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i < 0 || i + 1 >= args.length) {
    return undefined;
  }
  return args[i + 1];
}

export async function runDiag(args: string[]): Promise<void> {
  const sub = args[0];
  const tail = args.slice(1);
  if (sub === "help" || sub === "--help" || sub === "-h") {
    console.log(`nimbus diag — Gateway diagnostics snapshot (JSON)

Usage:
  nimbus diag [--json]              Full snapshot (pretty-printed JSON)
  nimbus diag slow-queries [--limit N] [--since 7d]
`);
    return;
  }

  if (sub === undefined || sub === "--json") {
    const snap = await withGatewayIpc((c) => c.call<unknown>("diag.snapshot", {}));
    console.log(JSON.stringify(snap, null, 2));
    return;
  }

  if (sub === "slow-queries") {
    const limitRaw = takeFlag(tail, "--limit");
    const limit = limitRaw === undefined ? Number.NaN : Number.parseInt(limitRaw, 10);
    const sinceArg = takeFlag(tail, "--since");
    let sinceMs = 0;
    if (sinceArg !== undefined) {
      sinceMs = Date.now() - parseSinceDurationToMs(sinceArg);
    }
    const r = await withGatewayIpc((c) =>
      c.call<{ rows: Record<string, unknown>[] }>("diag.slowQueries", {
        limit: Number.isFinite(limit) && limit > 0 ? limit : 50,
        sinceMs,
      }),
    );
    console.log(JSON.stringify(r.rows, null, 2));
    return;
  }

  throw new Error(`Unknown diag subcommand: ${sub ?? ""}. Try: nimbus diag help`);
}
