import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";

describe("UI shell", () => {
  it("renders placeholder copy", () => {
    render(
      <React.StrictMode>
        <div>Nimbus — Q4 2026</div>
      </React.StrictMode>,
    );
    expect(screen.getByText(/Nimbus/)).toBeInTheDocument();
  });
});
