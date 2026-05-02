import type { AgentInvokeHandler } from "../agent-invoke.ts";
import type { ConsentCoordinatorImpl } from "../consent.ts";
import type { WorkflowRunHandler } from "../workflow-invoke.ts";
import type { CreateIpcServerOptions } from "./options.ts";

/**
 * Internal collaborator interface — wraps the closure state of `createIpcServer`
 * so per-namespace dispatchers can live in sibling files without `this`-style
 * closure access. Not exported from `index.ts`.
 *
 * `getAgentInvokeHandler` and `getWorkflowRunHandler` are getters (not direct
 * fields) because the factory's `setAgentInvokeHandler` / `setWorkflowRunHandler`
 * public methods mutate the underlying `let` bindings; capturing the value at
 * context-construction time would freeze the handler to whatever was passed at
 * `createIpcServer(...)` time and break the setter API.
 */
export interface ServerCtx {
  readonly options: CreateIpcServerOptions;
  readonly consentImpl: ConsentCoordinatorImpl;
  readonly startedAtMs: number;
  broadcastNotification(method: string, params: Record<string, unknown>): void;
  getAgentInvokeHandler(): AgentInvokeHandler | undefined;
  getWorkflowRunHandler(): WorkflowRunHandler | undefined;
}

// Skip-symbol sentinels — module-private, exported here so dispatchers.ts and
// server.ts can both reference the same identity. Not re-exported from index.ts.
export const connectorRpcSkipped: unique symbol = Symbol("connectorRpcSkipped");
export const peopleRpcSkipped: unique symbol = Symbol("peopleRpcSkipped");
export const sessionRpcSkipped: unique symbol = Symbol("sessionRpcSkipped");
export const automationRpcSkipped: unique symbol = Symbol("automationRpcSkipped");
export const phase4RpcSkipped: unique symbol = Symbol("phase4RpcSkipped");
export const diagnosticsRpcSkipped: unique symbol = Symbol("diagnosticsRpcSkipped");
