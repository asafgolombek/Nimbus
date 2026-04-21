import { describe, expect, it } from "vitest";
import { create } from "zustand";
import { type ConnectorsSlice, createConnectorsSlice } from "../../src/store/slices/connectors";

function makeStore() {
  return create<ConnectorsSlice>()((...a) => createConnectorsSlice(...a));
}

describe("connectors slice (Plan 2 stub — persists list only)", () => {
  it("initial list is empty", () => {
    expect(makeStore().getState().connectorsList).toEqual([]);
  });

  it("setConnectorsList replaces the list", () => {
    const store = makeStore();
    store.getState().setConnectorsList([
      {
        service: "github",
        intervalMs: 300_000,
        depth: "summary",
        enabled: true,
        health: "healthy",
      },
    ]);
    expect(store.getState().connectorsList).toHaveLength(1);
    expect(store.getState().connectorsList[0]?.service).toBe("github");
  });
});
