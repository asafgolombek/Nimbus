import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import type { Agent } from "@mastra/core/agent";

import { LocalIndex } from "../index/local-index.ts";
import { parseWorkflowStepsJson, runWorkflowExecution } from "./workflow-runner.ts";
import { upsertWorkflowByName } from "./workflow-store.ts";

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

  test("rejects invalid JSON", () => {
    expect(() => parseWorkflowStepsJson("{")).toThrow(/not valid JSON/);
  });

  test("rejects non-array root", () => {
    expect(() => parseWorkflowStepsJson("{}")).toThrow(/JSON array/);
  });

  test("skips rows without non-empty run", () => {
    const steps = parseWorkflowStepsJson(
      JSON.stringify([{ run: "   ok  " }, { run: "" }, { label: "x" }, null, "nope"]),
    );
    expect(steps).toEqual([{ run: "ok" }]);
  });

  test("accepts continue_on_error alias", () => {
    const steps = parseWorkflowStepsJson(JSON.stringify([{ run: "a", continue_on_error: true }]));
    expect(steps[0]?.continueOnError).toBe(true);
  });
});

describe("runWorkflowExecution (dry run and validation)", () => {
  const noopAgent = {} as Agent;

  test("throws when workflow schema below v9", async () => {
    const db = new Database(":memory:");
    await expect(
      runWorkflowExecution({
        db,
        agent: noopAgent,
        workflowName: "w",
        triggeredBy: "t",
        dryRun: true,
        stream: false,
        sendChunk: () => {
          /* noop */
        },
      }),
    ).rejects.toThrow(/v9/);
  });

  test("throws for unknown workflow", async () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    await expect(
      runWorkflowExecution({
        db,
        agent: noopAgent,
        workflowName: "missing",
        triggeredBy: "t",
        dryRun: true,
        stream: false,
        sendChunk: () => {
          /* noop */
        },
      }),
    ).rejects.toThrow(/Unknown workflow/);
  });

  test("dry run returns preview step results without persisting run", async () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    const now = Date.now();
    upsertWorkflowByName(
      db,
      "demo",
      null,
      JSON.stringify([{ label: "L1", run: "do thing" }, { run: "second" }]),
      now,
    );
    const r = await runWorkflowExecution({
      db,
      agent: noopAgent,
      workflowName: "demo",
      triggeredBy: "cli",
      dryRun: true,
      stream: false,
      sendChunk: () => {
        /* noop */
      },
    });
    expect(r.dryRun).toBe(true);
    expect(r.stepResults).toEqual([
      { label: "L1", status: "preview", output: "do thing" },
      { label: "step-2", status: "preview", output: "second" },
    ]);
    const runCount = db.query(`SELECT COUNT(*) as c FROM workflow_run`).get() as { c: number };
    expect(runCount.c).toBe(0);
  });
});
