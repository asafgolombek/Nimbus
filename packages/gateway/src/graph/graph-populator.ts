import type { Database } from "bun:sqlite";

import { readIndexedUserVersion } from "../index/migrations/runner.ts";
import { isItemLinkedGraphType, upsertGraphEntity, upsertGraphRelation } from "./relationship-graph.ts";

export type IndexedItemGraphInput = {
  id: string;
  service: string;
  type: string;
  title: string;
  authorId: string | null;
  metadata: Record<string, unknown>;
};

function stringField(meta: Record<string, unknown>, key: string): string | undefined {
  const v = meta[key];
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

function repoPathFromMetadata(meta: Record<string, unknown>): string | undefined {
  return stringField(meta, "repo") ?? stringField(meta, "project");
}

function clearRelationsTouchingEntity(db: Database, entityId: string): void {
  db.run("DELETE FROM graph_relation WHERE from_id = ? OR to_id = ?", [entityId, entityId]);
}

function personDisplayName(db: Database, personId: string): string | null {
  const row = db.query("SELECT display_name FROM person WHERE id = ?").get(personId) as
    | { display_name: string | null }
    | null
    | undefined;
  if (row?.display_name !== undefined && row.display_name !== null && row.display_name.trim() !== "") {
    return row.display_name.trim();
  }
  return null;
}

/**
 * Maintains `graph_entity` / `graph_relation` from a unified index row (schema v7+).
 */
export function syncGraphFromIndexedItem(db: Database, row: IndexedItemGraphInput): void {
  if (readIndexedUserVersion(db) < 7) {
    return;
  }
  if (!isItemLinkedGraphType(row.type)) {
    return;
  }

  const now = Date.now();

  if (row.type === "pr") {
    const repoFull = repoPathFromMetadata(row.metadata);
    const prEntityId = upsertGraphEntity(db, {
      type: "pr",
      externalId: row.id,
      label: row.title,
      service: row.service,
      metadata: { repo: repoFull },
    });
    clearRelationsTouchingEntity(db, prEntityId);

    if (repoFull !== undefined) {
      const repoExt = `${row.service}:${repoFull}`;
      const repoId = upsertGraphEntity(db, {
        type: "repo",
        externalId: repoExt,
        label: repoFull,
        service: row.service,
      });
      upsertGraphRelation(db, prEntityId, repoId, "targets", now);
    }

    if (row.authorId !== null && row.authorId !== "") {
      const label = personDisplayName(db, row.authorId) ?? stringField(row.metadata, "user") ?? row.authorId;
      const personEntityId = upsertGraphEntity(db, {
        type: "person",
        externalId: row.authorId,
        label,
        service: row.service,
      });
      upsertGraphRelation(db, personEntityId, prEntityId, "authored", now);
    }
    return;
  }

  if (row.type === "issue") {
    const repoFull = repoPathFromMetadata(row.metadata);
    const issueEntityId = upsertGraphEntity(db, {
      type: "issue",
      externalId: row.id,
      label: row.title,
      service: row.service,
      metadata: { repo: repoFull },
    });
    clearRelationsTouchingEntity(db, issueEntityId);

    if (repoFull !== undefined) {
      const repoExt = `${row.service}:${repoFull}`;
      const repoId = upsertGraphEntity(db, {
        type: "repo",
        externalId: repoExt,
        label: repoFull,
        service: row.service,
      });
      upsertGraphRelation(db, issueEntityId, repoId, "belongs_to", now);
    }

    if (row.authorId !== null && row.authorId !== "") {
      const label = personDisplayName(db, row.authorId) ?? stringField(row.metadata, "user") ?? row.authorId;
      const personEntityId = upsertGraphEntity(db, {
        type: "person",
        externalId: row.authorId,
        label,
        service: row.service,
      });
      upsertGraphRelation(db, personEntityId, issueEntityId, "opened", now);
    }
    return;
  }

  if (row.type === "message") {
    const msgEntityId = upsertGraphEntity(db, {
      type: "message",
      externalId: row.id,
      label: row.title,
      service: row.service,
      metadata: {},
    });
    clearRelationsTouchingEntity(db, msgEntityId);

    if (row.authorId !== null && row.authorId !== "") {
      const label = personDisplayName(db, row.authorId) ?? stringField(row.metadata, "user") ?? row.authorId;
      const personEntityId = upsertGraphEntity(db, {
        type: "person",
        externalId: row.authorId,
        label,
        service: row.service,
      });
      upsertGraphRelation(db, personEntityId, msgEntityId, "posted", now);
    }

    const channel = stringField(row.metadata, "channel");
    if (channel !== undefined) {
      const chExt = `${row.service}:${channel}`;
      const chId = upsertGraphEntity(db, {
        type: "channel",
        externalId: chExt,
        label: channel,
        service: row.service,
      });
      upsertGraphRelation(db, msgEntityId, chId, "belongs_to", now);
    }
  }
}
