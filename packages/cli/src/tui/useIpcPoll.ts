import { useEffect, useRef, useState } from "react";

import { useIpc } from "./ipc-context.ts";
import type { TuiMode } from "./state.ts";

export interface IpcPollState<T> {
  data: T | null;
  error: Error | null;
  stale: boolean;
}

/**
 * Poll an IPC method on the given interval, pausing whenever `mode` is
 * "disconnected". Fires immediately on mount and on reconnect. Exposes
 * last-known data as stale while paused.
 */
export function useIpcPoll<T>(method: string, intervalMs: number, mode: TuiMode): IpcPollState<T> {
  const { client, logger } = useIpc();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const stale = mode === "disconnected";
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (mode === "disconnected") {
      return undefined;
    }
    let timer: ReturnType<typeof setInterval> | null = null;
    const run = async (): Promise<void> => {
      try {
        const next = await client.call<T>(method);
        if (!mountedRef.current) {
          return;
        }
        setData(next);
        setError(null);
      } catch (e) {
        if (!mountedRef.current) {
          return;
        }
        const wrapped = e instanceof Error ? e : new Error(String(e));
        setError(wrapped);
        logger.debug({ event: "tui.poll.error", method, err: wrapped.message }, "poll failed");
      }
    };
    void run();
    timer = setInterval(() => {
      void run();
    }, intervalMs);
    return () => {
      if (timer !== null) {
        clearInterval(timer);
      }
    };
  }, [client, logger, method, intervalMs, mode]);

  return { data, error, stale };
}
