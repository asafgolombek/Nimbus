import type { IPCClient } from "@nimbus-dev/client";
import type { Logger } from "pino";
import { createContext, useContext } from "react";

export interface IpcContextValue {
  client: IPCClient;
  logger: Logger;
}

export const IpcContext = createContext<IpcContextValue | null>(null);

export function useIpc(): IpcContextValue {
  const ctx = useContext(IpcContext);
  if (ctx === null) {
    throw new Error("useIpc must be used inside <IpcContext.Provider>");
  }
  return ctx;
}
