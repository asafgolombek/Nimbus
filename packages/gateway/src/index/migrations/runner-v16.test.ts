import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { runIndexedSchemaMigrations } from "./runner.ts";

describe("migration V16 — llm_models", () => {
  test("creates llm_models table and context_window_tokens column", () => {
    const db = new Database(":memory:");
    runIndexedSchemaMigrations(db, 17);

    const tables = db
      .query(`SELECT name FROM sqlite_master WHERE type='table' AND name='llm_models'`)
      .all() as Array<{ name: string }>;
    expect(tables).toHaveLength(1);

    const cols = db.query("PRAGMA table_info(sync_state)").all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === "context_window_tokens")).toBe(true);

    const row = db.query("PRAGMA user_version").get() as { user_version: number };
    expect(row.user_version).toBeGreaterThanOrEqual(16);
  });

  test("can insert and retrieve an llm_models row", () => {
    const db = new Database(":memory:");
    runIndexedSchemaMigrations(db, 17);

    db.run(
      `INSERT INTO llm_models (provider, model_name, parameter_count, context_window, last_seen_at)
       VALUES ('ollama', 'llama3.2', 3, 128000, ?)`,
      [Date.now()],
    );
    const row = db.query("SELECT model_name FROM llm_models WHERE provider = 'ollama'").get() as {
      model_name: string;
    } | null;
    expect(row?.model_name).toBe("llama3.2");
  });

  test("enforces unique(provider, model_name) constraint", () => {
    const db = new Database(":memory:");
    runIndexedSchemaMigrations(db, 17);

    const now = Date.now();
    db.run(
      `INSERT INTO llm_models (provider, model_name, last_seen_at) VALUES ('ollama', 'llama3.2', ?)`,
      [now],
    );
    expect(() => {
      db.run(
        `INSERT INTO llm_models (provider, model_name, last_seen_at) VALUES ('ollama', 'llama3.2', ?)`,
        [now],
      );
    }).toThrow();
  });
});
