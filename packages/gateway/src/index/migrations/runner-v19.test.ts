import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { runIndexedSchemaMigrations } from "./runner.ts";

describe("V19 migration — lan_peers", () => {
  test("creates lan_peers table", () => {
    const db = new Database(":memory:");
    runIndexedSchemaMigrations(db, 19);
    const cols = db.query(`PRAGMA table_info(lan_peers)`).all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name).sort();
    expect(names).toContain("peer_id");
    expect(names).toContain("peer_pubkey");
    expect(names).toContain("direction");
    expect(names).toContain("write_allowed");
    expect(names).toContain("paired_at");
  });

  test("is idempotent", () => {
    const db = new Database(":memory:");
    runIndexedSchemaMigrations(db, 19);
    runIndexedSchemaMigrations(db, 19);
    const row = db.query(`SELECT COUNT(*) AS n FROM lan_peers`).get() as { n: number };
    expect(row.n).toBe(0);
  });

  test("rejects direction outside inbound/outbound", () => {
    const db = new Database(":memory:");
    runIndexedSchemaMigrations(db, 19);
    expect(() =>
      db.run(
        `INSERT INTO lan_peers (peer_id, peer_pubkey, direction, write_allowed, paired_at) VALUES (?, ?, ?, ?, ?)`,
        ["p1", Buffer.alloc(32), "sideways", 0, "2026-04-19T00:00:00Z"],
      ),
    ).toThrow(/CHECK/);
  });

  test("peer_pubkey is UNIQUE", () => {
    const db = new Database(":memory:");
    runIndexedSchemaMigrations(db, 19);
    const pk = Buffer.alloc(32, 1);
    db.run(
      `INSERT INTO lan_peers (peer_id, peer_pubkey, direction, write_allowed, paired_at) VALUES (?, ?, ?, ?, ?)`,
      ["p1", pk, "inbound", 0, "2026-04-19T00:00:00Z"],
    );
    expect(() =>
      db.run(
        `INSERT INTO lan_peers (peer_id, peer_pubkey, direction, write_allowed, paired_at) VALUES (?, ?, ?, ?, ?)`,
        ["p2", pk, "inbound", 0, "2026-04-19T00:00:00Z"],
      ),
    ).toThrow(/UNIQUE/);
  });
});
