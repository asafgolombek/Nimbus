import { describe, expect, test } from "bun:test";

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
});
