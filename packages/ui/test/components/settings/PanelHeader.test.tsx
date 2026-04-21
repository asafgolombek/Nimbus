import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PanelHeader } from "../../../src/components/settings/PanelHeader";

describe("PanelHeader", () => {
  it("renders title (h2) + description", () => {
    render(<PanelHeader title="Profiles" description="Named configurations" />);
    expect(screen.getByRole("heading", { level: 2, name: "Profiles" })).toBeInTheDocument();
    expect(screen.getByText("Named configurations")).toBeInTheDocument();
  });

  it("renders the optional live-status pill when provided", () => {
    render(
      <PanelHeader
        title="Telemetry"
        description="d"
        livePill={<span data-testid="pill">On</span>}
      />,
    );
    expect(screen.getByTestId("pill")).toBeInTheDocument();
  });
});
