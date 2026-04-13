import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { LocalIndex } from "../index/local-index.ts";
import {
  deleteWorkflowByName,
  finishWorkflowRunRow,
  getWorkflowByName,
  insertWorkflowRunRow,
  insertWorkflowRunStepRow,
  listWorkflows,
  updateWorkflowRunStepRow,
  upsertWorkflowByName,
} from "./workflow-store.ts";

describe("workflow-store", () => {
  test("getWorkflowByName and listWorkflows return empty when schema below v9", () => {
    const db = new Database(":memory:");
    expect(getWorkflowByName(db, "missing")).toBeNull();
    expect(listWorkflows(db)).toEqual([]);
    expect(deleteWorkflowByName(db, "x")).toBe(false);
  });

  test("upsertWorkflowByName throws when schema below v9", () => {
    const db = new Database(":memory:");
    expect(() =>
      upsertWorkflowByName(db, "w", null, JSON.stringify([{ run: "a" }]), Date.now()),
    ).toThrow(/v9/);
  });

  test("upsert insert then update; get and list; delete", () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    const now = 1_700_000_000_000;
    const steps = JSON.stringify([{ run: "step one" }]);
    const id1 = upsertWorkflowByName(db, "report", "desc", steps, now);
    expect(id1.length).toBeGreaterThan(0);

    const row = getWorkflowByName(db, "report");
    expect(row).not.toBeNull();
    if (row === null) {
      return;
    }
    expect(row.name).toBe("report");
    expect(row.description).toBe("desc");
    expect(row.steps_json).toBe(steps);

    const id2 = upsertWorkflowByName(db, "report", null, JSON.stringify([{ run: "two" }]), now + 1);
    expect(id2).toBe(id1);

    const updated = getWorkflowByName(db, "report");
    expect(updated?.description).toBeNull();
    expect(updated?.steps_json).toContain("two");

    const listed = listWorkflows(db);
    expect(listed.some((w) => w.name === "report")).toBe(true);

    expect(deleteWorkflowByName(db, "report")).toBe(true);
    expect(getWorkflowByName(db, "report")).toBeNull();
    expect(deleteWorkflowByName(db, "report")).toBe(false);
  });

  test("workflow run and step rows", () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    const wfId = upsertWorkflowByName(db, "wf", null, JSON.stringify([{ run: "a" }]), Date.now());
    const runId = "run-1";
    const t0 = Date.now();
    insertWorkflowRunRow(db, {
      id: runId,
      workflowId: wfId,
      triggeredBy: "cli",
      status: "running",
      startedAt: t0,
    });
    insertWorkflowRunStepRow(db, {
      runId,
      stepIndex: 0,
      label: "s0",
      status: "running",
      startedAt: t0,
    });
    updateWorkflowRunStepRow(db, runId, 0, {
      status: "done",
      resultJson: JSON.stringify({ reply: "ok" }),
      finishedAt: t0 + 1,
    });
    finishWorkflowRunRow(db, runId, "done", t0 + 2, null);

    const runRow = db
      .query(`SELECT status, finished_at, error_msg FROM workflow_run WHERE id = ?`)
      .get(runId) as {
      status: string;
      finished_at: number;
      error_msg: string | null;
    };
    expect(runRow.status).toBe("done");
    expect(runRow.finished_at).toBe(t0 + 2);
    expect(runRow.error_msg).toBeNull();

    const stepRow = db
      .query(
        `SELECT status, result_json FROM workflow_run_step WHERE run_id = ? AND step_index = 0`,
      )
      .get(runId) as { status: string; result_json: string };
    expect(stepRow.status).toBe("done");
    expect((JSON.parse(stepRow.result_json) as { reply: string }).reply).toBe("ok");
  });
});
