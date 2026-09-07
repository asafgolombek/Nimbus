import {
  isCatchupBrief,
  isExpertBrief,
  isGhostBrief,
  isJanitorBrief,
} from "../agents/_lib/findings.ts";
import { codeUnitCompare } from "../util/code-unit-compare.ts";
import type { BriefSummary, FleetDigestExtractor } from "./fleet-digest-types.ts";

/** Sorted once, here, so no caller has to remember to (spec § 8.1). */
function summary(keys: readonly string[], metrics: Record<string, number>): BriefSummary {
  return { keys: [...keys].sort(codeUnitCompare), metrics: Object.freeze({ ...metrics }) };
}

/** Counts occurrences of `band` values under `prefix_<band>` keys. */
function bandCounts(prefix: string, bands: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of bands) out[`${prefix}_${b}`] = (out[`${prefix}_${b}`] ?? 0) + 1;
  return out;
}

const ghost: FleetDigestExtractor = (f) => {
  if (!isGhostBrief(f)) return undefined;
  return summary(
    f.findings.map((x) => x.peerId),
    {
      ghost_peers: f.findings.length,
      context_items: f.findings.reduce((n, x) => n + x.context.length, 0),
      ...bandCounts(
        "rank",
        f.findings.map((x) => x.rank),
      ),
    },
  );
};

const janitor: FleetDigestExtractor = (f) => {
  if (!isJanitorBrief(f)) return undefined;
  const keys = f.peersTouched.map((p) => `peer:${p.peerId}`);
  // Booleans are KEYS: as metrics they are suppressed by any digest_min_delta >= 2 (spec § 4.1).
  if (f.idle) keys.push("idle");
  if (f.proposalSuppressed) keys.push("proposal_suppressed");
  return summary(keys, { peers_clear: f.peersClear, peers_touched: f.peersTouched.length });
};

const catchup: FleetDigestExtractor = (f) => {
  if (!isCatchupBrief(f)) return undefined;
  const keys = f.sections.flatMap((s) => s.items.map((i) => `${s.serviceId}:${i.itemId}`));
  return summary(keys, {
    items_total: keys.length,
    sections: f.sections.length,
    owned_services: f.involvement.ownedServices.length,
    active_repos: f.involvement.activeRepos.length,
    incident_services: f.involvement.incidentServices.length,
    collaborators: f.involvement.collaboratorPersonIds.length,
  });
};

const expert: FleetDigestExtractor = (f) => {
  if (!isExpertBrief(f)) return undefined;
  return summary(
    f.ranked.map((r) => r.personId),
    {
      experts: f.ranked.length,
      evidence_total: f.ranked.reduce((n, r) => n + r.evidence.length, 0),
      ...bandCounts(
        "confidence",
        f.ranked.map((r) => r.confidence),
      ),
    },
  );
};

/** Completed in Tasks 3 and 4; typed as a partial record until then. */
const PARTIAL: Partial<Record<string, FleetDigestExtractor>> = {
  "agents.catchup": catchup,
  "agents.expert": expert,
  "agents.ghost": ghost,
  "agents.janitor": janitor,
};

/**
 * Parse-then-extract. `JSON.parse` failure and shape mismatch are the SAME outcome (`undefined`)
 * because the caller's response to both is identical: disclose the brief as not summarizable
 * rather than drop it (spec § 4.3).
 */
export function summarizeBrief(
  agentMethod: string,
  findingsJson: string,
): BriefSummary | undefined {
  // `Object.hasOwn` BEFORE indexing, never a bare `PARTIAL[agentMethod]`. The method string comes
  // from a database column, and a plain object resolves "constructor" up its prototype chain to
  // `Object` — a truthy "extractor" that returns its argument, so summarizeBrief would hand back a
  // raw parsed brief as if it were a BriefSummary. Same reasoning as `resolveFleetAgentMethod`.
  if (!Object.hasOwn(PARTIAL, agentMethod)) return undefined;
  const extract = PARTIAL[agentMethod];
  if (extract === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(findingsJson);
  } catch {
    return undefined;
  }
  return extract(parsed);
}
