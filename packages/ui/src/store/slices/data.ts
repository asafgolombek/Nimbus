import type { StateCreator } from "zustand";
import type {
  DataExportProgressPayload,
  DataImportProgressPayload,
  ExportPreflightResult,
} from "../../ipc/types";

/** Reason string attached to transient error state. Keyed so tests can match against constants. */
export type DataFlowErrorKind = "gateway_disconnected" | "rpc_failed" | "validation" | "terminal";

export interface ExportFlowState {
  readonly status: "idle" | "running" | "error";
  readonly progress: DataExportProgressPayload | null;
  readonly errorKind: DataFlowErrorKind | null;
  readonly errorMessage: string | null;
}

export interface ImportFlowState {
  readonly status: "idle" | "running" | "error";
  readonly progress: DataImportProgressPayload | null;
  readonly errorKind: DataFlowErrorKind | null;
  readonly errorMessage: string | null;
}

export interface DeleteFlowState {
  readonly status: "idle" | "running" | "error";
  readonly service: string | null;
  readonly errorKind: DataFlowErrorKind | null;
  readonly errorMessage: string | null;
}

export interface DataSlice {
  readonly exportFlow: ExportFlowState;
  readonly importFlow: ImportFlowState;
  readonly deleteFlow: DeleteFlowState;
  /**
   * Memory-only cache so the Export card keeps data visible under `StaleChip` when offline.
   * Initialised as `null`; use a falsy check (`if (lastExportPreflight)`) not `=== undefined`.
   */
  readonly lastExportPreflight: ExportPreflightResult | null;
  setExportFlow: (patch: Partial<ExportFlowState>) => void;
  setImportFlow: (patch: Partial<ImportFlowState>) => void;
  setDeleteFlow: (patch: Partial<DeleteFlowState>) => void;
  setExportProgress: (progress: DataExportProgressPayload) => void;
  setImportProgress: (progress: DataImportProgressPayload) => void;
  setLastExportPreflight: (preflight: ExportPreflightResult | null) => void;
  /**
   * Called by the connection-state subscription in DataPanel. Transitions any
   * currently-running flow to `{ status: "error", errorKind: "gateway_disconnected" }`
   * so the concurrent-flow guard releases the other two cards.
   */
  markDisconnected: () => void;
  resetDataTransients: () => void;
}

const IDLE_EXPORT: ExportFlowState = {
  status: "idle",
  progress: null,
  errorKind: null,
  errorMessage: null,
};
const IDLE_IMPORT: ImportFlowState = {
  status: "idle",
  progress: null,
  errorKind: null,
  errorMessage: null,
};
const IDLE_DELETE: DeleteFlowState = {
  status: "idle",
  service: null,
  errorKind: null,
  errorMessage: null,
};

export const createDataSlice: StateCreator<DataSlice, [], [], DataSlice> = (set) => ({
  exportFlow: IDLE_EXPORT,
  importFlow: IDLE_IMPORT,
  deleteFlow: IDLE_DELETE,
  lastExportPreflight: null,
  setExportFlow: (patch) => set((s) => ({ exportFlow: { ...s.exportFlow, ...patch } })),
  setImportFlow: (patch) => set((s) => ({ importFlow: { ...s.importFlow, ...patch } })),
  setDeleteFlow: (patch) => set((s) => ({ deleteFlow: { ...s.deleteFlow, ...patch } })),
  setExportProgress: (progress) => set((s) => ({ exportFlow: { ...s.exportFlow, progress } })),
  setImportProgress: (progress) => set((s) => ({ importFlow: { ...s.importFlow, progress } })),
  setLastExportPreflight: (preflight) => set({ lastExportPreflight: preflight }),
  markDisconnected: () =>
    set((s) => ({
      exportFlow:
        s.exportFlow.status === "running"
          ? {
              status: "error",
              errorKind: "gateway_disconnected",
              progress: null,
              errorMessage: null,
            }
          : s.exportFlow,
      importFlow:
        s.importFlow.status === "running"
          ? {
              status: "error",
              errorKind: "gateway_disconnected",
              progress: null,
              errorMessage: null,
            }
          : s.importFlow,
      deleteFlow:
        s.deleteFlow.status === "running"
          ? {
              status: "error",
              errorKind: "gateway_disconnected",
              service: s.deleteFlow.service,
              errorMessage: null,
            }
          : s.deleteFlow,
    })),
  resetDataTransients: () =>
    set({
      exportFlow: IDLE_EXPORT,
      importFlow: IDLE_IMPORT,
      deleteFlow: IDLE_DELETE,
      lastExportPreflight: null,
    }),
});
