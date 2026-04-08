import type { ConsentCoordinator } from "./consent.ts";

export interface IPCServer {
  readonly listenPath: string;
  readonly consent: ConsentCoordinator;
  start(): Promise<void>;
  stop(): Promise<void>;
}
