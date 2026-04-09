/**
 * Planned tool / connector action produced by the task planner.
 * `type` is matched against {@link HITL_REQUIRED} for structural consent gating.
 */
export type PlannedAction = {
  type: string;
  payload?: Record<string, unknown>;
};

export type ActionResult =
  | { status: "ok"; result: unknown }
  | { status: "rejected"; reason: string };

/**
 * Narrow channel used by `ToolExecutor` — implemented by binding IPC
 * `ConsentCoordinator` to a `clientId`.
 */
export interface ConsentChannel {
  requestApproval(prompt: string, details?: Record<string, unknown>): Promise<boolean>;
}

/** Persists HITL decisions; typically `LocalIndex`. */
export interface AuditSink {
  recordAudit(entry: {
    actionType: string;
    hitlStatus: "approved" | "rejected" | "not_required";
    actionJson: string;
    timestamp: number;
  }): void;
}

/** Dispatches approved actions to MCP (or a mock in tests). */
export interface ConnectorDispatcher {
  dispatch(action: PlannedAction): Promise<unknown>;
}
