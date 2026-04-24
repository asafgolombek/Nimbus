import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { getNimbusPaths } from "./paths.js";
import type { NimbusPaths } from "./paths.js";

export type GatewayStateFile = {
  pid: number;
  socketPath: string;
  logPath?: string;
};

export type SocketDiscoveryResult = {
  socketPath: string;
  source: "override" | "stateFile" | "default";
  pid?: number;
};

function isGatewayState(raw: unknown): raw is GatewayStateFile {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return false;
  const o = raw as Record<string, unknown>;
  if (typeof o.pid !== "number" || !Number.isFinite(o.pid)) return false;
  if (typeof o.socketPath !== "string") return false;
  if (o.logPath !== undefined && typeof o.logPath !== "string") return false;
  return true;
}

export function gatewayStatePath(paths: NimbusPaths): string {
  return join(paths.dataDir, "gateway.json");
}

export async function readGatewayState(
  paths: NimbusPaths,
): Promise<GatewayStateFile | undefined> {
  const p = gatewayStatePath(paths);
  if (!existsSync(p)) return undefined;
  try {
    const raw = JSON.parse(await readFile(p, "utf8")) as unknown;
    if (!isGatewayState(raw)) return undefined;
    const out: GatewayStateFile = { pid: raw.pid, socketPath: raw.socketPath };
    if (typeof raw.logPath === "string" && raw.logPath !== "") out.logPath = raw.logPath;
    return out;
  } catch {
    return undefined;
  }
}

export async function discoverSocketPath(opts?: {
  override?: string;
  paths?: NimbusPaths;
}): Promise<SocketDiscoveryResult> {
  if (opts?.override !== undefined && opts.override.length > 0) {
    return { socketPath: opts.override, source: "override" };
  }
  const paths = opts?.paths ?? getNimbusPaths();
  const state = await readGatewayState(paths);
  if (state !== undefined) {
    return { socketPath: state.socketPath, source: "stateFile", pid: state.pid };
  }
  return { socketPath: paths.socketPath, source: "default" };
}
