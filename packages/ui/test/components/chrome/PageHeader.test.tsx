import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/store", () => ({
  useNimbusStore: (sel: (s: { trayIcon: "normal" | "amber" | "red" }) => unknown) =>
    sel({ trayIcon: "normal" }),
}));

import { PageHeader } from "../../../src/components/chrome/PageHeader";

describe("PageHeader", () => {
  it("renders the title and profile name", () => {
    render(<PageHeader title="Dashboard" profile="work" />);
    expect(screen.getByRole("heading", { level: 1, name: /Dashboard/ })).toBeInTheDocument();
    expect(screen.getByText(/work/)).toBeInTheDocument();
  });

  it("shows 'all healthy' when aggregate is normal", () => {
    render(<PageHeader title="Dashboard" profile="work" />);
    expect(screen.getByText(/all healthy/i)).toBeInTheDocument();
  });

  it("falls back to 'default' profile when prop is absent", () => {
    render(<PageHeader title="Dashboard" />);
    expect(screen.getByText(/default/)).toBeInTheDocument();
  });
});
