import { beforeEach, describe, expect, it } from "vitest";
import { useNimbusStore } from "../../src/store";

describe("onboarding slice", () => {
  beforeEach(() => {
    useNimbusStore.getState().resetOnboarding();
  });

  it("toggles selection on/off", () => {
    useNimbusStore.getState().toggleSelected("github");
    expect(useNimbusStore.getState().selected.has("github")).toBe(true);
    useNimbusStore.getState().toggleSelected("github");
    expect(useNimbusStore.getState().selected.has("github")).toBe(false);
  });

  it("records per-service auth status", () => {
    useNimbusStore.getState().setAuthStatus("github", "authenticating");
    expect(useNimbusStore.getState().authStatus.github).toBe("authenticating");
    useNimbusStore.getState().setAuthStatus("github", "connected");
    expect(useNimbusStore.getState().authStatus.github).toBe("connected");
  });

  it("reset clears both selection and status", () => {
    useNimbusStore.getState().toggleSelected("github");
    useNimbusStore.getState().setAuthStatus("github", "connected");
    useNimbusStore.getState().resetOnboarding();
    expect(useNimbusStore.getState().selected.size).toBe(0);
    expect(useNimbusStore.getState().authStatus).toEqual({});
  });
});
