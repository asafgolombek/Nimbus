import type { Database } from "bun:sqlite";
import type { NimbusItem } from "@nimbus-dev/sdk";

import { RAW_META_MAX_BYTES } from "./constants.ts";

export type IndexedItemRow = {
  id: string;
  service: string;
  type: string;
  external_id: string;
  title: string;
  body_preview: string | null;
  url: string | null;
  canonical_url: string | null;
  modified_at: number;
  author_id: string | null;
  metadata: string | null;
  synced_at: number;
  pinned: number;
};

export function itemPrimaryKey(service: string, externalId: string): string {
  const prefix = `${service}:`;
  if (externalId.startsWith(prefix)) {
    return externalId;
  }
  return `${service}:${externalId}`;
}

export function itemExternalIdFromInput(service: string, idOrExternal: string): string {
  const prefix = `${service}:`;
  if (idOrExternal.startsWith(prefix)) {
    return idOrExternal.slice(prefix.length);
  }
  return idOrExternal;
}

function clipPreview(text: string): string {
  return text.length <= 512 ? text : text.slice(0, 512);
}

/**
 * Upsert a unified index row (FTS triggers maintain item_fts).
 */
export function upsertIndexedItem(
  db: Database,
  row: {
    service: string;
    type: string;
    externalId: string;
    title: string;
    bodyPreview?: string;
    url?: string | null;
    canonicalUrl?: string | null;
    modifiedAt: number;
    authorId?: string | null;
    metadata?: Record<string, unknown>;
    pinned?: boolean;
    syncedAt: number;
  },
): void {
  const id = itemPrimaryKey(row.service, row.externalId);
  const meta = JSON.stringify(row.metadata ?? {});
  if (Buffer.byteLength(meta, "utf8") > RAW_META_MAX_BYTES) {
    throw new Error(`metadata for item "${id}" exceeds 64 KB limit`);
  }
  const preview = clipPreview(row.bodyPreview ?? row.title);
  db.run(
    `INSERT INTO item (
      id, service, type, external_id, title, body_preview, url, canonical_url,
      modified_at, author_id, metadata, synced_at, pinned
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      service = excluded.service,
      type = excluded.type,
      external_id = excluded.external_id,
      title = excluded.title,
      body_preview = excluded.body_preview,
      url = excluded.url,
      canonical_url = excluded.canonical_url,
      modified_at = excluded.modified_at,
      author_id = excluded.author_id,
      metadata = excluded.metadata,
      synced_at = excluded.synced_at,
      pinned = excluded.pinned`,
    [
      id,
      row.service,
      row.type,
      row.externalId,
      row.title,
      preview,
      row.url ?? null,
      row.canonicalUrl ?? null,
      row.modifiedAt,
      row.authorId ?? null,
      meta,
      row.syncedAt,
      row.pinned === true ? 1 : 0,
    ],
  );
}

export function upsertNimbusItemIntoItemTable(db: Database, item: NimbusItem, syncedAt: number): void {
  const externalId = itemExternalIdFromInput(item.service, item.id);
  const meta: Record<string, unknown> = { ...(item.rawMeta ?? {}) };
  if (item.mimeType !== undefined) {
    meta["mime_type"] = item.mimeType;
  }
  if (item.sizeBytes !== undefined) {
    meta["size_bytes"] = item.sizeBytes;
  }
  if (item.parentId !== undefined) {
    meta["parent_id"] = item.parentId;
  }
  if (item.createdAt !== undefined) {
    meta["created_at"] = item.createdAt;
  }
  const row = {
    service: item.service,
    type: item.itemType,
    externalId,
    title: item.name,
    bodyPreview: item.name,
    modifiedAt: item.modifiedAt ?? item.createdAt ?? 0,
    metadata: meta,
    syncedAt,
  };
  if (item.url !== undefined) {
    upsertIndexedItem(db, { ...row, url: item.url });
  } else {
    upsertIndexedItem(db, row);
  }
}

export function deleteItemByPrimaryKey(db: Database, primaryKey: string): void {
  db.run("DELETE FROM item WHERE id = ?", [primaryKey]);
}

export function deleteItemByServiceExternal(db: Database, service: string, externalId: string): void {
  db.run("DELETE FROM item WHERE service = ? AND external_id = ?", [service, externalId]);
}

export function deleteAllItemsForService(db: Database, service: string): void {
  db.run("DELETE FROM item WHERE service = ?", [service]);
}
