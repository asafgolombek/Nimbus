import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { ConnectorStatus } from "../../../src/ipc/types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));

const store: {
  connectors: ConnectorStatus[];
  highlightConnector: string | null;
  setConnectors: (c: ConnectorStatus[]) => void;
  patchConnector: (name: string, patch: Partial<ConnectorStatus>) => void;
  recomputeAggregate: (c: ConnectorStatus[]) => void;
  setConnectorsMenu: (items: Array<{ name: string; health: ConnectorStatus["health"] }>) => void;
} = {
  connectors: [{ name: "drive", health: "healthy" }],
  highlightConnector: null,
  setConnectors: () => undefined,
  patchConnector: () => undefined,
  recomputeAggregate: () => undefined,
  setConnectorsMenu: () => undefined,
};

vi.mock("../../../src/store", () => ({
  useNimbusStore: (sel: (s: typeof store) => unknown) => sel(store),
}));

vi.mock("../../../src/hooks/useIpcQuery", () => ({
  useIpcQuery: () => ({ data: store.connectors, error: null, isLoading: false }),
}));

vi.mock("../../../src/hooks/useIpcSubscription", () => ({
  useIpcSubscription: () => undefined,
}));

import { ConnectorGrid } from "../../../src/components/dashboard/ConnectorGrid";

describe("ConnectorGrid", () => {
  it("renders one tile per connector", () => {
    store.connectors = [{ name: "drive", health: "healthy" }];
    render(
      <MemoryRouter>
        <ConnectorGrid />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Google Drive/)).toBeInTheDocument();
  });

  it("shows empty state when no connectors", () => {
    store.connectors = [];
    render(
      <MemoryRouter>
        <ConnectorGrid />
      </MemoryRouter>,
    );
    expect(screen.getByText(/No connectors configured/i)).toBeInTheDocument();
  });
});
