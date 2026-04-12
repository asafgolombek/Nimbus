/**
 * IPC Layer — JSON-RPC 2.0 over domain socket (Unix) or named pipe (Windows)
 *
 * See architecture.md §IPC Protocol.
 */

export type { AgentInvokeContext, AgentInvokeHandler } from "./agent-invoke.ts";
export type { WorkflowRunContext, WorkflowRunHandler } from "./workflow-invoke.ts";
export { type ConsentCoordinator, ConsentDisconnectedError } from "./consent.ts";
export type { CreateIpcServerOptions } from "./server.ts";
export { createIpcServer } from "./server.ts";
export type { IPCServer } from "./types.ts";
