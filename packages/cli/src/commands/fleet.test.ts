import { expect, test } from "bun:test";
import { JsonRpcError } from "@nimbus-dev/client";
import {
  FLEET_EXIT_CODES,
  type FleetIpc,
  type ParsedFleetArgs,
  parseFleetArgs,
  runFleet,
  runFleetCommand,
} from "./fleet.ts";

test("parses the subcommands", () => {
  expect(parseFleetArgs(["status"])).toEqual({ sub: "status", json: false });
  expect(parseFleetArgs(["briefs", "--limit", "5", "--json"])).toEqual({
    sub: "briefs",
    limit: 5,
    json: true,
  });
  expect(parseFleetArgs(["run", "morning_catchup", "--force"])).toEqual({
    sub: "run",
    job: "morning_catchup",
    force: true,
    json: false,
  });
});

test("an unknown subcommand is rejected", () => {
  expect(parseFleetArgs(["frobnicate"])).toBeUndefined();
});

test("run without a job name is rejected", () => {
  expect(parseFleetArgs(["run"])).toBeUndefined();
});

test("list and show parse cleanly", () => {
  expect(parseFleetArgs(["list", "--json"])).toEqual({ sub: "list", json: true });
  expect(parseFleetArgs(["show", "brief-1"])).toEqual({ sub: "show", id: "brief-1", json: false });
});

test("show without an id is rejected", () => {
  expect(parseFleetArgs(["show"])).toBeUndefined();
});

test("briefs --limit 0 or non-numeric is rejected, not silently defaulted", () => {
  expect(parseFleetArgs(["briefs", "--limit", "0"])).toBeUndefined();
  expect(parseFleetArgs(["briefs", "--limit", "abc"])).toBeUndefined();
});

test("briefs --job filters by job id", () => {
  expect(parseFleetArgs(["briefs", "--job", "morning_catchup"])).toEqual({
    sub: "briefs",
    job: "morning_catchup",
    json: false,
  });
});

function sinkSpy(): {
  out: string[];
  err: string[];
  sink: { out: (s: string) => void; err: (s: string) => void };
} {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, sink: { out: (s) => out.push(s), err: (s) => err.push(s) } };
}

test("fleet.status renders the probe and config", async () => {
  const client: FleetIpc = {
    call: async () => ({
      enabled: true,
      running: true,
      allowRemote: false,
      remoteCallBudget: 0,
      minIdleSeconds: 900,
      requireAcPower: true,
      retentionDays: 14,
      jobsConfigured: 2,
      probe: { power: "ac", idleMs: 1000, source: "measured" },
    }),
  };
  const { out, sink } = sinkSpy();
  const code = await runFleetCommand(client, { sub: "status", json: false }, sink);
  expect(code).toBe(FLEET_EXIT_CODES.ok);
  const rendered = out.join("");
  expect(rendered).toContain("fleet: enabled (running)");
  expect(rendered).toContain("jobs configured:    2");
});

test("fleet.runNow threads job and force through to the call params", async () => {
  let seenMethod = "";
  let seenParams: unknown;
  const client: FleetIpc = {
    call: async (method, params) => {
      seenMethod = method;
      seenParams = params;
      return {
        runId: "r1",
        outcome: "completed",
        jobsAttempted: 1,
        jobsCompleted: 1,
        jobsUnattempted: 0,
        jobsSkippedNotDue: 0,
      };
    },
  };
  const { sink } = sinkSpy();
  const code = await runFleetCommand(
    client,
    { sub: "run", job: "morning_catchup", force: true, json: false },
    sink,
  );
  expect(code).toBe(FLEET_EXIT_CODES.ok);
  expect(seenMethod).toBe("fleet.runNow");
  expect(seenParams).toEqual({ job: "morning_catchup", force: true });
});

test("a deferred run with runId null reports the machine was already busy running something else", async () => {
  const client: FleetIpc = {
    call: async () => ({
      runId: null,
      outcome: "deferred",
      jobsAttempted: 0,
      jobsCompleted: 0,
      jobsUnattempted: 2,
      jobsSkippedNotDue: 0,
    }),
  };
  const { out, sink } = sinkSpy();
  const code = await runFleetCommand(
    client,
    { sub: "run", job: "morning_catchup", force: false, json: false },
    sink,
  );
  expect(code).toBe(FLEET_EXIT_CODES.deferred);
  expect(out.join("")).toContain("already in flight");
});

test("a deferred run with a real runId reports a power/idle refusal, not an in-flight one", async () => {
  const client: FleetIpc = {
    call: async () => ({
      runId: "run-42",
      outcome: "deferred",
      jobsAttempted: 0,
      jobsCompleted: 0,
      jobsUnattempted: 2,
      jobsSkippedNotDue: 0,
    }),
  };
  const { out, sink } = sinkSpy();
  const code = await runFleetCommand(
    client,
    { sub: "run", job: "morning_catchup", force: false, json: false },
    sink,
  );
  expect(code).toBe(FLEET_EXIT_CODES.deferred);
  const rendered = out.join("");
  expect(rendered).toContain("battery or in use");
  expect(rendered).not.toContain("already in flight");
});

test("a failed run exits nonzero and a completed run exits 0", async () => {
  const outcomes: Array<[string, number]> = [
    ["completed", FLEET_EXIT_CODES.ok],
    ["yielded", FLEET_EXIT_CODES.ok],
    ["failed", FLEET_EXIT_CODES.failed],
  ];
  for (const [outcome, expected] of outcomes) {
    const client: FleetIpc = {
      call: async () => ({
        runId: "r",
        outcome,
        jobsAttempted: 1,
        jobsCompleted: outcome === "completed" ? 1 : 0,
        jobsUnattempted: 0,
        jobsSkippedNotDue: 0,
      }),
    };
    const { sink } = sinkSpy();
    const code = await runFleetCommand(
      client,
      { sub: "run", job: "j", force: false, json: false },
      sink,
    );
    expect(code).toBe(expected);
  }
});

test("fleet.show returns null for an unknown or expired brief and exits notFound", async () => {
  const client: FleetIpc = { call: async () => ({ brief: null }) };
  const { out, err, sink } = sinkSpy();
  const code = await runFleetCommand(client, { sub: "show", id: "nope", json: false }, sink);
  expect(code).toBe(FLEET_EXIT_CODES.notFound);
  expect(out).toEqual([]);
  expect(err.join("")).toContain("no such brief");
});

test("--json emits machine-readable output for every subcommand", async () => {
  const statusResponse = {
    enabled: true,
    running: false,
    allowRemote: false,
    remoteCallBudget: 0,
    minIdleSeconds: 900,
    requireAcPower: true,
    retentionDays: 14,
    jobsConfigured: 0,
    probe: { power: "ac", idleMs: 0, source: "measured" },
  };
  const briefResponse = {
    id: "b1",
    runId: "r1",
    jobId: "j1",
    agentMethod: "agents.catchup",
    briefMarkdown: "# hi",
    findingsJson: "{}",
    synthesisJson: null,
    createdAt: 0,
  };
  const responses: Record<string, unknown> = {
    "fleet.status": statusResponse,
    "fleet.list": { jobs: [] },
    "fleet.briefs": { briefs: [briefResponse] },
    "fleet.show": { brief: briefResponse },
    "fleet.runNow": {
      runId: "r1",
      outcome: "completed",
      jobsAttempted: 1,
      jobsCompleted: 1,
      jobsUnattempted: 0,
      jobsSkippedNotDue: 0,
    },
  };
  const client: FleetIpc = { call: async (method) => responses[method] };
  const cmds: ParsedFleetArgs[] = [
    { sub: "status", json: true },
    { sub: "list", json: true },
    { sub: "briefs", json: true },
    { sub: "show", id: "b1", json: true },
    { sub: "run", job: "j1", force: false, json: true },
  ];
  for (const cmd of cmds) {
    const { out, sink } = sinkSpy();
    await runFleetCommand(client, cmd, sink);
    expect(() => JSON.parse(out.join(""))).not.toThrow();
  }
});

test("runFleet prints usage and exits `usage` for an unparseable command", async () => {
  const { err, sink } = sinkSpy();
  const code = await runFleet(["frobnicate"], {
    runWithClient: () => {
      throw new Error("should not connect for an unparseable command");
    },
    sink,
  });
  expect(code).toBe(FLEET_EXIT_CODES.usage);
  expect(err.join("")).toContain("Usage: nimbus fleet");
});

test("runFleet uses the batch timeout budget for `run` and none for reads", async () => {
  const seenTimeouts: Array<number | undefined> = [];
  const deps = {
    runWithClient: async <T>(fn: (c: FleetIpc) => Promise<T>, timeoutMs?: number): Promise<T> => {
      seenTimeouts.push(timeoutMs);
      return fn({ call: async () => ({}) });
    },
    sink: sinkSpy().sink,
  };
  await runFleet(["status"], deps);
  await runFleet(["run", "j"], deps);
  expect(seenTimeouts[0]).toBeUndefined();
  expect(seenTimeouts[1]).toBeGreaterThan(0);
});

test("a real JsonRpcError with code -32602 (no such job) exits notFound; -32000 exits disabled", async () => {
  // The REAL transport class, not a lookalike: `jsonRpcErrorCode` is a brand check (see its own
  // doc comment), so a plain Error-with-a-.code property would silently fail to be recognised —
  // exactly the gap this test exists to catch.
  const notFoundClient: FleetIpc = {
    call: async () => {
      throw new JsonRpcError("fleet: no such fleet job: typo_job", -32602, undefined);
    },
  };
  const disabledClient: FleetIpc = {
    call: async () => {
      throw new JsonRpcError("fleet: not running", -32000, undefined);
    },
  };
  const s1 = sinkSpy();
  const code1 = await runFleetCommand(
    notFoundClient,
    { sub: "run", job: "typo_job", force: false, json: false },
    s1.sink,
  );
  const s2 = sinkSpy();
  const code2 = await runFleetCommand(
    disabledClient,
    { sub: "run", job: "j", force: false, json: false },
    s2.sink,
  );
  expect(code1).toBe(FLEET_EXIT_CODES.notFound);
  expect(code2).toBe(FLEET_EXIT_CODES.disabled);
});

test("the SAME translation applies to fleet.show, not just fleet.run", async () => {
  // Before this fix, only `runRun` translated -32602/-32000; every other subcommand's error fell
  // through to `runFleet`'s outer catch, which always reports `disabled` regardless of the real
  // code — so a -32602 from `fleet.show` (a bad/missing id) looked identical to a -32000 (the
  // fleet has no store wired at all), and a user asking about a specific brief would always be
  // told "the fleet is disabled" even when that was not the actual reason.
  const badIdClient: FleetIpc = {
    call: async () => {
      throw new JsonRpcError("fleet: id (non-empty string) required", -32602, undefined);
    },
  };
  const noStoreClient: FleetIpc = {
    call: async () => {
      throw new JsonRpcError("fleet: store not available", -32000, undefined);
    },
  };
  const s1 = sinkSpy();
  const code1 = await runFleetCommand(
    badIdClient,
    { sub: "show", id: "whatever", json: false },
    s1.sink,
  );
  const s2 = sinkSpy();
  const code2 = await runFleetCommand(
    noStoreClient,
    { sub: "show", id: "whatever", json: false },
    s2.sink,
  );
  expect(code1).toBe(FLEET_EXIT_CODES.notFound);
  expect(code2).toBe(FLEET_EXIT_CODES.disabled);
});

test("fleet.briefs also gets the shared translation for a -32000 (no store wired)", async () => {
  const client: FleetIpc = {
    call: async () => {
      throw new JsonRpcError("fleet: store not available", -32000, undefined);
    },
  };
  const { sink } = sinkSpy();
  const code = await runFleetCommand(client, { sub: "briefs", json: false }, sink);
  expect(code).toBe(FLEET_EXIT_CODES.disabled);
});
