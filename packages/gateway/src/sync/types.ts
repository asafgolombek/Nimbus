import type { Database } from "bun:sqlite";
import type { Logger } from "pino";

import type { NimbusVault } from "../vault/nimbus-vault.ts";
import type { ProviderRateLimiter } from "./rate-limiter.ts";

/** Per-sync execution context passed to `Syncable.sync` (Q2 Phase 1.3). */
export interface SyncContext {
  vault: NimbusVault;
  db: Database;
  logger: Logger;
  rateLimiter: ProviderRateLimiter;
  /** Phase 3 — fire-and-forget semantic embedding after index upsert (optional). */
  scheduleItemEmbedding?: (itemId: string) => void;
}

export interface Syncable {
  readonly serviceId: string;
  readonly defaultIntervalMs: number;
  /** First sync window when `cursor` is null; connector-enforced. */
  readonly initialSyncDepthDays: number;
  sync(ctx: SyncContext, cursor: string | null): Promise<SyncResult>;
}

export interface SyncResult {
  cursor: string | null;
  itemsUpserted: number;
  itemsDeleted: number;
  hasMore: boolean;
  durationMs: number;
  bytesTransferred?: number;
}

// ─── Retry-After parsing (RFC 7231) ───────────────────────────────────────────

/**
 * Parse a `Retry-After` response value: delay-seconds (`^\d+$`) or HTTP-date.
 * When the header is missing or not parseable, uses `fallbackSeconds` from now.
 */
export function retryAfterDateFromHeader(value: string | null, fallbackSeconds: number): Date {
  const fb = Number.isFinite(fallbackSeconds) && fallbackSeconds > 0 ? fallbackSeconds : 60;
  if (value === null) {
    return new Date(Date.now() + fb * 1000);
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return new Date(Date.now() + fb * 1000);
  }
  if (/^\d+$/.test(trimmed)) {
    const sec = Number.parseInt(trimmed, 10);
    if (Number.isFinite(sec) && sec >= 0) {
      return new Date(Date.now() + sec * 1000);
    }
  }
  const parsed = Date.parse(trimmed);
  if (Number.isFinite(parsed)) {
    return new Date(parsed);
  }
  return new Date(Date.now() + fb * 1000);
}

// ─── Typed sync errors ───────────────────────────────────────────────────────

/**
 * Throw from a connector's `sync()` to signal an HTTP 429 rate-limit response.
 * The scheduler will call `transitionHealth(rate_limited)` and skip dispatching
 * until `retryAfter` has passed.
 */
export class RateLimitError extends Error {
  readonly retryAfter: Date;
  constructor(retryAfter: Date, message = "Rate limited") {
    super(message);
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}

/**
 * Throw from a connector's `sync()` to signal an HTTP 401/403 response.
 * The scheduler will call `transitionHealth(unauthenticated)` and emit a
 * notification prompting the user to re-authenticate.
 */
export class UnauthenticatedError extends Error {
  constructor(message = "Connector authentication expired or revoked") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

/** Credential miss / token failure — no index changes, preserve incoming cursor. */
export function syncNoopResult(cursor: string | null, t0: number): SyncResult {
  return {
    cursor,
    itemsUpserted: 0,
    itemsDeleted: 0,
    hasMore: false,
    durationMs: Math.round(performance.now() - t0),
  };
}

export interface SyncSchedulerConfig {
  maxConcurrentSyncs: number;
  catchUpOnRestart: boolean;
  retentionDays: number;
}

export interface SyncStatus {
  serviceId: string;
  status: "ok" | "syncing" | "paused" | "backoff" | "error";
  lastSyncAt: number | null;
  nextSyncAt: number | null;
  intervalMs: number;
  itemCount: number;
  lastError: string | null;
  consecutiveFailures: number;
  /** Phase 3.5 — `sync_state.health_state` (connector health). */
  healthState?: string;
  /** Epoch ms for `sync_state.retry_after` when rate-limited; otherwise `null`. */
  healthRetryAfterMs?: number | null;
}
