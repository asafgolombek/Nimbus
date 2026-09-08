import { describe, expect, test } from "bun:test";
import { FleetConfigError, parseNimbusTomlFleet, parseNimbusTomlFleetJobs } from "./fleet-toml.ts";

test("an absent [fleet] block is disabled with safe defaults", () => {
  const c = parseNimbusTomlFleet("");
  expect(c.enabled).toBe(false);
  expect(c.allowRemote).toBe(false);
  expect(c.remoteCallBudget).toBe(0);
  expect(c.minIdleSeconds).toBe(900);
  expect(c.requireAcPower).toBe(true);
  expect(c.retentionDays).toBe(14);
});

test("parses a full [fleet] block", () => {
  const c = parseNimbusTomlFleet(
    [
      "[fleet]",
      "enabled = true",
      "allow_remote = true",
      "remote_call_budget = 5",
      "min_idle_seconds = 60",
      "require_ac_power = false",
      "retention_days = 30",
    ].join("\n"),
  );
  expect(c).toEqual({
    enabled: true,
    allowRemote: true,
    remoteCallBudget: 5,
    minIdleSeconds: 60,
    requireAcPower: false,
    retentionDays: 30,
  });
});

test("allow_remote with a zero budget is refused, not silently allowed", () => {
  expect(() =>
    parseNimbusTomlFleet(["[fleet]", "allow_remote = true", "remote_call_budget = 0"].join("\n")),
  ).toThrow(/remote_call_budget/);
});

test("keys after a following table header do not leak into [fleet]", () => {
  const c = parseNimbusTomlFleet(
    ["[fleet]", "enabled = true", "[other]", "enabled = false"].join("\n"),
  );
  expect(c.enabled).toBe(true);
});

test("parses multiple [[fleet.job]] blocks with flat params", () => {
  const jobs = parseNimbusTomlFleetJobs(
    [
      "[[fleet.job]]",
      'name = "morning_catchup"',
      'agent = "catchup"',
      "interval_seconds = 86400",
      "since_ms = 86400000",
      'service = "github"',
      "",
      "[[fleet.job]]",
      'name = "weekly_ownership"',
      'agent = "ownership"',
      "interval_seconds = 604800",
    ].join("\n"),
  );
  expect(jobs).toHaveLength(2);
  expect(jobs[0]).toEqual({
    name: "morning_catchup",
    agent: "catchup",
    intervalSeconds: 86400,
    params: { sinceMs: 86400000, service: "github" },
    digestMinDelta: 1,
  });
  expect(jobs[1]?.params).toEqual({});
});

test("a block with no name and no agent is not a job at all — ignored", () => {
  expect(parseNimbusTomlFleetJobs(["[[fleet.job]]"].join("\n"))).toEqual([]);
});

test("a job missing a required key is REFUSED, never silently dropped or defaulted", () => {
  // Dropping it leaves the owner believing a job is configured that will never run. Defaulting
  // interval_seconds to a day guesses a schedule they did not choose. Both fail silently; a
  // throw is the only outcome they can see.
  expect(() =>
    parseNimbusTomlFleetJobs(["[[fleet.job]]", 'name = "x"', 'agent = "catchup"'].join("\n")),
  ).toThrow(/interval_seconds/);
  expect(() =>
    parseNimbusTomlFleetJobs(["[[fleet.job]]", 'name = "x"', "interval_seconds = 10"].join("\n")),
  ).toThrow(/agent/);
});

test("duplicate job names are refused — the name is the job_id primary key", () => {
  expect(() =>
    parseNimbusTomlFleetJobs(
      [
        "[[fleet.job]]",
        'name = "dup"',
        'agent = "catchup"',
        "interval_seconds = 1",
        "[[fleet.job]]",
        'name = "dup"',
        'agent = "ownership"',
        "interval_seconds = 1",
      ].join("\n"),
    ),
  ).toThrow(/duplicate/i);
});

test("retention_days = 0 is REFUSED — a zero-retention run deletes its own row", () => {
  // `pruneRuns` uses `started_at <= cutoff`, so at retention 0 the prune a run performs on
  // completion removes that same run, and `runOnce` returns a runId naming no row. There is no
  // safe reading of 0 here, so it is refused rather than silently defaulted.
  expect(() => parseNimbusTomlFleet(["[fleet]", "retention_days = 0"].join("\n"))).toThrow(
    /retention_days/,
  );
});

test("a negative retention_days is refused for the same reason", () => {
  expect(() => parseNimbusTomlFleet(["[fleet]", "retention_days = -1"].join("\n"))).toThrow(
    /retention_days/,
  );
});

test("retention_days = 1 is the minimum and is accepted", () => {
  expect(parseNimbusTomlFleet(["[fleet]", "retention_days = 1"].join("\n")).retentionDays).toBe(1);
});

test("remote_call_budget = 0 stays legal — it is the default and means no remote", () => {
  // The bound raised for retention_days must NOT be raised for this key: 0 is what
  // `allow_remote = false` implies, and DEFAULT_FLEET_CONFIG ships it.
  //
  // HONEST SCOPE, because a review caught this claiming more than it does. The `= 0` assertion
  // CANNOT detect the mutation it looks like it guards: `DEFAULT_FLEET_CONFIG.remoteCallBudget` is
  // already 0, so raising the shared arm to `n >= 1` makes the key ignored and the merged config
  // still reads 0. Explicit-zero and defaulted-zero are indistinguishable here by construction.
  //
  // The sibling `min_idle_seconds = 0` test is what actually catches a shared-arm raise, because
  // its default is 900 and the mutation makes the read value diverge. Verified by applying that
  // mutation: it fails and this one does not.
  //
  // The `= 3` assertion below is still worth its line, but for a DIFFERENT mutation — it goes red
  // if the key stops being read at all, e.g. dropped from the switch.
  expect(
    parseNimbusTomlFleet(["[fleet]", "remote_call_budget = 0"].join("\n")).remoteCallBudget,
  ).toBe(0);
  expect(
    parseNimbusTomlFleet(["[fleet]", "allow_remote = true", "remote_call_budget = 3"].join("\n"))
      .remoteCallBudget,
  ).toBe(3);
});

test("min_idle_seconds = 0 stays legal — it means no idle requirement", () => {
  expect(parseNimbusTomlFleet(["[fleet]", "min_idle_seconds = 0"].join("\n")).minIdleSeconds).toBe(
    0,
  );
});

describe("[[fleet.job]] digest_min_delta", () => {
  const job = (extra: string) =>
    `[[fleet.job]]\nname = "j"\nagent = "ghost"\ninterval_seconds = 3600\n${extra}\n`;

  test("defaults to 1", () => {
    expect(parseNimbusTomlFleetJobs(job(""))[0]?.digestMinDelta).toBe(1);
  });

  test("is read, and does NOT leak into agent params", () => {
    const j = parseNimbusTomlFleetJobs(job("digest_min_delta = 5"))[0];
    expect(j?.digestMinDelta).toBe(5);
    expect(j?.params).toEqual({}); // the trap: it must not appear here
  });

  test("refuses below 1", () => {
    expect(() => parseNimbusTomlFleetJobs(job("digest_min_delta = 0"))).toThrow(FleetConfigError);
    expect(() => parseNimbusTomlFleetJobs(job("digest_min_delta = -2"))).toThrow(FleetConfigError);
  });

  // Named the same way every sibling refusal in this parser is (`${name} requires agent`): with
  // several `[[fleet.job]]` blocks in one file, an unnamed refusal costs the owner a search.
  test("refuses below 1, naming the job", () => {
    expect(() => parseNimbusTomlFleetJobs(job("digest_min_delta = 0"))).toThrow(
      /\[\[fleet\.job\]\] j digest_min_delta/,
    );
  });

  test("a genuine agent param still reaches params", () => {
    expect(parseNimbusTomlFleetJobs(job('file = "src/a.ts"'))[0]?.params).toEqual({
      file: "src/a.ts",
    });
  });

  test("a malformed value falls through to the default rather than throwing", () => {
    // Writing a number the parser can read and refuse is a DIFFERENT act from writing nonsense:
    // `digest_min_delta = 0` is a config error, `digest_min_delta = "abc"` is a typo that should
    // leave the key at its default, exactly as every sibling key in this parser behaves.
    for (const raw of [
      'digest_min_delta = "abc"',
      "digest_min_delta = 1.5",
      "digest_min_delta = 3abc",
    ]) {
      const j = parseNimbusTomlFleetJobs(job(raw))[0];
      expect(j?.digestMinDelta).toBe(1);
      expect(j?.params).toEqual({});
    }
  });
});
