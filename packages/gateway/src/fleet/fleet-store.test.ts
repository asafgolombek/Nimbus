import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { FLEET_V60_SQL } from "../index/fleet-v60-sql.ts";
import { FleetStore } from "./fleet-store.ts";

let db: Database;
let store: FleetStore;

beforeEach(() => {
  db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  db.exec(FLEET_V60_SQL);
  store = new FleetStore(db);
});

describe("FleetStore", () => {
  test("records a run and its briefs", () => {
    const runId = store.openRun({
      startedAt: 1000,
      hostPower: "ac",
      hostIdleMs: 900_000,
      hostSource: "measured",
      remoteCallBudget: 0,
    });
    store.recordBrief({
      runId,
      jobId: "morning_catchup",
      agentMethod: "agents.catchup",
      briefMarkdown: "# Catchup",
      findingsJson: "{}",
      synthesisJson: null,
      createdAt: 1100,
      expiresAt: 1100 + 86_400_000,
    });
    store.closeRun(runId, {
      endedAt: 2000,
      outcome: "completed",
      jobsInScope: 1,
      jobsAttempted: 1,
      jobsCompleted: 1,
      jobsSkippedNotDue: 0,
      remoteCallsMade: 0,
    });

    const briefs = store.listBriefs({ limit: 10 });
    expect(briefs).toHaveLength(1);
    expect(briefs[0]?.agentMethod).toBe("agents.catchup");
  });

  test("closeRun round-trips jobs_skipped_not_due as a value distinct from the other counters", () => {
    // Three DIFFERENT numbers, so a column swap or a copied bind parameter cannot pass. Persisted
    // rather than derived because the summary object is gone the moment `runOnce` returns, and
    // reconstructing "how many were not due" after the fact from config + fleet_job_state is a
    // guess: the intervals may have been edited since.
    const runId = store.openRun({
      startedAt: 10,
      hostPower: "ac",
      hostIdleMs: 900_000,
      hostSource: "measured",
      remoteCallBudget: 7,
    });
    store.closeRun(runId, {
      endedAt: 20,
      outcome: "yielded",
      jobsInScope: 9,
      jobsAttempted: 3,
      jobsCompleted: 2,
      jobsSkippedNotDue: 5,
      remoteCallsMade: 1,
    });

    const row = db
      .query(
        `SELECT jobs_in_scope, jobs_attempted, jobs_completed, jobs_skipped_not_due,
                remote_calls_made, outcome
           FROM fleet_run WHERE id = ?`,
      )
      .get(runId) as {
      jobs_in_scope: number;
      jobs_attempted: number;
      jobs_completed: number;
      jobs_skipped_not_due: number;
      remote_calls_made: number;
      outcome: string;
    } | null;
    expect(row).toMatchObject({
      jobs_in_scope: 9,
      jobs_attempted: 3,
      jobs_completed: 2,
      jobs_skipped_not_due: 5,
      remote_calls_made: 1,
      outcome: "yielded",
    });
  });

  test("a run row that is opened and never closed reports zero skipped, not NULL", () => {
    // The column is NOT NULL DEFAULT 0, so an in-flight run reads as 0 rather than NULL. A reader
    // must not have to handle a third state for a row that simply has not finished yet.
    const runId = store.openRun({
      startedAt: 10,
      hostPower: "unknown",
      hostIdleMs: null,
      hostSource: "power_only",
      remoteCallBudget: 0,
    });
    const row = db
      .query(
        `SELECT jobs_skipped_not_due AS n, jobs_in_scope AS scope, outcome
           FROM fleet_run WHERE id = ?`,
      )
      .get(runId) as { n: number; scope: number; outcome: string | null } | null;
    expect(row?.n).toBe(0);
    expect(row?.scope).toBe(0);
    expect(row?.outcome).toBeNull();
  });

  test("deleting a run cascades to its briefs — the cascade is live, not decorative", () => {
    const runId = store.openRun({
      startedAt: 1,
      hostPower: "unknown",
      hostIdleMs: null,
      hostSource: "power_only",
      remoteCallBudget: 0,
    });
    store.recordBrief({
      runId,
      jobId: "j",
      agentMethod: "agents.catchup",
      briefMarkdown: "x",
      findingsJson: "{}",
      synthesisJson: null,
      createdAt: 1,
      expiresAt: 2,
    });
    db.run("DELETE FROM fleet_run WHERE id = ?", [runId]);
    expect(store.listBriefs({ limit: 10 })).toHaveLength(0);
  });

  test("failure backoff is exponential and capped at 24h", () => {
    for (let i = 0; i < 8; i++) store.recordJobFailure("j", 0, "boom");
    const state = store.loadJobState("j");
    expect(state?.consecutiveFailures).toBe(8);
    expect(state?.backoffUntil).toBe(24 * 60 * 60 * 1000);
    expect(state?.lastError).toBe("boom");
  });

  test("a success clears the backoff", () => {
    store.recordJobFailure("j", 0, "boom");
    store.recordJobSuccess("j", 500);
    const state = store.loadJobState("j");
    expect(state?.consecutiveFailures).toBe(0);
    expect(state?.backoffUntil).toBeNull();
  });

  test("prune removes only expired briefs", () => {
    const runId = store.openRun({
      startedAt: 0,
      hostPower: "ac",
      hostIdleMs: 0,
      hostSource: "measured",
      remoteCallBudget: 0,
    });
    for (const [id, exp] of [
      ["old", 100],
      ["new", 10_000],
    ] as const) {
      store.recordBrief({
        runId,
        jobId: id,
        agentMethod: "agents.catchup",
        briefMarkdown: "x",
        findingsJson: "{}",
        synthesisJson: null,
        createdAt: 0,
        expiresAt: exp,
      });
    }
    expect(store.pruneBriefs(500)).toBe(1);
    expect(store.listBriefs({ limit: 10 })).toHaveLength(1);
  });

  test("getBrief is a point lookup that finds a brief beyond any list page", () => {
    const runId = store.openRun({
      startedAt: 0,
      hostPower: "ac",
      hostIdleMs: 0,
      hostSource: "measured",
      remoteCallBudget: 0,
    });
    let target = "";
    // More than any plausible list limit: a scan-and-find implementation returns undefined here.
    for (let i = 0; i < 1_200; i++) {
      const id = store.recordBrief({
        runId,
        jobId: `j${i}`,
        agentMethod: "agents.catchup",
        briefMarkdown: "x",
        findingsJson: "{}",
        synthesisJson: null,
        createdAt: i,
        expiresAt: 10_000_000,
      });
      if (i === 0) target = id; // the OLDEST, so it sorts last by created_at DESC
    }
    expect(store.getBrief(target)?.jobId).toBe("j0");
    expect(store.getBrief("no-such-id")).toBeUndefined();
  });

  test("pruning a run cascades its briefs away", () => {
    const runId = store.openRun({
      startedAt: 100,
      hostPower: "ac",
      hostIdleMs: 0,
      hostSource: "measured",
      remoteCallBudget: 0,
    });
    store.recordBrief({
      runId,
      jobId: "j",
      agentMethod: "agents.catchup",
      briefMarkdown: "x",
      findingsJson: "{}",
      synthesisJson: null,
      createdAt: 100,
      // Deliberately far in the future: the RUN's age is what retires it, and the cascade is
      // what removes the brief. Without pruneRuns, fleet_run grows one row per tick forever.
      expiresAt: 10_000_000,
    });
    expect(store.pruneRuns(500)).toBe(1);
    expect(store.listBriefs({ limit: 10 })).toHaveLength(0);
  });
});
