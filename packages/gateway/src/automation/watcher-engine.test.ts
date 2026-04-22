import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { upsertGraphEntity, upsertGraphRelation } from "../graph/relationship-graph.ts";
import { upsertIndexedItem } from "../index/item-store.ts";
import { LocalIndex } from "../index/local-index.ts";
import { evaluateWatchersAfterSync, evaluateWatchersStartupCatchUp } from "./watcher-engine.ts";
import { insertWatcher, listWatchers } from "./watcher-store.ts";

function makeDb(): Database {
  const db = new Database(":memory:");
  LocalIndex.ensureSchema(db);
  return db;
}

function insertAlertFiredWatcher(
  db: Database,
  name: string,
  conditionJson: string,
  createdAt: number,
): string {
  return insertWatcher(db, {
    name,
    enabled: 1,
    condition_type: "alert_fired",
    condition_json: conditionJson,
    action_type: "notify",
    action_json: "{}",
    created_at: createdAt,
  });
}

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
    const db = makeDb();
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
    const db = makeDb();
    const t0 = 1_700_000_000_000;
    insertAlertFiredWatcher(db, "bad-json", "not-json", t0);
    let calls = 0;
    evaluateWatchersAfterSync(db, "pagerduty", t0 + 1, () => {
      calls += 1;
    });
    expect(calls).toBe(0);
    await Promise.resolve();
  });

  test("service filter mismatch does not notify", async () => {
    const db = makeDb();
    const t0 = 1_700_000_000_000;
    insertAlertFiredWatcher(
      db,
      "pd-only",
      JSON.stringify({ filter: { service: "pagerduty" } }),
      t0,
    );
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
    const db = makeDb();
    const t0 = 1_700_000_000_000;
    const wid = insertAlertFiredWatcher(
      db,
      "pd-alerts",
      JSON.stringify({ filter: { service: "pagerduty" } }),
      t0,
    );
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
    const db = makeDb();
    const t0 = 2_700_000_000_000;
    insertAlertFiredWatcher(db, "any-svc", JSON.stringify({ filter: {} }), t0);
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
    const db = makeDb();
    const t0 = 3_800_000_000_000;
    insertAlertFiredWatcher(db, "catch-up", JSON.stringify({ filter: { service: "sentry" } }), t0);
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

  test("null filter in condition_json does not notify", async () => {
    const db = makeDb();
    const t0 = 3_900_000_000_000;
    // Valid JSON object but filter is null — should not notify.
    insertAlertFiredWatcher(db, "null-filter", JSON.stringify({ filter: null }), t0);
    upsertIndexedItem(db, {
      service: "sentry",
      type: "alert",
      externalId: "nf-1",
      title: "null filter alert",
      modifiedAt: t0 + 1000,
      syncedAt: t0 + 1000,
    });
    let calls = 0;
    evaluateWatchersAfterSync(db, "sentry", t0 + 2000, () => {
      calls += 1;
    });
    expect(calls).toBe(0);
    await Promise.resolve();
  });

  test("array filter in condition_json does not notify", async () => {
    const db = makeDb();
    const t0 = 3_950_000_000_000;
    // Valid JSON object but filter is an array — should not notify.
    insertAlertFiredWatcher(db, "array-filter", JSON.stringify({ filter: ["sentry"] }), t0);
    upsertIndexedItem(db, {
      service: "sentry",
      type: "alert",
      externalId: "af-1",
      title: "array filter alert",
      modifiedAt: t0 + 1000,
      syncedAt: t0 + 1000,
    });
    let calls = 0;
    evaluateWatchersAfterSync(db, "sentry", t0 + 2000, () => {
      calls += 1;
    });
    expect(calls).toBe(0);
    await Promise.resolve();
  });

  test("invalid graph_predicate_json shape suppresses notify (fail-closed)", async () => {
    const db = makeDb();
    const t0 = 3_970_000_000_000;
    insertWatcher(db, {
      name: "bad-predicate",
      enabled: 1,
      condition_type: "alert_fired",
      condition_json: JSON.stringify({ filter: { service: "sentry" } }),
      action_type: "notify",
      action_json: "{}",
      created_at: t0,
      // Valid JSON but relation kind is invalid — parseGraphPredicate returns ok:false.
      graph_predicate_json: JSON.stringify({
        relation: "not_a_real_relation",
        target: { type: "person", externalId: "gh:1" },
      }),
    });
    upsertIndexedItem(db, {
      service: "sentry",
      type: "alert",
      externalId: "bp-1",
      title: "bad predicate alert",
      modifiedAt: t0 + 1000,
      syncedAt: t0 + 1000,
    });
    let calls = 0;
    evaluateWatchersAfterSync(
      db,
      "sentry",
      t0 + 2000,
      () => {
        calls += 1;
      },
      { graphConditionsEnabled: true },
    );
    // Fail-closed: invalid predicate → no notification.
    expect(calls).toBe(0);
    await Promise.resolve();
  });

  test("graph predicate filters alert matches — no match suppresses notify", async () => {
    const db = makeDb();
    const t0 = 4_000_000_000_000;
    insertWatcher(db, {
      name: "graph-filtered",
      enabled: 1,
      condition_type: "alert_fired",
      condition_json: JSON.stringify({ filter: { service: "sentry" } }),
      action_type: "notify",
      action_json: "{}",
      created_at: t0,
      graph_predicate_json: JSON.stringify({
        relation: "owned_by",
        target: { type: "person", externalId: "gh:absent" },
      }),
    });
    upsertIndexedItem(db, {
      service: "sentry",
      type: "alert",
      externalId: "a1",
      title: "cpu",
      modifiedAt: t0 + 1000,
      syncedAt: t0 + 1000,
    });
    let calls = 0;
    evaluateWatchersAfterSync(
      db,
      "sentry",
      t0 + 2000,
      () => {
        calls += 1;
      },
      { graphConditionsEnabled: true },
    );
    expect(calls).toBe(0);
    await Promise.resolve();
  });

  test("graph predicate filters alert matches — matching edge fires notify", async () => {
    const db = makeDb();
    const t0 = 4_100_000_000_000;
    insertWatcher(db, {
      name: "graph-matched",
      enabled: 1,
      condition_type: "alert_fired",
      condition_json: JSON.stringify({ filter: { service: "sentry" } }),
      action_type: "notify",
      action_json: "{}",
      created_at: t0,
      graph_predicate_json: JSON.stringify({
        relation: "owned_by",
        target: { type: "person", externalId: "gh:7" },
      }),
    });
    upsertIndexedItem(db, {
      service: "sentry",
      type: "alert",
      externalId: "a2",
      title: "oom",
      modifiedAt: t0 + 1000,
      syncedAt: t0 + 1000,
    });
    // Seed the owning edge person → alert.
    const personId = upsertGraphEntity(db, {
      type: "person",
      externalId: "gh:7",
      label: "Dev",
      service: "github",
    });
    const alertId = upsertGraphEntity(db, {
      type: "alert",
      externalId: "a2",
      label: "oom",
      service: "sentry",
    });
    upsertGraphRelation(db, personId, alertId, "authored", t0);

    let calls = 0;
    evaluateWatchersAfterSync(
      db,
      "sentry",
      t0 + 2000,
      () => {
        calls += 1;
      },
      { graphConditionsEnabled: true },
    );
    expect(calls).toBe(1);
    await Promise.resolve();
  });

  test("graph predicate is ignored when graphConditionsEnabled = false", async () => {
    const db = makeDb();
    const t0 = 4_200_000_000_000;
    insertWatcher(db, {
      name: "graph-disabled",
      enabled: 1,
      condition_type: "alert_fired",
      condition_json: JSON.stringify({ filter: { service: "sentry" } }),
      action_type: "notify",
      action_json: "{}",
      created_at: t0,
      graph_predicate_json: JSON.stringify({
        relation: "owned_by",
        target: { type: "person", externalId: "gh:absent" },
      }),
    });
    upsertIndexedItem(db, {
      service: "sentry",
      type: "alert",
      externalId: "a3",
      title: "disk",
      modifiedAt: t0 + 1000,
      syncedAt: t0 + 1000,
    });
    let calls = 0;
    evaluateWatchersAfterSync(
      db,
      "sentry",
      t0 + 2000,
      () => {
        calls += 1;
      },
      { graphConditionsEnabled: false },
    );
    // Flag off → predicate ignored → alert fires.
    expect(calls).toBe(1);
    await Promise.resolve();
  });
});
