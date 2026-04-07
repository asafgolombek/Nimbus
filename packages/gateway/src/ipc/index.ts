/**
 * IPC Layer — JSON-RPC 2.0 over domain socket (Unix) or named pipe (Windows)
 *
 * See architecture.md §IPC Protocol
 */

/** Bound transport; JSON-RPC wiring is added in Stage 3. */
export interface IPCServer {
  readonly listenPath: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** Q1 placeholder — real bind/listen in Stage 3. */
export function createStubIpcServer(listenPath: string): IPCServer {
  return {
    listenPath,
    async start(): Promise<void> {},
    async stop(): Promise<void> {},
  };
}
