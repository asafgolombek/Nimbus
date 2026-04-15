/**
 * Aggregate-only telemetry fields sourced from SQLite (Phase 3.5).
 * Never includes row content (e.g. sync error messages) — counts and durations only.
 */

import type { Database } from "bun:sqlite";

const SEVEN_D_MS = 7 * 24 * 60 * 60 * 1000;

function tableExists(db: Database, name: string): boolean {
  const row = db
    .query(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`)
    .get(name) as { ok: number } | null;
  return row !== null;
}

function medianSorted(sorted: number[]): number {
  if (sorted.length === 0) {
    return 0;
  }
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    const v = sorted[mid];
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  }
  const a = sorted[mid - 1];
  const b = sorted[mid];
  if (typeof a === "number" && typeof b === "number" && Number.isFinite(a) && Number.isFinite(b)) {
    return (a + b) / 2;
  }
  return 0;
}

export type TelemetryDbAggregateSlice = {
  readonly connector_error_rate: Record<string, number>;
  readonly connector_health_transitions: Record<string, number>;
  readonly sync_duration_p50_ms: Record<string, number>;
  readonly extension_installs_by_id: Record<string, number>;
};

/**
 * Collects bounded aggregates from the last 7 days of `sync_telemetry` / health history,
 * plus a snapshot of enabled extension ids (count 1 each — not a time series).
 */
export function collectTelemetryDbAggregates(db: Database): TelemetryDbAggregateSlice {
  const connector_error_rate: Record<string, number> = {};
  const sync_duration_p50_ms: Record<string, number> = {};
  const connector_health_transitions: Record<string, number> = {};
  const extension_installs_by_id: Record<string, number> = {};

  const cutoff = Date.now() - SEVEN_D_MS;

  if (tableExists(db, "sync_telemetry")) {
    const rows = db
      .query(
        `SELECT service, duration_ms, error_msg
         FROM sync_telemetry
         WHERE started_at >= ?`,
      )
      .all(cutoff) as Array<{ service: string; duration_ms: number; error_msg: string | null }>;

    const durationsByService = new Map<string, number[]>();
    for (const r of rows) {
      const svc = r.service.trim();
      if (svc === "") {
        continue;
      }
      if (r.error_msg !== null && r.error_msg !== "") {
        connector_error_rate[svc] = (connector_error_rate[svc] ?? 0) + 1;
      }
      const dm = Math.max(0, Math.floor(r.duration_ms));
      const arr = durationsByService.get(svc);
      if (arr === undefined) {
        durationsByService.set(svc, [dm]);
      } else {
        arr.push(dm);
      }
    }
    for (const [svc, arr] of durationsByService) {
      const sorted = [...arr].sort((a, b) => a - b);
      sync_duration_p50_ms[svc] = Math.round(medianSorted(sorted));
    }
  }

  if (tableExists(db, "connector_health_history")) {
    const hRows = db
      .query(
        `SELECT to_state, COUNT(*) AS c
         FROM connector_health_history
         WHERE occurred_at >= ?
         GROUP BY to_state`,
      )
      .all(cutoff) as Array<{ to_state: string; c: number }>;
    for (const r of hRows) {
      const st = r.to_state.trim();
      if (st !== "") {
        connector_health_transitions[st] = Math.max(0, Math.floor(r.c));
      }
    }
  }

  if (tableExists(db, "extension")) {
    const extRows = db.query(`SELECT id FROM extension WHERE enabled = 1`).all() as Array<{
      id: string;
    }>;
    for (const r of extRows) {
      const id = r.id.trim();
      if (id !== "") {
        extension_installs_by_id[id] = 1;
      }
    }
  }

  return {
    connector_error_rate,
    connector_health_transitions,
    sync_duration_p50_ms,
    extension_installs_by_id,
  };
}
