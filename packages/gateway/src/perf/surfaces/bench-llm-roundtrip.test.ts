import { describe, expect, test } from "bun:test";

import { runLlmRoundtripOnce, S9_STUB_REASON } from "./bench-llm-roundtrip.ts";

describe("runLlmRoundtripOnce", () => {
  test("exports a stable stub reason string", () => {
    expect(typeof S9_STUB_REASON).toBe("string");
    expect(S9_STUB_REASON.length).toBeGreaterThan(0);
    expect(S9_STUB_REASON).toMatch(/Ollama|stub|reference-only/i);
  });

  test("driver shape: returns []", async () => {
    const samples = await runLlmRoundtripOnce({ runs: 1, runner: "local-dev" });
    expect(samples).toEqual([]);
  });
});
