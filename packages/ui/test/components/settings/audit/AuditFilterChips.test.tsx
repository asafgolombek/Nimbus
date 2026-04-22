import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuditFilterChips } from "../../../../src/components/settings/audit/AuditFilterChips";
import type { AuditFilter } from "../../../../src/store/slices/audit";

const defaultFilter: AuditFilter = {
  service: "",
  outcome: "all",
  sinceMs: null,
  untilMs: null,
};

function setup(overrides: Partial<AuditFilter> = {}, disabled = false) {
  const onChange = vi.fn();
  const onReset = vi.fn();
  render(
    <AuditFilterChips
      filter={{ ...defaultFilter, ...overrides }}
      availableServices={["github", "slack"]}
      onChange={onChange}
      onReset={onReset}
      disabled={disabled}
    />,
  );
  return { onChange, onReset };
}

describe("AuditFilterChips", () => {
  it("renders service options including 'all' and each available service", () => {
    setup();
    const select = screen.getByRole("combobox", { name: /service filter/i });
    expect(select).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "all" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "github" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "slack" })).toBeInTheDocument();
  });

  it("calls onChange with selected service", () => {
    const { onChange } = setup();
    fireEvent.change(screen.getByRole("combobox", { name: /service filter/i }), {
      target: { value: "github" },
    });
    expect(onChange).toHaveBeenCalledWith({ service: "github" });
  });

  it("calls onChange with selected outcome", () => {
    const { onChange } = setup();
    fireEvent.change(screen.getByRole("combobox", { name: /outcome filter/i }), {
      target: { value: "approved" },
    });
    expect(onChange).toHaveBeenCalledWith({ outcome: "approved" });
  });

  it("calls onChange with sinceMs when a valid date is entered", () => {
    const { onChange } = setup();
    fireEvent.change(screen.getByLabelText("Since (date filter)"), {
      target: { value: "2024-01-15" },
    });
    expect(onChange).toHaveBeenCalledWith({ sinceMs: expect.any(Number) });
  });

  it("calls onChange with sinceMs=null when since date is cleared", () => {
    const { onChange } = setup({ sinceMs: Date.now() });
    fireEvent.change(screen.getByLabelText("Since (date filter)"), {
      target: { value: "" },
    });
    expect(onChange).toHaveBeenCalledWith({ sinceMs: null });
  });

  it("calls onChange with untilMs=null when until date is cleared", () => {
    const { onChange } = setup({ untilMs: Date.now() });
    fireEvent.change(screen.getByLabelText("Until (date filter)"), {
      target: { value: "" },
    });
    expect(onChange).toHaveBeenCalledWith({ untilMs: null });
  });

  it("calls onChange with untilMs when a valid until date is entered", () => {
    const { onChange } = setup();
    fireEvent.change(screen.getByLabelText("Until (date filter)"), {
      target: { value: "2024-06-30" },
    });
    expect(onChange).toHaveBeenCalledWith({ untilMs: expect.any(Number) });
  });

  it("calls onReset when Reset button is clicked", () => {
    const { onReset } = setup();
    fireEvent.click(screen.getByRole("button", { name: /reset/i }));
    expect(onReset).toHaveBeenCalledOnce();
  });

  it("renders controls as disabled when disabled prop is true", () => {
    setup({}, true);
    for (const el of screen.getAllByRole("combobox")) {
      expect(el).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: /reset/i })).toBeDisabled();
  });

  it("shows formatted date in Since input when sinceMs is set", () => {
    const ms = new Date("2024-03-20").getTime();
    setup({ sinceMs: ms });
    const input = screen.getByLabelText("Since (date filter)") as HTMLInputElement;
    expect(input.value).toMatch(/2024-03-2\d/);
  });
});
