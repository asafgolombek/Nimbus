import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import type { NimbusFleetJobToml, NimbusFleetToml } from "../config/fleet-toml.ts";
import { DEFAULT_FLEET_CONFIG } from "../config/fleet-toml.ts";
import { FLEET_V60_SQL } from "../index/fleet-v60-sql.ts";
import type { HostActivityProbe } from "../platform/host-activity.ts";
import type { FleetInvoker, FleetJobOutcome } from "./fleet-invoker.ts";
import type { FleetRunSummary } from "./fleet-scheduler.ts";
import { FleetScheduler, isJobDue } from "./fleet-scheduler.ts";
import { FleetStore } from "./fleet-store.ts";

const AC_IDLE: HostActivityProbe = { power: "ac", idleMs: 3_600_000, source: "measured" };
const ON_BATTERY: HostActivityProbe = { power: "battery", idleMs: 3_600_000, source: "measured" };

const JOBS: readonly NimbusFleetJobToml[] = [
  { name: "a", agent: "catchup", intervalSeconds: 1, params: {} },
  { name: "b", agent: "ownership", intervalSeconds: 1, params: {} },
];

const NOW = 1_000_000;

function done(name: string): FleetJobOutcome {
  return {
    status: "done",
    briefMarkdown: `# ${name}`,
    findingsJson: JSON.stringify({ job: name }),
    synthesisJson: null,
  };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let db: Database;
let store: FleetStore;

beforeEach(() => {
  db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  db.exec(FLEET_V60_SQL);
  store = new FleetStore(db);
});

function build(opts: {
  probes: readonly HostActivityProbe[];
  invoke: FleetInvoker;
  config?: Partial<NimbusFleetToml>;
  remoteCallsMade?: () => number;
  tickMs?: number;
  onProbe?: () => void;
}): FleetScheduler {
  let i = 0;
  return new FleetScheduler({
    store,
    jobs: JOBS,
    config: { ...DEFAULT_FLEET_CONFIG, enabled: true, ...opts.config },
    capabilityDisabled: false,
    hostActivity: {
      probe: async (): Promise<HostActivityProbe> => {
        opts.onProbe?.();
        // Clamps rather than wrapping: a test that probes more often than it listed should keep
        // seeing the LAST state it described, not silently restart the sequence.
        const p = opts.probes[Math.min(i, opts.probes.length - 1)];
        i += 1;
        if (p === undefined) throw new Error("test bug: no probes configured");
        return p;
      },
    },
    invoke: opts.invoke,
    now: () => NOW,
    ...(opts.remoteCallsMade === undefined ? {} : { remoteCallsMade: opts.remoteCallsMade }),
    ...(opts.tickMs === undefined ? {} : { tickMs: opts.tickMs }),
  });
}

/** Narrows `runId` without an assertion, and fails the test loudly if a run row was expected. */
function requireRunId(summary: FleetRunSummary): string {
  if (summary.runId === null) throw new Error("expected the run to have opened a fleet_run row");
  return summary.runId;
}

function runRow(runId: string): {
  outcome: string | null;
  jobs_attempted: number;
  jobs_completed: number;
  remote_calls_made: number;
} {
  const row = db
    .query(
      `SELECT outcome, jobs_attempted, jobs_completed, remote_calls_made
         FROM fleet_run WHERE id = ?`,
    )
    .get(runId) as {
    outcome: string | null;
    jobs_attempted: number;
    jobs_completed: number;
    remote_calls_made: number;
  } | null;
  if (row === null) throw new Error(`no fleet_run row for ${runId}`);
  return row;
}

describe("isJobDue", () => {
  const job: NimbusFleetJobToml = { name: "a", agent: "catchup", intervalSeconds: 1, params: {} };

  test("a job with no state at all is due", () => {
    expect(isJobDue(job, undefined, NOW)).toBe(true);
  });

  test("a job that has only ever failed is due once its backoff expires", () => {
    // Keyed on lastSuccessAt, not lastAttemptAt: a failed job must retry when the backoff ends,
    // not wait a further full interval on top of it.
    const state = {
      jobId: "a",
      lastAttemptAt: NOW - 10,
      lastSuccessAt: null,
      consecutiveFailures: 3,
      backoffUntil: NOW - 1,
      lastError: "boom",
    };
    expect(isJobDue(job, state, NOW)).toBe(true);
    expect(isJobDue(job, { ...state, backoffUntil: NOW + 1 }, NOW)).toBe(false);
  });

  test("the interval is measured from the last SUCCESS", () => {
    const base = {
      jobId: "a",
      lastAttemptAt: NOW,
      consecutiveFailures: 0,
      backoffUntil: null,
      lastError: null,
    };
    expect(isJobDue(job, { ...base, lastSuccessAt: NOW - 999 }, NOW)).toBe(false);
    expect(isJobDue(job, { ...base, lastSuccessAt: NOW - 1_000 }, NOW)).toBe(true);
  });
});

describe("FleetScheduler.runOnce", () => {
  test("runs jobs strictly one at a time", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const s = build({
      probes: [AC_IDLE],
      invoke: async (job) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await sleep(5);
        inFlight -= 1;
        return done(job.name);
      },
    });
    const summary = await s.runOnce();
    expect(maxInFlight).toBe(1);
    expect(summary.outcome).toBe("completed");
    expect(summary.jobsCompleted).toBe(2);
    expect(summary.jobsUnattempted).toBe(0);
    // Counters agreeing is not proof the work happened: assert the persisted effect too.
    expect(
      store
        .listBriefs({ limit: 10 })
        .map((b) => b.jobId)
        .sort(),
    ).toEqual(["a", "b"]);
    expect(summary.runId).not.toBeNull();
    expect(runRow(requireRunId(summary))).toMatchObject({
      outcome: "completed",
      jobs_attempted: 2,
      jobs_completed: 2,
    });
  });

  test("refuses on battery and records deferred, attempting nothing", async () => {
    let called = 0;
    const s = build({
      probes: [ON_BATTERY],
      invoke: async (job) => {
        called += 1;
        return done(job.name);
      },
    });
    const summary = await s.runOnce();
    expect(summary.outcome).toBe("deferred");
    expect(called).toBe(0);
    // The refusal is DISCLOSED, not silent: a deferred run row records the host state that
    // caused it, which is the only way an owner can tell "never ran" from "kept deferring".
    expect(summary.runId).not.toBeNull();
    expect(runRow(requireRunId(summary))).toMatchObject({
      outcome: "deferred",
      jobs_attempted: 0,
    });
    expect(store.listBriefs({ limit: 10 })).toHaveLength(0);
  });

  test("yields at a job boundary when the user returns mid-run", async () => {
    // Probe 1 admits the run; probe 2 (between jobs) shows the user back.
    const s = build({ probes: [AC_IDLE, ON_BATTERY], invoke: async (job) => done(job.name) });
    const summary = await s.runOnce();
    expect(summary.outcome).toBe("yielded");
    expect(summary.jobsCompleted).toBe(1);
    expect(summary.jobsUnattempted).toBe(1);
    // Stopped at a boundary, not mid-brief: the one completed job's brief is intact and there is
    // no second, partial row.
    expect(store.listBriefs({ limit: 10 }).map((b) => b.jobId)).toEqual(["a"]);
  });

  test("a failing job backs off and the run continues", async () => {
    const s = build({
      probes: [AC_IDLE],
      invoke: async (job) =>
        job.name === "a" ? { status: "failed", error: "boom" } : done(job.name),
    });
    const summary = await s.runOnce();
    expect(summary.outcome).toBe("completed");
    expect(summary.jobsAttempted).toBe(2);
    expect(summary.jobsCompleted).toBe(1);
    expect(store.loadJobState("a")?.consecutiveFailures).toBe(1);
    expect(store.loadJobState("a")?.backoffUntil).toBeGreaterThan(NOW);
    expect(store.loadJobState("a")?.lastError).toBe("boom");
    // The failure is isolated: the later job still produced its brief.
    expect(store.listBriefs({ limit: 10 }).map((b) => b.jobId)).toEqual(["b"]);
  });

  test("a job that ran within its interval is NOT due", async () => {
    // Without this check the 60-second tick reruns every job every minute: a daily job would
    // produce 60 briefs an hour all night, and `interval_seconds` would be parsed and never read.
    store.recordJobSuccess("a", NOW - 500); // 0.5 s ago; interval is 1 s
    const ran: string[] = [];
    const s = build({
      probes: [AC_IDLE],
      invoke: async (job) => {
        ran.push(job.name);
        return done(job.name);
      },
    });
    const summary = await s.runOnce();
    expect(ran).toEqual(["b"]);
    expect(summary.jobsAttempted).toBe(1);
    // A not-due job must not leave a brief behind either — the counter and the table must agree.
    expect(store.listBriefs({ limit: 10 }).map((b) => b.jobId)).toEqual(["b"]);
  });

  test("a job whose interval has elapsed is due again", async () => {
    // The inverse control for the test above: a due check that refused EVERYTHING would satisfy
    // that one and fail this one, so the pair pins the predicate from both sides.
    store.recordJobSuccess("a", NOW - 5_000); // 5 s ago; interval is 1 s
    const ran: string[] = [];
    const s = build({
      probes: [AC_IDLE],
      invoke: async (job) => {
        ran.push(job.name);
        return done(job.name);
      },
    });
    await s.runOnce();
    expect(ran).toEqual(["a", "b"]);
  });

  test("a second tick while a run is in flight is refused, not run concurrently", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const s = build({
      probes: [AC_IDLE],
      invoke: async (job) => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await sleep(20);
        concurrent -= 1;
        return done(job.name);
      },
    });
    // A run can outlast the 60 s tick — a cold `ownership` + `impact` with synthesis easily does.
    const [first, second] = await Promise.all([s.runOnce(), s.runOnce()]);
    expect(maxConcurrent).toBe(1);
    expect([first.outcome, second.outcome].sort()).toEqual(["completed", "deferred"]);
    expect([first.runId, second.runId]).toContain(null); // the refused one opened no run row
    // Exactly ONE `fleet_run` row exists. Without the guard the second tick opens its own row and
    // interleaves its writes with the first — the counter check alone would not see that.
    const runs = db.query(`SELECT COUNT(*) AS n FROM fleet_run`).get() as { n: number };
    expect(runs.n).toBe(1);
    expect(store.listBriefs({ limit: 10 })).toHaveLength(2);
  });

  test("the in-flight guard is released after a run, so the next tick proceeds", async () => {
    // A guard that latches is as broken as no guard: the fleet would run exactly once per boot.
    const s = build({ probes: [AC_IDLE], invoke: async (job) => done(job.name) });
    await s.runOnce();
    const second = await s.runOnce({ force: true });
    expect(second.outcome).toBe("completed");
    expect(second.runId).not.toBeNull();
  });

  test("a throwing invoker closes the run as failed and releases the guard", async () => {
    // The invoker CONTRACT returns `{ status: "failed" }`, so a throw means something below it
    // broke that contract. The run row must still be closed: an `outcome` left NULL reads as
    // "still running" forever, and a latched `inFlight` would wedge the fleet until the next boot.
    let boom = true;
    const s = build({
      probes: [AC_IDLE],
      invoke: async (job) => {
        if (boom) {
          boom = false;
          throw new Error("invoker exploded");
        }
        return done(job.name);
      },
    });
    await expect(s.runOnce()).rejects.toThrow(/invoker exploded/);
    const failed = db
      .query(`SELECT COUNT(*) AS n FROM fleet_run WHERE outcome = 'failed'`)
      .get() as {
      n: number;
    };
    expect(failed.n).toBe(1);

    const after = await s.runOnce({ force: true });
    expect(after.runId).not.toBeNull();
    expect(after.outcome).toBe("completed");
  });

  test("runOnce({ jobName }) runs only that job", async () => {
    const ran: string[] = [];
    const s = build({
      probes: [AC_IDLE],
      invoke: async (job) => {
        ran.push(job.name);
        return done(job.name);
      },
    });
    await s.runOnce({ jobName: "b", force: true });
    expect(ran).toEqual(["b"]);
  });

  test("an unknown jobName throws rather than running everything", async () => {
    let called = 0;
    const s = build({
      probes: [AC_IDLE],
      invoke: async (job) => {
        called += 1;
        return done(job.name);
      },
    });
    await expect(s.runOnce({ jobName: "nope" })).rejects.toThrow(/no such fleet job/);
    expect(called).toBe(0);
  });

  test("a job inside its backoff window is skipped", async () => {
    store.recordJobFailure("a", NOW, "boom"); // backoff ends 1h later
    const ran: string[] = [];
    const s = build({
      probes: [AC_IDLE],
      invoke: async (job) => {
        ran.push(job.name);
        return done(job.name);
      },
    });
    await s.runOnce();
    expect(ran).toEqual(["b"]);
  });

  test("force skips ADMISSION only, never the disabled capability", async () => {
    let called = 0;
    const s = build({
      probes: [ON_BATTERY],
      invoke: async (job) => {
        called += 1;
        return done(job.name);
      },
    });
    const summary = await s.runOnce({ force: true });
    expect(called).toBe(2);
    expect(summary.outcome).toBe("completed");
  });

  test("force also overrides the interval and the backoff, but nothing above them", async () => {
    store.recordJobSuccess("a", NOW); // not due
    store.recordJobFailure("b", NOW, "boom"); // inside its backoff
    const ran: string[] = [];
    const s = build({
      probes: [AC_IDLE],
      invoke: async (job) => {
        ran.push(job.name);
        return done(job.name);
      },
    });
    await s.runOnce({ force: true });
    expect(ran).toEqual(["a", "b"]);
  });

  test("a disabled capability refuses even with force", async () => {
    const s = new FleetScheduler({
      store,
      jobs: JOBS,
      config: { ...DEFAULT_FLEET_CONFIG, enabled: true },
      capabilityDisabled: true,
      hostActivity: { probe: async () => AC_IDLE },
      invoke: async (job) => done(job.name),
      now: () => 1,
    });
    await expect(s.runOnce({ force: true })).rejects.toThrow(/org policy/);
    const runs = db.query(`SELECT COUNT(*) AS n FROM fleet_run`).get() as { n: number };
    expect(runs.n).toBe(0);
  });

  test("a disabled config refuses before it probes anything", async () => {
    let probed = 0;
    const s = new FleetScheduler({
      store,
      jobs: JOBS,
      config: DEFAULT_FLEET_CONFIG, // enabled: false
      capabilityDisabled: false,
      hostActivity: {
        probe: async (): Promise<HostActivityProbe> => {
          probed += 1;
          return AC_IDLE;
        },
      },
      invoke: async (job) => done(job.name),
      now: () => 1,
    });
    await expect(s.runOnce()).rejects.toThrow(/disabled/);
    expect(probed).toBe(0);
  });

  test("records the run's remote spend against its budget", async () => {
    const s = build({
      probes: [AC_IDLE],
      invoke: async (job) => done(job.name),
      config: { allowRemote: true, remoteCallBudget: 4 },
      remoteCallsMade: () => 3,
    });
    const summary = await s.runOnce();
    expect(summary.runId).not.toBeNull();
    expect(runRow(requireRunId(summary)).remote_calls_made).toBe(3);
    const budget = db
      .query(`SELECT remote_call_budget AS b FROM fleet_run WHERE id = ?`)
      .get(requireRunId(summary)) as { b: number };
    expect(budget.b).toBe(4);
  });
});

describe("FleetScheduler.start/stop", () => {
  test("start() ticks the loop and stop() halts it", async () => {
    let probed = 0;
    const s = build({
      probes: [ON_BATTERY], // defers immediately: the tick is what is under test, not the work
      invoke: async (job) => done(job.name),
      tickMs: 5,
      onProbe: () => {
        probed += 1;
      },
    });
    s.start();
    await sleep(60);
    const afterStart = probed;
    expect(afterStart).toBeGreaterThan(0);
    s.stop();
    await sleep(40);
    expect(probed).toBe(afterStart);
  });

  test("start() is idempotent — a second call installs no second interval", async () => {
    // The assertion that makes this real: if `start()` installed a second timer, `stop()` would
    // clear only the most recent one and the first would keep probing forever.
    let probed = 0;
    const s = build({
      probes: [ON_BATTERY],
      invoke: async (job) => done(job.name),
      tickMs: 5,
      onProbe: () => {
        probed += 1;
      },
    });
    s.start();
    s.start();
    s.stop();
    await sleep(50);
    expect(probed).toBe(0);
  });

  test("stop() before start() is a no-op, and the default tick installs cleanly", () => {
    // No `tickMs`, so this exercises the production `DEFAULT_TICK_MS` arm. A 60 s interval will
    // not fire inside the test; `unref` is what keeps it from holding the runner open.
    const s = build({ probes: [AC_IDLE], invoke: async (job) => done(job.name) });
    expect(() => s.stop()).not.toThrow();
    s.start();
    expect(() => s.stop()).not.toThrow();
  });

  test("a tick whose run rejects is swallowed, not left as an unhandled rejection", async () => {
    // `runOnce` throws on the disabled arms, and a timer callback has no caller to catch for it.
    // An unhandled rejection from the fleet timer would take the whole gateway process down —
    // over an optional, default-off feature.
    let rejections = 0;
    const onRejection = (): void => {
      rejections += 1;
    };
    process.on("unhandledRejection", onRejection);
    const s = new FleetScheduler({
      store,
      jobs: JOBS,
      config: { ...DEFAULT_FLEET_CONFIG, enabled: true },
      capabilityDisabled: true, // every tick rejects
      hostActivity: { probe: async () => AC_IDLE },
      invoke: async (job) => done(job.name),
      now: () => NOW,
      tickMs: 5,
    });
    s.start();
    await sleep(40);
    s.stop();
    process.off("unhandledRejection", onRejection);
    expect(rejections).toBe(0);
  });
});
