import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PanelComingSoon } from "../../../src/components/settings/PanelComingSoon";

describe("PanelComingSoon", () => {
  it("renders the provided title as a h2 and a 'coming soon' message", () => {
    render(<PanelComingSoon title="Model" />);
    expect(screen.getByRole("heading", { level: 2, name: /model/i })).toBeInTheDocument();
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });
});
