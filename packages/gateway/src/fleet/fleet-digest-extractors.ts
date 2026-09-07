import {
  isCatchupBrief,
  isConflictBrief,
  isExpertBrief,
  isGhostBrief,
  isHuddleBrief,
  isImpactBrief,
  isJanitorBrief,
  isWhyBrief,
} from "../agents/_lib/findings.ts";
import { codeUnitCompare } from "../util/code-unit-compare.ts";
import type {
  BriefSummary,
  EligibleAgentMethod,
  FleetDigestExtractor,
} from "./fleet-digest-types.ts";

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

const conflicts: FleetDigestExtractor = (f) => {
  if (!isConflictBrief(f)) return undefined;
  // FederatedItemLite carries no id, so the key composes the fields that identify WHICH item.
  // Retitling therefore reads as a resolve plus an appear — the same accepted bound as `huddle`
  // and `why` (spec § 4.4).
  return summary(
    f.collisions.map((c) => `${c.peerId}:${c.collisionType}:${c.service}:${c.title}`),
    {
      collisions_total: f.collisions.length,
      ...bandCounts(
        "type",
        f.collisions.map((c) => c.collisionType),
      ),
    },
  );
};

const huddle: FleetDigestExtractor = (f) => {
  if (!isHuddleBrief(f)) return undefined;
  // FederatedItemLite carries no id, so the key composes the fields that identify WHICH item.
  // Retitling therefore reads as a resolve plus an appear — the stated bound of spec § 4.4.
  const keys: string[] = [];
  let prs = 0;
  let tickets = 0;
  let incidents = 0;
  for (const c of f.contributions) {
    for (const [kind, items] of [
      ["pr", c.prs],
      ["ticket", c.tickets],
      ["incident", c.incidents],
    ] as const) {
      for (const i of items) keys.push(`${c.peerId}:${kind}:${i.service}:${i.title}`);
    }
    prs += c.prs.length;
    tickets += c.tickets.length;
    incidents += c.incidents.length;
  }
  return summary(keys, { peers: f.contributions.length, prs, tickets, incidents });
};

const impact: FleetDigestExtractor = (f) => {
  if (!isImpactBrief(f)) return undefined;
  return summary(
    f.affected.map((a) => `${a.category}:${a.affectedItemId}`),
    {
      affected_total: f.affected.length,
      ...bandCounts(
        "category",
        f.affected.map((a) => a.category),
      ),
    },
  );
};

const why: FleetDigestExtractor = (f) => {
  if (!isWhyBrief(f)) return undefined;
  // `lane:title`, NOT `entityId`: that field is `string | null`, so a key built on it changes the
  // moment an id arrives — the same phantom churn with an extra failure mode (spec § 4.4).
  return summary(
    f.findings.map((x) => `${x.lane}:${x.title}`),
    {
      findings_total: f.findings.length,
      ...bandCounts(
        "lane",
        f.findings.map((x) => x.lane),
      ),
    },
  );
};

function rec(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function numAt(o: Record<string, unknown>, k: string): number | undefined {
  const v = o[k];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Every listed key must be a finite number, else `undefined`. Narrow BY DESIGN: a full-shape
 * validator for a type that already typechecks elsewhere is a second definition free to drift.
 *
 * GENERIC over the key list so the result is `Record<K, number>` and not
 * `Record<string, number>`. Under this repo's `noUncheckedIndexedAccess` the latter would type
 * every read as `number | undefined` and force a cast at each of the twelve call sites below —
 * casts that would each be a place the guard above silently stops meaning anything.
 */
function numbers<K extends string>(
  o: Record<string, unknown>,
  keys: readonly K[],
): Record<K, number> | undefined {
  const out = {} as Record<K, number>;
  for (const k of keys) {
    const n = numAt(o, k);
    if (n === undefined) return undefined;
    out[k] = n;
  }
  return out;
}

function stringsAt(v: unknown, field: string): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const e of v) {
    const o = rec(e);
    const s = o?.[field];
    if (typeof s !== "string") return undefined;
    out.push(s);
  }
  return out;
}

const glossary: FleetDigestExtractor = (f) => {
  const o = rec(f);
  if (o === undefined || o["kind"] !== "glossary") return undefined;
  const terms = stringsAt(o["entries"], "term");
  const stats = rec(o["stats"]);
  if (terms === undefined || stats === undefined) return undefined;
  const n = numbers(stats, ["total", "pending", "vetoed", "manual"]);
  if (n === undefined) return undefined;
  return summary(terms, { ...n, entries_listed: terms.length });
};

const decisions: FleetDigestExtractor = (f) => {
  const o = rec(f);
  if (o === undefined || o["kind"] !== "decisions") return undefined;
  const ids = stringsAt(o["entries"], "id");
  const stats = rec(o["stats"]);
  if (ids === undefined || stats === undefined) return undefined;
  const n = numbers(stats, ["total", "pending", "extracted", "vetoed", "truncatedSources"]);
  if (n === undefined) return undefined;
  return summary(ids, {
    total: n.total,
    pending: n.pending,
    extracted: n.extracted,
    vetoed: n.vetoed,
    truncated_sources: n.truncatedSources,
    entries_listed: ids.length,
  });
};

const ownership: FleetDigestExtractor = (f) => {
  const o = rec(f);
  if (o === undefined || o["kind"] !== "ownership") return undefined;
  const coverage = rec(o["coverage"]);
  if (coverage === undefined) return undefined;
  const n = numbers(coverage, [
    "rootsTotal",
    "rootsCovered",
    "filesCovered",
    "filesExcluded",
    "servicesBound",
    "ownersEmitted",
    "entitiesReaped",
  ]);
  if (n === undefined) return undefined;
  // `target` is legitimately null in coverage mode — an EMPTY key set, not a failure.
  const target = rec(o["target"]);
  const owners = target === undefined ? [] : stringsAt(target["owners"], "externalId");
  if (owners === undefined) return undefined;
  return summary(owners, {
    roots_total: n.rootsTotal,
    roots_covered: n.rootsCovered,
    files_covered: n.filesCovered,
    files_excluded: n.filesExcluded,
    services_bound: n.servicesBound,
    owners_emitted: n.ownersEmitted,
    entities_reaped: n.entitiesReaped,
  });
};

/**
 * TOTAL over `EligibleAgentMethod`. Flipping an agent to `"eligible"` in `FLEET_ELIGIBILITY`
 * fails THIS declaration to compile until its extractor is written (spec § 4.2).
 */
export const FLEET_DIGEST_EXTRACTORS = {
  "agents.catchup": catchup,
  "agents.conflicts": conflicts,
  "agents.decisions": decisions,
  "agents.expert": expert,
  "agents.ghost": ghost,
  "agents.glossary": glossary,
  "agents.huddle": huddle,
  "agents.impact": impact,
  "agents.janitor": janitor,
  "agents.ownership": ownership,
  "agents.why": why,
} satisfies Readonly<Record<EligibleAgentMethod, FleetDigestExtractor>>;

/**
 * Parse-then-extract. `JSON.parse` failure and shape mismatch are the SAME outcome (`undefined`)
 * because the caller's response to both is identical: disclose the brief as not summarizable
 * rather than drop it (spec § 4.3).
 */
export function summarizeBrief(
  agentMethod: string,
  findingsJson: string,
): BriefSummary | undefined {
  // `Object.hasOwn` BEFORE indexing, never a bare `FLEET_DIGEST_EXTRACTORS[agentMethod]`. The
  // method string comes from a database column, and a plain object resolves "constructor" up its
  // prototype chain to `Object` — a truthy "extractor" that returns its argument, so
  // summarizeBrief would hand back a raw parsed brief as if it were a BriefSummary. Same
  // reasoning as `resolveFleetAgentMethod`.
  if (!Object.hasOwn(FLEET_DIGEST_EXTRACTORS, agentMethod)) return undefined;
  // The `hasOwn` check above IS the narrowing; TypeScript cannot see it through a plain `string`
  // index the way it would a template literal. Same idiom as `resolveFleetAgentMethod`.
  const extract = FLEET_DIGEST_EXTRACTORS[agentMethod as EligibleAgentMethod];
  let parsed: unknown;
  try {
    parsed = JSON.parse(findingsJson);
  } catch {
    return undefined;
  }
  try {
    return extract(parsed);
  } catch {
    // The SDK guards validate the OUTER shape only: `isGhostBrief` accepts a brief whose
    // `findings` is an array without checking the items, so a legacy-shaped row whose finding
    // lacks `context` passes the guard and then throws inside the extractor. Verified by probe.
    //
    // A throw here would escape `buildFleetDigest` and take down the whole digest over one bad
    // row — the opposite of the design, which is to DISCLOSE that one brief as not summarizable.
    // Stated tradeoff, accepted deliberately: this also catches genuine bugs in extractor logic
    // and reports them as unreadable data. That is the right trade because the alternative is an
    // unattended crash, and because the `Not compared` section makes the outcome visible rather
    // than silent. Per-item narrowing in all eleven extractors would be the other route; it is
    // eleven times the surface and one forgotten field reopens the hole.
    return undefined;
  }
}
