import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RouterStatus } from "../../../../src/components/settings/model/RouterStatus";
import type { RouterStatusResult } from "../../../../src/ipc/types";

describe("RouterStatus", () => {
  it("renders one badge per task type present in `decisions`", () => {
    const status: RouterStatusResult = {
      decisions: {
        classification: { providerId: "ollama", modelName: "gemma:2b", reason: "default" },
        reasoning: { providerId: "llamacpp", modelName: "llama3:8b", reason: "preferLocal" },
        summarisation: undefined,
      },
    };
    render(<RouterStatus status={status} />);
    expect(screen.getByText(/classification/i)).toBeInTheDocument();
    expect(screen.getByText(/reasoning/i)).toBeInTheDocument();
    expect(screen.getByText(/gemma:2b/)).toBeInTheDocument();
    expect(screen.getByText(/llama3:8b/)).toBeInTheDocument();
    expect(screen.getByText(/default/)).toBeInTheDocument();
    expect(screen.getByText(/preferLocal/)).toBeInTheDocument();
  });

  it("renders a 'none' pill for a task type with undefined decision", () => {
    const status: RouterStatusResult = {
      decisions: { classification: undefined },
    };
    render(<RouterStatus status={status} />);
    expect(screen.getByText(/no provider available/i)).toBeInTheDocument();
  });

  it("renders an empty state when `decisions` is empty", () => {
    render(<RouterStatus status={{ decisions: {} }} />);
    expect(screen.getByText(/router has not been queried/i)).toBeInTheDocument();
  });
});
