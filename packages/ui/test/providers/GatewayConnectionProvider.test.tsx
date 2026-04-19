import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler<T> = (payload: T) => void;
const connectionHandlers: Handler<string>[] = [];
const notificationHandlers: Handler<{ method: string; params: unknown }>[] = [];
const callMock = vi.fn<(method: string, params?: unknown) => Promise<unknown>>();

vi.mock("../../src/ipc/client", async () => {
  return {
    createIpcClient: () => ({
      call: callMock,
      subscribe: async (h: Handler<{ method: string; params: unknown }>) => {
        notificationHandlers.push(h);
        return () => {};
      },
      onConnectionState: async (h: Handler<string>) => {
        connectionHandlers.push(h);
        return () => {};
      },
    }),
  };
});

import { useLocation } from "react-router-dom";
import { GatewayConnectionProvider } from "../../src/providers/GatewayConnectionProvider";
import { useNimbusStore } from "../../src/store";

function Consumer({ onPath }: { onPath: (p: string) => void }) {
  const loc = useLocation();
  onPath(loc.pathname);
  return null;
}

describe("GatewayConnectionProvider", () => {
  beforeEach(() => {
    connectionHandlers.length = 0;
    notificationHandlers.length = 0;
    callMock.mockReset();
    useNimbusStore.setState({ connectionState: "initializing" });
  });

  it("mirrors connection state into the store", async () => {
    render(
      <MemoryRouter>
        <GatewayConnectionProvider>
          <div>child</div>
        </GatewayConnectionProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(connectionHandlers.length).toBeGreaterThan(0));
    connectionHandlers[0]?.("connected");

    await waitFor(() => expect(useNimbusStore.getState().connectionState).toBe("connected"));
  });

  it("routes to / when diag.snapshot has items (returning user)", async () => {
    callMock.mockImplementation(async (method) => {
      if (method === "diag.snapshot") return { indexTotalItems: 5, connectorCount: 2 };
      if (method === "db.getMeta") return "true";
      throw new Error(`unexpected method ${method}`);
    });

    const seen: string[] = [];

    const { rerender } = render(
      <MemoryRouter initialEntries={["/onboarding/welcome"]}>
        <GatewayConnectionProvider>
          <Consumer onPath={(p) => seen.push(p)} />
        </GatewayConnectionProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(connectionHandlers.length).toBeGreaterThan(0));
    connectionHandlers[0]?.("connected");

    await waitFor(() => expect(seen[seen.length - 1]).toBe("/"));
    rerender(<div />);
  });

  it("routes to / when meta is non-null even with zero items", async () => {
    callMock.mockImplementation(async (method) => {
      if (method === "diag.snapshot") return { indexTotalItems: 0, connectorCount: 0 };
      if (method === "db.getMeta") return "true";
      throw new Error(`unexpected method ${method}`);
    });

    const seen: string[] = [];

    const { rerender } = render(
      <MemoryRouter initialEntries={["/onboarding/welcome"]}>
        <GatewayConnectionProvider>
          <Consumer onPath={(p) => seen.push(p)} />
        </GatewayConnectionProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(connectionHandlers.length).toBeGreaterThan(0));
    connectionHandlers[0]?.("connected");

    await waitFor(() => expect(seen[seen.length - 1]).toBe("/"));
    rerender(<div />);
  });

  it("routes to /onboarding/welcome on first connected when no data and no meta", async () => {
    callMock.mockImplementation(async (method) => {
      if (method === "diag.snapshot") return { indexTotalItems: 0, connectorCount: 0 };
      if (method === "db.getMeta") return null;
      throw new Error(`unexpected method ${method}`);
    });

    const seen: string[] = [];

    const { rerender } = render(
      <MemoryRouter initialEntries={["/"]}>
        <GatewayConnectionProvider>
          <Consumer onPath={(p) => seen.push(p)} />
        </GatewayConnectionProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(connectionHandlers.length).toBeGreaterThan(0));
    connectionHandlers[0]?.("connected");

    await waitFor(() => expect(seen[seen.length - 1]).toBe("/onboarding/welcome"));
    rerender(<div />);
  });
});
