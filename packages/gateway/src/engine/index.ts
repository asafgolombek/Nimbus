/**
 * Nimbus Engine — sense → plan → gate → act → reflect cognitive loop
 *
 * Components:
 * - Intent Router (LLM classification)
 * - Task Planner (step decomposition)
 * - HITL Consent Gate (structural enforcement — NOT prompt-level)
 * - Tool Executor (MCP client dispatch)
 * - Memory Layer (hybrid RAG)
 *
 * See architecture.md §Subsystem 1: The Nimbus Engine
 */

// TODO Q1: Export nimbusAgent, IntentRouter, TaskPlanner, ToolExecutor, MemoryLayer

/** Subsystem marker for health checks and integration wiring. */
export const ENGINE_SUBSYSTEM_ID = "nimbus-engine" as const;
