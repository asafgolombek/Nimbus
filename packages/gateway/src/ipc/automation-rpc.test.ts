import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { upsertGraphEntity, upsertGraphRelation } from "../graph/relationship-graph.ts";
import { LocalIndex } from "../index/local-index.ts";
import { AutomationRpcError, dispatchAutomationRpc } from "./automation-rpc.ts";

function seededDb(): Database {
  const db = new Database(":memory:");
  LocalIndex.ensureSchema(db);
  return db;
}

describe("watcher.listCandidateRelations", () => {
  test("returns the three logical kinds with underlying relation types", () => {
    const db = seededDb();
    const out = dispatchAutomationRpc({
      method: "watcher.listCandidateRelations",
      params: {},
      db,
    });
    expect(out.kind).toBe("hit");
    if (out.kind !== "hit") return;
    const value = out.value as {
      relations: Array<{ relation: string; underlyingRelationTypes: string[] }>;
    };
    const kinds = value.relations.map((r) => r.relation).sort((a, b) => a.localeCompare(b));
    expect(kinds).toEqual(["downstream_of", "owned_by", "upstream_of"]);
    for (const r of value.relations) {
      expect(r.underlyingRelationTypes.length).toBeGreaterThan(0);
    }
  });
});

describe("watcher.validateCondition", () => {
  test("returns matchCount = 0 when graph has no edges", () => {
    const db = seededDb();
    const out = dispatchAutomationRpc({
      method: "watcher.validateCondition",
      params: {
        graphPredicateJson: JSON.stringify({
          relation: "owned_by",
          target: { type: "person", externalId: "gh:unknown" },
        }),
        sinceMs: 0,
      },
      db,
    });
    expect(out.kind).toBe("hit");
    if (out.kind !== "hit") return;
    expect((out.value as { matchCount: number }).matchCount).toBe(0);
  });

  test("counts items matching the predicate within the since window", () => {
    const db = seededDb();
    const t0 = 1_700_000_000_000;
    db.run(
      `INSERT INTO item (id, service, type, external_id, title, modified_at, synced_at)
       VALUES ('i1', 'github', 'pr', 'pr-1', 'feature', ?, ?)`,
      [t0 + 1000, t0 + 1000],
    );
    const personId = upsertGraphEntity(db, {
      type: "person",
      externalId: "gh:7",
      label: "Dev",
      service: "github",
    });
    const prId = upsertGraphEntity(db, {
      type: "pr",
      externalId: "pr-1",
      label: "feature",
      service: "github",
    });
    upsertGraphRelation(db, personId, prId, "authored", t0);

    const out = dispatchAutomationRpc({
      method: "watcher.validateCondition",
      params: {
        graphPredicateJson: JSON.stringify({
          relation: "owned_by",
          target: { type: "person", externalId: "gh:7" },
        }),
        sinceMs: t0,
      },
      db,
    });
    expect(out.kind).toBe("hit");
    if (out.kind !== "hit") return;
    expect((out.value as { matchCount: number }).matchCount).toBe(1);
  });

  test("rejects malformed graphPredicateJson with RPC error -32602", () => {
    const db = seededDb();
    expect(() =>
      dispatchAutomationRpc({
        method: "watcher.validateCondition",
        params: { graphPredicateJson: "not-json", sinceMs: 0 },
        db,
      }),
    ).toThrow(/graph_predicate_json|JSON|relation/i);
  });

  test("does not leak item content in the response (matchCount only)", () => {
    const db = seededDb();
    db.run(
      `INSERT INTO item (id, service, type, external_id, title, modified_at, synced_at)
       VALUES ('i1', 'github', 'pr', 'pr-1', 'SECRET_TOKEN_xyz', ?, ?)`,
      [1_700_001_000_000, 1_700_001_000_000],
    );
    const personId = upsertGraphEntity(db, {
      type: "person",
      externalId: "gh:1",
      label: "x",
      service: "github",
    });
    const prId = upsertGraphEntity(db, {
      type: "pr",
      externalId: "pr-1",
      label: "SECRET_TOKEN_xyz",
      service: "github",
    });
    upsertGraphRelation(db, personId, prId, "authored", 1_700_000_000_000);
    const out = dispatchAutomationRpc({
      method: "watcher.validateCondition",
      params: {
        graphPredicateJson: JSON.stringify({
          relation: "owned_by",
          target: { type: "person", externalId: "gh:1" },
        }),
        sinceMs: 1_700_000_000_000,
      },
      db,
    });
    expect(out.kind).toBe("hit");
    const json = JSON.stringify(out.kind === "hit" ? out.value : {});
    expect(json).not.toContain("SECRET_TOKEN_xyz");
  });
});

describe("watcher.listHistory", () => {
  test("returns fires newest-first", () => {
    const db = seededDb();
    db.run(
      `INSERT INTO watcher (id, name, enabled, condition_type, condition_json, action_type, action_json, created_at)
       VALUES ('w1', 'x', 1, 'schedule', '{}', 'notify', '{}', 0)`,
    );
    db.run(
      `INSERT INTO watcher_event (watcher_id, fired_at, condition_snapshot, action_result)
       VALUES ('w1', 10, '{"a":1}', '{"ok":true}'), ('w1', 20, '{"a":2}', '{"ok":true}')`,
    );
    const out = dispatchAutomationRpc({
      method: "watcher.listHistory",
      params: { watcherId: "w1", limit: 5 },
      db,
    });
    expect(out.kind).toBe("hit");
    if (out.kind !== "hit") return;
    const value = out.value as { events: Array<{ firedAt: number }> };
    expect(value.events.length).toBe(2);
    expect(value.events[0]?.firedAt).toBe(20);
  });

  test("rejects missing watcherId", () => {
    const db = seededDb();
    expect(() =>
      dispatchAutomationRpc({
        method: "watcher.listHistory",
        params: { limit: 5 },
        db,
      }),
    ).toThrow(AutomationRpcError);
  });
});

describe("workflow.listRuns", () => {
  test("returns last N runs newest-first", () => {
    const db = seededDb();
    db.run(
      `INSERT INTO workflow (id, name, description, steps_json, created_at, updated_at)
       VALUES ('wf1', 'alpha', NULL, '[]', 0, 0)`,
    );
    db.run(
      `INSERT INTO workflow_run (id, workflow_id, triggered_by, status, started_at, finished_at, error_msg, dry_run, params_override_json)
       VALUES ('r1', 'wf1', 'user', 'done', 10, 20, NULL, 0, NULL),
              ('r2', 'wf1', 'user', 'done', 30, 40, NULL, 0, NULL)`,
    );
    const out = dispatchAutomationRpc({
      method: "workflow.listRuns",
      params: { workflowName: "alpha", limit: 5 },
      db,
    });
    expect(out.kind).toBe("hit");
    if (out.kind !== "hit") return;
    const value = out.value as { runs: Array<{ id: string }> };
    expect(value.runs.length).toBe(2);
    expect(value.runs[0]?.id).toBe("r2");
  });
});
