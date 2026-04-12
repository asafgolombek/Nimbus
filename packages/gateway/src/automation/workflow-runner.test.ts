import { describe, expect, test } from "bun:test";

import { parseWorkflowStepsJson } from "./workflow-runner.ts";

describe("parseWorkflowStepsJson", () => {
  test("parses run steps", () => {
    const steps = parseWorkflowStepsJson(
      JSON.stringify([{ run: "hello" }, { label: "b", run: "world", continueOnError: true }]),
    );
    expect(steps).toEqual([{ run: "hello" }, { label: "b", run: "world", continueOnError: true }]);
  });

  test("rejects empty array", () => {
    expect(() => parseWorkflowStepsJson("[]")).toThrow(/no executable steps/);
  });
});
