import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/ipc/client");

import {
  llmGetRouterStatusMock,
  llmGetStatusMock,
  llmListModelsMock,
  llmLoadModelMock,
  llmSetDefaultMock,
  llmUnloadModelMock,
  subscribeMock,
} from "../../../src/ipc/__mocks__/client";
import { ModelPanel } from "../../../src/pages/settings/ModelPanel";
import { useNimbusStore } from "../../../src/store";

function renderPanel() {
  return render(
    <MemoryRouter>
      <ModelPanel />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  llmListModelsMock.mockReset();
  llmGetRouterStatusMock.mockReset();
  llmGetStatusMock.mockReset();
  llmLoadModelMock.mockReset();
  llmUnloadModelMock.mockReset();
  llmSetDefaultMock.mockReset();
  subscribeMock.mockReset();
  subscribeMock.mockResolvedValue(() => {});
  useNimbusStore.setState({
    installedModels: [],
    activePullId: null,
    pullProgress: {},
    pullStalled: false,
    routerStatus: null,
    loadedKeys: {},
    connectionState: "connected",
  } as never);
});

describe("ModelPanel", () => {
  it("fetches listModels and getRouterStatus on mount and renders both", async () => {
    llmListModelsMock.mockResolvedValueOnce({
      models: [
        { provider: "ollama", modelName: "gemma:2b" },
        { provider: "llamacpp", modelName: "llama3:8b-q4" },
      ],
    });
    llmGetRouterStatusMock.mockResolvedValueOnce({
      decisions: {
        classification: { providerId: "ollama", modelName: "gemma:2b", reason: "default" },
      },
    });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("gemma:2b")).toBeInTheDocument();
      expect(screen.getByText("llama3:8b-q4")).toBeInTheDocument();
      expect(screen.getByTestId("router-status")).toBeInTheDocument();
    });
  });

  it("Load button calls llmLoadModel with the row's provider + modelName", async () => {
    llmListModelsMock.mockResolvedValueOnce({
      models: [{ provider: "ollama", modelName: "gemma:2b" }],
    });
    llmGetRouterStatusMock.mockResolvedValueOnce({ decisions: {} });
    llmLoadModelMock.mockResolvedValueOnce({ isLoaded: true });
    renderPanel();
    await waitFor(() => screen.getByRole("button", { name: /load gemma:2b/i }));
    await userEvent.click(screen.getByRole("button", { name: /load gemma:2b/i }));
    await waitFor(() => expect(llmLoadModelMock).toHaveBeenCalledWith("ollama", "gemma:2b"));
  });

  it("Unload button calls llmUnloadModel when the row is loaded", async () => {
    useNimbusStore.setState({ loadedKeys: { "ollama:gemma:2b": true } } as never);
    llmListModelsMock.mockResolvedValueOnce({
      models: [{ provider: "ollama", modelName: "gemma:2b" }],
    });
    llmGetRouterStatusMock.mockResolvedValueOnce({ decisions: {} });
    llmUnloadModelMock.mockResolvedValueOnce({ isLoaded: false });
    renderPanel();
    await waitFor(() => screen.getByRole("button", { name: /unload gemma:2b/i }));
    await userEvent.click(screen.getByRole("button", { name: /unload gemma:2b/i }));
    await waitFor(() => expect(llmUnloadModelMock).toHaveBeenCalledWith("ollama", "gemma:2b"));
  });

  it("Set-default picker calls llmSetDefault with taskType, provider, modelName", async () => {
    llmListModelsMock.mockResolvedValueOnce({
      models: [{ provider: "ollama", modelName: "gemma:2b" }],
    });
    llmGetRouterStatusMock.mockResolvedValueOnce({ decisions: {} });
    llmSetDefaultMock.mockResolvedValueOnce({
      taskType: "reasoning",
      provider: "ollama",
      modelName: "gemma:2b",
    });
    // After setDefault we refetch getRouterStatus.
    llmGetRouterStatusMock.mockResolvedValueOnce({
      decisions: {
        reasoning: { providerId: "ollama", modelName: "gemma:2b", reason: "default" },
      },
    });
    renderPanel();
    await waitFor(() => screen.getByLabelText("gemma:2b default-for"));
    await userEvent.selectOptions(screen.getByLabelText("gemma:2b default-for"), "reasoning");
    await waitFor(() =>
      expect(llmSetDefaultMock).toHaveBeenCalledWith("reasoning", "ollama", "gemma:2b"),
    );
  });

  it("opens PullDialog when 'Pull new model…' is clicked", async () => {
    llmListModelsMock.mockResolvedValueOnce({ models: [] });
    llmGetRouterStatusMock.mockResolvedValueOnce({ decisions: {} });
    llmGetStatusMock.mockResolvedValueOnce({ available: { ollama: true, llamacpp: true } });
    renderPanel();
    await waitFor(() => screen.getByRole("button", { name: /pull new model/i }));
    await userEvent.click(screen.getByRole("button", { name: /pull new model/i }));
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: /pull model/i })).toBeInTheDocument(),
    );
  });

  it("llm.modelLoaded notification patches the row's loaded indicator", async () => {
    llmListModelsMock.mockResolvedValueOnce({
      models: [{ provider: "ollama", modelName: "gemma:2b" }],
    });
    llmGetRouterStatusMock.mockResolvedValueOnce({ decisions: {} });
    let captured: ((n: { method: string; params: unknown }) => void) | null = null;
    subscribeMock.mockImplementation(async (handler) => {
      captured = handler;
      return () => {};
    });
    renderPanel();
    await waitFor(() => screen.getByRole("button", { name: /load gemma:2b/i }));
    captured?.({
      method: "llm.modelLoaded",
      params: { provider: "ollama", modelName: "gemma:2b" },
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /unload gemma:2b/i })).toBeInTheDocument(),
    );
  });

  it("surfaces pull progress from a persisted activePullId (re-attach on reload)", async () => {
    useNimbusStore.setState({
      activePullId: "pull_abc",
      pullProgress: {
        pull_abc: {
          pullId: "pull_abc",
          provider: "ollama",
          modelName: "gemma:2b",
          status: "downloading",
          completedBytes: 250,
          totalBytes: 1000,
        },
      },
    } as never);
    llmListModelsMock.mockResolvedValueOnce({ models: [] });
    llmGetRouterStatusMock.mockResolvedValueOnce({ decisions: {} });
    renderPanel();
    await waitFor(() =>
      expect(screen.getByTestId("active-pull-banner")).toHaveTextContent(/gemma:2b/),
    );
    expect(screen.getByTestId("active-pull-banner")).toHaveTextContent(/25%/);
  });

  it("disables write controls when connectionState=disconnected", async () => {
    useNimbusStore.setState({ connectionState: "disconnected" } as never);
    llmListModelsMock.mockRejectedValueOnce(new Error("offline"));
    llmGetRouterStatusMock.mockRejectedValueOnce(new Error("offline"));
    useNimbusStore.setState({
      installedModels: [{ id: "ollama:gemma:2b", provider: "ollama" }],
    } as never);
    renderPanel();
    await waitFor(() => screen.getByRole("button", { name: /pull new model/i }));
    expect(screen.getByRole("button", { name: /pull new model/i })).toBeDisabled();
  });
});
