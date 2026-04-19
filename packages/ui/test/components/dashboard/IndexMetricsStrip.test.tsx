import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IndexMetricsStrip } from "../../../src/components/dashboard/IndexMetricsStrip";

const hookState = { data: null as unknown, error: null as string | null, isLoading: false };

vi.mock("../../../src/hooks/useIpcQuery", () => ({
  useIpcQuery: () => hookState,
}));

describe("IndexMetricsStrip", () => {
  it("renders 4 metric tiles with values", () => {
    hookState.data = {
      itemsTotal: 124_387,
      embeddingCoveragePct: 83,
      queryP95Ms: 42,
      indexSizeBytes: 2_147_483_648,
    };
    render(<IndexMetricsStrip />);
    expect(screen.getByText("124,387")).toBeInTheDocument();
    expect(screen.getByText("83%")).toBeInTheDocument();
    expect(screen.getByText("42 ms")).toBeInTheDocument();
    expect(screen.getByText("2.0 GB")).toBeInTheDocument();
  });

  it("renders em-dashes when no data and error is present", () => {
    hookState.data = null;
    hookState.error = "boom";
    render(<IndexMetricsStrip />);
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(4);
  });
});
