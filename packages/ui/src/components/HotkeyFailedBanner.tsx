import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

export function HotkeyFailedBanner() {
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let stop: (() => void) | null = null;
    (async () => {
      stop = await listen<string>("tray://hotkey-failed", (evt) => {
        setError(typeof evt.payload === "string" ? evt.payload : "Unknown error");
      });
    })();
    return () => {
      stop?.();
    };
  }, []);

  if (!error || dismissed) return null;
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "8px 16px",
        background: "rgba(212, 166, 87, 0.12)",
        borderBottom: "1px solid var(--color-amber)",
        color: "var(--color-fg)",
        fontSize: 12,
      }}
    >
      <span>
        Quick-query hotkey (<strong>Ctrl+Shift+N</strong>) could not be registered — it may be bound
        by another app. Details: {error}
      </span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        style={{
          padding: "4px 10px",
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--color-border)",
          background: "transparent",
          color: "var(--color-fg-muted)",
          cursor: "pointer",
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
