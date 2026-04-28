import { describe, expect, test } from "bun:test";
import { runRssMultiAgentOnce, S7C_REFERENCE_ONLY_REASON } from "./bench-rss-multi-agent.ts";

describe("runRssMultiAgentOnce", () => {
  test("exports a stable reference-only reason string", () => {
    expect(typeof S7C_REFERENCE_ONLY_REASON).toBe("string");
    expect(S7C_REFERENCE_ONLY_REASON.length).toBeGreaterThan(0);
  });

  test("driver shape matches: returns []", async () => {
    const samples = await runRssMultiAgentOnce({ runs: 1, runner: "local-dev" });
    expect(samples).toEqual([]);
  });
});
