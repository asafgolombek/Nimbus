import type { StateCreator } from "zustand";
import type { ConnectorHealth } from "../../ipc/types";

/**
 * Persisted per-connector snapshot — written to localStorage so cold-opening the app
 * with the Gateway already down still shows the last-known grid (spec §2.1).
 */
export interface PersistedConnectorRow {
  readonly service: string;
  readonly intervalMs: number;
  readonly depth: "metadata_only" | "summary" | "full";
  readonly enabled: boolean;
  readonly health: ConnectorHealth;
}

export interface ConnectorsSlice {
  readonly connectorsList: ReadonlyArray<PersistedConnectorRow>;
  /** Transient — tracks which rows are mid-setConfig. Not persisted. */
  readonly perServiceInFlight: Readonly<Record<string, boolean>>;
  /** Transient — deep-link target from Dashboard's degraded-connector tile. Not persisted. */
  readonly highlightService: string | null;
  setConnectorsList: (list: ReadonlyArray<PersistedConnectorRow>) => void;
  setConnectorInFlight: (service: string, inFlight: boolean) => void;
  setHighlightService: (service: string | null) => void;
  patchConnectorRow: (service: string, patch: Partial<PersistedConnectorRow>) => void;
}

export const createConnectorsSlice: StateCreator<ConnectorsSlice, [], [], ConnectorsSlice> = (
  set,
) => ({
  connectorsList: [],
  perServiceInFlight: {},
  highlightService: null,
  setConnectorsList: (list) => set({ connectorsList: list }),
  setConnectorInFlight: (service, inFlight) =>
    set((s) => ({
      perServiceInFlight: { ...s.perServiceInFlight, [service]: inFlight },
    })),
  setHighlightService: (service) => set({ highlightService: service }),
  patchConnectorRow: (service, patch) =>
    set((s) => ({
      connectorsList: s.connectorsList.map((r) => (r.service === service ? { ...r, ...patch } : r)),
    })),
});
