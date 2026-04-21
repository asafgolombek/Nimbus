import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { useConfirm } from "../../src/hooks/useConfirm";

function Harness({ expected }: { expected: string }) {
  const confirm = useConfirm();
  const [result, setResult] = useState<string>("idle");
  return (
    <>
      <button
        type="button"
        onClick={async () => {
          const ok = await confirm({
            title: "Delete profile",
            description: `Type "${expected}" to confirm.`,
            expectedText: expected,
            confirmLabel: "Delete",
          });
          setResult(ok ? "confirmed" : "cancelled");
        }}
      >
        open
      </button>
      <div data-testid="out">{result}</div>
      {confirm.modal}
    </>
  );
}

describe("useConfirm", () => {
  it("resolves true when user types the exact expected text and clicks Delete", async () => {
    render(<Harness expected="github" />);
    await userEvent.click(screen.getByRole("button", { name: "open" }));
    await userEvent.type(screen.getByRole("textbox"), "github");
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByTestId("out")).toHaveTextContent("confirmed");
  });

  it("Delete button stays disabled until typed text matches expectedText exactly", async () => {
    render(<Harness expected="github" />);
    await userEvent.click(screen.getByRole("button", { name: "open" }));
    const confirmBtn = screen.getByRole("button", { name: "Delete" });
    expect(confirmBtn).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox"), "githu");
    expect(confirmBtn).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox"), "b");
    expect(confirmBtn).not.toBeDisabled();
  });

  it("resolves false when user clicks Cancel", async () => {
    render(<Harness expected="x" />);
    await userEvent.click(screen.getByRole("button", { name: "open" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByTestId("out")).toHaveTextContent("cancelled");
  });
});
