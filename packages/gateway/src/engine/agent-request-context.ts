import { AsyncLocalStorage } from "node:async_hooks";

export type AgentRequestContext = {
  /** Present when the IPC client passed `sessionId` on `agent.invoke`. */
  sessionId?: string | undefined;
};

export const agentRequestContext = new AsyncLocalStorage<AgentRequestContext>();

export function getAgentRequestSessionId(): string | undefined {
  return agentRequestContext.getStore()?.sessionId;
}
