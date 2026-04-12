import type { Database } from "bun:sqlite";
import { EMBEDDING_V6_MIGRATION_SQL } from "../embedding-v6-sql.ts";
import { EXTENSION_SESSION_V10_MIGRATION_SQL } from "../extension-session-v10-sql.ts";
import { GRAPH_V7_MIGRATION_SQL } from "../graph-v7-sql.ts";
import { PERSON_HANDLES_V5_ALTER_SQL } from "../person-handles-v5-sql.ts";
import { PERSON_LINKED_V4_ALTER_SQL } from "../person-linked-v4-sql.ts";
import { SCHEDULER_V2_MIGRATION_SQL } from "../scheduler-schema-sql.ts";
import { INITIAL_SCHEMA_SQL } from "../schema-sql.ts";
import { loadSqliteVecOrThrow } from "../sqlite-vec-load.ts";
import {
  UNIFIED_ITEM_V3_MIGRATE_FROM_LEGACY_SQL,
  UNIFIED_ITEM_V3_SCHEMA_SQL,
} from "../unified-item-v3-sql.ts";
import { WATCHER_V8_MIGRATION_SQL } from "../watcher-v8-sql.ts";
import { WORKFLOW_V9_MIGRATION_SQL } from "../workflow-v9-sql.ts";

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

type IndexedSchemaStep = {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly apply: (db: Database, now: number) => void;
};

function migrateIndexedV0ToV1(db: Database, now: number): void {
  db.transaction(() => {
    db.exec(INITIAL_SCHEMA_SQL);
    db.exec("PRAGMA user_version = 1");
    recordMigration(db, 1, "initial filesystem schema", now);
  })();
}

function migrateIndexedV1ToV2(db: Database, now: number): void {
  db.transaction(() => {
    db.exec(SCHEDULER_V2_MIGRATION_SQL);
    db.exec("PRAGMA user_version = 2");
    recordMigration(db, 2, "scheduler_state + sync_telemetry", now);
  })();
}

function migrateIndexedV2ToV3(db: Database, now: number): void {
  db.transaction(() => {
    db.exec(UNIFIED_ITEM_V3_SCHEMA_SQL);
    db.exec(UNIFIED_ITEM_V3_MIGRATE_FROM_LEGACY_SQL);
    db.exec("PRAGMA user_version = 3");
    recordMigration(db, 3, "unified item + item_fts + person", now);
  })();
}

function migrateIndexedV3ToV4(db: Database, now: number): void {
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
}

function migrateIndexedV4ToV5(db: Database, now: number): void {
  db.transaction(() => {
    if (!personTableHasColumn(db, "bitbucket_uuid")) {
      db.exec(PERSON_HANDLES_V5_ALTER_SQL.trim());
    }
    db.exec("PRAGMA user_version = 5");
    recordMigration(db, 5, "person bitbucket_uuid + microsoft_user_id + discord_user_id", now);
  })();
}

function migrateIndexedV5ToV6(db: Database, now: number): void {
  loadSqliteVecOrThrow(db);
  db.transaction(() => {
    db.exec(EMBEDDING_V6_MIGRATION_SQL);
    db.exec("PRAGMA user_version = 6");
    recordMigration(db, 6, "embedding_chunk + vec_items_384", now);
  })();
}

function migrateIndexedV6ToV7(db: Database, now: number): void {
  db.transaction(() => {
    db.exec(GRAPH_V7_MIGRATION_SQL);
    db.exec("PRAGMA user_version = 7");
    recordMigration(db, 7, "graph_entity + graph_relation", now);
  })();
}

function migrateIndexedV7ToV8(db: Database, now: number): void {
  db.transaction(() => {
    db.exec(WATCHER_V8_MIGRATION_SQL);
    db.exec("PRAGMA user_version = 8");
    recordMigration(db, 8, "watcher + watcher_event", now);
  })();
}

function migrateIndexedV8ToV9(db: Database, now: number): void {
  db.transaction(() => {
    db.exec(WORKFLOW_V9_MIGRATION_SQL);
    db.exec("PRAGMA user_version = 9");
    recordMigration(db, 9, "workflow tables", now);
  })();
}

function migrateIndexedV9ToV10(db: Database, now: number): void {
  db.transaction(() => {
    db.exec(EXTENSION_SESSION_V10_MIGRATION_SQL);
    db.exec("PRAGMA user_version = 10");
    recordMigration(db, 10, "extension + session_memory", now);
  })();
}

const INDEXED_SCHEMA_STEPS: readonly IndexedSchemaStep[] = [
  { fromVersion: 0, toVersion: 1, apply: migrateIndexedV0ToV1 },
  { fromVersion: 1, toVersion: 2, apply: migrateIndexedV1ToV2 },
  { fromVersion: 2, toVersion: 3, apply: migrateIndexedV2ToV3 },
  { fromVersion: 3, toVersion: 4, apply: migrateIndexedV3ToV4 },
  { fromVersion: 4, toVersion: 5, apply: migrateIndexedV4ToV5 },
  { fromVersion: 5, toVersion: 6, apply: migrateIndexedV5ToV6 },
  { fromVersion: 6, toVersion: 7, apply: migrateIndexedV6ToV7 },
  { fromVersion: 7, toVersion: 8, apply: migrateIndexedV7ToV8 },
  { fromVersion: 8, toVersion: 9, apply: migrateIndexedV8ToV9 },
  { fromVersion: 9, toVersion: 10, apply: migrateIndexedV9ToV10 },
];

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
    if (uv >= 7) {
      recordMigration(db, 7, "graph_entity + graph_relation (backfilled)", now);
    }
    if (uv >= 8) {
      recordMigration(db, 8, "watcher + watcher_event (backfilled)", now);
    }
    if (uv >= 9) {
      recordMigration(db, 9, "workflow + workflow_run + workflow_run_step (backfilled)", now);
    }
    if (uv >= 10) {
      recordMigration(db, 10, "extension + session_memory (backfilled)", now);
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

  for (const step of INDEXED_SCHEMA_STEPS) {
    if (ver === step.fromVersion && targetVersion >= step.toVersion) {
      step.apply(db, now);
      ver = step.toVersion;
    }
  }

  if (ver !== targetVersion) {
    throw new Error(
      `Unsupported local index schema version: ${String(ver)} (expected 0–${String(targetVersion)})`,
    );
  }
}
