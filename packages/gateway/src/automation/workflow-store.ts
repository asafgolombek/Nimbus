import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";

import { readIndexedUserVersion } from "../index/migrations/runner.ts";

export type WorkflowRow = {
  id: string;
  name: string;
  description: string | null;
  steps_json: string;
  created_at: number;
  updated_at: number;
};

export function getWorkflowByName(db: Database, name: string): WorkflowRow | null {
  if (readIndexedUserVersion(db) < 9) {
    return null;
  }
  const row = db
    .query(
      `SELECT id, name, description, steps_json, created_at, updated_at FROM workflow WHERE name = ?`,
    )
    .get(name) as WorkflowRow | null | undefined;
  return row ?? null;
}

export function listWorkflows(db: Database): WorkflowRow[] {
  if (readIndexedUserVersion(db) < 9) {
    return [];
  }
  return db
    .query(
      `SELECT id, name, description, steps_json, created_at, updated_at
       FROM workflow ORDER BY name`,
    )
    .all() as WorkflowRow[];
}

export function upsertWorkflowByName(
  db: Database,
  name: string,
  description: string | null,
  stepsJson: string,
  now: number,
): string {
  if (readIndexedUserVersion(db) < 9) {
    throw new Error("Workflow schema requires v9+");
  }
  const existing = db.query(`SELECT id FROM workflow WHERE name = ?`).get(name) as
    | { id: string }
    | null
    | undefined;
  if (existing?.id !== undefined) {
    db.run(`UPDATE workflow SET description = ?, steps_json = ?, updated_at = ? WHERE id = ?`, [
      description,
      stepsJson,
      now,
      existing.id,
    ]);
    return existing.id;
  }
  const id = randomUUID();
  db.run(
    `INSERT INTO workflow (id, name, description, steps_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, name, description, stepsJson, now, now],
  );
  return id;
}

export function deleteWorkflowByName(db: Database, name: string): boolean {
  if (readIndexedUserVersion(db) < 9) {
    return false;
  }
  const r = db.run(`DELETE FROM workflow WHERE name = ?`, [name]);
  return r.changes > 0;
}

export function insertWorkflowRunRow(
  db: Database,
  row: {
    id: string;
    workflowId: string;
    triggeredBy: string;
    status: string;
    startedAt: number;
    dryRun?: boolean;
    paramsOverrideJson?: string | null;
  },
): void {
  db.run(
    `INSERT INTO workflow_run (id, workflow_id, triggered_by, status, started_at, finished_at, error_msg, dry_run, params_override_json)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
    [
      row.id,
      row.workflowId,
      row.triggeredBy,
      row.status,
      row.startedAt,
      row.dryRun === true ? 1 : 0,
      row.paramsOverrideJson ?? null,
    ],
  );
}

export function finishWorkflowRunRow(
  db: Database,
  id: string,
  status: string,
  finishedAt: number,
  errorMsg: string | null,
): void {
  db.run(`UPDATE workflow_run SET status = ?, finished_at = ?, error_msg = ? WHERE id = ?`, [
    status,
    finishedAt,
    errorMsg,
    id,
  ]);
}

export function insertWorkflowRunStepRow(
  db: Database,
  row: {
    runId: string;
    stepIndex: number;
    label: string | null;
    status: string;
    startedAt: number;
  },
): void {
  db.run(
    `INSERT INTO workflow_run_step (run_id, step_index, label, status, hitl_action, hitl_approved, result_json, started_at, finished_at)
     VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, NULL)`,
    [row.runId, row.stepIndex, row.label, row.status, row.startedAt],
  );
}

export function updateWorkflowRunStepRow(
  db: Database,
  runId: string,
  stepIndex: number,
  patch: { status: string; resultJson: string | null; finishedAt: number },
): void {
  db.run(
    `UPDATE workflow_run_step SET status = ?, result_json = ?, finished_at = ?
     WHERE run_id = ? AND step_index = ?`,
    [patch.status, patch.resultJson, patch.finishedAt, runId, stepIndex],
  );
}
