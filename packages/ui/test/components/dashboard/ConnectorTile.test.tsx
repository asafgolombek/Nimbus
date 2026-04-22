import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConnectorTile } from "../../../src/components/dashboard/ConnectorTile";
import type { ConnectorHealth, ConnectorStatus } from "../../../src/ipc/types";

describe("ConnectorTile", () => {
  it("shows the connector name and last-sync relative time", () => {
    const c: ConnectorStatus = {
      name: "drive",
      health: "healthy",
      lastSyncAt: new Date(Date.now() - 120_000).toISOString(),
    };
    render(<ConnectorTile status={c} highlighted={false} />);
    expect(screen.getByText(/Google Drive/)).toBeInTheDocument();
    expect(screen.getByText(/m ago/)).toBeInTheDocument();
  });

  it("renders degradation reason for degraded state", () => {
    const c: ConnectorStatus = {
      name: "slack",
      health: "rate_limited",
      degradationReason: "rate-limited by upstream",
    };
    render(<ConnectorTile status={c} highlighted={false} />);
    expect(screen.getByText(/rate-limited/i)).toBeInTheDocument();
  });

  it("shows 'not synced yet' when lastSyncAt is missing", () => {
    const c: ConnectorStatus = { name: "gmail", health: "healthy" };
    render(<ConnectorTile status={c} highlighted={false} />);
    expect(screen.getByText(/not synced yet/i)).toBeInTheDocument();
  });

  it("applies a highlight ring when highlighted=true", () => {
    const c: ConnectorStatus = { name: "notion", health: "healthy" };
    const { container } = render(<ConnectorTile status={c} highlighted={true} />);
    const el = container.querySelector('[data-connector="notion"]');
    expect(el?.className).toMatch(/ring/);
  });

  it.each<[ConnectorHealth, string]>([
    ["error", "color-error"],
    ["unauthenticated", "color-error"],
    ["paused", "color-fg-muted"],
  ])("dot colour for '%s' health maps to CSS var containing %s", (health, expectedClass) => {
    const c: ConnectorStatus = { name: "github", health };
    const { container } = render(<ConnectorTile status={c} highlighted={false} />);
    const dot = container.querySelector('[aria-hidden="true"]');
    expect(dot?.className).toMatch(new RegExp(expectedClass));
  });

  it("falls back to the raw name for unknown connector identifiers", () => {
    const c: ConnectorStatus = { name: "my-custom-connector", health: "healthy" };
    render(<ConnectorTile status={c} highlighted={false} />);
    expect(screen.getByText("my-custom-connector")).toBeInTheDocument();
  });
});
