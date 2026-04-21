import type { StateCreator } from "zustand";
import type { TelemetryStatus } from "../../ipc/types";

export interface TelemetrySlice {
  readonly status: TelemetryStatus | null;
  readonly telemetryActionInFlight: boolean;
  setTelemetryStatus: (s: TelemetryStatus) => void;
  setTelemetryActionInFlight: (v: boolean) => void;
}

export const createTelemetrySlice: StateCreator<TelemetrySlice, [], [], TelemetrySlice> = (
  set,
) => ({
  status: null,
  telemetryActionInFlight: false,
  setTelemetryStatus: (s) => set({ status: s }),
  setTelemetryActionInFlight: (v) => set({ telemetryActionInFlight: v }),
});
