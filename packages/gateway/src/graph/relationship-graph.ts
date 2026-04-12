import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";

const ITEM_LINKED_ENTITY_TYPES = [
  "pr",
  "issue",
  "ci_run",
  "deployment",
  "alert",
  "message",
  "incident",
  "error_issue",
] as const;

export type ItemLinkedEntityType = (typeof ITEM_LINKED_ENTITY_TYPES)[number];

export function isItemLinkedGraphType(t: string): t is ItemLinkedEntityType {
  return (ITEM_LINKED_ENTITY_TYPES as readonly string[]).includes(t);
}

/** Deterministic primary key for `graph_entity` (stable across process restarts). */
export function deterministicGraphEntityId(type: string, externalId: string): string {
  return createHash("sha256").update(`nimbus.graph.v1\0${type}\0${externalId}`).digest("hex");
}

export type GraphEntityRow = {
  id: string;
  type: string;
  external_id: string;
  label: string;
  service: string | null;
  metadata: string | null;
};

export type GraphRelationRow = {
  type: string;
  from_id: string;
  to_id: string;
};

export function upsertGraphEntity(
  db: Database,
  row: {
    type: string;
    externalId: string;
    label: string;
    service?: string | null;
    metadata?: Record<string, unknown> | null;
  },
): string {
  const id = deterministicGraphEntityId(row.type, row.externalId);
  const meta =
    row.metadata === undefined || row.metadata === null ? null : JSON.stringify(row.metadata);
  db.run(
    `INSERT INTO graph_entity (id, type, external_id, label, service, metadata)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (type, external_id) DO UPDATE SET
       label = excluded.label,
       service = excluded.service,
       metadata = excluded.metadata`,
    [id, row.type, row.externalId, row.label, row.service ?? null, meta],
  );
  return id;
}

export function upsertGraphRelation(
  db: Database,
  fromId: string,
  toId: string,
  relationType: string,
  createdAt: number,
  weight = 1.0,
): void {
  db.run(
    `INSERT INTO graph_relation (from_id, to_id, type, weight, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (from_id, to_id, type) DO UPDATE SET
       weight = excluded.weight,
       created_at = excluded.created_at`,
    [fromId, toId, relationType, weight, createdAt],
  );
}

/** Removes the primary index-backed graph node for this item (relations cascade). */
export function deleteGraphEntitiesForItemKeys(db: Database, itemPrimaryKeys: string[]): void {
  if (itemPrimaryKeys.length === 0) {
    return;
  }
  const placeholders = itemPrimaryKeys.map(() => "?").join(",");
  const types = [...ITEM_LINKED_ENTITY_TYPES];
  const typePlaceholders = types.map(() => "?").join(",");
  db.run(
    `DELETE FROM graph_entity
     WHERE external_id IN (${placeholders})
       AND type IN (${typePlaceholders})`,
    [...itemPrimaryKeys, ...types],
  );
}

function resolveStartEntityId(db: Database, startRef: string): string | null {
  const byPk = db.query("SELECT id FROM graph_entity WHERE id = ?").get(startRef) as
    | { id: string }
    | null
    | undefined;
  if (byPk?.id !== undefined) {
    return byPk.id;
  }
  const byExt = db
    .query(`SELECT id FROM graph_entity WHERE external_id = ? ORDER BY type LIMIT 1`)
    .get(startRef) as { id: string } | null | undefined;
  return byExt?.id ?? null;
}

export type TraverseGraphOptions = {
  relationTypes?: string[];
  depth?: number;
  maxNodes?: number;
};

export type TraverseGraphResult = {
  startEntityId: string;
  entities: GraphEntityRow[];
  relations: GraphRelationRow[];
};

/**
 * BFS expansion over the relationship graph (both directions along edges).
 */
export function traverseGraph(
  db: Database,
  startRef: string,
  opts?: TraverseGraphOptions,
): TraverseGraphResult | { error: string } {
  const maxDepth = opts?.depth === undefined ? 2 : Math.min(8, Math.max(0, opts.depth));
  const maxNodes = opts?.maxNodes === undefined ? 200 : Math.min(500, Math.max(1, opts.maxNodes));
  const typeFilter = opts?.relationTypes?.filter((t) => t.trim() !== "") ?? null;

  const startId = resolveStartEntityId(db, startRef);
  if (startId === null) {
    return { error: `No graph entity found for ref: ${startRef}` };
  }

  const visitedEntityIds = new Set<string>([startId]);
  const frontier: Array<{ id: string; d: number }> = [{ id: startId, d: 0 }];
  const relationsOut: GraphRelationRow[] = [];
  const relationKey = (r: GraphRelationRow) => `${r.from_id}|${r.type}|${r.to_id}`;

  while (frontier.length > 0) {
    const cur = frontier.shift();
    if (cur === undefined) {
      break;
    }
    if (cur.d >= maxDepth) {
      continue;
    }

    let relSql = `SELECT type, from_id, to_id FROM graph_relation WHERE from_id = ? OR to_id = ?`;
    const relParams: Array<string | number> = [cur.id, cur.id];
    if (typeFilter !== null && typeFilter.length > 0) {
      const ph = typeFilter.map(() => "?").join(",");
      relSql += ` AND type IN (${ph})`;
      relParams.push(...typeFilter);
    }

    const rels = db.query(relSql).all(...relParams) as GraphRelationRow[];
    for (const r of rels) {
      const key = relationKey(r);
      if (!relationsOut.some((x) => relationKey(x) === key)) {
        relationsOut.push(r);
      }
      const neighbor = r.from_id === cur.id ? r.to_id : r.from_id;
      if (!visitedEntityIds.has(neighbor)) {
        if (visitedEntityIds.size >= maxNodes) {
          continue;
        }
        visitedEntityIds.add(neighbor);
        frontier.push({ id: neighbor, d: cur.d + 1 });
      }
    }
  }

  const idList = [...visitedEntityIds];
  const placeholders = idList.map(() => "?").join(",");
  const entities = db
    .query(
      `SELECT id, type, external_id, label, service, metadata FROM graph_entity WHERE id IN (${placeholders})`,
    )
    .all(...idList) as GraphEntityRow[];

  return {
    startEntityId: startId,
    entities,
    relations: relationsOut,
  };
}
