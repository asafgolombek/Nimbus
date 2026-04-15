import type { Database } from "bun:sqlite";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "pino";
import { loadNimbusTelemetryFromPath } from "../config/telemetry-toml.ts";
import { collectIndexMetrics } from "../db/metrics.ts";

import { assertTelemetryPayloadSafe, buildTelemetryPreview } from "./collector.ts";

export type TelemetryFlushHandle = {
  readonly stop: () => void;
};

function readOrCreateSessionId(dataDir: string): string {
  const p = join(dataDir, ".nimbus-telemetry-session");
  try {
    if (existsSync(p)) {
      const raw = readFileSync(p, "utf8").trim().split(/\r?\n/)[0]?.trim() ?? "";
      if (raw !== "") {
        return raw;
      }
    }
  } catch {
    /* fall through */
  }
  const id = crypto.randomUUID();
  try {
    writeFileSync(p, `${id}\n`, "utf8");
  } catch {
    /* non-fatal */
  }
  return id;
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
      if (existsSync(join(opts.dataDir, ".nimbus-telemetry-disabled"))) {
        return;
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
        ...(opts.coldStartMs !== undefined ? { coldStartMs: opts.coldStartMs } : {}),
      });
      assertTelemetryPayloadSafe(payload);
      void fetch(cfg.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify(payload),
      }).then(
        (res) => {
          if (!res.ok) {
            opts.logger.warn(
              { msg: "telemetry_flush_http_error", status: res.status, endpoint: cfg.endpoint },
              "telemetry POST failed",
            );
          }
        },
        (err: unknown) => {
          opts.logger.warn(
            {
              msg: "telemetry_flush_network_error",
              err: err instanceof Error ? err.message : String(err),
            },
            "telemetry POST threw",
          );
        },
      );
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
