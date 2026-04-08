/**
 * Nimbus Engine — sense → plan → gate → act → reflect cognitive loop
 *
 * Components:
 * - Intent Router (LLM classification) — TODO Q1
 * - Task Planner (step decomposition) — TODO Q1
 * - HITL Consent Gate + Tool Executor — `executor.ts`
 * - Memory Layer (hybrid RAG) — TODO Q3+
 *
 * See architecture.md §Subsystem 1: The Nimbus Engine
 */

export {
  bindConsentChannel,
  formatConsentPrompt,
  HITL_REQUIRED,
  ToolExecutor,
} from "./executor.ts";
export type {
  ActionResult,
  AuditSink,
  ConnectorDispatcher,
  ConsentChannel,
  PlannedAction,
} from "./types.ts";

/** Subsystem marker for health checks and integration wiring. */
export const ENGINE_SUBSYSTEM_ID = "nimbus-engine" as const;
