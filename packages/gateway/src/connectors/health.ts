/**
 * Connector health state machine — Phase 3.5 Workstream 2.
 *
 * `transitionHealth()` is the single point of entry for all health state changes.
 * It updates `sync_state` in place and appends a row to `connector_health_history`
 * so that `nimbus connector history <name>` can show a timeline.
 *
 * Design notes:
 *  - All state transitions go through this function — callers never write directly
 *    to `sync_state.health_state`.
 *  - History rows are pruned by the weekly retentionDays pruner (>7 days old).
 *  - `last_error` is truncated to 512 chars to prevent runaway DB growth.
 */

import type { Database } from "bun:sqlite";

/** Uniform jitter in [0, maxExclusive) for backoff spacing (CSPRNG). */
function jitterBelowMs(maxExclusive: number): number {
  const word = new Uint32Array(1);
  crypto.getRandomValues(word);
  const u = word[0] ?? 0;
  return (u / 2 ** 32) * maxExclusive;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConnectorHealthState =
  | "healthy"
  | "degraded"
  | "error"
  | "rate_limited"
  | "unauthenticated"
  | "paused";

export interface ConnectorHealthSnapshot {
  connectorId: string;
  state: ConnectorHealthState;
  retryAfter?: Date;
  backoffUntil?: Date;
  backoffAttempt: number;
  lastError?: string;
  lastSuccessfulSync?: Date;
  lastSyncAttempt?: Date;
}

export type HealthEvent =
  | { type: "sync_success" }
  | { type: "rate_limited"; retryAfter: Date }
  | { type: "unauthenticated" }
  | { type: "transient_error"; error: string; attempt: number }
  | { type: "persistent_error"; error: string }
  | { type: "paused" }
  | { type: "resumed" }
  | { type: "skipped_offline" };

const MAX_ERROR_LENGTH = 512;

function truncate(s: string): string {
  return s.length > MAX_ERROR_LENGTH ? `${s.slice(0, MAX_ERROR_LENGTH - 3)}...` : s;
}

// ─── State-transition table ───────────────────────────────────────────────────

/**
 * Derive the next `ConnectorHealthState` from an incoming event.
 * The `attempt` field on `transient_error` is provided by the caller (scheduler).
 */
function nextState(event: HealthEvent, maxAttempts: number): ConnectorHealthState {
  switch (event.type) {
    case "sync_success":
      return "healthy";
    case "rate_limited":
      return "rate_limited";
    case "unauthenticated":
      return "unauthenticated";
    case "transient_error":
      return event.attempt >= maxAttempts ? "error" : "degraded";
    case "persistent_error":
      return "error";
    case "paused":
      return "paused";
    case "resumed":
      return "healthy";
    case "skipped_offline":
      // No state change — we record history but leave health_state unchanged.
      return "__no_change__" as ConnectorHealthState;
  }
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

interface SyncStateHealthRow {
  health_state: string;
  retry_after: number | null;
  backoff_until: number | null;
  backoff_attempt: number;
  last_error: string | null;
  last_sync_at: number | null;
}

function readHealthRow(db: Database, connectorId: string): SyncStateHealthRow | null {
  return (
    (db
      .query(
        `SELECT health_state, retry_after, backoff_until, backoff_attempt, last_error, last_sync_at
         FROM sync_state WHERE connector_id = ?`,
      )
      .get(connectorId) as SyncStateHealthRow | null) ?? null
  );
}

function upsertHealthRow(
  db: Database,
  connectorId: string,
  patch: {
    health_state: string;
    retry_after: number | null;
    backoff_until: number | null;
    backoff_attempt: number;
    last_error: string | null;
  },
): void {
  // Ensure a sync_state row exists (may not exist yet for brand-new connectors).
  db.run(
    `INSERT OR IGNORE INTO sync_state (connector_id, last_sync_at, next_sync_token) VALUES (?, NULL, NULL)`,
    [connectorId],
  );
  db.run(
    `UPDATE sync_state
     SET health_state   = ?,
         retry_after    = ?,
         backoff_until  = ?,
         backoff_attempt = ?,
         last_error     = ?
     WHERE connector_id = ?`,
    [
      patch.health_state,
      patch.retry_after,
      patch.backoff_until,
      patch.backoff_attempt,
      patch.last_error,
      connectorId,
    ],
  );
}

function appendHistory(
  db: Database,
  connectorId: string,
  fromState: string | null,
  toState: string,
  reason: string | null,
  occurredAt: number,
): void {
  db.run(
    `INSERT INTO connector_health_history
       (connector_id, from_state, to_state, reason, occurred_at)
     VALUES (?, ?, ?, ?, ?)`,
    [connectorId, fromState, toState, reason, occurredAt],
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Default max transient-error attempts before entering `error` state. */
export const DEFAULT_MAX_BACKOFF_ATTEMPTS = 10;

/**
 * Apply `event` to the health state of `connectorId`, persist the new state,
 * and append a history row. Returns the updated snapshot.
 *
 * @param db            Open read-write bun:sqlite Database (V13+ schema).
 * @param connectorId   The connector's `service_id` string.
 * @param event         The health event to apply.
 * @param maxAttempts   Max transient failures before entering `error` (default 10).
 */
export function transitionHealth(
  db: Database,
  connectorId: string,
  event: HealthEvent,
  maxAttempts = DEFAULT_MAX_BACKOFF_ATTEMPTS,
): ConnectorHealthSnapshot {
  const now = Date.now();
  const current = readHealthRow(db, connectorId);
  const fromState = current?.health_state ?? null;

  const to = nextState(event, maxAttempts);

  // Compute updated fields based on event type.
  let retryAfterMs: number | null = current?.retry_after ?? null;
  let backoffUntilMs: number | null = current?.backoff_until ?? null;
  let backoffAttempt: number = current?.backoff_attempt ?? 0;
  let lastError: string | null = current?.last_error ?? null;
  let reason: string | null = null;

  switch (event.type) {
    case "sync_success":
      retryAfterMs = null;
      backoffUntilMs = null;
      backoffAttempt = 0;
      lastError = null;
      reason = "sync succeeded";
      break;

    case "rate_limited": {
      retryAfterMs = event.retryAfter.getTime();
      reason = `rate_limited until ${event.retryAfter.toISOString()}`;
      break;
    }

    case "unauthenticated":
      lastError = "HTTP 401/403 — token expired or revoked";
      reason = "unauthenticated (401/403)";
      break;

    case "transient_error": {
      backoffAttempt = event.attempt;
      lastError = truncate(event.error);
      reason = truncate(`transient error (attempt ${String(event.attempt)}): ${event.error}`);
      // Compute exponential backoff window.
      const baseMs = 5_000;
      const maxBackoffMs = 3_600_000;
      const jitter = jitterBelowMs(500);
      const delay = Math.min(baseMs * 2 ** Math.max(0, event.attempt - 1), maxBackoffMs) + jitter;
      backoffUntilMs = now + delay;
      break;
    }

    case "persistent_error":
      lastError = truncate(event.error);
      reason = truncate(`persistent error: ${event.error}`);
      backoffUntilMs = null;
      break;

    case "paused":
      reason = "connector paused";
      break;

    case "resumed":
      backoffUntilMs = null;
      backoffAttempt = 0;
      lastError = null;
      reason = "connector resumed";
      break;

    case "skipped_offline":
      // Record history but do NOT update sync_state — offline skips are informational only.
      appendHistory(db, connectorId, fromState, fromState ?? "healthy", "skipped (offline)", now);
      return buildSnapshot(connectorId, current);
  }

  // Persist only when the state actually changes (or fields differ).
  const effectiveState =
    to === ("__no_change__" as ConnectorHealthState) ? (fromState ?? "healthy") : to;

  db.transaction(() => {
    upsertHealthRow(db, connectorId, {
      health_state: effectiveState,
      retry_after: retryAfterMs,
      backoff_until: backoffUntilMs,
      backoff_attempt: backoffAttempt,
      last_error: lastError,
    });
    appendHistory(db, connectorId, fromState, effectiveState, reason, now);
  })();

  const updated = readHealthRow(db, connectorId);
  return buildSnapshot(connectorId, updated);
}

/**
 * Read the current health snapshot for a connector without mutating state.
 * Returns a default healthy snapshot if the connector has no `sync_state` row.
 */
export function getConnectorHealth(db: Database, connectorId: string): ConnectorHealthSnapshot {
  const row = readHealthRow(db, connectorId);
  return buildSnapshot(connectorId, row);
}

/**
 * Read health snapshots for all connectors that have a `sync_state` row.
 */
export function getAllConnectorHealth(db: Database): ConnectorHealthSnapshot[] {
  const rows = db
    .query(
      `SELECT connector_id, health_state, retry_after, backoff_until,
              backoff_attempt, last_error, last_sync_at
       FROM sync_state`,
    )
    .all() as Array<SyncStateHealthRow & { connector_id: string }>;

  return rows.map((r) =>
    buildSnapshot(r.connector_id, {
      health_state: r.health_state,
      retry_after: r.retry_after,
      backoff_until: r.backoff_until,
      backoff_attempt: r.backoff_attempt,
      last_error: r.last_error,
      last_sync_at: r.last_sync_at,
    }),
  );
}

/**
 * Retrieve the last `limit` history rows for a connector, most recent first.
 */
export interface HealthHistoryRow {
  id: number;
  connectorId: string;
  fromState: string | null;
  toState: string;
  reason: string | null;
  occurredAt: Date;
}

export function getConnectorHealthHistory(
  db: Database,
  connectorId: string,
  limit = 100,
): HealthHistoryRow[] {
  const rows = db
    .query(
      `SELECT id, connector_id, from_state, to_state, reason, occurred_at
       FROM connector_health_history
       WHERE connector_id = ?
       ORDER BY occurred_at DESC, id DESC
       LIMIT ?`,
    )
    .all(connectorId, limit) as Array<{
    id: number;
    connector_id: string;
    from_state: string | null;
    to_state: string;
    reason: string | null;
    occurred_at: number;
  }>;

  return rows.map((r) => ({
    id: r.id,
    connectorId: r.connector_id,
    fromState: r.from_state,
    toState: r.to_state,
    reason: r.reason,
    occurredAt: new Date(r.occurred_at),
  }));
}

/**
 * Prune history rows older than `maxAgeDays` for all connectors.
 * Called by the weekly retention pruner.
 */
export function pruneConnectorHealthHistory(db: Database, maxAgeDays: number): number {
  const cutoffMs = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const result = db.run(`DELETE FROM connector_health_history WHERE occurred_at < ?`, [cutoffMs]);
  return result.changes;
}

// ─── Internal helper ─────────────────────────────────────────────────────────

function buildSnapshot(
  connectorId: string,
  row: SyncStateHealthRow | null,
): ConnectorHealthSnapshot {
  if (row === null) {
    return { connectorId, state: "healthy", backoffAttempt: 0 };
  }
  const snap: ConnectorHealthSnapshot = {
    connectorId,
    state: (row.health_state as ConnectorHealthState) ?? "healthy",
    backoffAttempt: row.backoff_attempt ?? 0,
  };
  if (row.retry_after !== null) {
    snap.retryAfter = new Date(row.retry_after);
  }
  if (row.backoff_until !== null) {
    snap.backoffUntil = new Date(row.backoff_until);
  }
  if (row.last_error !== null) {
    snap.lastError = row.last_error;
  }
  if (row.last_sync_at !== null) {
    snap.lastSuccessfulSync = new Date(row.last_sync_at);
  }
  return snap;
}
