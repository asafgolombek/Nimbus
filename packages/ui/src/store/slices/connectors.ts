import type { StateCreator } from "zustand";
import type { ConnectorHealth } from "../../ipc/types";

/**
 * Minimal per-connector snapshot persisted across UI reloads so cold-opening the app
 * with the Gateway already down still shows the last-known grid (spec §2.1).
 * Full Connectors-panel wiring lands in a later plan.
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
  setConnectorsList: (list: ReadonlyArray<PersistedConnectorRow>) => void;
}

export const createConnectorsSlice: StateCreator<ConnectorsSlice, [], [], ConnectorsSlice> = (
  set,
) => ({
  connectorsList: [],
  setConnectorsList: (list) => set({ connectorsList: list }),
});
