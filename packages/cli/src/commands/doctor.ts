import { platform } from "node:os";

import { IPCClient } from "../ipc-client/index.ts";
import { gatewayStatePath, isProcessAlive, readGatewayState } from "../lib/gateway-process.ts";
import { getCliPlatformPaths } from "../paths.ts";

const LINUX_SECRET_TOOL_HINT =
  "secret-tool not found. Install libsecret-tools (Debian/Ubuntu) or libsecret (Fedora/Arch) to use the OS vault on Linux.";

const MIN_BUN_MAJOR = 1;
const MIN_BUN_MINOR = 2;

function bunVersionOk(): boolean {
  const m = /^(\d+)\.(\d+)\./.exec(Bun.version);
  if (m === null) {
    return true;
  }
  const major = Number(m[1]);
  const minor = Number(m[2]);
  return major > MIN_BUN_MAJOR || (major === MIN_BUN_MAJOR && minor >= MIN_BUN_MINOR);
}

type ConnectorHealthRow = {
  connectorId?: unknown;
  state?: unknown;
};

function worstHealthSeverity(rows: ConnectorHealthRow[]): "ok" | "warn" | "fail" {
  let worst: "ok" | "warn" | "fail" = "ok";
  for (const r of rows) {
    const st = typeof r.state === "string" ? r.state : "";
    if (st === "unauthenticated" || st === "error") {
      worst = "fail";
    } else if (st === "degraded" || st === "rate_limited") {
      if (worst === "ok") {
        worst = "warn";
      }
    }
  }
  return worst;
}

function healthStateMark(st: string): string {
  if (st === "healthy" || st === "paused") {
    return "[ok]";
  }
  if (st === "unauthenticated" || st === "error") {
    return "[fail]";
  }
  return "[warn]";
}

export async function runDoctor(_args: string[]): Promise<void> {
  let exit = 0;
  const paths = getCliPlatformPaths();

  console.log(`Runtime: Bun ${Bun.version}`);
  if (!bunVersionOk()) {
    console.log(
      `[fail] Nimbus expects Bun >= ${String(MIN_BUN_MAJOR)}.${String(MIN_BUN_MINOR)} (see repository README).`,
    );
    exit = Math.max(exit, 2);
  } else {
    console.log("[ok] Bun version meets minimum.");
  }

  console.log(`Data dir: ${paths.dataDir}`);
  console.log(`Gateway state file: ${gatewayStatePath(paths)}`);

  if (platform() === "linux") {
    if (Bun.which("secret-tool") === null) {
      console.log(`[fail] Vault: ${LINUX_SECRET_TOOL_HINT}`);
      exit = Math.max(exit, 2);
    } else {
      console.log("[ok] Vault: secret-tool is on PATH.");
    }
  } else {
    console.log(`[ok] Vault: OS-native store (${platform()}) — no Linux secret-tool check.`);
  }

  const state = await readGatewayState(paths);
  if (state === undefined) {
    console.log("[fail] Gateway: not running (no gateway.json — start with: nimbus start).");
    exit = Math.max(exit, 2);
  } else if (!isProcessAlive(state.pid)) {
    console.log(
      `[fail] Gateway: stale state (pid ${String(state.pid)} is not running) — try nimbus stop or remove the state file.`,
    );
    exit = Math.max(exit, 2);
  } else {
    const client = new IPCClient(state.socketPath);
    try {
      await client.connect();
      const ping = await client.call<{ uptime?: number }>("gateway.ping", {});
      const uptime =
        typeof ping.uptime === "number" && Number.isFinite(ping.uptime) ? ping.uptime : 0;
      console.log(`[ok] Gateway: IPC OK (uptime ~${String(Math.round(uptime / 1000))}s).`);

      const val = await client.call<{ ok: boolean; errors: string[]; warnings: string[] }>(
        "config.validate",
        {},
      );
      if (val.warnings.length > 0) {
        for (const w of val.warnings) {
          console.log(`[warn] Config: ${w}`);
        }
        exit = Math.max(exit, 1);
      }
      if (!val.ok) {
        for (const e of val.errors) {
          console.log(`[fail] Config: ${e}`);
        }
        exit = Math.max(exit, 2);
      } else if (val.errors.length === 0 && val.warnings.length === 0) {
        console.log("[ok] Config: valid.");
      }

      const snap = await client.call<{
        index?: { totalItems?: unknown };
        connectorHealth?: unknown;
      }>("diag.snapshot", {});
      const total = snap.index?.totalItems;
      const nItems =
        typeof total === "number" && Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
      if (nItems === 0) {
        console.log("[warn] Index: zero items — run connector sync after auth.");
        exit = Math.max(exit, 1);
      } else {
        console.log(`[ok] Index: ${String(nItems)} items.`);
      }

      const healthRaw = snap.connectorHealth;
      const health: ConnectorHealthRow[] = Array.isArray(healthRaw)
        ? (healthRaw as ConnectorHealthRow[])
        : [];
      if (health.length === 0) {
        console.log("[warn] Connectors: none registered.");
        exit = Math.max(exit, 1);
      } else {
        console.log("Connector health:");
        for (const h of health) {
          const id = typeof h.connectorId === "string" ? h.connectorId : "?";
          const st = typeof h.state === "string" ? h.state : "?";
          const mark = healthStateMark(st);
          console.log(`  ${mark} ${id}: ${st}`);
        }
        const sev = worstHealthSeverity(health);
        if (sev === "fail") {
          exit = Math.max(exit, 1);
        } else if (sev === "warn") {
          exit = Math.max(exit, 1);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`[fail] Gateway: IPC failed — ${msg}`);
      exit = Math.max(exit, 2);
    } finally {
      await client.disconnect().catch(() => {});
    }
  }

  process.exitCode = exit;
}
