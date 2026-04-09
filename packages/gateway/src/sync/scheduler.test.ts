import type { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import pino from "pino";

import { createMemoryVault, openMemoryIndexDatabase } from "../testing/bun-test-support.ts";
import { ProviderRateLimiter } from "./rate-limiter.ts";
import { SyncScheduler } from "./scheduler.ts";
import { loadSchedulerState } from "./scheduler-store.ts";
import type { Syncable, SyncContext, SyncResult } from "./types.ts";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function testContext(db: Database): SyncContext {
  return {
    db,
    vault: createMemoryVault(),
    logger: pino({ level: "silent" }),
    rateLimiter: new ProviderRateLimiter(),
  };
}

describe("SyncScheduler", () => {
  test("two connectors run on their intervals", async () => {
    const db = openMemoryIndexDatabase();
    const ctx = testContext(db);
    let a = 0;
    let b = 0;
    const ca: Syncable = {
      serviceId: "a",
      defaultIntervalMs: 40,
      initialSyncDepthDays: 30,
      async sync(): Promise<SyncResult> {
        a += 1;
        return {
          cursor: "c",
          itemsUpserted: 0,
          itemsDeleted: 0,
          hasMore: false,
          durationMs: 0,
        };
      },
    };
    const cb: Syncable = {
      serviceId: "b",
      defaultIntervalMs: 40,
      initialSyncDepthDays: 30,
      async sync(): Promise<SyncResult> {
        b += 1;
        return {
          cursor: "c",
          itemsUpserted: 0,
          itemsDeleted: 0,
          hasMore: false,
          durationMs: 0,
        };
      },
    };
    const sched = new SyncScheduler(ctx, { maxConcurrentSyncs: 2 });
    sched.register(ca);
    sched.register(cb);
    sched.start();
    await sleep(200);
    sched.stop();
    expect(a).toBeGreaterThanOrEqual(2);
    expect(b).toBeGreaterThanOrEqual(2);
  });

  test("backoff on failure sets next_sync_at and consecutive_failures", async () => {
    const db = openMemoryIndexDatabase();
    const ctx = testContext(db);
    const c: Syncable = {
      serviceId: "fail",
      defaultIntervalMs: 60_000,
      initialSyncDepthDays: 30,
      async sync(): Promise<SyncResult> {
        throw new Error("boom");
      },
    };
    const before = Date.now();
    const sched = new SyncScheduler(ctx, {}, { random: () => 0 });
    sched.register(c);
    try {
      await sched.forceSync("fail");
    } catch {
      /* force rejects when sync throws */
    }
    sched.stop();
    const row = loadSchedulerState(db, "fail");
    expect(row).not.toBeNull();
    expect(row?.consecutive_failures).toBe(1);
    expect(row?.status).toBe("backoff");
    expect(row?.next_sync_at).toBeGreaterThanOrEqual(before + 3900);
    expect(row?.next_sync_at).toBeLessThanOrEqual(before + 4500);
  });

  test("persists cursor across scheduler instances", async () => {
    const db = openMemoryIndexDatabase();
    const ctx = testContext(db);
    const cursors: Array<string | null> = [];
    const c: Syncable = {
      serviceId: "persist",
      defaultIntervalMs: 60_000,
      initialSyncDepthDays: 30,
      async sync(_ctx, cursor): Promise<SyncResult> {
        cursors.push(cursor);
        return {
          cursor: "next",
          itemsUpserted: 1,
          itemsDeleted: 0,
          hasMore: false,
          durationMs: 1,
        };
      },
    };
    const s1 = new SyncScheduler(ctx);
    s1.register(c);
    await s1.forceSync("persist");
    s1.stop();

    const s2 = new SyncScheduler(ctx);
    s2.register(c);
    await s2.forceSync("persist");
    s2.stop();

    expect(cursors[0]).toBeNull();
    expect(cursors[1]).toBe("next");
  });

  test("maxConcurrentSyncs caps parallel runs across services", async () => {
    const db = openMemoryIndexDatabase();
    const ctx = testContext(db);
    let concurrent = 0;
    let peak = 0;
    const make = (id: string): Syncable => ({
      serviceId: id,
      defaultIntervalMs: 20,
      initialSyncDepthDays: 30,
      async sync(): Promise<SyncResult> {
        concurrent += 1;
        peak = Math.max(peak, concurrent);
        await sleep(60);
        concurrent -= 1;
        return {
          cursor: null,
          itemsUpserted: 0,
          itemsDeleted: 0,
          hasMore: false,
          durationMs: 60,
        };
      },
    });
    const sched = new SyncScheduler(ctx, { maxConcurrentSyncs: 3 });
    for (const id of ["c1", "c2", "c3", "c4"]) {
      sched.register(make(id));
    }
    sched.start();
    await sleep(250);
    sched.stop();
    expect(peak).toBeLessThanOrEqual(3);
  });

  test("catchUpOnRestart false resets overdue next_sync without running sync", async () => {
    const db = openMemoryIndexDatabase();
    const ctx = testContext(db);
    let runs = 0;
    const c: Syncable = {
      serviceId: "late",
      defaultIntervalMs: 10_000,
      initialSyncDepthDays: 30,
      async sync(): Promise<SyncResult> {
        runs += 1;
        return {
          cursor: null,
          itemsUpserted: 0,
          itemsDeleted: 0,
          hasMore: false,
          durationMs: 0,
        };
      },
    };
    const sched = new SyncScheduler(ctx, { catchUpOnRestart: false });
    sched.register(c);
    db.run(`UPDATE scheduler_state SET next_sync_at = ? WHERE service_id = ?`, [1, "late"]);
    sched.start();
    await sleep(80);
    sched.stop();
    expect(runs).toBe(0);
    const row = loadSchedulerState(db, "late");
    expect(row?.next_sync_at).not.toBe(1);
    expect(row?.next_sync_at).toBeGreaterThan(Date.now() - 100);
  });

  test("hasMore re-queues continuation without waiting interval", async () => {
    const db = openMemoryIndexDatabase();
    const ctx = testContext(db);
    let n = 0;
    const times: number[] = [];
    const c: Syncable = {
      serviceId: "pages",
      defaultIntervalMs: 400,
      initialSyncDepthDays: 30,
      async sync(): Promise<SyncResult> {
        n += 1;
        times.push(Date.now());
        if (n === 1) {
          return {
            cursor: "p1",
            itemsUpserted: 0,
            itemsDeleted: 0,
            hasMore: true,
            durationMs: 0,
          };
        }
        return {
          cursor: "p2",
          itemsUpserted: 0,
          itemsDeleted: 0,
          hasMore: false,
          durationMs: 0,
        };
      },
    };
    const sched = new SyncScheduler(ctx);
    sched.register(c);
    sched.start();
    await sleep(150);
    sched.stop();
    expect(n).toBe(2);
    expect(times.length).toBe(2);
    const t0 = times[0];
    const t1 = times[1];
    if (t0 === undefined || t1 === undefined) {
      throw new Error("expected two sync timestamps");
    }
    expect(t1 - t0).toBeLessThan(200);
  });

  test("fifth consecutive failure notifies and sets error status", async () => {
    const db = openMemoryIndexDatabase();
    const ctx = testContext(db);
    let notifications = 0;
    const c: Syncable = {
      serviceId: "die",
      defaultIntervalMs: 60_000,
      initialSyncDepthDays: 30,
      async sync(): Promise<SyncResult> {
        throw new Error("x");
      },
    };
    const sched = new SyncScheduler(
      ctx,
      {},
      {
        random: () => 0,
        notify: async () => {
          notifications += 1;
        },
      },
    );
    sched.register(c);
    db.run(
      `UPDATE scheduler_state SET consecutive_failures = 4, status = 'ok', next_sync_at = ?, paused = 0 WHERE service_id = ?`,
      [Date.now() + 60 * 60 * 1000, "die"],
    );
    sched.start();
    try {
      await sched.forceSync("die");
    } catch {
      /* expected failure */
    }
    sched.stop();
    expect(notifications).toBe(1);
    const row = loadSchedulerState(db, "die");
    expect(row?.status).toBe("error");
    expect(row?.consecutive_failures).toBe(5);
  });
});
