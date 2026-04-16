/**
 * Index snapshot management — manual + scheduled.
 *
 * Manual:   `nimbus db snapshot` → <dataDir>/snapshots/nimbus-<timestamp>.db.gz
 * Restore:  `nimbus db restore <snapshot>` — requires confirmation, prints item-count diff
 * List:     `nimbus db snapshots list` — filename / timestamp / compressed size
 * Schedule: [db.snapshots] config block drives an interval-based scheduler here
 *
 * Uses `VACUUM INTO` so the database does not need to be closed for a snapshot.
 */

import { Database as BunDatabase, type Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";

// ─── Types ───────────────────────────────────────────────────────────────────

export type SnapshotEntry = {
  /** Absolute path to the .db.gz file */
  path: string;
  filename: string;
  /** Unix ms extracted from filename */
  timestampMs: number;
  compressedSizeBytes: number;
};

export type SnapshotConfig = {
  enabled: boolean;
  /** Cron schedule string (informational only; execution uses intervalMs). */
  schedule: string;
  /** How many recent snapshots to keep (oldest pruned on each run). */
  keepLast: number;
  /** Derived interval in ms between snapshots (caller computes from schedule). */
  intervalMs: number;
};

export const DEFAULT_SNAPSHOT_CONFIG: SnapshotConfig = {
  enabled: true,
  schedule: "0 2 * * *",
  keepLast: 7,
  intervalMs: 24 * 60 * 60 * 1000, // 24 hours
};

const SNAPSHOTS_DIR_NAME = "snapshots";

function snapshotsDir(dataDir: string): string {
  return join(dataDir, SNAPSHOTS_DIR_NAME);
}

// ─── Take snapshot ────────────────────────────────────────────────────────────

/**
 * Create a compressed snapshot of the live database.
 * Uses `VACUUM INTO` so the source DB stays open.
 *
 * @returns Absolute path of the written `.db.gz` file.
 */
export function takeSnapshot(db: Database, dataDir: string): string {
  const dir = snapshotsDir(dataDir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  const timestamp = Date.now();
  const uniq = randomUUID();
  const tmpPath = join(dir, `nimbus-${String(timestamp)}-${uniq}.db`);
  const gzPath = join(dir, `nimbus-${String(timestamp)}.db.gz`);
  const gzPartial = join(dir, `nimbus-${String(timestamp)}-${uniq}.db.gz.partial`);

  db.run(`VACUUM INTO ?`, [tmpPath]);
  try {
    chmodSync(tmpPath, 0o600);
  } catch {
    /* best-effort — snapshot still proceeds */
  }

  const raw = readFileSync(tmpPath);
  const compressed = Bun.gzipSync(raw);
  const fd = openSync(gzPartial, "wx", 0o600);
  try {
    writeSync(fd, compressed);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(gzPartial, gzPath);
  } catch {
    rmSync(gzPath, { force: true });
    renameSync(gzPartial, gzPath);
  }

  try {
    rmSync(tmpPath);
  } catch {
    /* non-fatal */
  }

  return gzPath;
}

// ─── List snapshots ───────────────────────────────────────────────────────────

/**
 * Return all snapshots in `<dataDir>/snapshots/`, newest first.
 */
export function listSnapshots(dataDir: string): SnapshotEntry[] {
  const dir = snapshotsDir(dataDir);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  const results: SnapshotEntry[] = [];
  for (const name of entries) {
    if (!name.startsWith("nimbus-") || !name.endsWith(".db.gz")) {
      continue;
    }
    // nimbus-<timestamp>.db.gz
    const tsStr = name.slice("nimbus-".length, -".db.gz".length);
    const tsMs = Number.parseInt(tsStr, 10);
    if (!Number.isFinite(tsMs)) {
      continue;
    }
    const fullPath = join(dir, name);
    let size = 0;
    try {
      size = statSync(fullPath).size;
    } catch {
      continue;
    }
    results.push({
      path: fullPath,
      filename: name,
      timestampMs: tsMs,
      compressedSizeBytes: size,
    });
  }

  results.sort((a, b) => b.timestampMs - a.timestampMs);
  return results;
}

// ─── Restore snapshot ─────────────────────────────────────────────────────────

export type RestorePreview = {
  snapshotTimestampMs: number;
  /** Item count in the current live DB */
  currentItemCount: number;
  /** Item count in the snapshot */
  snapshotItemCount: number;
};

/**
 * Read item counts from a compressed snapshot without restoring it.
 * Opens the snapshot in a temporary in-memory copy.
 */
export function previewRestore(db: Database, snapshotPath: string): RestorePreview {
  const compressed = readFileSync(snapshotPath);
  const raw = Bun.gunzipSync(compressed);

  const tmpPath = join(dirname(snapshotPath), `.restore-preview-${randomUUID()}.tmp`);
  try {
    writeFileSync(tmpPath, raw, { mode: 0o600, flag: "wx" });
    const snapDb = new BunDatabase(tmpPath, { readonly: true });
    let snapCount = 0;
    try {
      const row = snapDb.query("SELECT COUNT(*) as c FROM item").get() as { c: number } | undefined;
      snapCount = row?.c ?? 0;
    } finally {
      snapDb.close();
    }

    let liveCount = 0;
    try {
      const row = db.query("SELECT COUNT(*) as c FROM item").get() as { c: number } | undefined;
      liveCount = row?.c ?? 0;
    } catch {
      /* item table may not exist yet */
    }

    const snapshotTsMatch = /nimbus-(\d+)\.db\.gz/.exec(snapshotPath);
    const tsStr = snapshotTsMatch?.[1] ?? "0";
    const tsMs = Number.parseInt(tsStr, 10);

    return {
      snapshotTimestampMs: Number.isFinite(tsMs) ? tsMs : 0,
      currentItemCount: liveCount,
      snapshotItemCount: snapCount,
    };
  } finally {
    try {
      rmSync(tmpPath);
    } catch {
      /* non-fatal */
    }
  }
}

/**
 * Restore the live database from a snapshot.
 * **The caller MUST close the database before calling this and re-open it after.**
 *
 * @param snapshotPath Absolute path to a `.db.gz` snapshot.
 * @param dbPath       Absolute path to the live `nimbus.db` file to overwrite.
 */
export function restoreSnapshot(snapshotPath: string, dbPath: string): void {
  const compressed = readFileSync(snapshotPath);
  const raw = Bun.gunzipSync(compressed);
  writeFileSync(dbPath, raw);
}

// ─── Prune snapshots ──────────────────────────────────────────────────────────

/**
 * Keep only the `keepLast` most-recent snapshots; delete the rest.
 * Returns the number of deleted files.
 */
export function pruneSnapshots(dataDir: string, keepLast: number): number {
  const all = listSnapshots(dataDir);
  const toDelete = all.slice(keepLast);
  let deleted = 0;
  for (const entry of toDelete) {
    try {
      rmSync(entry.path);
      deleted++;
    } catch {
      /* best-effort */
    }
  }
  return deleted;
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

type SnapshotSchedulerHandle = { stop: () => void };

/**
 * Start an interval-based snapshot scheduler.
 * The first snapshot fires immediately if `runNow` is true.
 *
 * @param db        Live database (must remain open while scheduler is running).
 * @param dataDir   Platform data directory.
 * @param config    Snapshot configuration.
 * @param runNow    Fire the first snapshot immediately (for testing / startup catch-up).
 * @returns A handle with `stop()` to clear the interval.
 */
export function startSnapshotScheduler(
  db: Database,
  dataDir: string,
  config: SnapshotConfig,
  runNow = false,
): SnapshotSchedulerHandle {
  if (!config.enabled) {
    return { stop: () => {} };
  }

  function runSnapshot(): void {
    try {
      takeSnapshot(db, dataDir);
      pruneSnapshots(dataDir, config.keepLast);
    } catch {
      /* snapshot errors must not crash the gateway */
    }
  }

  if (runNow) {
    runSnapshot();
  }

  const handle = setInterval(runSnapshot, config.intervalMs);

  return {
    stop(): void {
      clearInterval(handle);
    },
  };
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function humanBytes(n: number): string {
  if (n < 1024) return `${String(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatSnapshotList(entries: SnapshotEntry[]): string {
  if (entries.length === 0) {
    return "No snapshots found.";
  }
  const header = "FILENAME                                   TIMESTAMP                SIZE";
  const sep = "─".repeat(header.length);
  const rows = entries.map((e) => {
    const dt = new Date(e.timestampMs).toISOString().replace("T", " ").slice(0, 19);
    const size = humanBytes(e.compressedSizeBytes).padStart(8);
    return `${e.filename.padEnd(42)} ${dt}  ${size}`;
  });
  return [header, sep, ...rows].join("\n");
}
