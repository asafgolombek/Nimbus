import type { StateCreator } from "zustand";
import type { ConnectorStatus } from "../../ipc/types";

export type TrayIconState = "normal" | "amber" | "red";

export interface ConnectorsMenuEntry {
  readonly name: string;
  readonly health: ConnectorStatus["health"];
}

export interface TraySlice {
  readonly aggregateHealth: TrayIconState;
  readonly pendingHitl: number;
  readonly connectorsMenu: ConnectorsMenuEntry[];
  setAggregateHealth: (icon: TrayIconState) => void;
  setPendingHitl: (n: number) => void;
  setConnectorsMenu: (items: ConnectorsMenuEntry[]) => void;
  recomputeAggregate: (connectors: ConnectorStatus[]) => void;
}

export const createTraySlice: StateCreator<TraySlice, [], [], TraySlice> = (set) => ({
  aggregateHealth: "normal",
  pendingHitl: 0,
  connectorsMenu: [],
  setAggregateHealth: (aggregateHealth) => set({ aggregateHealth }),
  setPendingHitl: (n) => set({ pendingHitl: Math.max(0, n) }),
  setConnectorsMenu: (items) => set({ connectorsMenu: items }),
  recomputeAggregate: (connectors) => {
    const hasRed = connectors.some((c) => c.health === "error" || c.health === "unauthenticated");
    const hasAmber = connectors.some((c) => c.health === "degraded" || c.health === "rate_limited");
    set({ aggregateHealth: hasRed ? "red" : hasAmber ? "amber" : "normal" });
  },
});
