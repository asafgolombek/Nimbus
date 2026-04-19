import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/ipc/client");
vi.mock("../../src/store", () => ({
  useNimbusStore: (selector: (s: { connectionState: string }) => unknown) =>
    selector({ connectionState: "connected" }),
}));

import { useIpcQuery } from "../../src/hooks/useIpcQuery";
import { callMock } from "../../src/ipc/__mocks__/client";

describe("useIpcQuery", () => {
  beforeEach(() => {
    callMock.mockReset();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls the method once on mount", async () => {
    callMock.mockResolvedValue({ ok: 1 });
    const { result } = renderHook(() => useIpcQuery<{ ok: number }>("x", 30_000));
    await waitFor(() => expect(result.current.data).toEqual({ ok: 1 }));
    expect(callMock).toHaveBeenCalledTimes(1);
    expect(callMock).toHaveBeenCalledWith("x", {});
  });

  it("re-calls at interval", async () => {
    callMock.mockResolvedValue("y");
    renderHook(() => useIpcQuery<string>("m", 1_000));
    await waitFor(() => expect(callMock).toHaveBeenCalledTimes(1));
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    await waitFor(() => expect(callMock).toHaveBeenCalledTimes(2));
  });

  it("pauses while tab hidden", async () => {
    callMock.mockResolvedValue("y");
    renderHook(() => useIpcQuery<string>("m", 1_000));
    await waitFor(() => expect(callMock).toHaveBeenCalledTimes(1));

    Object.defineProperty(document, "visibilityState", { value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(callMock).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "visibilityState", { value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(callMock).toHaveBeenCalledTimes(2));
  });

  it("exposes error on rejection", async () => {
    callMock.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useIpcQuery<string>("m", 30_000));
    await waitFor(() => expect(result.current.error).toBe("boom"));
  });

  it("refetch() fires an immediate call", async () => {
    callMock.mockResolvedValue("v");
    const { result } = renderHook(() => useIpcQuery<string>("m", 30_000));
    await waitFor(() => expect(callMock).toHaveBeenCalledTimes(1));
    act(() => {
      result.current.refetch();
    });
    await waitFor(() => expect(callMock).toHaveBeenCalledTimes(2));
  });
});
