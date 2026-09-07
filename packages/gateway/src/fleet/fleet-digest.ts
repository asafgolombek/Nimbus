import type { NimbusFleetJobToml } from "../config/fleet-toml.ts";
import { codeUnitCompare } from "../util/code-unit-compare.ts";
import { summarizeBrief } from "./fleet-digest-extractors.ts";
import type {
  BriefSummary,
  FleetDigestNotCompared,
  FleetDigestResult,
  FleetJobDigest,
  FleetMetricDelta,
} from "./fleet-digest-types.ts";
import type { FleetStore } from "./fleet-store.ts";

type Compared = Pick<FleetJobDigest, "status" | "metrics" | "keysAppeared" | "keysResolved">;

/**
 * Pure comparison of two brief summaries into the diff fields of a `FleetJobDigest`. No I/O, no
 * database — the caller (Task 8) supplies the identity fields (job id, brief ids, timestamps).
 *
 * Three rules, each load-bearing (spec § 6):
 *  1. A key change (appeared/resolved) is NEVER suppressed by `minDelta` — it is not a magnitude.
 *  2. A metric present on only one side is reported as `{ before: null, after: null, delta: null }`
 *     on the missing side, never synthesized into a fabricated `0 -> N` jump — and it is reported
 *     regardless of `minDelta`, since there is no delta to compare against the threshold.
 *  3. A suppressed-by-threshold change must not read as "nothing happened": the status is
 *     `unchanged_within_threshold`, distinct from `unchanged`.
 */
export function compareSummaries(
  before: BriefSummary,
  after: BriefSummary,
  minDelta: number,
): Compared {
  const b = new Set(before.keys);
  const a = new Set(after.keys);
  const keysAppeared = [...a].filter((k) => !b.has(k)).sort(codeUnitCompare);
  const keysResolved = [...b].filter((k) => !a.has(k)).sort(codeUnitCompare);

  const metrics: Record<string, FleetMetricDelta> = {};
  let suppressed = false;
  const names = [...new Set([...Object.keys(before.metrics), ...Object.keys(after.metrics)])].sort(
    codeUnitCompare,
  );
  for (const name of names) {
    const bv = before.metrics[name];
    const av = after.metrics[name];
    if (bv === undefined || av === undefined) {
      // Present on one side only: an extractor gained or lost a field. Reporting `0 -> N` would
      // assert movement of exactly the current value, indistinguishable from a real jump from
      // zero, and would fire on every job the first night after any extractor changed (§ 6.1).
      // Reported unconditionally: there is no delta here for `minDelta` to bound.
      metrics[name] = { before: bv ?? null, after: av ?? null, delta: null };
      continue;
    }
    const delta = av - bv;
    if (delta === 0) continue;
    if (Math.abs(delta) < minDelta) {
      suppressed = true;
      continue;
    }
    metrics[name] = { before: bv, after: av, delta };
  }

  const changed =
    keysAppeared.length > 0 || keysResolved.length > 0 || Object.keys(metrics).length > 0;
  return {
    // A suppressed metric must not read as "nothing happened": the status names the threshold's
    // involvement so a reader cannot mistake a hidden change for no change.
    status: changed ? "changed" : suppressed ? "unchanged_within_threshold" : "unchanged",
    metrics: Object.freeze(metrics),
    keysAppeared,
    keysResolved,
  };
}

/**
 * Walks the UNION of configured jobs and jobs with a live brief in the window (spec § 5.1) — not
 * either half alone: config-only drops overnight work when a job block is deleted in the morning,
 * briefs-only drops the "configured but never ran" fact. Sorts every outcome into a job digest or
 * one of four `notCompared` populations; never drops a job silently.
 */
export function buildFleetDigest(deps: {
  store: FleetStore;
  jobs: readonly NimbusFleetJobToml[];
  windowMs: number;
  now: number;
}): Omit<FleetDigestResult, "markdown"> {
  const windowStartMs = deps.now - deps.windowMs;
  const configured = new Map(deps.jobs.map((j) => [j.name, j]));
  const ids = [
    ...new Set([
      ...configured.keys(),
      ...deps.store.jobIdsWithBriefsInWindow({ windowStartMs, now: deps.now }),
    ]),
  ].sort(codeUnitCompare);

  const jobs: FleetJobDigest[] = [];
  // Derived from `FleetDigestNotCompared` rather than restated inline — that type is the single
  // definition of these shapes; structural checking at the return statement below catches drift
  // either way, but there is no reason to keep a second copy of it here.
  const firstObservation: FleetDigestNotCompared["firstObservation"][number][] = [];
  const notSummarizable: FleetDigestNotCompared["notSummarizable"][number][] = [];
  const noBriefInWindow: FleetDigestNotCompared["noBriefInWindow"][number][] = [];
  const agentChanged: FleetDigestNotCompared["agentChanged"][number][] = [];

  for (const jobId of ids) {
    const cfg = configured.get(jobId);
    const { current, predecessor } = deps.store.briefPairForJob({
      jobId,
      windowStartMs,
      now: deps.now,
    });
    if (current === undefined) {
      // Configured but no brief landed in the window at all — reported with the CONFIGURED agent
      // name, since there is no brief to read one from.
      noBriefInWindow.push({ jobId, agent: cfg?.agent ?? "unknown" });
      continue;
    }
    if (predecessor === undefined) {
      // One brief only: reporting it as "all new" would fabricate a change against a baseline
      // that never existed (spec § 5.2).
      firstObservation.push({ jobId, briefId: current.id, createdAt: current.createdAt });
      continue;
    }
    if (current.agentMethod !== predecessor.agentMethod) {
      // Same job name, different agent — the owner repointed it. Both briefs are readable, but
      // their metric namespaces are disjoint, so comparing them would report EVERY metric as
      // one-sided and every key as churn: a wall of movement describing a config edit, not the
      // index. Refused with its own disclosure rather than diffed (spec § 5.3).
      //
      // Deliberately takes precedence over summarizability: this fires BEFORE either brief is
      // even passed to `summarizeBrief`, so a `current` brief that is both under the new agent
      // AND independently corrupt is absorbed into this disclosure with no separate
      // "also unreadable" signal. That is still correct — the comparison is impossible either
      // way, and "the agent changed" is the more actionable fact for a reader than "also, the
      // new brief doesn't parse".
      agentChanged.push({ jobId, from: predecessor.agentMethod, to: current.agentMethod });
      continue;
    }
    const after = summarizeBrief(current.agentMethod, current.findingsJson);
    const before = summarizeBrief(predecessor.agentMethod, predecessor.findingsJson);
    if (after === undefined || before === undefined) {
      // Both sides are checked, and both reported when both fail: a reader responds differently
      // to a broken NEW brief than to a broken OLD one, so the role is part of the disclosure.
      if (after === undefined) {
        notSummarizable.push({
          jobId,
          briefId: current.id,
          role: "current",
          reason: `unreadable ${current.agentMethod} brief`,
        });
      }
      if (before === undefined) {
        notSummarizable.push({
          jobId,
          briefId: predecessor.id,
          role: "predecessor",
          reason: `unreadable ${predecessor.agentMethod} brief`,
        });
      }
      continue;
    }
    const minDelta = cfg?.digestMinDelta ?? 1;
    jobs.push({
      jobId,
      agentMethod: current.agentMethod,
      configured: cfg !== undefined,
      minDelta,
      currentBriefId: current.id,
      currentCreatedAt: current.createdAt,
      predecessorBriefId: predecessor.id,
      predecessorCreatedAt: predecessor.createdAt,
      // The PAIR's span, not the window — those differ per job (spec § 2.1).
      comparisonSpanMs: current.createdAt - predecessor.createdAt,
      ...compareSummaries(before, after, minDelta),
    });
  }

  return {
    windowMs: deps.windowMs,
    generatedAt: deps.now,
    jobs,
    notCompared: { firstObservation, notSummarizable, noBriefInWindow, agentChanged },
  };
}
