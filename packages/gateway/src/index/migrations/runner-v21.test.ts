import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { runIndexedSchemaMigrations } from "./runner.ts";

describe("V21 migration — sync_state.depth", () => {
  test("adds depth column with default 'summary'", () => {
    const db = new Database(":memory:");
    runIndexedSchemaMigrations(db, 21);
    const cols = db.query(`PRAGMA table_info(sync_state)`).all() as Array<{
      name: string;
      dflt_value: string | null;
      notnull: number;
    }>;
    const depth = cols.find((c) => c.name === "depth");
    expect(depth).toBeDefined();
    expect(depth?.notnull).toBe(1);
    expect(depth?.dflt_value).toBe("'summary'");
  });

  test("inserts row respects the default", () => {
    const db = new Database(":memory:");
    runIndexedSchemaMigrations(db, 21);
    db.run(
      `INSERT INTO sync_state (connector_id, last_sync_at, next_sync_token) VALUES (?, ?, ?)`,
      ["github", null, null],
    );
    const row = db.query(`SELECT depth FROM sync_state WHERE connector_id = ?`).get("github") as
      | { depth: string }
      | undefined;
    expect(row?.depth).toBe("summary");
  });

  test("CHECK constraint rejects unknown depth values", () => {
    const db = new Database(":memory:");
    runIndexedSchemaMigrations(db, 21);
    db.run(
      `INSERT INTO sync_state (connector_id, last_sync_at, next_sync_token) VALUES (?, ?, ?)`,
      ["gh", null, null],
    );
    expect(() => db.run(`UPDATE sync_state SET depth = 'bogus' WHERE connector_id = 'gh'`)).toThrow(
      /CHECK/,
    );
  });

  test("is idempotent", () => {
    const db = new Database(":memory:");
    runIndexedSchemaMigrations(db, 21);
    runIndexedSchemaMigrations(db, 21);
    const cols = db.query(`PRAGMA table_info(sync_state)`).all() as Array<{ name: string }>;
    expect(cols.filter((c) => c.name === "depth")).toHaveLength(1);
  });
});
