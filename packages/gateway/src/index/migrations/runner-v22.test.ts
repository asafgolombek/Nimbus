import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { runIndexedSchemaMigrations } from "./runner.ts";

describe("V22 migration — watcher.graph_predicate_json", () => {
  test("adds nullable graph_predicate_json column", () => {
    const db = new Database(":memory:");
    runIndexedSchemaMigrations(db, 22);
    const cols = db.query(`PRAGMA table_info(watcher)`).all() as Array<{
      name: string;
      dflt_value: string | null;
      notnull: number;
      type: string;
    }>;
    const col = cols.find((c) => c.name === "graph_predicate_json");
    expect(col).toBeDefined();
    expect(col?.notnull).toBe(0);
    expect(col?.dflt_value).toBeNull();
    expect(col?.type.toUpperCase()).toBe("TEXT");
  });

  test("pre-existing watchers default to NULL graph_predicate_json", () => {
    const db = new Database(":memory:");
    runIndexedSchemaMigrations(db, 21);
    db.run(
      `INSERT INTO watcher (id, name, enabled, condition_type, condition_json,
                            action_type, action_json, created_at)
       VALUES (?, ?, 1, 'alert_fired', '{}', 'notify', '{}', ?)`,
      ["w1", "legacy", 1_700_000_000_000],
    );
    runIndexedSchemaMigrations(db, 22);
    const row = db.query(`SELECT graph_predicate_json FROM watcher WHERE id = 'w1'`).get() as {
      graph_predicate_json: string | null;
    };
    expect(row.graph_predicate_json).toBeNull();
  });

  test("accepts an arbitrary JSON string", () => {
    const db = new Database(":memory:");
    runIndexedSchemaMigrations(db, 22);
    db.run(
      `INSERT INTO watcher (id, name, enabled, condition_type, condition_json,
                            action_type, action_json, created_at,
                            graph_predicate_json)
       VALUES (?, ?, 1, 'alert_fired', '{}', 'notify', '{}', ?, ?)`,
      [
        "w2",
        "gp",
        1_700_000_000_000,
        JSON.stringify({ relation: "owned_by", target: { type: "person", externalId: "u:1" } }),
      ],
    );
    const row = db.query(`SELECT graph_predicate_json FROM watcher WHERE id = 'w2'`).get() as {
      graph_predicate_json: string | null;
    };
    expect(row.graph_predicate_json).not.toBeNull();
    expect(JSON.parse(row.graph_predicate_json ?? "null")).toMatchObject({ relation: "owned_by" });
  });

  test("is idempotent when run twice", () => {
    const db = new Database(":memory:");
    runIndexedSchemaMigrations(db, 22);
    runIndexedSchemaMigrations(db, 22);
    const cols = db.query(`PRAGMA table_info(watcher)`).all() as Array<{ name: string }>;
    expect(cols.filter((c) => c.name === "graph_predicate_json")).toHaveLength(1);
  });

  test("records the ledger entry", () => {
    const db = new Database(":memory:");
    runIndexedSchemaMigrations(db, 22);
    const row = db.query(`SELECT description FROM _schema_migrations WHERE version = 22`).get() as
      | { description: string }
      | undefined;
    expect(row?.description).toContain("graph-aware");
  });
});
