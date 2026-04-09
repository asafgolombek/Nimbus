import type { Database } from "bun:sqlite";

import {
  countItemsForService,
  insertSyncTelemetry,
  loadSchedulerState,
  setIntervalMs,
  setNextSyncAt,
  setPaused,
  updateSchedulerState,
  upsertSchedulerRegistration,
} from "./scheduler-store.ts";
import type {
  Syncable,
  SyncContext,
  SyncResult,
  SyncSchedulerConfig,
  SyncStatus,
} from "./types.ts";

const DEFAULT_CONFIG: SyncSchedulerConfig = {
  maxConcurrentSyncs: 3,
  catchUpOnRestart: false,
  retentionDays: 90,
};

type JobReason = "scheduled" | "continuation" | "force";

type Job = {
  serviceId: string;
  reason: JobReason;
};

function clampBackoffBaseMs(failures: number): number {
  const base = 5000 * 2 ** Math.max(0, failures - 1);
  return Math.min(30 * 60 * 1000, base);
}

function genericSyncErrorMessage(): string {
  return "Sync failed";
}

export class SyncScheduler {
  private readonly db: Database;
  private readonly ctx: SyncContext;
  private readonly config: SyncSchedulerConfig;
  private readonly notify: ((title: string, body: string) => Promise<void>) | undefined;
  private readonly rand: () => number;

  private readonly connectors = new Map<string, Syncable>();
  private readonly inFlight = new Set<string>();
  private queue: Job[] = [];
  private runningGlobal = 0;
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private stopped = false;

  private readonly forceWaiters = new Map<string, Array<(err?: unknown) => void>>();

  constructor(
    syncContext: SyncContext,
    config?: Partial<SyncSchedulerConfig>,
    options?: {
      notify?: (title: string, body: string) => Promise<void>;
      random?: () => number;
    },
  ) {
    this.db = syncContext.db;
    this.ctx = syncContext;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.notify = options?.notify;
    this.rand = options?.random ?? Math.random;
  }

  register(connector: Syncable, intervalOverrideMs?: number): void {
    const now = Date.now();
    const existing = loadSchedulerState(this.db, connector.serviceId);
    const interval = intervalOverrideMs ?? existing?.interval_ms ?? connector.defaultIntervalMs;
    const updateInterval = intervalOverrideMs !== undefined;
    upsertSchedulerRegistration(this.db, connector.serviceId, interval, now, updateInterval);
    this.connectors.set(connector.serviceId, connector);
    if (this.started) {
      this.tick();
    }
  }

  /** Drop a connector from scheduling (e.g. after `connector.remove`). In-flight jobs finish best-effort. */
  unregister(serviceId: string): void {
    this.connectors.delete(serviceId);
    this.queue = this.queue.filter((j) => j.serviceId !== serviceId);
    this.resolveForceWaiters(serviceId, new Error("Connector removed"));
  }

  setInterval(serviceId: string, intervalMs: number): void {
    if (!Number.isFinite(intervalMs) || intervalMs < 1) {
      throw new Error("intervalMs must be a positive finite number");
    }
    setIntervalMs(this.db, serviceId, intervalMs);
  }

  start(): void {
    if (this.started || this.stopped) {
      return;
    }
    this.started = true;
    const now = Date.now();
    if (!this.config.catchUpOnRestart) {
      for (const id of this.connectors.keys()) {
        const row = loadSchedulerState(this.db, id);
        if (row?.next_sync_at != null && row.next_sync_at < now) {
          setNextSyncAt(this.db, id, now + row.interval_ms);
        }
      }
    }
    this.tickHandle = setInterval(() => {
      this.tick();
    }, 25);
    this.tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.tickHandle !== null) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
  }

  pause(serviceId: string): void {
    setPaused(this.db, serviceId, true);
  }

  resume(serviceId: string): void {
    setPaused(this.db, serviceId, false);
    if (this.started) {
      this.tick();
    }
  }

  async forceSync(serviceId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const list = this.forceWaiters.get(serviceId) ?? [];
      list.push((err?: unknown) => {
        if (err !== undefined) {
          reject(err instanceof Error ? err : new Error(String(err)));
        } else {
          resolve();
        }
      });
      this.forceWaiters.set(serviceId, list);
      this.queue = this.queue.filter((j) => j.serviceId !== serviceId);
      this.queue.unshift({ serviceId, reason: "force" });
      this.pump();
    });
  }

  getStatus(serviceId?: string): SyncStatus[] {
    if (serviceId !== undefined && serviceId !== "" && !this.connectors.has(serviceId)) {
      return [];
    }
    const ids =
      serviceId !== undefined && serviceId !== ""
        ? [serviceId]
        : [...this.connectors.keys()].sort((a, b) => a.localeCompare(b));
    const out: SyncStatus[] = [];
    for (const id of ids) {
      const row = loadSchedulerState(this.db, id);
      if (row === null) {
        continue;
      }
      const itemCount = countItemsForService(this.db, id);
      out.push(this.rowToStatus(id, row, itemCount));
    }
    return out;
  }

  private rowToStatus(
    serviceId: string,
    row: NonNullable<ReturnType<typeof loadSchedulerState>>,
    itemCount: number,
  ): SyncStatus {
    let status: SyncStatus["status"] = "ok";
    if (row.paused === 1) {
      status = "paused";
    } else if (this.inFlight.has(serviceId)) {
      status = "syncing";
    } else if (row.status === "error") {
      status = "error";
    } else if (row.status === "backoff") {
      status = "backoff";
    }
    return {
      serviceId,
      status,
      lastSyncAt: row.last_sync_at,
      nextSyncAt: row.next_sync_at,
      intervalMs: row.interval_ms,
      itemCount,
      lastError: row.error_msg,
      consecutiveFailures: row.consecutive_failures,
    };
  }

  private tick(): void {
    if (this.stopped) {
      return;
    }
    const now = Date.now();
    for (const id of this.connectors.keys()) {
      const row = loadSchedulerState(this.db, id);
      if (row === null || row.paused === 1 || row.status === "error") {
        continue;
      }
      if (this.inFlight.has(id)) {
        continue;
      }
      if (this.queue.some((j) => j.serviceId === id)) {
        continue;
      }
      if (row.next_sync_at != null && now >= row.next_sync_at) {
        this.queue.push({ serviceId: id, reason: "scheduled" });
      }
    }
    this.pump();
  }

  private canStartJob(job: Job): boolean {
    if (this.inFlight.has(job.serviceId)) {
      return false;
    }
    const row = loadSchedulerState(this.db, job.serviceId);
    if (row === null) {
      return false;
    }
    if (row.paused === 1 && job.reason !== "force") {
      return false;
    }
    if (row.status === "error" && job.reason !== "force") {
      return false;
    }
    return true;
  }

  private pump(): void {
    if (this.stopped) {
      return;
    }
    while (this.runningGlobal < this.config.maxConcurrentSyncs && this.queue.length > 0) {
      let idx = -1;
      for (let i = 0; i < this.queue.length; i++) {
        const j = this.queue[i];
        if (j !== undefined && this.canStartJob(j)) {
          idx = i;
          break;
        }
      }
      if (idx === -1) {
        break;
      }
      const job = this.queue[idx];
      if (job === undefined) {
        break;
      }
      this.queue.splice(idx, 1);
      this.inFlight.add(job.serviceId);
      this.runningGlobal++;
      void this.runJob(job).finally(() => {
        this.inFlight.delete(job.serviceId);
        this.runningGlobal--;
        this.pump();
        this.tick();
      });
    }
  }

  private resolveForceWaiters(serviceId: string, err?: unknown): void {
    const waiters = this.forceWaiters.get(serviceId);
    if (waiters === undefined) {
      return;
    }
    this.forceWaiters.delete(serviceId);
    for (const w of waiters) {
      w(err);
    }
  }

  private backoffDelayMs(failures: number): number {
    const capped = clampBackoffBaseMs(failures);
    const jitter = 0.8 + this.rand() * 0.4;
    return Math.min(30 * 60 * 1000, Math.floor(capped * jitter));
  }

  private async runJob(job: Job): Promise<void> {
    const connector = this.connectors.get(job.serviceId);
    if (connector === undefined) {
      this.resolveForceWaiters(
        job.serviceId,
        job.reason === "force" ? new Error("Unknown service") : undefined,
      );
      return;
    }
    const row = loadSchedulerState(this.db, job.serviceId);
    if (row === null) {
      this.resolveForceWaiters(
        job.serviceId,
        job.reason === "force" ? new Error("Missing scheduler state") : undefined,
      );
      return;
    }
    if (row.paused === 1 && job.reason !== "force") {
      this.resolveForceWaiters(job.serviceId);
      return;
    }
    if (row.status === "error" && job.reason !== "force") {
      this.resolveForceWaiters(job.serviceId);
      return;
    }

    const startedAt = Date.now();
    let result: SyncResult;
    try {
      result = await connector.sync(this.ctx, row.cursor);
    } catch {
      const failures = row.consecutive_failures + 1;
      const msg = genericSyncErrorMessage();
      const durationMs = Date.now() - startedAt;
      insertSyncTelemetry(this.db, {
        service: job.serviceId,
        startedAt,
        durationMs,
        itemsUpserted: 0,
        itemsDeleted: 0,
        bytesTransferred: null,
        hadMore: false,
        errorMsg: msg,
      });
      if (failures >= 5) {
        updateSchedulerState(this.db, {
          serviceId: job.serviceId,
          cursor: row.cursor,
          intervalMs: row.interval_ms,
          lastSyncAt: row.last_sync_at,
          nextSyncAt: null,
          status: "error",
          errorMsg: msg,
          consecutiveFailures: failures,
          paused: row.paused === 1,
        });
        void this.notify?.(
          "Nimbus sync failed",
          `Service "${job.serviceId}" stopped after repeated failures.`,
        );
      } else {
        const delay = this.backoffDelayMs(failures);
        updateSchedulerState(this.db, {
          serviceId: job.serviceId,
          cursor: row.cursor,
          intervalMs: row.interval_ms,
          lastSyncAt: row.last_sync_at,
          nextSyncAt: Date.now() + delay,
          status: "backoff",
          errorMsg: msg,
          consecutiveFailures: failures,
          paused: row.paused === 1,
        });
      }
      if (job.reason === "force") {
        this.resolveForceWaiters(job.serviceId, new Error(msg));
      } else {
        this.resolveForceWaiters(job.serviceId);
      }
      return;
    }

    const durationMs = Date.now() - startedAt;
    const bytes =
      result.bytesTransferred !== undefined && Number.isFinite(result.bytesTransferred)
        ? Math.floor(result.bytesTransferred)
        : null;
    insertSyncTelemetry(this.db, {
      service: job.serviceId,
      startedAt,
      durationMs,
      itemsUpserted: result.itemsUpserted,
      itemsDeleted: result.itemsDeleted,
      bytesTransferred: bytes,
      hadMore: result.hasMore,
      errorMsg: null,
    });

    const now = Date.now();
    const nextInterval = now + row.interval_ms;
    const nextSyncAt: number | null = result.hasMore ? now : nextInterval;

    updateSchedulerState(this.db, {
      serviceId: job.serviceId,
      cursor: result.cursor,
      intervalMs: row.interval_ms,
      lastSyncAt: now,
      nextSyncAt,
      status: "ok",
      errorMsg: null,
      consecutiveFailures: 0,
      paused: row.paused === 1,
    });

    if (result.hasMore) {
      this.queue.unshift({ serviceId: job.serviceId, reason: "continuation" });
    }

    this.resolveForceWaiters(job.serviceId);
  }
}
