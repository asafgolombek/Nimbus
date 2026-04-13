import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { upsertIndexedItem } from "../index/item-store.ts";
import { LocalIndex } from "../index/local-index.ts";
import { evaluateWatchersAfterSync, evaluateWatchersStartupCatchUp } from "./watcher-engine.ts";
import { insertWatcher, listWatchers } from "./watcher-store.ts";

describe("watcher-engine", () => {
  test("evaluateWatchersAfterSync no-op when schema below v8", async () => {
    const db = new Database(":memory:");
    let calls = 0;
    evaluateWatchersAfterSync(db, "pagerduty", Date.now(), () => {
      calls += 1;
    });
    expect(calls).toBe(0);
    await Promise.resolve();
  });

  test("non-alert_fired condition does not notify", async () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    const t0 = 1_700_000_000_000;
    insertWatcher(db, {
      name: "other",
      enabled: 1,
      condition_type: "custom",
      condition_json: "{}",
      action_type: "notify",
      action_json: "{}",
      created_at: t0,
    });
    let calls = 0;
    evaluateWatchersAfterSync(db, "pagerduty", t0 + 1, () => {
      calls += 1;
    });
    expect(calls).toBe(0);
    await Promise.resolve();
  });

  test("invalid condition_json does not notify", async () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    const t0 = 1_700_000_000_000;
    insertWatcher(db, {
      name: "bad-json",
      enabled: 1,
      condition_type: "alert_fired",
      condition_json: "not-json",
      action_type: "notify",
      action_json: "{}",
      created_at: t0,
    });
    let calls = 0;
    evaluateWatchersAfterSync(db, "pagerduty", t0 + 1, () => {
      calls += 1;
    });
    expect(calls).toBe(0);
    await Promise.resolve();
  });

  test("service filter mismatch does not notify", async () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    const t0 = 1_700_000_000_000;
    insertWatcher(db, {
      name: "pd-only",
      enabled: 1,
      condition_type: "alert_fired",
      condition_json: JSON.stringify({ filter: { service: "pagerduty" } }),
      action_type: "notify",
      action_json: "{}",
      created_at: t0,
    });
    upsertIndexedItem(db, {
      service: "pagerduty",
      type: "alert",
      externalId: "a1",
      title: "cpu",
      modifiedAt: t0 + 5000,
      syncedAt: t0 + 5000,
    });
    let calls = 0;
    evaluateWatchersAfterSync(db, "datadog", t0 + 6000, () => {
      calls += 1;
    });
    expect(calls).toBe(0);
    await Promise.resolve();
  });

  test("fires on new alert for synced service and updates watcher timestamps", async () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    const t0 = 1_700_000_000_000;
    const wid = insertWatcher(db, {
      name: "pd-alerts",
      enabled: 1,
      condition_type: "alert_fired",
      condition_json: JSON.stringify({ filter: { service: "pagerduty" } }),
      action_type: "notify",
      action_json: "{}",
      created_at: t0,
    });
    upsertIndexedItem(db, {
      service: "pagerduty",
      type: "alert",
      externalId: "inc-42",
      title: "High CPU",
      modifiedAt: t0 + 8000,
      syncedAt: t0 + 8000,
    });
    const bodies: string[] = [];
    const evalAt = t0 + 9000;
    evaluateWatchersAfterSync(db, "pagerduty", evalAt, async (_title, body) => {
      const evDuring = db
        .query(`SELECT COUNT(*) as c FROM watcher_event WHERE watcher_id = ?`)
        .get(wid) as { c: number };
      expect(evDuring.c).toBe(1);
      bodies.push(body);
    });
    expect(bodies.length).toBe(1);
    expect(bodies[0]).toContain("High CPU");
    expect(bodies[0]).toContain("pagerduty");

    const w = listWatchers(db).find((x) => x.id === wid);
    expect(w?.last_checked_at).toBe(evalAt);
    expect(w?.last_fired_at).toBe(evalAt);

    const evCount = db
      .query(`SELECT COUNT(*) as c FROM watcher_event WHERE watcher_id = ?`)
      .get(wid) as {
      c: number;
    };
    expect(evCount.c).toBe(1);
    await Promise.resolve();
  });

  test("omitted filter service matches any synced service", async () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    const t0 = 2_700_000_000_000;
    insertWatcher(db, {
      name: "any-svc",
      enabled: 1,
      condition_type: "alert_fired",
      condition_json: JSON.stringify({ filter: {} }),
      action_type: "notify",
      action_json: "{}",
      created_at: t0,
    });
    upsertIndexedItem(db, {
      service: "sentry",
      type: "alert",
      externalId: "e1",
      title: "Error spike",
      modifiedAt: t0 + 1000,
      syncedAt: t0 + 1000,
    });
    const bodies: string[] = [];
    evaluateWatchersAfterSync(db, "sentry", t0 + 2000, async (_t, b) => {
      bodies.push(b);
    });
    expect(bodies.length).toBe(1);
    await Promise.resolve();
  });

  test("startup catch-up evaluates without a prior sync event", async () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    const t0 = 3_800_000_000_000;
    insertWatcher(db, {
      name: "catch-up",
      enabled: 1,
      condition_type: "alert_fired",
      condition_json: JSON.stringify({ filter: { service: "sentry" } }),
      action_type: "notify",
      action_json: "{}",
      created_at: t0,
    });
    upsertIndexedItem(db, {
      service: "sentry",
      type: "alert",
      externalId: "su-1",
      title: "Regression detected",
      modifiedAt: t0 + 4000,
      syncedAt: t0 + 4000,
    });
    const bodies: string[] = [];
    evaluateWatchersStartupCatchUp(db, t0 + 5000, async (_t, b) => {
      bodies.push(b);
    });
    expect(bodies.length).toBe(1);
    expect(bodies[0]).toContain("Regression");
    await Promise.resolve();
  });
});
