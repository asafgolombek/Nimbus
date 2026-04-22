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

  test("dry run returns preview step results and persists a dry_run=1 row", async () => {
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
      { label: "L1", status: "preview", output: "do thing", hitlActions: [] },
      { label: "step-2", status: "preview", output: "second", hitlActions: [] },
    ]);
    const runCount = db.query(`SELECT COUNT(*) as c FROM workflow_run`).get() as { c: number };
    expect(runCount.c).toBe(1);
    const runRow = db.query(`SELECT dry_run, status FROM workflow_run LIMIT 1`).get() as {
      dry_run: number;
      status: string;
    };
    expect(runRow.dry_run).toBe(1);
    expect(runRow.status).toBe("preview");
  });

  test("dry run includes heuristic hitlActions for HITL-like step text", async () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    const now = Date.now();
    upsertWorkflowByName(
      db,
      "hitl-demo",
      null,
      JSON.stringify([{ run: "Run terraform apply in production" }]),
      now,
    );
    const r = await runWorkflowExecution({
      db,
      agent: noopAgent,
      workflowName: "hitl-demo",
      triggeredBy: "t",
      dryRun: true,
      stream: false,
      sendChunk: () => {
        /* noop */
      },
    });
    expect(r.stepResults[0]?.hitlActions).toContain("iac.terraform.apply");
  });

  test("runWorkflowExecution writes a dry_run=1 row when dryRun is true", async () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    upsertWorkflowByName(
      db,
      "preview-me",
      null,
      JSON.stringify([{ label: "step-1", run: "echo hi" }]),
      Date.now(),
    );
    await runWorkflowExecution({
      db,
      agent: noopAgent,
      workflowName: "preview-me",
      triggeredBy: "user",
      dryRun: true,
      stream: false,
      sendChunk: () => {
        /* noop */
      },
    });
    const row = db
      .query(
        `SELECT dry_run, status FROM workflow_run
         WHERE workflow_id = (SELECT id FROM workflow WHERE name = 'preview-me')
         ORDER BY started_at DESC LIMIT 1`,
      )
      .get() as { dry_run: number; status: string };
    expect(row.dry_run).toBe(1);
    expect(row.status).toBe("preview");
  });

  test("runWorkflowExecution persists paramsOverride JSON on the real-run row", async () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    upsertWorkflowByName(
      db,
      "po-real",
      null,
      JSON.stringify([{ label: "step-1", run: "echo hi" }]),
      Date.now(),
    );
    const override = { "step-1": { greeting: "hi" } };
    await runWorkflowExecution({
      db,
      agent: noopAgent,
      workflowName: "po-real",
      triggeredBy: "user",
      dryRun: false,
      stream: false,
      sendChunk: () => {
        /* noop */
      },
      conversationalRunner: async () => ({ reply: "ok" }),
      paramsOverride: override,
    });
    const row = db
      .query(
        `SELECT params_override_json FROM workflow_run
         WHERE workflow_id = (SELECT id FROM workflow WHERE name = 'po-real')
         ORDER BY started_at DESC LIMIT 1`,
      )
      .get() as { params_override_json: string };
    expect(JSON.parse(row.params_override_json)).toEqual(override);
  });

  test("runWorkflowExecution persists paramsOverride JSON on the dry-run row", async () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    upsertWorkflowByName(
      db,
      "po-dry",
      null,
      JSON.stringify([{ label: "step-1", run: "echo hi" }]),
      Date.now(),
    );
    const override = { "step-1": { greeting: "dry" } };
    await runWorkflowExecution({
      db,
      agent: noopAgent,
      workflowName: "po-dry",
      triggeredBy: "user",
      dryRun: true,
      stream: false,
      sendChunk: () => {
        /* noop */
      },
      paramsOverride: override,
    });
    const row = db
      .query(
        `SELECT params_override_json FROM workflow_run
         WHERE workflow_id = (SELECT id FROM workflow WHERE name = 'po-dry')
         ORDER BY started_at DESC LIMIT 1`,
      )
      .get() as { params_override_json: string };
    expect(JSON.parse(row.params_override_json)).toEqual(override);
  });

  test("runWorkflowExecution persists NULL params_override_json when not provided", async () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    upsertWorkflowByName(
      db,
      "po-absent",
      null,
      JSON.stringify([{ label: "step-1", run: "echo hi" }]),
      Date.now(),
    );
    await runWorkflowExecution({
      db,
      agent: noopAgent,
      workflowName: "po-absent",
      triggeredBy: "user",
      dryRun: false,
      stream: false,
      sendChunk: () => {
        /* noop */
      },
      conversationalRunner: async () => ({ reply: "ok" }),
    });
    const row = db
      .query(
        `SELECT params_override_json FROM workflow_run
         WHERE workflow_id = (SELECT id FROM workflow WHERE name = 'po-absent')
         ORDER BY started_at DESC LIMIT 1`,
      )
      .get() as { params_override_json: string | null };
    expect(row.params_override_json).toBeNull();
  });
});
