import { fireEvent, render, screen } from "@testing-library/react";
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
});
