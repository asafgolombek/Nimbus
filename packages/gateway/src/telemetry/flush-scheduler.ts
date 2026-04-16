import type { Database } from "bun:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "pino";
import { loadNimbusTelemetryFromPath } from "../config/telemetry-toml.ts";
import { collectIndexMetrics } from "../db/metrics.ts";

import { assertTelemetryPayloadSafe, buildTelemetryPreview } from "./collector.ts";

export type TelemetryFlushHandle = {
  readonly stop: () => void;
};

/** Matches `crypto.randomUUID()` output (RFC 4122 version 4). */
const STORED_SESSION_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseStoredTelemetrySessionId(raw: string): string | undefined {
  const s = raw.trim();
  if (!STORED_SESSION_UUID_RE.test(s)) {
    return undefined;
  }
  return s.toLowerCase();
}

function readErrorCode(err: unknown): string | undefined {
  if (err !== null && typeof err === "object" && "code" in err) {
    const c = (err as { code: unknown }).code;
    return typeof c === "string" ? c : undefined;
  }
  return undefined;
}

/** Persists a random session id without echoing arbitrary file bytes into outbound telemetry. */
function readOrCreateSessionId(dataDir: string): string {
  const p = join(dataDir, ".nimbus-telemetry-session");
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const raw = readFileSync(p, "utf8").trim().split(/\r?\n/)[0]?.trim() ?? "";
      const parsed = parseStoredTelemetrySessionId(raw);
      if (parsed !== undefined) {
        return parsed;
      }
      const id = crypto.randomUUID();
      try {
        writeFileSync(p, `${id}\n`, "utf8");
      } catch {
        /* non-fatal */
      }
      return id;
    } catch (e: unknown) {
      if (readErrorCode(e) === "ENOENT") {
        const id = crypto.randomUUID();
        try {
          writeFileSync(p, `${id}\n`, { encoding: "utf8", flag: "wx" });
          return id;
        } catch (e2: unknown) {
          if (readErrorCode(e2) === "EEXIST") {
            continue;
          }
          return id;
        }
      }
      return crypto.randomUUID();
    }
  }
  return crypto.randomUUID();
}

/**
 * Starts a timer that POSTs aggregate telemetry to the configured endpoint when enabled.
 * Reloads `[telemetry]` from `activeTomlPath` on each tick (pick up edits after restart-free
 * interval elapses — interval itself is fixed at scheduler start from the same file).
 */
export function startTelemetryFlushScheduler(opts: {
  readonly dataDir: string;
  readonly activeTomlPath: string;
  readonly getDatabase: () => Database;
  readonly gatewayVersion: string;
  readonly logger: Logger;
  /** One-shot assembly cost (ms) attributed to this Gateway process boot. */
  readonly coldStartMs?: number;
}): TelemetryFlushHandle {
  let stopped = false;
  const cfg0 = loadNimbusTelemetryFromPath(opts.activeTomlPath);
  const ms = Math.min(86_400_000, Math.max(60_000, cfg0.flushIntervalSeconds * 1000));
  let handle: ReturnType<typeof setInterval> | null = null;

  const tick = (): void => {
    if (stopped) {
      return;
    }
    try {
      try {
        readFileSync(join(opts.dataDir, ".nimbus-telemetry-disabled"));
        return;
      } catch (e: unknown) {
        if (readErrorCode(e) !== "ENOENT") {
          /* ignore unreadable marker */
        }
      }
      const cfg = loadNimbusTelemetryFromPath(opts.activeTomlPath);
      if (!cfg.enabled) {
        return;
      }
      const db = opts.getDatabase();
      const m = collectIndexMetrics(db);
      const sessionId = readOrCreateSessionId(opts.dataDir);
      const payload = buildTelemetryPreview({
        nimbusVersion: opts.gatewayVersion,
        queryLatencyP50Ms: m.queryLatencyP50Ms,
        queryLatencyP95Ms: m.queryLatencyP95Ms,
        queryLatencyP99Ms: m.queryLatencyP99Ms,
        sessionId,
        db,
        ...(opts.coldStartMs === undefined ? {} : { coldStartMs: opts.coldStartMs }),
      });
      assertTelemetryPayloadSafe(payload);
      fetch(cfg.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify(payload),
      })
        .then((res) => {
          if (!res.ok) {
            opts.logger.warn(
              { msg: "telemetry_flush_http_error", status: res.status, endpoint: cfg.endpoint },
              "telemetry POST failed",
            );
          }
        })
        .catch((err: unknown) => {
          opts.logger.warn(
            {
              msg: "telemetry_flush_network_error",
              err: err instanceof Error ? err.message : String(err),
            },
            "telemetry POST threw",
          );
        });
    } catch (e) {
      opts.logger.warn(
        { msg: "telemetry_flush_tick_error", err: e instanceof Error ? e.message : String(e) },
        "telemetry flush tick failed",
      );
    }
  };

  handle = setInterval(tick, ms);
  tick();

  return {
    stop(): void {
      stopped = true;
      if (handle !== null) {
        clearInterval(handle);
        handle = null;
      }
    },
  };
}
