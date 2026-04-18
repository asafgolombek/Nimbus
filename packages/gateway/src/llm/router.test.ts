import { describe, expect, test } from "bun:test";
import { LlmRouter, type LlmRouterConfig } from "./router.ts";
import type { LlmProvider } from "./types.ts";

function makeFakeProvider(id: "ollama" | "llamacpp" | "remote", available: boolean): LlmProvider {
  return {
    providerId: id,
    isAvailable: async () => available,
    listModels: async () => [],
    generate: async (_opts) => ({
      text: `response from ${id}`,
      tokensIn: 1,
      tokensOut: 1,
      modelUsed: id,
      isLocal: id !== "remote",
      provider: id,
    }),
  };
}

const DEFAULT_CONFIG: LlmRouterConfig = {
  preferLocal: true,
  remoteModel: "claude-sonnet-4-6",
  localModel: "llama3.2",
  minReasoningParams: 7,
  enforceAirGap: false,
};

describe("LlmRouter.selectProvider", () => {
  test("returns ollama when preferLocal=true and ollama is available", async () => {
    const router = new LlmRouter(DEFAULT_CONFIG);
    router.registerProvider(makeFakeProvider("ollama", true));
    router.registerProvider(makeFakeProvider("remote", true));
    const provider = await router.selectProvider("agent_step");
    expect(provider?.providerId).toBe("ollama");
  });

  test("falls back to remote when local unavailable and enforceAirGap=false", async () => {
    const router = new LlmRouter(DEFAULT_CONFIG);
    router.registerProvider(makeFakeProvider("ollama", false));
    router.registerProvider(makeFakeProvider("remote", true));
    const provider = await router.selectProvider("agent_step");
    expect(provider?.providerId).toBe("remote");
  });

  test("returns undefined when all providers unavailable", async () => {
    const router = new LlmRouter(DEFAULT_CONFIG);
    router.registerProvider(makeFakeProvider("ollama", false));
    const provider = await router.selectProvider("classification");
    expect(provider).toBeUndefined();
  });

  test("enforceAirGap=true never returns remote provider", async () => {
    const config: LlmRouterConfig = { ...DEFAULT_CONFIG, enforceAirGap: true };
    const router = new LlmRouter(config);
    router.registerProvider(makeFakeProvider("ollama", false));
    router.registerProvider(makeFakeProvider("remote", true));
    const provider = await router.selectProvider("reasoning");
    expect(provider).toBeUndefined();
  });

  test("enforceAirGap=true returns local when available", async () => {
    const config: LlmRouterConfig = { ...DEFAULT_CONFIG, enforceAirGap: true };
    const router = new LlmRouter(config);
    router.registerProvider(makeFakeProvider("llamacpp", true));
    const provider = await router.selectProvider("reasoning");
    expect(provider?.providerId).toBe("llamacpp");
  });

  test("preferLocal=false prefers remote over local", async () => {
    const config: LlmRouterConfig = { ...DEFAULT_CONFIG, preferLocal: false };
    const router = new LlmRouter(config);
    router.registerProvider(makeFakeProvider("ollama", true));
    router.registerProvider(makeFakeProvider("remote", true));
    const provider = await router.selectProvider("classification");
    expect(provider?.providerId).toBe("remote");
  });
});

describe("LlmRouter.generate", () => {
  test("delegates to selected provider and returns result", async () => {
    const router = new LlmRouter(DEFAULT_CONFIG);
    router.registerProvider(makeFakeProvider("ollama", true));
    const result = await router.generate({ task: "agent_step", prompt: "hello" });
    expect(result.provider).toBe("ollama");
    expect(result.text).toBe("response from ollama");
  });

  test("throws when no provider is available", async () => {
    const router = new LlmRouter(DEFAULT_CONFIG);
    await expect(router.generate({ task: "classification", prompt: "test" })).rejects.toThrow(
      "No LLM provider available",
    );
  });
});
