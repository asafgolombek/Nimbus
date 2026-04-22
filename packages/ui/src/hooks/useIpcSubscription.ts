import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect } from "react";

export function useIpcSubscription<T = unknown>(
  event: string,
  handler: (payload: T) => void,
): void {
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;
    listen<T>(event, (e) => handler(e.payload))
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [event, handler]);
}
