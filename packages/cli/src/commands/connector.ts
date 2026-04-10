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

type SyncTelemetryEntry = {
  startedAt: number;
  durationMs: number;
  itemsUpserted: number;
  itemsDeleted: number;
  bytesTransferred: number | null;
  hadMore: boolean;
  errorMsg: string | null;
};

type SyncStatusWithTelemetry = SyncStatus & { telemetry?: SyncTelemetryEntry[] };

type ConnectorFlags = {
  rest: string[];
  port?: number;
  scopes?: string[];
  token?: string;
  username?: string;
  apiBase?: string;
  full?: boolean;
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

function fmtNextSync(ms: number | null): string {
  if (ms === null) {
    return "—";
  }
  const delta = ms - Date.now();
  if (delta <= 0) {
    return "due";
  }
  const sec = Math.floor(delta / 1000);
  if (sec < 60) {
    return `in ${String(sec)}s`;
  }
  if (sec < 3600) {
    return `in ${String(Math.floor(sec / 60))}m`;
  }
  if (sec < 86400) {
    return `in ${String(Math.floor(sec / 3600))}h`;
  }
  return `in ${String(Math.floor(sec / 86400))}d`;
}

function truncateText(s: string, maxLen: number): string {
  if (s.length <= maxLen) {
    return s;
  }
  if (maxLen <= 1) {
    return "…";
  }
  return `${s.slice(0, maxLen - 1)}…`;
}

function parseFlags(args: string[]): ConnectorFlags {
  const rest: string[] = [];
  let port: number | undefined;
  let scopes: string[] | undefined;
  let token: string | undefined;
  let username: string | undefined;
  let apiBase: string | undefined;
  let full: boolean | undefined;
  const q = [...args];

  while (q.length > 0) {
    const a = q.shift();
    if (a === undefined) {
      break;
    }
    if (a === "--port" || a === "-p") {
      const v = q.shift();
      if (v === undefined) {
        throw new Error("Missing value for --port");
      }
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 65_535) {
        throw new Error("Invalid --port");
      }
      port = n;
      continue;
    }
    if (a === "--scopes" || a === "-s") {
      const v = q.shift();
      if (v === undefined) {
        throw new Error("Missing value for --scopes");
      }
      scopes = v
        .split(",")
        .map((x) => x.trim())
        .filter((x) => x.length > 0);
      continue;
    }
    if (a === "--token" || a === "-t") {
      const v = q.shift();
      if (v === undefined) {
        throw new Error("Missing value for --token");
      }
      if (v.trim() === "") {
        throw new Error("Invalid --token (empty)");
      }
      token = v.trim();
      continue;
    }
    if (a === "--username" || a === "-u") {
      const v = q.shift();
      if (v === undefined) {
        throw new Error("Missing value for --username");
      }
      if (v.trim() === "") {
        throw new Error("Invalid --username (empty)");
      }
      username = v.trim();
      continue;
    }
    if (a === "--full") {
      full = true;
      continue;
    }
    if (a === "--api-base") {
      const v = q.shift();
      if (v === undefined) {
        throw new Error("Missing value for --api-base");
      }
      if (v.trim() === "") {
        throw new Error("Invalid --api-base (empty)");
      }
      apiBase = v.trim().replace(/\/+$/, "");
      continue;
    }
    rest.push(a);
  }

  const out: ConnectorFlags = { rest };
  if (port !== undefined) {
    out.port = port;
  }
  if (scopes !== undefined) {
    out.scopes = scopes;
  }
  if (token !== undefined) {
    out.token = token;
  }
  if (username !== undefined) {
    out.username = username;
  }
  if (apiBase !== undefined) {
    out.apiBase = apiBase;
  }
  if (full !== undefined) {
    out.full = full;
  }
  return out;
}

function padField(s: string, w: number): string {
  return s.length >= w ? s : s + " ".repeat(w - s.length);
}

function repeatChar(ch: string, n: number): string {
  return ch.repeat(Math.max(0, n));
}

async function runConnectorAuth(tail: string[]): Promise<void> {
  const { rest, port, scopes, token, username, apiBase } = parseFlags(tail);
  const service = rest[0];
  if (service === undefined) {
    throw new Error(
      "Usage: nimbus connector auth <service> [--port <n>] [--scopes a,b] [--token <pat>] [--username <u>] [--api-base <url>]",
    );
  }
  const params: {
    service: string;
    port?: number;
    scopes?: string[];
    personalAccessToken?: string;
    bitbucketUsername?: string;
    apiBaseUrl?: string;
  } = { service };
  if (port !== undefined) {
    params.port = port;
  }
  if (scopes !== undefined) {
    params.scopes = scopes;
  }
  const normalized = service.trim().toLowerCase().replaceAll("-", "_");
  if (normalized === "linear") {
    const apiKey = token ?? process.env["NIMBUS_LINEAR_API_KEY"]?.trim();
    if (apiKey === undefined || apiKey === "") {
      throw new Error(
        "Linear requires an API key: nimbus connector auth linear --token <key>  (or set NIMBUS_LINEAR_API_KEY)",
      );
    }
    params.personalAccessToken = apiKey;
  }
  if (normalized === "github") {
    const pat = token ?? process.env["NIMBUS_GITHUB_PAT"]?.trim();
    if (pat === undefined || pat === "") {
      throw new Error(
        "GitHub requires a PAT: nimbus connector auth github --token <pat>  (or set NIMBUS_GITHUB_PAT in the environment)",
      );
    }
    params.personalAccessToken = pat;
  }
  if (normalized === "gitlab") {
    const pat = token ?? process.env["NIMBUS_GITLAB_PAT"]?.trim();
    if (pat === undefined || pat === "") {
      throw new Error(
        "GitLab requires a PAT: nimbus connector auth gitlab --token <pat>  (or set NIMBUS_GITLAB_PAT in the environment)",
      );
    }
    params.personalAccessToken = pat;
    if (apiBase !== undefined) {
      params.apiBaseUrl = apiBase;
    }
  }
  if (normalized === "bitbucket") {
    const u =
      username ??
      process.env["NIMBUS_BITBUCKET_USERNAME"]?.trim() ??
      process.env["BITBUCKET_USERNAME"]?.trim();
    if (u === undefined || u === "") {
      throw new Error(
        "Bitbucket requires username: nimbus connector auth bitbucket --username <atlassian_username> --token <app_password>  (or set NIMBUS_BITBUCKET_USERNAME)",
      );
    }
    const appPass = token ?? process.env["NIMBUS_BITBUCKET_APP_PASSWORD"]?.trim();
    if (appPass === undefined || appPass === "") {
      throw new Error(
        "Bitbucket requires an app password: nimbus connector auth bitbucket --username ... --token <app_password>  (or set NIMBUS_BITBUCKET_APP_PASSWORD)",
      );
    }
    params.bitbucketUsername = u;
    params.personalAccessToken = appPass;
  }
  const res = await withIpc((c) =>
    c.call<{ ok: boolean; serviceId: string; scopesGranted: string[] }>("connector.auth", params),
  );
  console.log(`Signed in: ${res.serviceId}`);
  if (
    res.serviceId === "github" ||
    res.serviceId === "gitlab" ||
    res.serviceId === "bitbucket" ||
    res.serviceId === "linear"
  ) {
    console.log("Credential: stored in the OS vault (no OAuth scopes).");
  } else {
    console.log(`Scopes: ${res.scopesGranted.join(", ")}`);
  }
}

async function runConnectorList(): Promise<void> {
  const rows = await withIpc((c) => c.call<SyncStatus[]>("connector.listStatus"));
  if (rows.length === 0) {
    console.log("No connectors registered yet. Use: nimbus connector auth <service>");
    return;
  }
  const errCap = 48;
  const wService = Math.max(10, "SERVICE".length, ...rows.map((r) => r.serviceId.length));
  const wStatus = Math.max(8, "STATUS".length, ...rows.map((r) => r.status.length));
  const wLast = Math.max(10, "LAST SYNC".length, ...rows.map((r) => relTime(r.lastSyncAt).length));
  const wNext = Math.max(
    10,
    "NEXT SYNC".length,
    ...rows.map((r) => fmtNextSync(r.nextSyncAt).length),
  );
  const wItems = Math.max(5, "ITEMS".length, ...rows.map((r) => String(r.itemCount).length));
  const wFail = Math.max(
    4,
    "FAIL".length,
    ...rows.map((r) => String(r.consecutiveFailures).length),
  );

  const head = `${padField("SERVICE", wService)}  ${padField("STATUS", wStatus)}  ${padField("LAST SYNC", wLast)}  ${padField("NEXT SYNC", wNext)}  ${padField("ITEMS", wItems)}  ${padField("FAIL", wFail)}  ERROR`;
  const ruleLen = head.length + errCap;
  console.log(head);
  console.log(repeatChar("─", ruleLen));
  for (const r of rows) {
    const errRaw = r.lastError ?? "—";
    const err = truncateText(errRaw, errCap);
    const line = `${padField(r.serviceId, wService)}  ${padField(r.status, wStatus)}  ${padField(relTime(r.lastSyncAt), wLast)}  ${padField(fmtNextSync(r.nextSyncAt), wNext)}  ${padField(String(r.itemCount), wItems)}  ${padField(String(r.consecutiveFailures), wFail)}  ${err}`;
    console.log(line);
  }
}

async function runConnectorPause(service: string): Promise<void> {
  await withIpc((c) => c.call("connector.pause", { serviceId: service }));
  console.log(`Paused: ${service}`);
}

async function runConnectorResume(service: string): Promise<void> {
  await withIpc((c) => c.call("connector.resume", { serviceId: service }));
  console.log(`Resumed: ${service}`);
}

function parseStatusArgs(tail: string[]): { service: string; stats: boolean } {
  let stats = false;
  const rest: string[] = [];
  for (const a of tail) {
    if (a === "--stats") {
      stats = true;
      continue;
    }
    rest.push(a);
  }
  const service = rest[0];
  if (service === undefined) {
    throw new Error("Usage: nimbus connector status <service> [--stats]");
  }
  return { service, stats };
}

async function runConnectorStatusParsed(service: string, stats: boolean): Promise<void> {
  const params: { serviceId: string; includeStats?: boolean } = { serviceId: service };
  if (stats) {
    params.includeStats = true;
  }
  const row = await withIpc((c) => c.call<SyncStatusWithTelemetry>("connector.status", params));
  console.log(JSON.stringify(row, null, 2));
}

async function runConnectorLifecycle(sub: string, tail: string[]): Promise<void> {
  if (sub === "status") {
    const { service, stats } = parseStatusArgs(tail);
    await runConnectorStatusParsed(service, stats);
    return;
  }
  const service = tail[0];
  if (service === undefined) {
    throw new Error(`Usage: nimbus connector ${sub} <service>`);
  }
  if (sub === "pause") {
    await runConnectorPause(service);
    return;
  }
  if (sub === "resume") {
    await runConnectorResume(service);
    return;
  }
}

async function runConnectorSetInterval(tail: string[]): Promise<void> {
  const service = tail[0];
  const dur = tail[1];
  if (service === undefined || dur === undefined) {
    throw new Error("Usage: nimbus connector set-interval <service> <duration>  (e.g. 5m, 1h)");
  }
  const ms = parseDurationToMs(dur);
  await withIpc((c) => c.call("connector.setInterval", { serviceId: service, intervalMs: ms }));
  console.log(`Interval set: ${service} → ${dur} (${String(ms)} ms)`);
}

async function runConnectorSync(tail: string[]): Promise<void> {
  const { rest, full } = parseFlags(tail);
  const service = rest[0];
  if (service === undefined) {
    throw new Error("Usage: nimbus connector sync <service> [--full]");
  }
  let syncParams: { serviceId: string; full?: boolean };
  if (full === true) {
    syncParams = { serviceId: service, full: true };
  } else {
    syncParams = { serviceId: service };
  }
  await withIpc((c) => c.call("connector.sync", syncParams));
  const suffix = full === true ? " (full)" : "";
  console.log(`Sync requested: ${service}${suffix}`);
}

async function runConnectorRemove(tail: string[]): Promise<void> {
  const service = tail[0];
  if (service === undefined) {
    throw new Error("Usage: nimbus connector remove <service>");
  }
  const res = await withIpc((c) =>
    c.call<{ ok: boolean; itemsDeleted: number; vaultKeysRemoved: string[] }>("connector.remove", {
      serviceId: service,
    }),
  );
  console.log(`Removed index rows: ${String(res.itemsDeleted)}`);
  if (res.vaultKeysRemoved.length > 0) {
    console.log(`Cleared vault keys: ${res.vaultKeysRemoved.join(", ")}`);
  }
}

export async function runConnector(args: string[]): Promise<void> {
  const sub = args[0];
  const tail = args.slice(1);

  if (sub === undefined || sub === "help" || sub === "--help" || sub === "-h") {
    printConnectorHelp();
    return;
  }

  if (sub === "auth") {
    await runConnectorAuth(tail);
    return;
  }
  if (sub === "list") {
    await runConnectorList();
    return;
  }
  if (sub === "pause" || sub === "resume" || sub === "status") {
    await runConnectorLifecycle(sub, tail);
    return;
  }
  if (sub === "set-interval") {
    await runConnectorSetInterval(tail);
    return;
  }
  if (sub === "sync") {
    await runConnectorSync(tail);
    return;
  }
  if (sub === "remove") {
    await runConnectorRemove(tail);
    return;
  }

  throw new Error(`Unknown connector subcommand: ${sub}. Try: nimbus connector help`);
}

function printConnectorHelp(): void {
  console.log(`nimbus connector — cloud connector registration and sync (Q2)

Usage:
  nimbus connector auth <service> [--port <n>] [--scopes a,b] [--token <pat>] [--api-base <url>]
  nimbus connector list
  nimbus connector status <service> [--stats]
  nimbus connector sync <service> [--full]
  nimbus connector pause <service>
  nimbus connector resume <service>
  nimbus connector set-interval <service> <duration>
  nimbus connector remove <service>

Services (examples): google_drive, gmail, google_photos, onedrive, outlook, teams, github, gitlab, linear

OAuth client ids (required for Google/Microsoft auth):
  NIMBUS_OAUTH_GOOGLE_CLIENT_ID
  NIMBUS_OAUTH_MICROSOFT_CLIENT_ID

GitHub: use --token or env NIMBUS_GITHUB_PAT (stored as vault key github.pat).
GitLab: use --token or env NIMBUS_GITLAB_PAT (gitlab.pat). Self-hosted: --api-base https://git.example.com/api/v4 (gitlab.api_base).
Linear: use --token or env NIMBUS_LINEAR_API_KEY (linear.api_key).

Credentials are stored in the OS vault only (never printed here).
`);
}
