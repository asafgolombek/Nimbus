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
      jobsAttempted: 1,
      jobsCompleted: 1,
      remoteCallsMade: 0,
    });

    const briefs = store.listBriefs({ limit: 10 });
    expect(briefs).toHaveLength(1);
    expect(briefs[0]?.agentMethod).toBe("agents.catchup");
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
