import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { runIndexedSchemaMigrations } from "./runner.ts";

describe("V20 migration — llm_task_defaults", () => {
  test("creates llm_task_defaults table with correct columns", () => {
    const db = new Database(":memory:");
    runIndexedSchemaMigrations(db, 20);
    const cols = db.query(`PRAGMA table_info(llm_task_defaults)`).all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name).sort((a, b) => a.localeCompare(b));
    expect(names).toContain("task_type");
    expect(names).toContain("provider");
    expect(names).toContain("model_name");
    expect(names).toContain("updated_at");
  });

  test("is idempotent", () => {
    const db = new Database(":memory:");
    runIndexedSchemaMigrations(db, 20);
    runIndexedSchemaMigrations(db, 20);
    const row = db.query(`SELECT COUNT(*) AS n FROM llm_task_defaults`).get() as { n: number };
    expect(row.n).toBe(0);
  });

  test("upsert round-trip: insert then conflict-update", () => {
    const db = new Database(":memory:");
    runIndexedSchemaMigrations(db, 20);
    db.run(
      `INSERT INTO llm_task_defaults (task_type, provider, model_name, updated_at) VALUES (?, ?, ?, ?)`,
      ["classification", "ollama", "gemma:2b", 1000],
    );
    db.run(
      `INSERT INTO llm_task_defaults (task_type, provider, model_name, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(task_type) DO UPDATE SET provider=excluded.provider, model_name=excluded.model_name, updated_at=excluded.updated_at`,
      ["classification", "llamacpp", "llama3.2", 2000],
    );
    const row = db
      .query(`SELECT provider, model_name FROM llm_task_defaults WHERE task_type = ?`)
      .get("classification") as { provider: string; model_name: string } | undefined;
    expect(row?.provider).toBe("llamacpp");
    expect(row?.model_name).toBe("llama3.2");
  });

  test("task_type is PRIMARY KEY (duplicate rejected)", () => {
    const db = new Database(":memory:");
    runIndexedSchemaMigrations(db, 20);
    db.run(
      `INSERT INTO llm_task_defaults (task_type, provider, model_name, updated_at) VALUES (?, ?, ?, ?)`,
      ["embedding", "ollama", "nomic-embed", 1000],
    );
    expect(() =>
      db.run(
        `INSERT INTO llm_task_defaults (task_type, provider, model_name, updated_at) VALUES (?, ?, ?, ?)`,
        ["embedding", "llamacpp", "nomic-embed", 2000],
      ),
    ).toThrow(/UNIQUE/);
  });
});
