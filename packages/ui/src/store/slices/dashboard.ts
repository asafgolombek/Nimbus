import type { StateCreator } from "zustand";
import type { AuditEntry, ConnectorStatus, IndexMetrics } from "../../ipc/types";

export interface DashboardSlice {
  metrics: IndexMetrics | null;
  metricsError: string | null;
  connectors: ConnectorStatus[];
  audit: AuditEntry[];
  highlightConnector: string | null;
  setMetrics(m: IndexMetrics): void;
  setMetricsError(e: string | null): void;
  setConnectors(c: ConnectorStatus[]): void;
  patchConnector(name: string, patch: Partial<ConnectorStatus>): void;
  setAudit(a: AuditEntry[]): void;
  requestHighlight(name: string): void;
  clearHighlight(): void;
}

export const createDashboardSlice: StateCreator<DashboardSlice, [], [], DashboardSlice> = (
  set,
) => ({
  metrics: null,
  metricsError: null,
  connectors: [],
  audit: [],
  highlightConnector: null,
  setMetrics: (m) => set({ metrics: m }),
  setMetricsError: (e) => set({ metricsError: e }),
  setConnectors: (c) => set({ connectors: c }),
  patchConnector: (name, patch) =>
    set((s) => ({
      connectors: s.connectors.map((x) => (x.name === name ? { ...x, ...patch } : x)),
    })),
  setAudit: (a) => set({ audit: a }),
  requestHighlight: (name) => set({ highlightConnector: name }),
  clearHighlight: () => set({ highlightConnector: null }),
});
