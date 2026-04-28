import { type PropsWithChildren, useEffect, useRef } from "react";
import { type NavigateFunction, useNavigate } from "react-router-dom";
import { createIpcClient } from "../ipc/client";
import type { ConnectionState, DiagSnapshot } from "../ipc/types";
import { useNimbusStore } from "../store";

const FIRST_CONNECT_ATTEMPTS = 5;
const FIRST_CONNECT_BACKOFF_MS = [200, 500, 1000, 2000, 4000];

interface RunFirstConnectArgs {
  client: ReturnType<typeof createIpcClient>;
  navigate: NavigateFunction;
  firstConnectHandled: { current: boolean };
  isCancelled: () => boolean;
}

function isFreshInstall(snap: DiagSnapshot, meta: string | null): boolean {
  if (meta != null) {
    return false;
  }
  if (snap.connectorCount !== 0) {
    return false;
  }
  return snap.indexTotalItems === 0;
}

async function tryFirstConnectOnce(
  args: RunFirstConnectArgs,
): Promise<"done" | "cancelled" | "failed"> {
  if (args.isCancelled()) {
    return "cancelled";
  }
  try {
    const snap = await args.client.call<DiagSnapshot>("diag.snapshot");
    if (args.isCancelled()) {
      return "cancelled";
    }
    const meta = await args.client.call<string | null>("db.getMeta", {
      key: "onboarding_completed",
    });
    if (args.isCancelled()) {
      return "cancelled";
    }
    args.navigate(isFreshInstall(snap, meta) ? "/onboarding/welcome" : "/", {
      replace: true,
    });
    return "done";
  } catch {
    return "failed";
  }
}

async function runFirstConnect(args: RunFirstConnectArgs): Promise<void> {
  if (args.firstConnectHandled.current) {
    return;
  }
  args.firstConnectHandled.current = true; // claim before any await to block concurrent invocations
  for (let attempt = 0; attempt < FIRST_CONNECT_ATTEMPTS; attempt++) {
    const result = await tryFirstConnectOnce(args);
    if (result !== "failed") {
      return;
    }
    if (attempt === FIRST_CONNECT_ATTEMPTS - 1) {
      args.firstConnectHandled.current = false; // all attempts exhausted — allow next event to retry
      return;
    }
    await new Promise((r) => setTimeout(r, FIRST_CONNECT_BACKOFF_MS[attempt]));
  }
}

export function GatewayConnectionProvider({ children }: PropsWithChildren) {
  const navigate = useNavigate();
  const setConnectionState = useNimbusStore((s) => s.setConnectionState);
  const firstConnectHandled = useRef(false);

  useEffect(() => {
    const client = createIpcClient();
    let stopState: (() => void) | null = null;
    let stopNotif: (() => void) | null = null;
    // Guards against post-unmount work: the retry loop above sleeps for seconds
    // and would otherwise continue after the component is gone, calling navigate
    // on a stale closure and consuming IPC against an unrelated test's mock.
    let cancelled = false;
    const isCancelled = () => cancelled;

    const init = async () => {
      stopState = await client.onConnectionState((state: ConnectionState) => {
        if (cancelled) return;
        setConnectionState(state);
        if (state === "connected") {
          void runFirstConnect({ client, navigate, firstConnectHandled, isCancelled });
        }
      });
      if (cancelled) {
        stopState?.();
        return;
      }
      stopNotif = await client.subscribe(() => {
        // Sub-projects B/C/D consume notifications
      });
      if (cancelled) stopNotif?.();
    };

    void init();
    return () => {
      cancelled = true;
      stopState?.();
      stopNotif?.();
    };
  }, [navigate, setConnectionState]);

  return <>{children}</>;
}
