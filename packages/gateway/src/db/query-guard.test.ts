import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assertReadOnlySelectSql, runReadOnlySelect, SqlGuardError } from "./query-guard.ts";

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "nimbus-guard-"));
  const path = join(dir, "test.db");
  const db = new Database(path);
  db.run("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
  db.run("INSERT INTO t (name) VALUES ('a'), ('b'), ('c')");
  db.close();
  return path;
}

describe("query-guard PRAGMA allowlist (S5-F2)", () => {
  test("rejects PRAGMA secure_delete = ON", () => {
    expect(() => assertReadOnlySelectSql("SELECT * FROM t; PRAGMA secure_delete = ON;")).toThrow(
      SqlGuardError,
    );
  });

  test("rejects PRAGMA optimize", () => {
    expect(() => assertReadOnlySelectSql("SELECT 1; PRAGMA optimize;")).toThrow(SqlGuardError);
  });

  test("rejects PRAGMA mmap_size = 1024", () => {
    expect(() => assertReadOnlySelectSql("SELECT 1; PRAGMA mmap_size = 1024;")).toThrow(
      SqlGuardError,
    );
  });

  test("permits PRAGMA query_only when used after SELECT", () => {
    expect(() => assertReadOnlySelectSql("SELECT 1; PRAGMA query_only = 1")).not.toThrow();
  });

  test("permits PRAGMA table_info", () => {
    expect(() => assertReadOnlySelectSql("SELECT * FROM pragma_table_info('t')")).not.toThrow();
  });
});

describe("query-guard wall-clock timeout (S5-F3)", () => {
  test("aborts an unbounded recursive CTE within the configured timeout", async () => {
    const dbPath = tempDbPath();
    const start = Date.now();
    await expect(
      runReadOnlySelect(
        dbPath,
        "WITH RECURSIVE x(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM x) SELECT * FROM x",
        { timeoutMs: 1500 },
      ),
    ).rejects.toThrow(/exceeded.*1500ms/);
    expect(Date.now() - start).toBeLessThan(8000);
  });

  test("returns rows for a bounded SELECT well under the timeout", async () => {
    const dbPath = tempDbPath();
    const rows = await runReadOnlySelect(dbPath, "SELECT name FROM t ORDER BY id", {
      timeoutMs: 5000,
    });
    expect(rows).toEqual([{ name: "a" }, { name: "b" }, { name: "c" }]);
  });
});
