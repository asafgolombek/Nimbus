import { beforeEach, describe, expect, it } from "vitest";
import { create } from "zustand";
import { createHitlSlice, type HitlSlice } from "../../src/store/slices/hitl";

describe("hitl slice", () => {
  let useStore: ReturnType<typeof create<HitlSlice>>;
  beforeEach(() => {
    useStore = create<HitlSlice>()((...a) => createHitlSlice(...a));
  });

  it("enqueues a request", () => {
    useStore.getState().enqueue({
      requestId: "r1",
      prompt: "Delete?",
      receivedAtMs: Date.now(),
    });
    expect(useStore.getState().pending).toHaveLength(1);
  });

  it("dedupes by requestId", () => {
    const r = { requestId: "r1", prompt: "p", receivedAtMs: 1 };
    useStore.getState().enqueue(r);
    useStore.getState().enqueue(r);
    expect(useStore.getState().pending).toHaveLength(1);
  });

  it("resolve removes by id", () => {
    useStore.getState().enqueue({ requestId: "r1", prompt: "p", receivedAtMs: 1 });
    useStore.getState().enqueue({ requestId: "r2", prompt: "q", receivedAtMs: 2 });
    useStore.getState().resolve("r1", true);
    expect(useStore.getState().pending).toHaveLength(1);
    expect(useStore.getState().pending[0]?.requestId).toBe("r2");
  });

  it("resolve for unknown id is a no-op", () => {
    useStore.getState().resolve("ghost", true);
    expect(useStore.getState().pending).toHaveLength(0);
  });
});
