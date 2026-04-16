/**
 * Nimbus Engine — sense → plan → gate → act → reflect cognitive loop
 *
 * Components:
 * - Intent Router (LLM classification) — `router.ts`
 * - Task Planner — `planner.ts`
 * - Mastra agent (read-only tools) — `agent.ts`
 * - HITL Consent Gate + Tool Executor — `executor.ts`
 * - Memory Layer (hybrid RAG) — roadmap Q3+
 *
 * See architecture.md §Subsystem 1: The Nimbus Engine
 */

export { createNimbusEngineAgent } from "./agent.ts";
export {
  bindConsentChannel,
  formatConsentPrompt,
  HITL_REQUIRED,
  redactPayloadForConsentDisplay,
  ToolExecutor,
} from "./executor.ts";
export { GatewayAgentUnavailableError } from "./gateway-agent-error.ts";
export { planFromIntent } from "./planner.ts";
export { type ClassifiedIntent, classifyIntent, type IntentClass } from "./router.ts";
export { runAsk } from "./run-ask.ts";
export type {
  ActionResult,
  AuditSink,
  ConnectorDispatcher,
  ConsentChannel,
  PlannedAction,
} from "./types.ts";

/** Subsystem marker for health checks and integration wiring. */
export const ENGINE_SUBSYSTEM_ID = "nimbus-engine" as const;
