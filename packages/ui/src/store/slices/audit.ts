import type { StateCreator } from "zustand";
import type { AuditSummary } from "../../ipc/types";

/** Outcome filter values match the Gateway `hitl_status` column verbatim, plus "all". */
export type AuditOutcomeFilter = "all" | "approved" | "rejected" | "not_required";

export interface AuditFilter {
  /** First-segment service name (e.g., "github" derived from "github.sync"); empty string = no service filter. */
  readonly service: string;
  readonly outcome: AuditOutcomeFilter;
  /** Inclusive lower bound, ms epoch. `null` = no lower bound. */
  readonly sinceMs: number | null;
  /** Inclusive upper bound, ms epoch. `null` = no upper bound. */
  readonly untilMs: number | null;
}

export interface AuditSlice {
  readonly auditFilter: AuditFilter;
  /** Latest snapshot of `audit.getSummary` — `null` until first fetch completes. Transient. */
  readonly auditSummary: AuditSummary | null;
  /** Transient — `true` while `audit.verify` or `audit.export` is in flight. */
  readonly auditActionInFlight: boolean;
  setAuditFilter: (next: Partial<AuditFilter>) => void;
  resetAuditFilter: () => void;
  setAuditSummary: (snapshot: AuditSummary | null) => void;
  setAuditActionInFlight: (inFlight: boolean) => void;
}

const DEFAULT_FILTER: AuditFilter = {
  service: "",
  outcome: "all",
  sinceMs: null,
  untilMs: null,
};

export const createAuditSlice: StateCreator<AuditSlice, [], [], AuditSlice> = (set) => ({
  auditFilter: DEFAULT_FILTER,
  auditSummary: null,
  auditActionInFlight: false,
  setAuditFilter: (next) => set((s) => ({ auditFilter: { ...s.auditFilter, ...next } })),
  resetAuditFilter: () => set({ auditFilter: DEFAULT_FILTER }),
  setAuditSummary: (snapshot) => set({ auditSummary: snapshot }),
  setAuditActionInFlight: (inFlight) => set({ auditActionInFlight: inFlight }),
});
