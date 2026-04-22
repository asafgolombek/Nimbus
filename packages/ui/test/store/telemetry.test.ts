import { beforeEach, describe, expect, it } from "vitest";
import { create } from "zustand";
import type { TelemetryStatus } from "../../src/ipc/types";
import { createTelemetrySlice, type TelemetrySlice } from "../../src/store/slices/telemetry";

function makeStore() {
  return create<TelemetrySlice>()((...a) => createTelemetrySlice(...a));
}

describe("telemetry slice", () => {
  let store: ReturnType<typeof makeStore>;
  beforeEach(() => {
    store = makeStore();
  });

  it("initial status is null", () => {
    expect(store.getState().status).toBeNull();
  });

  it("setTelemetryStatus stores a disabled payload", () => {
    store.getState().setTelemetryStatus({ enabled: false });
    expect(store.getState().status?.enabled).toBe(false);
  });

  it("setTelemetryStatus stores an enabled payload with preview fields", () => {
    const payload: TelemetryStatus = {
      enabled: true,
      session_id: "preview-not-persisted",
      nimbus_version: "0.1.0",
      platform: "linux",
      connector_error_rate: {},
      connector_health_transitions: {},
      query_latency_p50_ms: 3,
      query_latency_p95_ms: 14,
      query_latency_p99_ms: 22,
      agent_invocation_latency_p50_ms: 0,
      agent_invocation_latency_p95_ms: 0,
      sync_duration_p50_ms: {},
      cold_start_ms: 90,
      extension_installs_by_id: {},
      extension_uninstalls_by_id: {},
    };
    store.getState().setTelemetryStatus(payload);
    const s = store.getState().status;
    expect(s?.enabled).toBe(true);
    if (s?.enabled) {
      expect(s.query_latency_p95_ms).toBe(14);
    }
  });

  it("setTelemetryActionInFlight toggles correctly", () => {
    store.getState().setTelemetryActionInFlight(true);
    expect(store.getState().telemetryActionInFlight).toBe(true);
  });
});
