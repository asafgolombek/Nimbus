import { type PropsWithChildren, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { createIpcClient } from "../ipc/client";
import type { ConnectionState, DiagSnapshot } from "../ipc/types";
import { useNimbusStore } from "../store";

export function GatewayConnectionProvider({ children }: PropsWithChildren) {
  const navigate = useNavigate();
  const setConnectionState = useNimbusStore((s) => s.setConnectionState);
  const firstConnectHandled = useRef(false);

  useEffect(() => {
    const client = createIpcClient();
    let stopState: (() => void) | null = null;
    let stopNotif: (() => void) | null = null;

    const runFirstConnect = async () => {
      if (firstConnectHandled.current) return;
      firstConnectHandled.current = true; // claim before any await to block concurrent invocations
      const MAX_ATTEMPTS = 5;
      const BACKOFF_MS = [200, 500, 1000, 2000, 4000];
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {
          const snap = await client.call<DiagSnapshot>("diag.snapshot");
          const meta = await client.call<string | null>("db.getMeta", {
            key: "onboarding_completed",
          });
          const fresh = meta == null && snap.connectorCount === 0 && snap.indexTotalItems === 0;
          navigate(fresh ? "/onboarding/welcome" : "/", { replace: true });
          return;
        } catch {
          if (attempt === MAX_ATTEMPTS - 1) {
            firstConnectHandled.current = false; // all attempts exhausted — allow next event to retry
            return;
          }
          await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
        }
      }
    };

    const init = async () => {
      stopState = await client.onConnectionState((state: ConnectionState) => {
        setConnectionState(state);
        if (state === "connected") void runFirstConnect();
      });
      stopNotif = await client.subscribe(() => {
        // Sub-projects B/C/D consume notifications
      });
    };

    void init();
    return () => {
      stopState?.();
      stopNotif?.();
    };
  }, [navigate, setConnectionState]);

  return <>{children}</>;
}
