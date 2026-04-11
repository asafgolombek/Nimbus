import type { Database } from "bun:sqlite";
import { EMBEDDING_V6_MIGRATION_SQL } from "../embedding-v6-sql.ts";
import { PERSON_HANDLES_V5_ALTER_SQL } from "../person-handles-v5-sql.ts";
import { PERSON_LINKED_V4_ALTER_SQL } from "../person-linked-v4-sql.ts";
import { SCHEDULER_V2_MIGRATION_SQL } from "../scheduler-schema-sql.ts";
import { INITIAL_SCHEMA_SQL } from "../schema-sql.ts";
import { loadSqliteVecOrThrow } from "../sqlite-vec-load.ts";
import {
  UNIFIED_ITEM_V3_MIGRATE_FROM_LEGACY_SQL,
  UNIFIED_ITEM_V3_SCHEMA_SQL,
} from "../unified-item-v3-sql.ts";

const MIGRATIONS_LEDGER_SQL = `
CREATE TABLE IF NOT EXISTS _schema_migrations (
  version INTEGER PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);
`;

function personTableHasLinkedColumn(db: Database): boolean {
  const rows = db.query("PRAGMA table_info(person)").all() as Array<{ name: string }>;
  return rows.some((r) => r.name === "linked");
}

function personTableHasColumn(db: Database, columnName: string): boolean {
  const rows = db.query("PRAGMA table_info(person)").all() as Array<{ name: string }>;
  return rows.some((r) => r.name === columnName);
}

/** Current local index `PRAGMA user_version` (0 before first migration). */
export function readIndexedUserVersion(db: Database): number {
  const row = db.query("PRAGMA user_version").get() as { user_version: number } | undefined;
  const v = row?.user_version;
  return typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : 0;
}

function recordMigration(db: Database, version: number, description: string, now: number): void {
  db.run(
    `INSERT OR IGNORE INTO _schema_migrations (version, description, applied_at) VALUES (?, ?, ?)`,
    [version, description, now],
  );
}

/**
 * Backfill the ledger on existing databases that already reached `user_version` before the ledger existed.
 */
function backfillMigrationsLedger(db: Database): void {
  const uv = readIndexedUserVersion(db);
  if (uv < 1) {
    return;
  }
  const row = db.query(`SELECT COUNT(*) as c FROM _schema_migrations`).get() as
    | { c: number }
    | undefined;
  const c = row?.c ?? 0;
  if (c > 0) {
    return;
  }
  const now = Date.now();
  db.transaction(() => {
    if (uv >= 1) {
      recordMigration(db, 1, "initial filesystem schema (backfilled)", now);
    }
    if (uv >= 2) {
      recordMigration(db, 2, "scheduler_state + sync_telemetry (backfilled)", now);
    }
    if (uv >= 3) {
      recordMigration(db, 3, "unified item + item_fts + person (backfilled)", now);
    }
    if (uv >= 4) {
      recordMigration(db, 4, "person.linked (backfilled)", now);
    }
    if (uv >= 5) {
      recordMigration(db, 5, "person extra handles (backfilled)", now);
    }
    if (uv >= 6) {
      recordMigration(db, 6, "embedding_chunk + vec_items_384 (backfilled)", now);
    }
  })();
}

/**
 * Formal migration runner (Q2 §1.5). `PRAGMA user_version` remains the source of truth for stepping;
 * `_schema_migrations` is an append-only audit log.
 */
export function runIndexedSchemaMigrations(db: Database, targetVersion: number): void {
  db.exec(MIGRATIONS_LEDGER_SQL);
  backfillMigrationsLedger(db);

  let ver = readIndexedUserVersion(db);
  if (ver >= targetVersion) {
    return;
  }

  const now = Date.now();

  if (ver === 0) {
    db.transaction(() => {
      db.exec(INITIAL_SCHEMA_SQL);
      db.exec("PRAGMA user_version = 1");
      recordMigration(db, 1, "initial filesystem schema", now);
    })();
    ver = 1;
  }
  if (ver === 1 && targetVersion >= 2) {
    db.transaction(() => {
      db.exec(SCHEDULER_V2_MIGRATION_SQL);
      db.exec("PRAGMA user_version = 2");
      recordMigration(db, 2, "scheduler_state + sync_telemetry", now);
    })();
    ver = 2;
  }
  if (ver === 2 && targetVersion >= 3) {
    db.transaction(() => {
      db.exec(UNIFIED_ITEM_V3_SCHEMA_SQL);
      db.exec(UNIFIED_ITEM_V3_MIGRATE_FROM_LEGACY_SQL);
      db.exec("PRAGMA user_version = 3");
      recordMigration(db, 3, "unified item + item_fts + person", now);
    })();
    ver = 3;
  }
  if (ver === 3 && targetVersion >= 4) {
    db.transaction(() => {
      if (!personTableHasLinkedColumn(db)) {
        db.exec(PERSON_LINKED_V4_ALTER_SQL.trim());
      }
      db.run(
        `UPDATE person SET linked = 0 WHERE canonical_email IS NULL OR trim(canonical_email) = ''`,
      );
      db.exec("PRAGMA user_version = 4");
      recordMigration(db, 4, "person.linked column", now);
    })();
    ver = 4;
  }
  if (ver === 4 && targetVersion >= 5) {
    db.transaction(() => {
      if (!personTableHasColumn(db, "bitbucket_uuid")) {
        db.exec(PERSON_HANDLES_V5_ALTER_SQL.trim());
      }
      db.exec("PRAGMA user_version = 5");
      recordMigration(db, 5, "person bitbucket_uuid + microsoft_user_id + discord_user_id", now);
    })();
    ver = 5;
  }
  if (ver === 5 && targetVersion >= 6) {
    loadSqliteVecOrThrow(db);
    db.transaction(() => {
      db.exec(EMBEDDING_V6_MIGRATION_SQL);
      db.exec("PRAGMA user_version = 6");
      recordMigration(db, 6, "embedding_chunk + vec_items_384", now);
    })();
    ver = 6;
  }

  if (ver !== targetVersion) {
    throw new Error(
      `Unsupported local index schema version: ${String(ver)} (expected 0–${String(targetVersion)})`,
    );
  }
}
