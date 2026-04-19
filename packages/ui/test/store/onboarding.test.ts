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

describe("connection slice", () => {
  beforeEach(() => {
    useNimbusStore.setState({
      connectionState: "initializing",
      reconnectAttempts: 0,
      lastConnectedAt: null,
    });
  });

  it("setConnectionState('connecting') increments reconnectAttempts", () => {
    useNimbusStore.getState().setConnectionState("connecting");
    expect(useNimbusStore.getState().reconnectAttempts).toBe(1);
    useNimbusStore.getState().setConnectionState("connecting");
    expect(useNimbusStore.getState().reconnectAttempts).toBe(2);
  });

  it("setConnectionState('connected') resets reconnectAttempts to 0 and sets lastConnectedAt", () => {
    useNimbusStore.getState().setConnectionState("connecting");
    useNimbusStore.getState().setConnectionState("connecting");
    expect(useNimbusStore.getState().reconnectAttempts).toBe(2);

    const before = Date.now();
    useNimbusStore.getState().setConnectionState("connected");
    const after = Date.now();

    expect(useNimbusStore.getState().reconnectAttempts).toBe(0);
    const lastConnectedAt = useNimbusStore.getState().lastConnectedAt;
    expect(lastConnectedAt).not.toBeNull();
    expect(lastConnectedAt!).toBeGreaterThanOrEqual(before);
    expect(lastConnectedAt!).toBeLessThanOrEqual(after);
  });

  it("setConnectionState with other state preserves reconnectAttempts", () => {
    useNimbusStore.getState().setConnectionState("connecting");
    expect(useNimbusStore.getState().reconnectAttempts).toBe(1);
    useNimbusStore.getState().setConnectionState("disconnected");
    expect(useNimbusStore.getState().reconnectAttempts).toBe(1);
  });
});
