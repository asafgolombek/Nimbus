import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StaleChip } from "../../../src/components/settings/StaleChip";

describe("StaleChip", () => {
  it("renders offline-since text when provided", () => {
    render(<StaleChip offlineSinceIso="2026-04-20T12:00:00Z" />);
    const chip = screen.getByLabelText(/stale/i);
    expect(chip).toBeInTheDocument();
    expect(chip.textContent).toMatch(/offline/i);
  });

  it("renders generic stale text when no timestamp is provided", () => {
    render(<StaleChip />);
    expect(screen.getByLabelText(/stale/i)).toBeInTheDocument();
  });
});
