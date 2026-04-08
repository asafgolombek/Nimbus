/**
 * IPC Layer — JSON-RPC 2.0 over domain socket (Unix) or named pipe (Windows)
 *
 * See architecture.md §IPC Protocol, dev-plan-q1.md §Stage 3
 */

export { ConsentDisconnectedError, type ConsentCoordinator } from "./consent.ts";
export { createIpcServer } from "./server.ts";
export type { CreateIpcServerOptions } from "./server.ts";
export type { IPCServer } from "./types.ts";
