import { describe, expect, it } from "vitest";
import { create } from "zustand";
import { createModelSlice, type ModelSlice } from "../../src/store/slices/model";

function makeStore() {
  return create<ModelSlice>()((...a) => createModelSlice(...a));
}

describe("model slice (Plan 2 stub — persists installed list + activePullId)", () => {
  it("initial state is empty list + null pullId", () => {
    const s = makeStore().getState();
    expect(s.installedModels).toEqual([]);
    expect(s.activePullId).toBeNull();
  });

  it("setInstalledModels + setActivePullId update correctly", () => {
    const store = makeStore();
    store.getState().setInstalledModels([{ id: "gemma:2b", provider: "ollama" }]);
    store.getState().setActivePullId("pull-abc123");
    expect(store.getState().installedModels).toHaveLength(1);
    expect(store.getState().activePullId).toBe("pull-abc123");
  });

  it("setActivePullId(null) clears the active pull", () => {
    const store = makeStore();
    store.getState().setActivePullId("pull-abc");
    store.getState().setActivePullId(null);
    expect(store.getState().activePullId).toBeNull();
  });
});
