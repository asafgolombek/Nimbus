import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { LlamaCppProvider } from "./llamacpp-provider.ts";

const FAKE_COMPLETION_RESPONSE = {
  content: "Response from llama.cpp",
  timings: { prompt_n: 8, predicted_n: 7 },
};

describe("LlamaCppProvider", () => {
  beforeEach(() => {
    globalThis.fetch = mock(async (url: string) => {
      if ((url as string).endsWith("/health")) {
        return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
      }
      if ((url as string).endsWith("/completion")) {
        return new Response(JSON.stringify(FAKE_COMPLETION_RESPONSE), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = fetch;
  });

  test("providerId is 'llamacpp'", () => {
    expect(new LlamaCppProvider().providerId).toBe("llamacpp");
  });

  test("isAvailable returns true when /health responds ok", async () => {
    const p = new LlamaCppProvider("http://127.0.0.1:8080");
    expect(await p.isAvailable()).toBe(true);
  });

  test("isAvailable returns false when server is not reachable", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const p = new LlamaCppProvider("http://127.0.0.1:8080");
    expect(await p.isAvailable()).toBe(false);
  });

  test("listModels returns the configured GGUF model name", async () => {
    const p = new LlamaCppProvider("http://127.0.0.1:8080", "mistral-7b.gguf");
    const models = await p.listModels();
    expect(models).toHaveLength(1);
    expect(models[0]?.modelName).toBe("mistral-7b.gguf");
    expect(models[0]?.provider).toBe("llamacpp");
  });

  test("generate calls /completion and returns correct result", async () => {
    const p = new LlamaCppProvider("http://127.0.0.1:8080", "mistral-7b.gguf");
    const result = await p.generate({ task: "reasoning", prompt: "Explain this." });
    expect(result.text).toBe("Response from llama.cpp");
    expect(result.isLocal).toBe(true);
    expect(result.provider).toBe("llamacpp");
    expect(result.tokensIn).toBe(8);
    expect(result.tokensOut).toBe(7);
  });

  test("generate throws on non-200 response", async () => {
    globalThis.fetch = mock(
      async () => new Response("error", { status: 503 }),
    ) as unknown as typeof fetch;
    const p = new LlamaCppProvider("http://127.0.0.1:8080");
    await expect(p.generate({ task: "classification", prompt: "test" })).rejects.toThrow("503");
  });
});
