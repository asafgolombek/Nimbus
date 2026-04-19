import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const callMock = vi.fn<(method: string, params?: unknown) => Promise<unknown>>();
type NotifHandler = (n: { method: string; params: unknown }) => void;
const notifHandlers: NotifHandler[] = [];

vi.mock("../../src/ipc/client", () => ({
  createIpcClient: () => ({
    call: callMock,
    subscribe: async (h: NotifHandler) => {
      notifHandlers.push(h);
      return () => {};
    },
    onConnectionState: async () => () => {},
  }),
}));

const closeMock = vi.fn();
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ close: closeMock }),
}));

import { QuickQuery } from "../../src/pages/QuickQuery";

describe("QuickQuery", () => {
  beforeEach(() => {
    callMock.mockReset();
    notifHandlers.length = 0;
    closeMock.mockReset();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it("submits a prompt and renders streamed tokens", async () => {
    callMock.mockResolvedValueOnce({ streamId: "s1" });
    render(
      <MemoryRouter>
        <QuickQuery />
      </MemoryRouter>,
    );
    const input = screen.getByPlaceholderText(/ask nimbus/i);
    fireEvent.change(input, { target: { value: "summarize my week" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    await waitFor(() => expect(notifHandlers.length).toBeGreaterThan(0));
    act(() =>
      (notifHandlers.at(0) as NotifHandler)({
        method: "engine.streamToken",
        params: { streamId: "s1", text: "Hello" },
      }),
    );
    act(() =>
      (notifHandlers.at(0) as NotifHandler)({
        method: "engine.streamToken",
        params: { streamId: "s1", text: ", world" },
      }),
    );
    expect(screen.getByText(/Hello, world/)).toBeTruthy();
  });

  it("closes the window 2s after streamDone", async () => {
    callMock.mockResolvedValueOnce({ streamId: "s2" });
    render(
      <MemoryRouter>
        <QuickQuery />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByPlaceholderText(/ask nimbus/i), { target: { value: "hi" } });
    fireEvent.submit(screen.getByPlaceholderText(/ask nimbus/i).closest("form") as HTMLFormElement);

    await waitFor(() => expect(notifHandlers.length).toBeGreaterThan(0));
    act(() =>
      (notifHandlers.at(0) as NotifHandler)({
        method: "engine.streamDone",
        params: { streamId: "s2", model: "local · llama-3.1-8b" },
      }),
    );
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    await waitFor(() => expect(closeMock).toHaveBeenCalled());
  });

  it("closes immediately on Escape", () => {
    render(
      <MemoryRouter>
        <QuickQuery />
      </MemoryRouter>,
    );
    fireEvent.keyDown(globalThis, { key: "Escape" });
    expect(closeMock).toHaveBeenCalled();
  });

  it("does not call IPC when prompt is empty or whitespace", async () => {
    render(
      <MemoryRouter>
        <QuickQuery />
      </MemoryRouter>,
    );
    fireEvent.submit(screen.getByPlaceholderText(/ask nimbus/i).closest("form") as HTMLFormElement);
    await new Promise((r) => setTimeout(r, 0));
    expect(callMock).not.toHaveBeenCalled();
  });

  it("shows local model label from meta when streamDone has no model field", async () => {
    callMock.mockResolvedValueOnce({ streamId: "s3" });
    render(
      <MemoryRouter>
        <QuickQuery />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByPlaceholderText(/ask nimbus/i), { target: { value: "hi" } });
    fireEvent.submit(screen.getByPlaceholderText(/ask nimbus/i).closest("form") as HTMLFormElement);

    await waitFor(() => expect(notifHandlers.length).toBeGreaterThan(0));
    act(() =>
      (notifHandlers.at(0) as NotifHandler)({
        method: "engine.streamDone",
        params: { streamId: "s3", meta: { isLocal: true, modelUsed: "gemma2" } },
      }),
    );
    await waitFor(() => expect(screen.getByText(/local · gemma2/)).toBeTruthy());
  });

  it("shows remote model label from meta when not local", async () => {
    callMock.mockResolvedValueOnce({ streamId: "s4" });
    render(
      <MemoryRouter>
        <QuickQuery />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByPlaceholderText(/ask nimbus/i), { target: { value: "hi" } });
    fireEvent.submit(screen.getByPlaceholderText(/ask nimbus/i).closest("form") as HTMLFormElement);

    await waitFor(() => expect(notifHandlers.length).toBeGreaterThan(0));
    act(() =>
      (notifHandlers.at(0) as NotifHandler)({
        method: "engine.streamDone",
        params: { streamId: "s4", meta: { isLocal: false, modelUsed: "gpt-4o" } },
      }),
    );
    await waitFor(() => expect(screen.getByText(/gpt-4o/)).toBeTruthy());
  });
});
