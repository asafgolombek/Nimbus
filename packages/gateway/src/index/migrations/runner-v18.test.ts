import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { GENESIS_HASH } from "../../db/audit-chain.ts";
import { runIndexedSchemaMigrations } from "./runner.ts";

function seedV17Audit(db: Database): void {
  db.run(
    `INSERT INTO audit_log (action_type, hitl_status, action_json, timestamp) VALUES (?, ?, ?, ?)`,
    ["a", "approved", "{}", 1000],
  );
  db.run(
    `INSERT INTO audit_log (action_type, hitl_status, action_json, timestamp) VALUES (?, ?, ?, ?)`,
    ["b", "approved", "{}", 2000],
  );
}

describe("V18 migration — audit chain backfill", () => {
  test("adds row_hash + prev_hash columns and backfills existing rows", () => {
    const db = new Database(":memory:");
    runIndexedSchemaMigrations(db, 17);
    seedV17Audit(db);
    runIndexedSchemaMigrations(db, 18);

    const rows = db
      .query(`SELECT id, row_hash, prev_hash FROM audit_log ORDER BY id ASC`)
      .all() as Array<{
      id: number;
      row_hash: string;
      prev_hash: string;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows[0]?.prev_hash).toBe(GENESIS_HASH);
    expect(rows[0]?.row_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[1]?.prev_hash).toBe(rows[0]?.row_hash);
  });

  test("creates _meta table with audit_verified_through_id initialised to 0", () => {
    const db = new Database(":memory:");
    runIndexedSchemaMigrations(db, 18);
    const row = db.query(`SELECT value FROM _meta WHERE key = 'audit_verified_through_id'`).get() as
      | { value: string }
      | undefined;
    expect(row?.value).toBe("0");
  });
});
