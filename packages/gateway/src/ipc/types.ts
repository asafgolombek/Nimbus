import type { AgentInvokeHandler } from "./agent-invoke.ts";
import type { ConsentCoordinator } from "./consent.ts";
import type { WorkflowRunHandler } from "./workflow-invoke.ts";

export interface IPCServer {
  readonly listenPath: string;
  readonly consent: ConsentCoordinator;
  start(): Promise<void>;
  stop(): Promise<void>;
  setAgentInvokeHandler(handler: AgentInvokeHandler | undefined): void;
  setWorkflowRunHandler(handler: WorkflowRunHandler | undefined): void;
}
