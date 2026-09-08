/**
 * The accepted-advisory registry: every npm advisory `bun audit` reports that
 * this repository has deliberately decided NOT to fix, with the reason and a
 * date by which the decision must be re-made.
 *
 * This is the JS-side mirror of the `[advisories].ignore` list in
 * `packages/ui/src-tauri/deny.toml` — same contract, same culture: an advisory
 * is either fixed or it is written down here. A row is not permission to stop
 * looking; `audit:advisories` fails once `recheckBy` passes, and fails again if
 * the row is still here after the advisory has cleared (retire = delete the row,
 * never leave drift).
 *
 * Adding a row is a last resort. The order of preference is:
 *   1. Upgrade. Root `overrides` in package.json is this repo's mechanism.
 *   2. Prove the vulnerable code path unreachable AND record that proof here.
 *   3. Only then, accept — with a named unblocking condition.
 *
 * `docs/security-hardening.md` carries the human narrative; this file is
 * authoritative for anything machine-checkable.
 */

/** npm advisory severities, ordered low -> critical by `severityRank`. */
export type AdvisorySeverity = "info" | "low" | "moderate" | "high" | "critical";

export interface AcceptedAdvisory {
  /**
   * The GHSA id, matched against the advisory URL `bun audit --json` reports.
   * For a non-GHSA advisory this is the full URL instead.
   */
  readonly ghsa: string;
  /** npm package name, exactly as `bun audit` keys it. */
  readonly package: string;
  /**
   * Severity at the time of acceptance. If the advisory is later re-scored
   * ABOVE this, the gate fails: the decision was made against the old score.
   */
  readonly severity: AdvisorySeverity;
  /** Why no upgrade resolves it — the state of the published version graph. */
  readonly noFixReason: string;
  /** Why the vulnerable code path cannot be reached, or what bounds the impact. */
  readonly reachability: string;
  /** The concrete event that would let this row be deleted. */
  readonly unblockedBy: string;
  /** ISO date (YYYY-MM-DD) the decision was made. */
  readonly acceptedOn: string;
  /** ISO date (YYYY-MM-DD) after which the gate fails until the row is re-judged. */
  readonly recheckBy: string;
  readonly owner: string;
}

/**
 * The longest an advisory may be accepted without being re-judged. One quarter,
 * matching `MANUAL_AUDIT_MAX_AGE_DAYS` in `scripts/release/credential-registry.ts`
 * so the two hygiene cadences cannot drift apart.
 */
export const MAX_ACCEPTANCE_DAYS = 92;

export const ACCEPTED_ADVISORIES: readonly AcceptedAdvisory[] = [
  // EMPTY, and that is the correct state — not a placeholder.
  //
  // The only row this registry ever held was `@ai-sdk/provider-utils`
  // (GHSA-866g-f22w-33x8), accepted 2026-07-29 because @mastra/core reached it through an npm
  // ALIAS (`"@ai-sdk/provider-utils-v5": "npm:@ai-sdk/provider-utils@3.0.25"`) that root
  // `overrides` provably could not retarget. Its own `unblockedBy` named the exit condition:
  // "@mastra/core … publishes a release whose `@ai-sdk/provider-utils-v5` alias resolves outside
  // `<=3.0.97`".
  //
  // @mastra/core 1.64.0 met it. Checked on the substance the row demanded rather than on the
  // version number it warned against trusting: the v5 alias is GONE from bun.lock entirely, the
  // resolved copies are 4.0.40 and 5.0.13, and `bun audit` reports no vulnerabilities. The row was
  // deleted rather than left to rot, per the retire rule — a stale acceptance is drift, and
  // `audit:advisories` fails on exactly that.
];
