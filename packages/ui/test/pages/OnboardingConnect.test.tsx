import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const callMock = vi.fn<(method: string, params?: unknown) => Promise<unknown>>();
vi.mock("../../src/ipc/client", () => ({
  createIpcClient: () => ({
    call: callMock,
    subscribe: async () => () => {},
    onConnectionState: async () => () => {},
  }),
}));

import { Connect } from "../../src/pages/onboarding/Connect";
import { useNimbusStore } from "../../src/store";

function renderAt() {
  return render(
    <MemoryRouter initialEntries={["/onboarding/connect"]}>
      <Routes>
        <Route path="/onboarding/connect" element={<Connect />} />
        <Route path="/onboarding/syncing" element={<div>syncing</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Onboarding → Connect", () => {
  beforeEach(() => {
    callMock.mockReset();
    useNimbusStore.getState().resetOnboarding();
  });

  it("renders the 6 connector cards", () => {
    renderAt();
    for (const name of ["Google Drive", "GitHub", "Slack", "Linear", "Notion", "Gmail"]) {
      expect(screen.getByText(name)).toBeTruthy();
    }
  });

  it("clicking a card toggles its selection in the store", () => {
    renderAt();
    fireEvent.click(screen.getByText("GitHub"));
    expect(useNimbusStore.getState().selected.has("GitHub")).toBe(true);
    fireEvent.click(screen.getByText("GitHub"));
    expect(useNimbusStore.getState().selected.has("GitHub")).toBe(false);
  });

  it("Authenticate dispatches connector.startAuth for each selected", async () => {
    callMock.mockImplementation(async (method) => {
      if (method === "connector.startAuth") return null;
      if (method === "connector.list") return [{ name: "GitHub", state: "healthy" }];
      throw new Error(`unexpected ${method}`);
    });
    renderAt();
    fireEvent.click(screen.getByText("GitHub"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /authenticate/i }));
    });
    await waitFor(() =>
      expect(callMock).toHaveBeenCalledWith("connector.startAuth", { service: "GitHub" }),
    );
  });
});
