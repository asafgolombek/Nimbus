import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { LocalIndex } from "../../../src/index/local-index.ts";
import {
  assertTelemetryPayloadSafe,
  buildTelemetryPreview,
  TelemetryPayloadUnsafeError,
} from "../../../src/telemetry/collector.ts";

describe("telemetry payload safety", () => {
  test("buildTelemetryPreview output passes assertTelemetryPayloadSafe", () => {
    const p = buildTelemetryPreview({
      nimbusVersion: "0.1.0",
      queryLatencyP50Ms: 1,
      queryLatencyP95Ms: 2,
      queryLatencyP99Ms: 3,
    });
    expect(() => assertTelemetryPayloadSafe(p)).not.toThrow();
  });

  test("rejects unexpected top-level keys", () => {
    const bad = {
      ...buildTelemetryPreview({
        nimbusVersion: "0.1.0",
        queryLatencyP50Ms: 0,
        queryLatencyP95Ms: 0,
        queryLatencyP99Ms: 0,
      }),
      user_email: "x@y.com",
    };
    expect(() => assertTelemetryPayloadSafe(bad)).toThrow(TelemetryPayloadUnsafeError);
  });

  test("rejects forbidden nested keys", () => {
    const bad = {
      ...buildTelemetryPreview({
        nimbusVersion: "0.1.0",
        queryLatencyP50Ms: 0,
        queryLatencyP95Ms: 0,
        queryLatencyP99Ms: 0,
      }),
      connector_error_rate: { oauth_token: 1 },
    };
    expect(() => assertTelemetryPayloadSafe(bad)).toThrow(TelemetryPayloadUnsafeError);
  });

  test("buildTelemetryPreview with db merges aggregates and stays safe", () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    const t = Date.now();
    db.run(
      `INSERT INTO sync_telemetry (service, started_at, duration_ms, items_upserted, items_deleted, bytes_transferred, had_more, error_msg)
       VALUES ('slack', ?, 40, 0, 0, NULL, 0, 'x')`,
      [t],
    );
    const p = buildTelemetryPreview({
      nimbusVersion: "0.1.0",
      queryLatencyP50Ms: 1,
      queryLatencyP95Ms: 2,
      queryLatencyP99Ms: 3,
      db,
      coldStartMs: 42,
    });
    expect(p.connector_error_rate["slack"]).toBe(1);
    expect(p.cold_start_ms).toBe(42);
    expect(() => assertTelemetryPayloadSafe(p)).not.toThrow();
  });
});
