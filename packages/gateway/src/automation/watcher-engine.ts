import type { Database } from "bun:sqlite";

import { readIndexedUserVersion } from "../index/migrations/runner.ts";
import {
  insertWatcherEvent,
  listEnabledWatchers,
  updateWatcherLastChecked,
  updateWatcherLastFired,
  type WatcherRow,
} from "./watcher-store.ts";

function asRecord(json: string): Record<string, unknown> | undefined {
  try {
    const v = JSON.parse(json) as unknown;
    if (v === null || typeof v !== "object" || Array.isArray(v)) {
      return undefined;
    }
    return v as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * Best-effort watcher evaluation after a connector sync completes.
 */
export function evaluateWatchersAfterSync(
  db: Database,
  syncedServiceId: string,
  nowMs: number,
  notify: (title: string, body: string) => void | Promise<void>,
): void {
  if (readIndexedUserVersion(db) < 8) {
    return;
  }

  for (const w of listEnabledWatchers(db)) {
    const fired = evaluateOneWatcher(db, w, syncedServiceId);
    updateWatcherLastChecked(db, w.id, nowMs);
    if (fired !== null) {
      insertWatcherEvent(db, w.id, nowMs, fired.snapshot, JSON.stringify({ ok: true }));
      void notify("Nimbus watcher", `${w.name}: ${fired.summary}`);
      updateWatcherLastFired(db, w.id, nowMs);
    }
  }
}

/**
 * One startup pass: evaluate enabled watchers without requiring a connector sync (catch-up).
 * Uses the same alert query as post-sync evaluation; omits the per-sync service gate.
 */
export function evaluateWatchersStartupCatchUp(
  db: Database,
  nowMs: number,
  notify: (title: string, body: string) => void | Promise<void>,
): void {
  if (readIndexedUserVersion(db) < 8) {
    return;
  }
  for (const w of listEnabledWatchers(db)) {
    const fired = evaluateOneWatcher(db, w, undefined);
    updateWatcherLastChecked(db, w.id, nowMs);
    if (fired !== null) {
      insertWatcherEvent(db, w.id, nowMs, fired.snapshot, JSON.stringify({ ok: true }));
      void notify("Nimbus watcher", `${w.name}: ${fired.summary}`);
      updateWatcherLastFired(db, w.id, nowMs);
    }
  }
}

function evaluateOneWatcher(
  db: Database,
  w: WatcherRow,
  syncedServiceId: string | undefined,
): { summary: string; snapshot: string } | null {
  if (w.condition_type !== "alert_fired") {
    return null;
  }
  const cond = asRecord(w.condition_json);
  if (cond === undefined) {
    return null;
  }
  const filter = cond["filter"];
  if (filter === null || typeof filter !== "object" || Array.isArray(filter)) {
    return null;
  }
  const f = filter as Record<string, unknown>;
  const service = typeof f["service"] === "string" ? f["service"] : undefined;
  if (syncedServiceId !== undefined && service !== undefined && service !== syncedServiceId) {
    return null;
  }

  const since = w.last_checked_at ?? w.created_at;
  const rows = db
    .query(
      `SELECT id, title, service, modified_at FROM item
       WHERE type = 'alert'
         AND modified_at > ?
         AND (? IS NULL OR service = ?)
       ORDER BY modified_at DESC
       LIMIT 5`,
    )
    .all(since, service ?? null, service ?? null) as Array<{
    id: string;
    title: string;
    service: string;
    modified_at: number;
  }>;

  if (rows.length === 0) {
    return null;
  }

  const first = rows[0];
  if (first === undefined) {
    return null;
  }
  const summary = `${first.service}: ${first.title}`;
  const snapshot = JSON.stringify({ matches: rows, condition: w.condition_json });
  return { summary, snapshot };
}
