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

/**
 * S2-F9 — paths consumed by `pino`'s redact config. Covers the most common
 * third-party SDK error shapes (Authorization headers, nested config.headers,
 * common token field names) so an OpenAI/Anthropic/Slack SDK error chain
 * cannot smuggle credentials through these structured paths.
 *
 * Both top-level (`apiKey`, `token`) and one-level-deep (`*.apiKey`,
 * `err.apiKey`) variants are listed because pino's redact path syntax does
 * not match implicitly across depths.
 */
const PINO_REDACT_PATHS: readonly string[] = [
  // Legacy paths
  "*.token",
  "*.secret",
  "oauth.*",
  "*.password",
  "*.key",
  // Top-level direct names (pino's `*.foo` does not match top-level `foo`).
  "apiKey",
  "api_key",
  "token",
  "secret",
  "password",
  "accessToken",
  "refreshToken",
  "bot_token",
  "app_password",
  "authorization",
  "Authorization",
  // One-level-deep
  "*.apiKey",
  "*.api_key",
  "*.accessToken",
  "*.refreshToken",
  "*.bot_token",
  "*.app_password",
  // Header chains
  "*.headers.authorization",
  "*.headers.Authorization",
  "*.config.headers.authorization",
  "*.config.headers.Authorization",
  "err.headers.authorization",
  "err.headers.Authorization",
  "err.config.headers.authorization",
  "err.config.headers.Authorization",
  "err.apiKey",
  "err.api_key",
  "err.token",
  "err.accessToken",
];

/**
 * S2-F9 — value-level patterns scrubbed from `msg` and from `err.message` /
 * `err.stack`. Defends against future third-party SDK error formats that
 * embed credentials in the bare message string instead of structured fields.
 */
export const REDACT_VALUE_PATTERNS: ReadonlyArray<RegExp> = [
  /Bearer\s+[A-Za-z0-9._\-+/=]+/g,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /sk-ant-[A-Za-z0-9_-]{16,}/g,
  /ghp_[A-Za-z0-9]{16,}/g,
  /gho_[A-Za-z0-9]{16,}/g,
  /xox[baprs]-[A-Za-z0-9-]{8,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
];

export function scrubRedactedValuePatterns(s: string): string {
  let out = s;
  for (const re of REDACT_VALUE_PATTERNS) {
    out = out.replace(re, "[REDACTED]");
  }
  return out;
}

function pinoLogFormatter(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...o };
  // pino calls `formatters.log` on the merged input bindings (the first
  // object arg). The bare `msg` string is NOT in this object — it is added
  // separately by pino — so message-string scrubbing happens in the
  // `hooks.logMethod` stage below.
  const e = out["err"];
  if (e !== null && typeof e === "object") {
    const eObj = { ...(e as Record<string, unknown>) };
    if (typeof eObj["message"] === "string") {
      eObj["message"] = scrubRedactedValuePatterns(eObj["message"] as string);
    }
    if (typeof eObj["stack"] === "string") {
      eObj["stack"] = scrubRedactedValuePatterns(eObj["stack"] as string);
    }
    out["err"] = eObj;
  }
  return out;
}

/**
 * S2-F9 — intercept user-supplied log args and scrub credential-shaped
 * substrings from any string arg before pino formats them. Catches the
 * common case `logger.warn("token rejected: Bearer abc...")` where the
 * sensitive value is in the bare msg string, never reaching the
 * `formatters.log` hook.
 */
function pinoLogMethodHook(
  this: unknown,
  args: unknown[],
  method: (...a: unknown[]) => void,
): void {
  const scrubbed = args.map((a) => (typeof a === "string" ? scrubRedactedValuePatterns(a) : a));
  method.apply(this, scrubbed);
}

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
 *
 * S2-F9 — applies both pino's `redact` config (structured paths) and a
 * value-level scrubber via `formatters.log` for `msg` / `err.message` /
 * `err.stack` so unstructured credential leakage from third-party SDK
 * error chains is also stripped.
 */
export function createGatewayPinoLogger(logDir: string): Logger {
  const level = resolveLogLevel();
  const logPath = gatewayDailyLogPath(logDir);
  const baseOpts = {
    level,
    redact: [...PINO_REDACT_PATHS],
    formatters: { log: pinoLogFormatter },
    hooks: { logMethod: pinoLogMethodHook },
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
 * Test-only — build a pino logger that writes to the supplied stream and
 * applies the production redact config. Used by S2-F9 unit tests so they
 * can capture log lines without touching the filesystem.
 */
export function createGatewayPinoLoggerForStream(
  stream: NodeJS.WritableStream,
  level = "warn",
): Logger {
  return pino(
    {
      level,
      redact: [...PINO_REDACT_PATHS],
      formatters: { log: pinoLogFormatter },
      hooks: { logMethod: pinoLogMethodHook },
    },
    stream,
  );
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
