import type { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONNECTOR_REMOVE_INTENT_V15_SQL } from "../../connectors/remove-intent.ts";
import { CONNECTOR_HEALTH_V13_SQL } from "../connector-health-v13-sql.ts";
import {
  EMBEDDING_V6_MIGRATION_SQL,
  EMBEDDING_V6_NO_VEC_MIGRATION_SQL,
} from "../embedding-v6-sql.ts";
import {
  EXTENSION_SESSION_V10_MIGRATION_SQL,
  EXTENSION_SESSION_V10_NO_VEC_MIGRATION_SQL,
} from "../extension-session-v10-sql.ts";
import { GRAPH_RELATION_TYPES_V12_SQL } from "../graph-relation-types-v12-sql.ts";
import { GRAPH_V7_MIGRATION_SQL } from "../graph-v7-sql.ts";
import { PERSON_HANDLES_V5_ALTER_SQL } from "../person-handles-v5-sql.ts";
import { PERSON_LINKED_V4_ALTER_SQL } from "../person-linked-v4-sql.ts";
import { QUERY_LATENCY_V14_SQL } from "../query-latency-v14-sql.ts";
import { SCHEDULER_V2_MIGRATION_SQL } from "../scheduler-schema-sql.ts";
import { INITIAL_SCHEMA_SQL } from "../schema-sql.ts";
import { tryLoadSqliteVec } from "../sqlite-vec-load.ts";
import {
  UNIFIED_ITEM_V3_MIGRATE_FROM_LEGACY_SQL,
  UNIFIED_ITEM_V3_SCHEMA_SQL,
} from "../unified-item-v3-sql.ts";
import { USER_MCP_V11_MIGRATION_SQL } from "../user-mcp-v11-sql.ts";
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
  const vecLoaded = tryLoadSqliteVec(db);
  db.transaction(() => {
    db.exec(vecLoaded ? EMBEDDING_V6_MIGRATION_SQL : EMBEDDING_V6_NO_VEC_MIGRATION_SQL);
    db.exec("PRAGMA user_version = 6");
    recordMigration(
      db,
      6,
      vecLoaded ? "embedding_chunk + vec_items_384" : "embedding_chunk (sqlite-vec unavailable)",
      now,
    );
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

function vecTableExists(db: Database): boolean {
  const row = db
    .query(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'vec_items_384'`)
    .get() as { 1: number } | null;
  return row !== null;
}

function migrateIndexedV9ToV10(db: Database, now: number): void {
  const hasVec = vecTableExists(db);
  db.transaction(() => {
    db.exec(
      hasVec ? EXTENSION_SESSION_V10_MIGRATION_SQL : EXTENSION_SESSION_V10_NO_VEC_MIGRATION_SQL,
    );
    db.exec("PRAGMA user_version = 10");
    recordMigration(db, 10, "extension + session_memory", now);
  })();
}

function migrateIndexedV10ToV11(db: Database, now: number): void {
  db.transaction(() => {
    db.exec(USER_MCP_V11_MIGRATION_SQL);
    db.exec("PRAGMA user_version = 11");
    recordMigration(db, 11, "user_mcp_connector", now);
  })();
}

function migrateIndexedV11ToV12(db: Database, now: number): void {
  db.transaction(() => {
    db.exec(GRAPH_RELATION_TYPES_V12_SQL);
    db.exec("PRAGMA user_version = 12");
    recordMigration(db, 12, "graph_relation_type filesystem edges", now);
  })();
}

function migrateIndexedV12ToV13(db: Database, now: number): void {
  db.transaction(() => {
    db.exec(CONNECTOR_HEALTH_V13_SQL);
    db.exec("PRAGMA user_version = 13");
    recordMigration(db, 13, "connector health state + history", now);
  })();
}

function migrateIndexedV13ToV14(db: Database, now: number): void {
  db.transaction(() => {
    db.exec(QUERY_LATENCY_V14_SQL);
    db.exec("PRAGMA user_version = 14");
    recordMigration(db, 14, "query_latency_log + slow_query_log", now);
  })();
}

function migrateIndexedV14ToV15(db: Database, now: number): void {
  db.transaction(() => {
    db.exec(CONNECTOR_REMOVE_INTENT_V15_SQL);
    db.exec("PRAGMA user_version = 15");
    recordMigration(db, 15, "connector_remove_intent (crash-safe removal WAL)", now);
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
  { fromVersion: 10, toVersion: 11, apply: migrateIndexedV10ToV11 },
  { fromVersion: 11, toVersion: 12, apply: migrateIndexedV11ToV12 },
  { fromVersion: 12, toVersion: 13, apply: migrateIndexedV12ToV13 },
  { fromVersion: 13, toVersion: 14, apply: migrateIndexedV13ToV14 },
  { fromVersion: 14, toVersion: 15, apply: migrateIndexedV14ToV15 },
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
    if (uv >= 11) {
      recordMigration(db, 11, "user_mcp_connector (backfilled)", now);
    }
    if (uv >= 12) {
      recordMigration(db, 12, "graph_relation_type filesystem edges (backfilled)", now);
    }
    if (uv >= 13) {
      recordMigration(db, 13, "connector health state + history (backfilled)", now);
    }
    if (uv >= 14) {
      recordMigration(db, 14, "query_latency_log + slow_query_log (backfilled)", now);
    }
    if (uv >= 15) {
      recordMigration(db, 15, "connector_remove_intent (backfilled)", now);
    }
  })();
}

// ─── Pre-migration backup ────────────────────────────────────────────────────

export type MigrationBackupOptions = {
  /** Directory where backups are written, e.g. `<dataDir>/backups`. */
  backupDir: string;
  /** Absolute path to the live DB file (must not be `:memory:`). */
  dbPath: string;
};

/**
 * Thrown when a migration fails mid-run. The pre-migration backup path is
 * included in the message so the Gateway startup handler can print a clear,
 * actionable recovery message before exiting.
 */
export class MigrationRollbackError extends Error {
  readonly migrationVersion: number;
  readonly backupPath: string | null;
  override readonly cause: unknown;

  constructor(version: number, backupPath: string | null, cause: unknown) {
    const hint =
      backupPath === null
        ? " No backup was available (in-memory or missing DB path)."
        : ` A pre-migration backup was saved to: ${backupPath}`;
    super(`Migration v${String(version)} failed and was rolled back.${hint}`);
    this.name = "MigrationRollbackError";
    this.migrationVersion = version;
    this.backupPath = backupPath;
    this.cause = cause;
  }
}

/**
 * Create a gzip-compressed backup of `dbPath` before running migration `version`.
 * Uses `VACUUM INTO` (SQLite 3.27+) so the backup is always clean regardless of
 * WAL state — no need to close the database first.
 *
 * Returns the path of the written `.db.gz` file.
 * Throws if the backup cannot be written (caller aborts the migration).
 */
function writePreMigrationBackup(
  db: Database,
  version: number,
  opts: MigrationBackupOptions,
): string {
  mkdirSync(opts.backupDir, { recursive: true });

  const timestamp = Date.now();
  const tmpPath = join(opts.backupDir, `pre-migration-${String(version)}-${String(timestamp)}.db`);
  const gzPath = `${tmpPath}.gz`;

  // VACUUM INTO creates a defragmented, WAL-checkpointed copy without locking
  // the source for longer than a read transaction.
  db.run(`VACUUM INTO ?`, [tmpPath]);

  // readFileSync / Bun.gzipSync / writeFileSync are all synchronous —
  // safe to call from the migration runner without async plumbing.
  const raw = readFileSync(tmpPath);
  const compressed = Bun.gzipSync(raw);
  writeFileSync(gzPath, compressed);

  // Remove the uncompressed temp copy
  try {
    rmSync(tmpPath);
  } catch {
    /* non-fatal */
  }

  return gzPath;
}

/**
 * Remove backup files older than `maxAgeDays` from `backupDir`.
 * Called at the end of a fully successful migration run.
 */
function pruneOldBackups(backupDir: string, maxAgeDays: number): void {
  let entries: string[];
  try {
    entries = readdirSync(backupDir);
  } catch {
    return; // directory doesn't exist yet — nothing to prune
  }
  const cutoffMs = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  for (const name of entries) {
    if (!name.endsWith(".db.gz")) {
      continue;
    }
    const fullPath = join(backupDir, name);
    try {
      const st = statSync(fullPath);
      if (st.mtimeMs < cutoffMs) {
        rmSync(fullPath);
      }
    } catch {
      /* ignore stat/rm failures — best-effort pruning */
    }
  }
}

function applyIndexedSchemaStep(
  db: Database,
  step: IndexedSchemaStep,
  currentVersion: number,
  targetVersion: number,
  backupOptions: MigrationBackupOptions | undefined,
  now: number,
): number | null {
  if (currentVersion !== step.fromVersion || targetVersion < step.toVersion) {
    return null;
  }
  let backupPath: string | null = null;

  if (backupOptions !== undefined) {
    // Abort the entire run if the backup cannot be written.
    backupPath = writePreMigrationBackup(db, step.toVersion, backupOptions);
  }

  try {
    step.apply(db, now);
  } catch (err) {
    // Each migration runs inside its own transaction — SQLite has already
    // rolled it back. Wrap and re-throw with recovery information.
    throw new MigrationRollbackError(step.toVersion, backupPath, err);
  }

  return step.toVersion;
}

// ─── Public runner ────────────────────────────────────────────────────────────

/**
 * Formal migration runner (Q2 §1.5). `PRAGMA user_version` remains the source of truth for stepping;
 * `_schema_migrations` is an append-only audit log.
 *
 * When `backupOptions` is provided, a gzip-compressed backup of the DB is
 * written before each migration step. On failure the migration transaction is
 * rolled back automatically by SQLite; the backup is available for manual
 * recovery and its path is included in the thrown `MigrationRollbackError`.
 */
export function runIndexedSchemaMigrations(
  db: Database,
  targetVersion: number,
  backupOptions?: MigrationBackupOptions,
): void {
  db.exec(MIGRATIONS_LEDGER_SQL);
  backfillMigrationsLedger(db);

  let ver = readIndexedUserVersion(db);
  if (ver >= targetVersion) {
    return;
  }

  const now = Date.now();
  let anyStepRan = false;

  for (const step of INDEXED_SCHEMA_STEPS) {
    const nextVer = applyIndexedSchemaStep(db, step, ver, targetVersion, backupOptions, now);
    if (nextVer !== null) {
      ver = nextVer;
      anyStepRan = true;
    }
  }

  if (ver !== targetVersion) {
    throw new Error(
      `Unsupported local index schema version: ${String(ver)} (expected 0–${String(targetVersion)})`,
    );
  }

  // Prune old backups after a fully successful run (best-effort).
  if (anyStepRan && backupOptions !== undefined) {
    try {
      pruneOldBackups(backupOptions.backupDir, 30);
    } catch {
      /* pruning failure must not prevent successful startup */
    }
  }
}
