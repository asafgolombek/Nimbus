import { useCallback, useEffect, useState } from "react";
import { PanelError } from "../../components/settings/PanelError";
import { PanelHeader } from "../../components/settings/PanelHeader";
import { StaleChip } from "../../components/settings/StaleChip";
import { createIpcClient } from "../../ipc/client";
import type { TelemetryStatus } from "../../ipc/types";
import { useNimbusStore } from "../../store";

interface CounterCardProps {
  readonly label: string;
  readonly value: string | number;
  readonly unit?: string;
}

function CounterCard({ label, value, unit }: CounterCardProps) {
  return (
    <div className="p-3 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-subtle)]">
      <div className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{label}</div>
      <div className="text-xl font-semibold mt-1">
        {value}
        {unit !== undefined && <span className="ml-1 text-sm font-normal">{unit}</span>}
      </div>
    </div>
  );
}

export function TelemetryPanel() {
  const status = useNimbusStore((s) => s.status);
  const inFlight = useNimbusStore((s) => s.telemetryActionInFlight);
  const connectionState = useNimbusStore((s) => s.connectionState);
  const setStatus = useNimbusStore((s) => s.setTelemetryStatus);
  const setInFlight = useNimbusStore((s) => s.setTelemetryActionInFlight);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const offline = connectionState === "disconnected";
  const writeDisabled = offline || inFlight;

  const refresh = useCallback(async () => {
    try {
      const res: TelemetryStatus = await createIpcClient().telemetryGetStatus();
      setStatus(res);
      setFetchError(null);
    } catch (e) {
      setFetchError((e as Error).message);
    }
  }, [setStatus]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onToggle = useCallback(async () => {
    if (status === null) return;
    const target = !status.enabled;
    setInFlight(true);
    try {
      await createIpcClient().telemetrySetEnabled(target);
      await refresh();
    } finally {
      setInFlight(false);
    }
  }, [refresh, setInFlight, status]);

  const enabled = status?.enabled === true;

  return (
    <section className="p-6 space-y-6">
      <PanelHeader
        title="Telemetry"
        description="Opt-in, aggregate-only counters. No content, no payloads. The payload sample below is exactly what would be sent."
        livePill={offline ? <StaleChip /> : undefined}
      />
      {fetchError !== null && (
        <PanelError
          message={`Failed to load telemetry status: ${fetchError}`}
          onRetry={() => void refresh()}
        />
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Telemetry"
          onClick={() => void onToggle()}
          disabled={writeDisabled || status === null}
          className={[
            "relative inline-block w-12 h-6 rounded-full transition-colors",
            enabled ? "bg-[var(--color-accent)]" : "bg-[var(--color-border)]",
            "disabled:opacity-50",
          ].join(" ")}
        >
          <span
            className={[
              "absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform",
              enabled ? "translate-x-6" : "translate-x-0",
            ].join(" ")}
          />
        </button>
        <span className="text-sm">{enabled ? "Telemetry enabled" : "Telemetry disabled"}</span>
      </div>

      {status?.enabled === true && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <CounterCard label="Query p50" value={status.query_latency_p50_ms} unit="ms" />
            <CounterCard label="Query p95" value={status.query_latency_p95_ms} unit="ms" />
            <CounterCard label="Query p99" value={status.query_latency_p99_ms} unit="ms" />
            <CounterCard label="Cold start" value={status.cold_start_ms} unit="ms" />
          </div>

          <div>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-sm text-[var(--color-accent)] underline"
            >
              {expanded ? "Hide payload sample" : "View payload sample"}
            </button>
            {expanded && (
              <pre
                data-testid="telemetry-payload-json"
                className="mt-3 text-xs p-3 rounded-md bg-[var(--color-bg-subtle)] border border-[var(--color-border)] overflow-auto"
              >
                {JSON.stringify(status, null, 2)}
              </pre>
            )}
          </div>
        </>
      )}
    </section>
  );
}
