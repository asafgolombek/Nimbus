import { beforeEach, describe, expect, it } from "vitest";
import { create } from "zustand";
import { createSettingsSlice, type SettingsSlice } from "../../src/store/slices/settings";

function makeStore() {
  return create<SettingsSlice>()((...a) => createSettingsSlice(...a));
}

describe("settings slice", () => {
  let store: ReturnType<typeof makeStore>;
  beforeEach(() => {
    store = makeStore();
  });

  it("initial activePanel is null", () => {
    expect(store.getState().activePanel).toBeNull();
  });

  it("setActivePanel stores the panel key", () => {
    store.getState().setActivePanel("profiles");
    expect(store.getState().activePanel).toBe("profiles");
  });

  it("setActivePanel(null) clears the active panel", () => {
    store.getState().setActivePanel("telemetry");
    store.getState().setActivePanel(null);
    expect(store.getState().activePanel).toBeNull();
  });
});
