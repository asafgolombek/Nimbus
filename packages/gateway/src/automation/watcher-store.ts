import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";

import { readIndexedUserVersion } from "../index/migrations/runner.ts";

export type WatcherRow = {
  id: string;
  name: string;
  enabled: number;
  condition_type: string;
  condition_json: string;
  action_type: string;
  action_json: string;
  created_at: number;
  last_checked_at: number | null;
  last_fired_at: number | null;
};

export function listWatchers(db: Database): WatcherRow[] {
  if (readIndexedUserVersion(db) < 8) {
    return [];
  }
  return db
    .query(
      `SELECT id, name, enabled, condition_type, condition_json, action_type, action_json,
              created_at, last_checked_at, last_fired_at
       FROM watcher ORDER BY name`,
    )
    .all() as WatcherRow[];
}

export function listEnabledWatchers(db: Database): WatcherRow[] {
  return listWatchers(db).filter((w) => w.enabled === 1);
}

export function insertWatcher(
  db: Database,
  row: Omit<WatcherRow, "id" | "last_checked_at" | "last_fired_at"> & { id?: string },
): string {
  if (readIndexedUserVersion(db) < 8) {
    throw new Error("Watcher schema requires v8+");
  }
  const id = row.id ?? randomUUID();
  const now = row.created_at;
  db.run(
    `INSERT INTO watcher (id, name, enabled, condition_type, condition_json, action_type, action_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      row.name,
      row.enabled,
      row.condition_type,
      row.condition_json,
      row.action_type,
      row.action_json,
      now,
    ],
  );
  return id;
}

export function deleteWatcher(db: Database, id: string): void {
  if (readIndexedUserVersion(db) < 8) {
    return;
  }
  db.run(`DELETE FROM watcher WHERE id = ?`, [id]);
}

export function updateWatcherLastChecked(db: Database, id: string, ts: number): void {
  db.run(`UPDATE watcher SET last_checked_at = ? WHERE id = ?`, [ts, id]);
}

export function updateWatcherLastFired(db: Database, id: string, ts: number): void {
  db.run(`UPDATE watcher SET last_fired_at = ? WHERE id = ?`, [ts, id]);
}

export function insertWatcherEvent(
  db: Database,
  watcherId: string,
  firedAt: number,
  conditionSnapshot: string,
  actionResult: string | null,
): void {
  db.run(
    `INSERT INTO watcher_event (watcher_id, fired_at, condition_snapshot, action_result)
     VALUES (?, ?, ?, ?)`,
    [watcherId, firedAt, conditionSnapshot, actionResult],
  );
}
