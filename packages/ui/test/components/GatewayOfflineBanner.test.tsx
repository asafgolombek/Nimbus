import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GatewayOfflineBanner } from "../../src/components/GatewayOfflineBanner";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn<(cmd: string) => Promise<unknown>>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

describe("GatewayOfflineBanner", () => {
  beforeEach(() => invokeMock.mockReset());
  afterEach(() => invokeMock.mockReset());

  it("renders the offline message and a Start Gateway button", () => {
    render(<GatewayOfflineBanner />);
    expect(screen.getByText(/Gateway is not running/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /start gateway/i })).toBeTruthy();
  });

  it("invokes shell_start_gateway when the button is clicked", () => {
    invokeMock.mockResolvedValueOnce(null);
    render(<GatewayOfflineBanner />);
    fireEvent.click(screen.getByRole("button", { name: /start gateway/i }));
    expect(invokeMock).toHaveBeenCalledWith("shell_start_gateway");
  });

  it("shows the error message when invoke throws an Error", async () => {
    invokeMock.mockRejectedValueOnce(new Error("permission denied"));
    render(<GatewayOfflineBanner />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /start gateway/i }));
      await Promise.resolve();
    });
    expect(screen.getByText(/permission denied/)).toBeInTheDocument();
  });

  it("shows a stringified error when invoke throws a non-Error value", async () => {
    invokeMock.mockRejectedValueOnce("gateway not found");
    render(<GatewayOfflineBanner />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /start gateway/i }));
      await Promise.resolve();
    });
    expect(screen.getByText(/gateway not found/)).toBeInTheDocument();
  });
});
