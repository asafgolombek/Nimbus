import { beforeEach, describe, expect, it } from "vitest";
import { create } from "zustand";
import { createTraySlice, type TraySlice } from "../../src/store/slices/tray";

describe("tray slice WS5-B extensions", () => {
  let useStore: ReturnType<typeof create<TraySlice>>;
  beforeEach(() => {
    useStore = create<TraySlice>()((...a) => createTraySlice(...a));
  });

  it("aggregateHealth=red when any connector is unauthenticated", () => {
    useStore.getState().recomputeAggregate([
      { name: "a", health: "healthy" },
      { name: "b", health: "unauthenticated" },
    ]);
    expect(useStore.getState().aggregateHealth).toBe("red");
  });

  it("aggregateHealth=amber when any connector is degraded and none is red", () => {
    useStore.getState().recomputeAggregate([
      { name: "a", health: "healthy" },
      { name: "b", health: "degraded" },
    ]);
    expect(useStore.getState().aggregateHealth).toBe("amber");
  });

  it("aggregateHealth=normal when all healthy", () => {
    useStore.getState().recomputeAggregate([{ name: "a", health: "healthy" }]);
    expect(useStore.getState().aggregateHealth).toBe("normal");
  });

  it("setPendingHitl updates badge count and floors at 0", () => {
    useStore.getState().setPendingHitl(2);
    expect(useStore.getState().pendingHitl).toBe(2);
    useStore.getState().setPendingHitl(-1);
    expect(useStore.getState().pendingHitl).toBe(0);
  });

  it("setConnectorsMenu replaces the menu", () => {
    useStore.getState().setConnectorsMenu([{ name: "drive", health: "healthy" }]);
    expect(useStore.getState().connectorsMenu).toHaveLength(1);
  });
});
