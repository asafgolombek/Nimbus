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
}
