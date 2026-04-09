import { IPCClient } from "../ipc-client/index.ts";
import { readGatewayState } from "../lib/gateway-process.ts";
import { parseDurationToMs } from "../lib/parse-duration.ts";
import { getCliPlatformPaths } from "../paths.ts";

type SyncStatus = {
  serviceId: string;
  status: string;
  lastSyncAt: number | null;
  nextSyncAt: number | null;
  intervalMs: number;
  itemCount: number;
  lastError: string | null;
  consecutiveFailures: number;
};

async function withIpc<T>(fn: (c: IPCClient) => Promise<T>): Promise<T> {
  const paths = getCliPlatformPaths();
  const state = await readGatewayState(paths);
  if (state === undefined) {
    throw new Error("Gateway is not running. Start with: nimbus start");
  }
  const client = new IPCClient(state.socketPath);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.disconnect();
  }
}

function relTime(ms: number | null): string {
  if (ms === null) {
    return "—";
  }
  const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (sec < 60) {
    return `${String(sec)}s ago`;
  }
  if (sec < 3600) {
    return `${String(Math.floor(sec / 60))}m ago`;
  }
  if (sec < 86400) {
    return `${String(Math.floor(sec / 3600))}h ago`;
  }
  return `${String(Math.floor(sec / 86400))}d ago`;
}

function parseFlags(args: string[]): {
  rest: string[];
  port?: number;
  scopes?: string[];
  full?: boolean;
} {
  const rest: string[] = [];
  let port: number | undefined;
  let scopes: string[] | undefined;
  let full: boolean | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) {
      continue;
    }
    if (a === "--port" || a === "-p") {
      const v = args[i + 1];
      if (v === undefined) {
        throw new Error("Missing value for --port");
      }
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 65_535) {
        throw new Error("Invalid --port");
      }
      port = n;
      i++;
      continue;
    }
    if (a === "--scopes" || a === "-s") {
      const v = args[i + 1];
      if (v === undefined) {
        throw new Error("Missing value for --scopes");
      }
      scopes = v
        .split(",")
        .map((x) => x.trim())
        .filter((x) => x.length > 0);
      i++;
      continue;
    }
    if (a === "--full") {
      full = true;
      continue;
    }
    rest.push(a);
  }
  const out: { rest: string[]; port?: number; scopes?: string[]; full?: boolean } = { rest };
  if (port !== undefined) {
    out.port = port;
  }
  if (scopes !== undefined) {
    out.scopes = scopes;
  }
  if (full !== undefined) {
    out.full = full;
  }
  return out;
}

export async function runConnector(args: string[]): Promise<void> {
  const sub = args[0];
  const tail = args.slice(1);

  if (sub === undefined || sub === "help" || sub === "--help" || sub === "-h") {
    printConnectorHelp();
    return;
  }

  if (sub === "auth") {
    const { rest, port, scopes } = parseFlags(tail);
    const service = rest[0];
    if (service === undefined) {
      throw new Error("Usage: nimbus connector auth <service> [--port <n>] [--scopes a,b]");
    }
    const params: { service: string; port?: number; scopes?: string[] } = { service };
    if (port !== undefined) {
      params.port = port;
    }
    if (scopes !== undefined) {
      params.scopes = scopes;
    }
    const res = await withIpc((c) =>
      c.call<{ ok: boolean; serviceId: string; scopesGranted: string[] }>("connector.auth", params),
    );
    console.log(`Signed in: ${res.serviceId}`);
    console.log(`Scopes: ${res.scopesGranted.join(", ")}`);
    return;
  }

  if (sub === "list") {
    const rows = await withIpc((c) => c.call<SyncStatus[]>("connector.listStatus"));
    if (rows.length === 0) {
      console.log("No connectors registered yet. Use: nimbus connector auth <service>");
      return;
    }
    const pad = (s: string, w: number): string =>
      s.length >= w ? s : s + " ".repeat(w - s.length);
    const header = `${pad("SERVICE", 14)} ${pad("STATUS", 10)} ${pad("LAST SYNC", 12)} ${pad("ITEMS", 8)} ERROR`;
    console.log(header);
    for (const r of rows) {
      const err = r.lastError ?? "—";
      const line = `${pad(r.serviceId, 14)} ${pad(r.status, 10)} ${pad(relTime(r.lastSyncAt), 12)} ${pad(String(r.itemCount), 8)} ${err}`;
      console.log(line);
    }
    return;
  }

  if (sub === "pause" || sub === "resume" || sub === "status") {
    const service = tail[0];
    if (service === undefined) {
      throw new Error(`Usage: nimbus connector ${sub} <service>`);
    }
    if (sub === "pause") {
      await withIpc((c) => c.call("connector.pause", { serviceId: service }));
      console.log(`Paused: ${service}`);
      return;
    }
    if (sub === "resume") {
      await withIpc((c) => c.call("connector.resume", { serviceId: service }));
      console.log(`Resumed: ${service}`);
      return;
    }
    const row = await withIpc((c) =>
      c.call<SyncStatus>("connector.status", { serviceId: service }),
    );
    console.log(JSON.stringify(row, null, 2));
    return;
  }

  if (sub === "set-interval") {
    const service = tail[0];
    const dur = tail[1];
    if (service === undefined || dur === undefined) {
      throw new Error("Usage: nimbus connector set-interval <service> <duration>  (e.g. 5m, 1h)");
    }
    const ms = parseDurationToMs(dur);
    await withIpc((c) => c.call("connector.setInterval", { serviceId: service, intervalMs: ms }));
    console.log(`Interval set: ${service} → ${dur} (${String(ms)} ms)`);
    return;
  }

  if (sub === "sync") {
    const { rest, full } = parseFlags(tail);
    const service = rest[0];
    if (service === undefined) {
      throw new Error("Usage: nimbus connector sync <service> [--full]");
    }
    await withIpc((c) =>
      c.call(
        "connector.sync",
        full === true ? { serviceId: service, full: true } : { serviceId: service },
      ),
    );
    console.log(`Sync requested: ${service}${full === true ? " (full)" : ""}`);
    return;
  }

  if (sub === "remove") {
    const service = tail[0];
    if (service === undefined) {
      throw new Error("Usage: nimbus connector remove <service>");
    }
    const res = await withIpc((c) =>
      c.call<{ ok: boolean; itemsDeleted: number; vaultKeysRemoved: string[] }>(
        "connector.remove",
        {
          serviceId: service,
        },
      ),
    );
    console.log(`Removed index rows: ${String(res.itemsDeleted)}`);
    if (res.vaultKeysRemoved.length > 0) {
      console.log(`Cleared vault keys: ${res.vaultKeysRemoved.join(", ")}`);
    }
    return;
  }

  throw new Error(`Unknown connector subcommand: ${sub}. Try: nimbus connector help`);
}

function printConnectorHelp(): void {
  console.log(`nimbus connector — cloud connector registration and sync (Q2)

Usage:
  nimbus connector auth <service> [--port <n>] [--scopes a,b]
  nimbus connector list
  nimbus connector status <service>
  nimbus connector sync <service> [--full]
  nimbus connector pause <service>
  nimbus connector resume <service>
  nimbus connector set-interval <service> <duration>
  nimbus connector remove <service>

Services (examples): google_drive, gmail, google_photos, onedrive, outlook, teams

OAuth client ids (required for auth):
  NIMBUS_OAUTH_GOOGLE_CLIENT_ID
  NIMBUS_OAUTH_MICROSOFT_CLIENT_ID

Credentials are stored in the OS vault only (never printed here).
`);
}
