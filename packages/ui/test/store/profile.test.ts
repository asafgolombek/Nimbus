import { beforeEach, describe, expect, it } from "vitest";
import { create } from "zustand";
import { createProfileSlice, type ProfileSlice } from "../../src/store/slices/profile";

function makeStore() {
  return create<ProfileSlice>()((...a) => createProfileSlice(...a));
}

describe("profile slice", () => {
  let store: ReturnType<typeof makeStore>;
  beforeEach(() => {
    store = makeStore();
  });

  it("initial state: active=null, profiles=[], lastFetchAt=null", () => {
    const s = store.getState();
    expect(s.active).toBeNull();
    expect(s.profiles).toEqual([]);
    expect(s.lastFetchAt).toBeNull();
  });

  it("setProfileList replaces list + active + stamps lastFetchAt", () => {
    const before = Date.now();
    store.getState().setProfileList({
      profiles: [{ name: "default" }, { name: "work" }],
      active: "default",
    });
    const s = store.getState();
    expect(s.profiles.map((p) => p.name)).toEqual(["default", "work"]);
    expect(s.active).toBe("default");
    expect(s.lastFetchAt).not.toBeNull();
    expect(s.lastFetchAt ?? 0).toBeGreaterThanOrEqual(before);
  });

  it("setActiveProfileOptimistic updates active without altering the list", () => {
    store.getState().setProfileList({
      profiles: [{ name: "default" }, { name: "work" }],
      active: "default",
    });
    store.getState().setActiveProfileOptimistic("work");
    expect(store.getState().active).toBe("work");
    expect(store.getState().profiles.map((p) => p.name)).toEqual(["default", "work"]);
  });

  it("setProfileActionInFlight toggles the flag", () => {
    store.getState().setProfileActionInFlight(true);
    expect(store.getState().actionInFlight).toBe(true);
    store.getState().setProfileActionInFlight(false);
    expect(store.getState().actionInFlight).toBe(false);
  });
});
