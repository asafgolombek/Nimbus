import type { Database } from "bun:sqlite";

export interface WatcherHistoryEvent {
  readonly firedAt: number;
  readonly conditionSnapshot: string;
  readonly actionResult: string;
}

export interface WatcherHistoryListResult {
  readonly events: ReadonlyArray<WatcherHistoryEvent>;
}

export interface ListWatcherHistoryParams {
  readonly watcherId: string;
  readonly limit: number;
}

const MIN_LIMIT = 1;
const MAX_LIMIT = 500;

function clamp(n: number): number {
  if (!Number.isFinite(n) || n < MIN_LIMIT) return 0;
  if (n > MAX_LIMIT) return MAX_LIMIT;
  return Math.floor(n);
}

export function listWatcherHistory(
  db: Database,
  params: ListWatcherHistoryParams,
): WatcherHistoryListResult {
  const limit = clamp(params.limit);
  if (limit === 0) return { events: [] };
  const rows = db
    .query(
      `SELECT fired_at, condition_snapshot, action_result
       FROM watcher_event
       WHERE watcher_id = ?
       ORDER BY fired_at DESC
       LIMIT ?`,
    )
    .all(params.watcherId, limit) as Array<{
    fired_at: number;
    condition_snapshot: string;
    action_result: string;
  }>;
  return {
    events: rows.map((r) => ({
      firedAt: r.fired_at,
      conditionSnapshot: r.condition_snapshot,
      actionResult: r.action_result,
    })),
  };
}
