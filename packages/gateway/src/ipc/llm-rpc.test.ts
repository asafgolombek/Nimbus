import { describe, expect, test } from "bun:test";
import type { LlmModelInfo } from "../llm/types.ts";
import type { LlmRpcContext } from "./llm-rpc.ts";
import { dispatchLlmRpc } from "./llm-rpc.ts";

function makeFakeRegistry(models: LlmModelInfo[] = []): LlmRpcContext["registry"] {
  return {
    listAllModels: async () => models,
    checkAvailability: async () => ({ ollama: true, llamacpp: false }),
  } as unknown as LlmRpcContext["registry"];
}

describe("dispatchLlmRpc", () => {
  test("returns miss for unknown method", async () => {
    const ctx: LlmRpcContext = { registry: makeFakeRegistry() };
    const result = await dispatchLlmRpc("unknown.method", {}, ctx);
    expect(result.kind).toBe("miss");
  });

  test("returns miss for non-llm prefix", async () => {
    const ctx: LlmRpcContext = { registry: makeFakeRegistry() };
    const result = await dispatchLlmRpc("connector.list", {}, ctx);
    expect(result.kind).toBe("miss");
  });

  test("llm.listModels returns model list", async () => {
    const models: LlmModelInfo[] = [
      { provider: "ollama", modelName: "llama3.2", contextWindow: 128000 },
    ];
    const ctx: LlmRpcContext = { registry: makeFakeRegistry(models) };
    const result = await dispatchLlmRpc("llm.listModels", {}, ctx);
    expect(result.kind).toBe("hit");
    if (result.kind === "hit") {
      const value = result.value as { models: LlmModelInfo[] };
      expect(value.models).toHaveLength(1);
      expect(value.models[0]?.modelName ?? "").toBe("llama3.2");
    }
  });

  test("llm.getStatus returns availability map", async () => {
    const ctx: LlmRpcContext = { registry: makeFakeRegistry() };
    const result = await dispatchLlmRpc("llm.getStatus", {}, ctx);
    expect(result.kind).toBe("hit");
    if (result.kind === "hit") {
      const value = result.value as { available: Record<string, boolean> };
      expect(value.available["ollama"]).toBe(true);
      expect(value.available["llamacpp"]).toBe(false);
    }
  });
});
