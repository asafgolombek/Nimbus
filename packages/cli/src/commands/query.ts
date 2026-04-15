import { parseSinceDurationToMs } from "../lib/parse-since.ts";
import { withGatewayIpc } from "../lib/with-gateway-ipc.ts";

function takeFlag(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i < 0 || i + 1 >= args.length) {
    return undefined;
  }
  return args[i + 1];
}

export async function runQuery(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === "help" || args[0] === "--help" || args[0] === "-h") {
    console.log(`nimbus query — structured index reads (Gateway IPC)

Usage:
  nimbus query --service <id> [--type <t>] [--since 7d] [--limit N] [--json | --pretty]
  nimbus query --sql "SELECT ..." [--json | --pretty]   (read-only guard)
`);
    return;
  }

  const sql = takeFlag(args, "--sql");
  const wantJson = args.includes("--json");
  const pretty = args.includes("--pretty");

  if (sql !== undefined) {
    const r = await withGatewayIpc((c) =>
      c.call<{ rows: Record<string, unknown>[]; meta: { count: number } }>("index.querySql", {
        sql,
      }),
    );
    printRows(r.rows, wantJson, pretty);
    return;
  }

  const service = takeFlag(args, "--service");
  if (service === undefined || service === "") {
    throw new Error("Missing --service (or use --sql for guarded SELECT)");
  }
  const type = takeFlag(args, "--type");
  const sinceRaw = takeFlag(args, "--since");
  const limitRaw = takeFlag(args, "--limit");
  const limit = limitRaw === undefined ? Number.NaN : Number.parseInt(limitRaw, 10);

  let sinceMs: number | undefined;
  if (sinceRaw !== undefined) {
    sinceMs = Date.now() - parseSinceDurationToMs(sinceRaw);
  }

  const params: {
    services: string[];
    types?: string[];
    sinceMs?: number;
    limit: number;
  } = {
    services: [service],
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(1000, limit) : 50,
  };
  if (sinceMs !== undefined) {
    params.sinceMs = sinceMs;
  }
  if (type !== undefined && type !== "") {
    params.types = [type];
  }

  const r = await withGatewayIpc((c) =>
    c.call<{ items: Record<string, unknown>[]; meta: { limit: number; total: number } }>(
      "index.queryItems",
      params,
    ),
  );
  printRows(r.items, wantJson, pretty);
}

function formatQueryCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
    case "bigint":
      return String(value);
    case "symbol":
      return value.toString();
    case "object":
      return JSON.stringify(value);
    default:
      return "";
  }
}

function printRows(rows: Record<string, unknown>[], wantJson: boolean, pretty: boolean): void {
  if (wantJson || !pretty) {
    console.log(JSON.stringify(rows, null, wantJson ? 2 : 0));
    return;
  }
  if (rows.length === 0) {
    console.log("(no rows)");
    return;
  }
  const keys = Object.keys(rows[0] ?? {});
  console.log(keys.join("\t"));
  for (const row of rows) {
    console.log(keys.map((k) => formatQueryCell(row[k])).join("\t"));
  }
}
