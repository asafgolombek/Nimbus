/**
 * Phase 4 Section 2 — Graph-aware watcher predicates.
 *
 * Predicate JSON shape (stored in `watcher.graph_predicate_json`):
 *
 *   {
 *     "relation": "owned_by" | "upstream_of" | "downstream_of",
 *     "target":   { "type": string, "externalId": string }
 *   }
 *
 * Logical relation kinds map onto sets of concrete `graph_relation.type`
 * values emitted by `graph-populator.ts`:
 *
 *   owned_by       ← target PERSON → item via  authored | opened | posted
 *   upstream_of    ← item → target  via  any outgoing edge (belongs_to, targets, in_repo, defined_in, depends_on)
 *   downstream_of  ← target → item  via  any outgoing edge (same set, direction reversed)
 *
 * Predicate evaluation is a *filter*: a candidate item matches the watcher
 * iff its `graph_entity` row (resolved via `deterministicGraphEntityId`) has
 * a direct graph-edge to the target entity in the logical direction.
 */

import type { Database } from "bun:sqlite";
import { deterministicGraphEntityId, traverseGraph } from "../graph/relationship-graph.ts";

export const GRAPH_RELATION_KINDS = ["owned_by", "upstream_of", "downstream_of"] as const;
export type GraphRelationKind = (typeof GRAPH_RELATION_KINDS)[number];

export type GraphTarget = {
  type: string;
  externalId: string;
};

export type GraphPredicate = {
  relation: GraphRelationKind;
  target: GraphTarget;
};

export type ParseGraphPredicateResult =
  | { ok: true; predicate: GraphPredicate }
  | { ok: false; error: string };

const OWNED_BY_UNDERLYING = ["authored", "opened", "posted"] as const;
const UPSTREAM_UNDERLYING = [
  "belongs_to",
  "targets",
  "in_repo",
  "defined_in",
  "depends_on",
] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isGraphRelationKind(v: unknown): v is GraphRelationKind {
  return typeof v === "string" && (GRAPH_RELATION_KINDS as readonly string[]).includes(v);
}

function validateTarget(raw: unknown): GraphTarget | string {
  if (!isRecord(raw)) {
    return "target must be an object";
  }
  const type = raw["type"];
  if (typeof type !== "string" || type.trim() === "") {
    return "target.type must be a non-empty string";
  }
  const externalId = raw["externalId"];
  if (typeof externalId !== "string" || externalId.trim() === "") {
    return "target.externalId must be a non-empty string";
  }
  return { type: type.trim(), externalId: externalId.trim() };
}

export function parseGraphPredicate(json: string): ParseGraphPredicateResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: "graph_predicate_json is not valid JSON" };
  }
  if (!isRecord(parsed)) {
    return { ok: false, error: "graph_predicate_json must be a JSON object" };
  }
  const relation = parsed["relation"];
  if (!isGraphRelationKind(relation)) {
    return {
      ok: false,
      error: `relation must be one of ${GRAPH_RELATION_KINDS.join(", ")}`,
    };
  }
  const targetResult = validateTarget(parsed["target"]);
  if (typeof targetResult === "string") {
    return { ok: false, error: targetResult };
  }
  return { ok: true, predicate: { relation, target: targetResult } };
}

export type CandidateRelation = {
  relation: GraphRelationKind;
  description: string;
  underlyingRelationTypes: readonly string[];
};

export function listCandidateGraphRelations(): readonly CandidateRelation[] {
  return [
    {
      relation: "owned_by",
      description: "Item was authored, opened, or posted by the target person.",
      underlyingRelationTypes: OWNED_BY_UNDERLYING,
    },
    {
      relation: "upstream_of",
      description: "Item has a direct outgoing edge to the target entity.",
      underlyingRelationTypes: UPSTREAM_UNDERLYING,
    },
    {
      relation: "downstream_of",
      description: "Target entity has a direct outgoing edge to the item.",
      underlyingRelationTypes: UPSTREAM_UNDERLYING,
    },
  ];
}

export type ItemMatchContext = {
  db: Database;
  itemEntityType: string;
  itemExternalId: string;
  predicate: GraphPredicate;
};

/**
 * Returns `true` iff the item referenced by (`itemEntityType`, `itemExternalId`)
 * has a **direct graph edge** (depth 1) to the predicate's target in the
 * direction implied by `predicate.relation`.
 */
export function itemMatchesGraphPredicate(ctx: ItemMatchContext): boolean {
  const { db, itemEntityType, itemExternalId, predicate } = ctx;
  const itemEntityId = deterministicGraphEntityId(itemEntityType, itemExternalId);
  const targetEntityId = deterministicGraphEntityId(
    predicate.target.type,
    predicate.target.externalId,
  );

  // Spec asks us to reuse `traverseGraph` — depth=1 gives us the direct edges
  // around the item. We then inspect the relation list for an edge to the
  // target in the correct direction and relation-type set.
  const ownedBy: readonly string[] = OWNED_BY_UNDERLYING;
  const upstream: readonly string[] = UPSTREAM_UNDERLYING;
  const typeFilter: readonly string[] = predicate.relation === "owned_by" ? ownedBy : upstream;
  const traversal = traverseGraph(db, itemEntityId, {
    depth: 1,
    relationTypes: [...typeFilter],
  });
  if ("error" in traversal) {
    return false;
  }

  for (const rel of traversal.relations) {
    if (predicate.relation === "owned_by") {
      // person → item edge
      if (rel.from_id === targetEntityId && rel.to_id === itemEntityId) {
        return true;
      }
    } else if (predicate.relation === "upstream_of") {
      // item → target edge
      if (rel.from_id === itemEntityId && rel.to_id === targetEntityId) {
        return true;
      }
    } else {
      // downstream_of: target → item edge
      if (rel.from_id === targetEntityId && rel.to_id === itemEntityId) {
        return true;
      }
    }
  }
  return false;
}

export type ValidateCountContext = {
  db: Database;
  predicate: GraphPredicate;
  /** `item.modified_at` lower bound (exclusive). Prevents unbounded scans. */
  sinceMs: number;
  /** Hard cap on scanned candidate items. Default 5_000. */
  maxScan?: number;
};

/**
 * Read-only preview count used by `watcher.validateCondition`. Scans at most
 * `maxScan` recent items and returns how many satisfy the predicate. Does
 * NOT leak item content or secrets — caller only sees the count.
 */
export function countItemsMatchingGraphPredicate(ctx: ValidateCountContext): number {
  const { db, predicate, sinceMs } = ctx;
  const maxScan = ctx.maxScan ?? 5_000;
  const candidates = db
    .query(
      `SELECT id, service, type, external_id FROM item
       WHERE modified_at > ?
       ORDER BY modified_at DESC
       LIMIT ?`,
    )
    .all(sinceMs, maxScan) as Array<{
    id: string;
    service: string;
    type: string;
    external_id: string;
  }>;
  let count = 0;
  for (const row of candidates) {
    if (
      itemMatchesGraphPredicate({
        db,
        itemEntityType: row.type,
        itemExternalId: row.external_id,
        predicate,
      })
    ) {
      count += 1;
    }
  }
  return count;
}
