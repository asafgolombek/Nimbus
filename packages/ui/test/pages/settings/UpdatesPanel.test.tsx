import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/ipc/client");
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));

import {
  callMock,
  updaterApplyUpdateMock,
  updaterCheckNowMock,
  updaterGetStatusMock,
  updaterRollbackMock,
} from "../../../src/ipc/__mocks__/client";
import { UpdatesPanel } from "../../../src/pages/settings/UpdatesPanel";
import { useNimbusStore } from "../../../src/store";

beforeEach(() => {
  callMock.mockReset();
  updaterApplyUpdateMock.mockReset();
  updaterCheckNowMock.mockReset();
  updaterGetStatusMock.mockReset();
  updaterRollbackMock.mockReset();
  useNimbusStore.setState({
    connectionState: "connected",
    updaterStatus: null,
    updaterUiState: "idle",
    updaterCheck: null,
    updaterDownload: null,
    updaterRestarting: null,
    updaterFailure: null,
  } as never);
  updaterGetStatusMock.mockResolvedValue({
    state: "idle",
    currentVersion: "0.1.0",
    configUrl: "https://updates.nimbus.dev/manifest.json",
  });
});

afterEach(() => {
  useNimbusStore.setState({
    updaterStatus: null,
    updaterUiState: "idle",
    updaterCheck: null,
    updaterDownload: null,
    updaterRestarting: null,
    updaterFailure: null,
  } as never);
});

describe("UpdatesPanel (slimmed; subscriptions live in UpdaterRestartChrome)", () => {
  it("renders current version once status loads", async () => {
    render(<UpdatesPanel />);
    await waitFor(() => expect(screen.getByText("0.1.0")).toBeTruthy());
  });

  it("Check now success with no update keeps state idle", async () => {
    updaterCheckNowMock.mockResolvedValueOnce({
      currentVersion: "0.1.0",
      latestVersion: "0.1.0",
      updateAvailable: false,
    });
    render(<UpdatesPanel />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Check now" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    await waitFor(() => expect(useNimbusStore.getState().updaterUiState).toBe("idle"));
    expect(useNimbusStore.getState().updaterCheck?.updateAvailable).toBe(false);
  });

  it("Check now success with update flips to `available` and surfaces Apply button + notes", async () => {
    updaterCheckNowMock.mockResolvedValueOnce({
      currentVersion: "0.1.0",
      latestVersion: "0.2.0",
      updateAvailable: true,
      notes: "Bug fixes and improvements.",
    });
    render(<UpdatesPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    await waitFor(() => expect(useNimbusStore.getState().updaterUiState).toBe("available"));
    expect(screen.getByRole("button", { name: /Apply 0.2.0/ })).toBeTruthy();
    expect(screen.getByText(/Bug fixes and improvements/)).toBeTruthy();
  });

  it("Apply runs updater_apply_started + updaterApplyUpdate and flips to applying", async () => {
    useNimbusStore.setState({
      updaterUiState: "available",
      updaterCheck: { currentVersion: "0.1.0", latestVersion: "0.2.0", updateAvailable: true },
    } as never);
    updaterApplyUpdateMock.mockResolvedValueOnce({ jobId: "x" });
    render(<UpdatesPanel />);
    await waitFor(() => screen.getByRole("button", { name: /Apply 0.2.0/ }));
    fireEvent.click(screen.getByRole("button", { name: /Apply 0.2.0/ }));
    await waitFor(() => expect(useNimbusStore.getState().updaterUiState).toBe("applying"));
    expect(updaterApplyUpdateMock).toHaveBeenCalledTimes(1);
  });

  it("Rollback button surfaces only when prior state is rolled_back/failed and runs updater.rollback", async () => {
    updaterGetStatusMock.mockResolvedValueOnce({
      state: "rolled_back",
      currentVersion: "0.1.0",
      configUrl: "u",
      lastError: "previous install failed",
    });
    updaterRollbackMock.mockResolvedValueOnce({ ok: true });
    render(<UpdatesPanel />);
    await waitFor(() => expect(screen.getByText(/previous install failed/)).toBeTruthy());
    const rollback = screen.getByRole("button", { name: "Rollback" });
    fireEvent.click(rollback);
    await waitFor(() => expect(updaterRollbackMock).toHaveBeenCalledTimes(1));
  });

  it("Disconnected state disables Check now", async () => {
    useNimbusStore.setState({ connectionState: "disconnected" } as never);
    render(<UpdatesPanel />);
    await waitFor(() => expect(screen.getByText("0.1.0")).toBeTruthy());
    expect((screen.getByRole("button", { name: "Check now" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
