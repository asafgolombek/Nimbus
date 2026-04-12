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
    db.run(
      `UPDATE workflow SET description = ?, steps_json = ?, updated_at = ? WHERE id = ?`,
      [description, stepsJson, now, existing.id],
    );
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
