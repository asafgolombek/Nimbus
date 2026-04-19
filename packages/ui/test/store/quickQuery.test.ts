import { beforeEach, describe, expect, it } from "vitest";
import { useNimbusStore } from "../../src/store";

describe("quickQuery slice", () => {
  beforeEach(() => {
    useNimbusStore.getState().reset();
  });

  it("startStream sets streamId and clears tokens/modelLabel/doneAt", () => {
    useNimbusStore.getState().startStream("s1");
    expect(useNimbusStore.getState().streamId).toBe("s1");
    expect(useNimbusStore.getState().tokens).toEqual([]);
    expect(useNimbusStore.getState().modelLabel).toBeNull();
    expect(useNimbusStore.getState().doneAt).toBeNull();
  });

  it("appendToken with matching streamId appends the token", () => {
    useNimbusStore.getState().startStream("s1");
    useNimbusStore.getState().appendToken("s1", "Hello");
    useNimbusStore.getState().appendToken("s1", " world");
    expect(useNimbusStore.getState().tokens).toEqual(["Hello", " world"]);
  });

  it("appendToken with mismatching streamId is a no-op", () => {
    useNimbusStore.getState().startStream("s1");
    useNimbusStore.getState().appendToken("s1", "Hello");
    useNimbusStore.getState().appendToken("wrong-id", " ignored");
    expect(useNimbusStore.getState().tokens).toEqual(["Hello"]);
  });

  it("markDone with matching streamId sets modelLabel and doneAt", () => {
    useNimbusStore.getState().startStream("s1");
    const before = Date.now();
    useNimbusStore.getState().markDone("s1", "local · llama-3.1-8b");
    const after = Date.now();
    expect(useNimbusStore.getState().modelLabel).toBe("local · llama-3.1-8b");
    expect(useNimbusStore.getState().doneAt).not.toBeNull();
    expect(useNimbusStore.getState().doneAt!).toBeGreaterThanOrEqual(before);
    expect(useNimbusStore.getState().doneAt!).toBeLessThanOrEqual(after);
  });

  it("markDone with mismatching streamId is a no-op", () => {
    useNimbusStore.getState().startStream("s1");
    useNimbusStore.getState().markDone("wrong-id", "some-model");
    expect(useNimbusStore.getState().modelLabel).toBeNull();
    expect(useNimbusStore.getState().doneAt).toBeNull();
  });

  it("reset clears all state", () => {
    useNimbusStore.getState().startStream("s1");
    useNimbusStore.getState().appendToken("s1", "token");
    useNimbusStore.getState().markDone("s1", "model");
    useNimbusStore.getState().reset();
    expect(useNimbusStore.getState().streamId).toBeNull();
    expect(useNimbusStore.getState().tokens).toEqual([]);
    expect(useNimbusStore.getState().modelLabel).toBeNull();
    expect(useNimbusStore.getState().doneAt).toBeNull();
  });
});
