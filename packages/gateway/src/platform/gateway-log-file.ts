/**
 * Daily gateway log path and Pino factory. Basename must stay in sync with
 * `packages/cli/src/lib/spawn-gateway.ts` (`gatewayLogBasename`).
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { platform } from "node:os";
import { join } from "node:path";
import type { Logger } from "pino";
import pino from "pino";

import { processEnvGet } from "./env-access.ts";
import { createDarwinPaths, createLinuxPaths, createWindowsPaths } from "./paths.ts";

/** Keep in sync with `packages/cli/src/lib/spawn-gateway.ts` — local calendar date, append same file per day. */
export function gatewayLogBasename(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `gateway-${String(y)}-${m}-${day}.log`;
}

export function gatewayDailyLogPath(logDir: string): string {
  return join(logDir, gatewayLogBasename());
}

const PINO_REDACT_PATHS: readonly string[] = [
  "*.token",
  "*.secret",
  "oauth.*",
  "*.password",
  "*.key",
];

const ALLOWED_LEVELS = new Set<string>([
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
]);

function resolveLogLevel(): string {
  const raw = processEnvGet("NIMBUS_LOG_LEVEL");
  if (raw !== undefined && raw !== "" && ALLOWED_LEVELS.has(raw)) {
    return raw;
  }
  return "warn";
}

/**
 * Pino logger: always appends JSON lines to the daily file under `logDir`.
 * When stdout is a TTY, also mirrors to stdout for local development.
 */
export function createGatewayPinoLogger(logDir: string): Logger {
  const level = resolveLogLevel();
  const logPath = gatewayDailyLogPath(logDir);
  const baseOpts = {
    level,
    redact: [...PINO_REDACT_PATHS],
  };

  const fileDest = pino.destination({ dest: logPath, sync: false });

  if (process.stdout.isTTY === true) {
    return pino(
      baseOpts,
      pino.multistream([
        { level, stream: process.stdout },
        { level, stream: fileDest },
      ]),
    );
  }
  return pino(baseOpts, fileDest);
}

/**
 * Best-effort append when startup fails before returning `PlatformServices`
 * (e.g. missing native deps). Plain text; no secrets.
 */
export function emergencyGatewayLog(err: unknown): void {
  try {
    const p = platform();
    let logDir: string;
    switch (p) {
      case "win32":
        logDir = createWindowsPaths().logDir;
        break;
      case "darwin":
        logDir = createDarwinPaths().logDir;
        break;
      case "linux":
        logDir = createLinuxPaths().logDir;
        break;
      default:
        return;
    }
    mkdirSync(logDir, { recursive: true });
    const path = gatewayDailyLogPath(logDir);
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    appendFileSync(path, `[${new Date().toISOString()}] [gateway] fatal: ${msg}\n`, "utf8");
  } catch {
    /* ignore secondary failures */
  }
}
