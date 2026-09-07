import { codeUnitCompare } from "../util/code-unit-compare.ts";
import type { BriefSummary, FleetJobDigest, FleetMetricDelta } from "./fleet-digest-types.ts";

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
