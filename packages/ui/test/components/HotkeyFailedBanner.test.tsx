import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (e: { payload: unknown }) => void;
const handlers: Handler[] = [];
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_event: string, h: Handler) => {
    handlers.push(h);
    return () => {};
  }),
}));

import { HotkeyFailedBanner } from "../../src/components/HotkeyFailedBanner";

describe("HotkeyFailedBanner", () => {
  beforeEach(() => {
    handlers.length = 0;
  });

  it("renders nothing until the tray emits hotkey-failed", () => {
    const { container } = render(<HotkeyFailedBanner />);
    expect(container.textContent).toBe("");
  });

  it("renders the conflict message when the event fires", async () => {
    render(<HotkeyFailedBanner />);
    await waitFor(() => expect(handlers.length).toBeGreaterThan(0));
    handlers[0]!({ payload: "already bound" });
    expect(await screen.findByText(/could not be registered/i)).toBeTruthy();
  });

  it("Dismiss hides the banner", async () => {
    render(<HotkeyFailedBanner />);
    await waitFor(() => expect(handlers.length).toBeGreaterThan(0));
    handlers[0]!({ payload: "already bound" });
    fireEvent.click(await screen.findByRole("button", { name: /dismiss/i }));
    expect(screen.queryByText(/could not be registered/i)).toBeNull();
  });
});
