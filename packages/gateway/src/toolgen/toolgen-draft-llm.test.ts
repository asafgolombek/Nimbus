import { describe, expect, test } from "bun:test";
import { createToolgenDraftLlm } from "./toolgen-draft-llm.ts";

function router(provider: { isLocal: boolean } | undefined) {
  const calls: unknown[] = [];
  return {
    calls,
    selectProvider: async (task: string) => {
      calls.push(task);
      return provider === undefined
        ? undefined
        : { ...provider, generate: async () => ({ text: "drafted" }) };
    },
  };
}

describe("createToolgenDraftLlm", () => {
  test('mode "off" never asks the router at all', async () => {
    const r = router({ isLocal: true });
    expect(await createToolgenDraftLlm(r as never, "off")("p")).toBeNull();
    expect(r.calls).toEqual([]);
  });

  test('mode "local" uses a local provider and reports isLocal', async () => {
    expect(await createToolgenDraftLlm(router({ isLocal: true }) as never, "local")("p")).toEqual({
      text: "drafted",
      isLocal: true,
    });
  });

  test('mode "local" REFUSES a remote provider rather than using it', async () => {
    expect(
      await createToolgenDraftLlm(router({ isLocal: false }) as never, "local")("p"),
    ).toBeNull();
  });

  test('mode "allow-remote" uses a remote provider and reports isLocal false', async () => {
    expect(
      await createToolgenDraftLlm(router({ isLocal: false }) as never, "allow-remote")("p"),
    ).toEqual({ text: "drafted", isLocal: false });
  });

  test("no provider at all yields null", async () => {
    expect(await createToolgenDraftLlm(router(undefined) as never, "local")("p")).toBeNull();
  });

  test('asks for the "reasoning" task so the capability floor applies', async () => {
    const r = router({ isLocal: true });
    await createToolgenDraftLlm(r as never, "local")("p");
    expect(r.calls).toEqual(["reasoning"]);
  });
});
