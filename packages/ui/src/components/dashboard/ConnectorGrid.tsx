import { type ReactNode, useCallback, useEffect } from "react";
import { Link } from "react-router-dom";
import { useIpcQuery } from "../../hooks/useIpcQuery";
import { useIpcSubscription } from "../../hooks/useIpcSubscription";
import type { ConnectorStatus } from "../../ipc/types";
import { useNimbusStore } from "../../store";
import { ConnectorTile } from "./ConnectorTile";

interface HealthChangedPayload {
  name: string;
  health: ConnectorStatus["health"];
  degradationReason?: string;
}

export function ConnectorGrid(): ReactNode {
  const setConnectors = useNimbusStore((s) => s.setConnectors);
  const patchConnector = useNimbusStore((s) => s.patchConnector);
  const connectors = useNimbusStore((s) => s.connectors);
  const highlight = useNimbusStore((s) => s.highlightConnector);

  const { data } = useIpcQuery<ConnectorStatus[]>("connector.listStatus", 30_000);
  useEffect(() => {
    if (data && data !== connectors) setConnectors(data);
  }, [data, connectors, setConnectors]);

  const onHealth = useCallback(
    (payload: HealthChangedPayload) => {
      patchConnector(payload.name, {
        health: payload.health,
        degradationReason: payload.degradationReason,
      });
    },
    [patchConnector],
  );
  useIpcSubscription<HealthChangedPayload>("connector://health-changed", onHealth);

  if (connectors.length === 0) {
    return (
      <section aria-label="Connectors" className="text-[var(--color-fg-muted)] text-sm">
        No connectors configured.{" "}
        <Link to="/onboarding" className="underline">
          Open onboarding
        </Link>
        .
      </section>
    );
  }

  return (
    <section
      aria-label="Connectors"
      className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3"
    >
      {connectors.map((c) => (
        <ConnectorTile key={c.name} status={c} highlighted={c.name === highlight} />
      ))}
    </section>
  );
}
