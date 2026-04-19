import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";

export function GatewayOfflineBanner() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onStart = async () => {
    setPending(true);
    setError(null);
    try {
      await invoke("shell_start_gateway");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      role="alert"
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "10px 16px",
        background: "rgba(212, 166, 87, 0.15)",
        borderBottom: "1px solid var(--color-amber)",
        color: "var(--color-fg)",
      }}
    >
      <span>Gateway is not running.{error ? ` (${error})` : ""}</span>
      <button
        type="button"
        onClick={onStart}
        disabled={pending}
        style={{
          padding: "6px 14px",
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--color-amber)",
          background: "transparent",
          color: "var(--color-amber)",
          cursor: "pointer",
        }}
      >
        {pending ? "Starting…" : "Start Gateway"}
      </button>
    </div>
  );
}
