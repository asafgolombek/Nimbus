import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProfileHealthPill } from "../../../src/components/chrome/ProfileHealthPill";

describe("ProfileHealthPill", () => {
  it("shows 'all healthy' for normal health", () => {
    render(<ProfileHealthPill profile="work" aggregateHealth="normal" />);
    expect(screen.getByText("all healthy")).toBeInTheDocument();
    expect(screen.getByText("work")).toBeInTheDocument();
  });

  it("shows 'degraded' for amber health", () => {
    render(<ProfileHealthPill profile="personal" aggregateHealth="amber" />);
    expect(screen.getByText("degraded")).toBeInTheDocument();
  });

  it("shows 'unavailable' for red health", () => {
    render(<ProfileHealthPill profile="work" aggregateHealth="red" />);
    expect(screen.getByText("unavailable")).toBeInTheDocument();
  });
});
