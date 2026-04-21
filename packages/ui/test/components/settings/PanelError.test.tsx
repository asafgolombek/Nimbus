import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PanelError } from "../../../src/components/settings/PanelError";

describe("PanelError", () => {
  it("renders message and fires onRetry when the button is clicked", async () => {
    const onRetry = vi.fn();
    render(<PanelError message="Boom" onRetry={onRetry} />);
    expect(screen.getByText("Boom")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
