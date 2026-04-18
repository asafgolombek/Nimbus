import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { runIndexedSchemaMigrations } from "./runner.ts";

describe("migration V17 — sub_task_results", () => {
  test("creates sub_task_results table", () => {
    const db = new Database(":memory:");
    runIndexedSchemaMigrations(db, 17);

    const tables = db
      .query(`SELECT name FROM sqlite_master WHERE type='table' AND name='sub_task_results'`)
      .all() as Array<{ name: string }>;
    expect(tables).toHaveLength(1);

    const row = db.query("PRAGMA user_version").get() as { user_version: number };
    expect(row.user_version).toBeGreaterThanOrEqual(17);
  });

  test("can insert a sub_task_results row", () => {
    const db = new Database(":memory:");
    runIndexedSchemaMigrations(db, 17);

    const now = Date.now();
    db.run(
      `INSERT INTO sub_task_results
       (session_id, parent_id, task_index, task_type, status, created_at)
       VALUES ('sess1', 'parent1', 0, 'classification', 'done', ?)`,
      [now],
    );
    const row = db
      .query("SELECT task_type FROM sub_task_results WHERE session_id = 'sess1'")
      .get() as { task_type: string } | null;
    expect(row?.task_type).toBe("classification");
  });

  test("enforces status CHECK constraint", () => {
    const db = new Database(":memory:");
    runIndexedSchemaMigrations(db, 17);

    expect(() => {
      db.run(
        `INSERT INTO sub_task_results
         (session_id, parent_id, task_index, task_type, status, created_at)
         VALUES ('s', 'p', 0, 'classification', 'invalid_status', ?)`,
        [Date.now()],
      );
    }).toThrow();
  });
});
