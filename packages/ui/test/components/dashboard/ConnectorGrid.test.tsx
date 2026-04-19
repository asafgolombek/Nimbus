import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ConnectorGrid } from "../../../src/components/dashboard/ConnectorGrid";
import type { ConnectorStatus } from "../../../src/ipc/types";

const store: {
  connectors: ConnectorStatus[];
  highlightConnector: string | null;
  setConnectors: (c: ConnectorStatus[]) => void;
  patchConnector: (name: string, patch: Partial<ConnectorStatus>) => void;
} = {
  connectors: [{ name: "drive", health: "healthy" }],
  highlightConnector: null,
  setConnectors: () => undefined,
  patchConnector: () => undefined,
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
