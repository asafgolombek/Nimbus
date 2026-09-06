import { describe, expect, test } from "bun:test";
import type { SynthesisRouter } from "../agents/_lib/synthesis-llm.ts";
import type { ResolvedSynthesisProvider } from "../llm/router.ts";
import { createFleetRemoteBudget, wrapFleetSynthesisRouter } from "./fleet-synthesis-router.ts";

const LOCAL: ResolvedSynthesisProvider = { providerId: "ollama", modelName: "qwen", isLocal: true };
const REMOTE: ResolvedSynthesisProvider = {
  providerId: "anthropic",
  modelName: "opus",
  isLocal: false,
};

function fakeRouter(
  resolve: ResolvedSynthesisProvider | undefined,
  calls: string[],
): SynthesisRouter {
  return {
    resolveForSynthesis: async () => resolve,
    generateMarkdown: async (_p, provider) => {
      calls.push(provider.providerId);
      return "md";
    },
  };
}

describe("wrapFleetSynthesisRouter (I38)", () => {
  test("a LOCAL provider passes through untouched", async () => {
    const calls: string[] = [];
    const r = wrapFleetSynthesisRouter(fakeRouter(LOCAL, calls), createFleetRemoteBudget(false, 0));
    expect(await r.resolveForSynthesis(true)).toEqual(LOCAL);
    await r.generateMarkdown("p", LOCAL);
    expect(calls).toEqual(["ollama"]);
  });

  test("without allow_remote a remote provider is withheld — resolve returns undefined", async () => {
    const calls: string[] = [];
    const r = wrapFleetSynthesisRouter(
      fakeRouter(REMOTE, calls),
      createFleetRemoteBudget(false, 0),
    );
    expect(await r.resolveForSynthesis(true)).toBeUndefined();
    expect(calls).toEqual([]);
  });

  test("generateMarkdown REFUSES a remote provider handed to it directly", async () => {
    const calls: string[] = [];
    const r = wrapFleetSynthesisRouter(
      fakeRouter(REMOTE, calls),
      createFleetRemoteBudget(false, 0),
    );
    // The second door: a caller that already holds a remote provider must not get through either.
    await expect(r.generateMarkdown("p", REMOTE)).rejects.toThrow(/allow_remote/);
    expect(calls).toEqual([]);
  });

  test("with allow_remote and budget 1, exactly one remote call is permitted", async () => {
    const calls: string[] = [];
    const budget = createFleetRemoteBudget(true, 1);
    const r = wrapFleetSynthesisRouter(fakeRouter(REMOTE, calls), budget);
    await r.generateMarkdown("p", REMOTE);
    expect(budget.spent()).toBe(1);
    await expect(r.generateMarkdown("p", REMOTE)).rejects.toThrow(/budget/);
    expect(calls).toEqual(["anthropic"]);
    expect(budget.exhausted()).toBe(true);
  });

  test("an exhausted budget withholds the remote provider at resolve time too", async () => {
    const budget = createFleetRemoteBudget(true, 1);
    budget.consume();
    const r = wrapFleetSynthesisRouter(fakeRouter(REMOTE, []), budget);
    expect(await r.resolveForSynthesis(true)).toBeUndefined();
  });

  test("locality is read off the provider, never recomputed from a vendor id", async () => {
    // A provider whose id LOOKS remote but declares isLocal (I34 is the single source) passes.
    const looksRemote: ResolvedSynthesisProvider = {
      providerId: "anthropic",
      modelName: "m",
      isLocal: true,
    };
    const calls: string[] = [];
    const r = wrapFleetSynthesisRouter(
      fakeRouter(looksRemote, calls),
      createFleetRemoteBudget(false, 0),
    );
    await r.generateMarkdown("p", looksRemote);
    expect(calls).toEqual(["anthropic"]);
  });
});
