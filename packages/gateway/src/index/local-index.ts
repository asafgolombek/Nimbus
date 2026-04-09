import type { Database } from "bun:sqlite";
import type { NimbusItem } from "@nimbus-dev/sdk";

import { SCHEDULER_V2_MIGRATION_SQL } from "./scheduler-schema-sql.ts";
import { INITIAL_SCHEMA_SQL } from "./schema-sql.ts";

export const RAW_META_MAX_BYTES = 65_536;

export type AuditEntry = {
  id: number;
  actionType: string;
  hitlStatus: "approved" | "rejected" | "not_required";
  actionJson: string;
  timestamp: number;
};

export type IndexSearchQuery = {
  service?: string;
  itemType?: string;
  name?: string;
  limit?: number;
};

/** Row shape from `SELECT i.* FROM items i` */
type ItemRow = {
  id: string;
  service: string;
  item_type: string;
  name: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: number | null;
  modified_at: number | null;
  url: string | null;
  parent_id: string | null;
  raw_meta: string | null;
};

function ftsNameMatchQuery(name: string): string {
  const tokens = name
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) {
    return "";
  }
  return tokens
    .map((t) => {
      const escaped = t.replaceAll('"', '""');
      return `name : "${escaped}"*`;
    })
    .join(" AND ");
}

function rowToItem(row: ItemRow): NimbusItem {
  const item: NimbusItem = {
    id: String(row.id),
    service: String(row.service),
    itemType: String(row.item_type),
    name: String(row.name),
  };
  if (row.mime_type != null) {
    item.mimeType = String(row.mime_type);
  }
  if (row.size_bytes != null) {
    item.sizeBytes = Number(row.size_bytes);
  }
  if (row.created_at != null) {
    item.createdAt = Number(row.created_at);
  }
  if (row.modified_at != null) {
    item.modifiedAt = Number(row.modified_at);
  }
  if (row.url != null) {
    item.url = String(row.url);
  }
  if (row.parent_id != null) {
    item.parentId = String(row.parent_id);
  }
  if (row.raw_meta != null && row.raw_meta !== "") {
    try {
      const parsed: unknown = JSON.parse(String(row.raw_meta));
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        item.rawMeta = parsed as Record<string, unknown>;
      }
    } catch {
      /* leave rawMeta unset */
    }
  }
  return item;
}

function readUserVersion(db: Database): number {
  const row = db.query("PRAGMA user_version").get() as { user_version: number } | null | undefined;
  const v = row?.user_version;
  return typeof v === "number" ? v : 0;
}

export class LocalIndex {
  static readonly SCHEMA_VERSION = 2;

  /**
   * Applies bundled migrations when `user_version` is below `SCHEMA_VERSION`.
   */
  static ensureSchema(db: Database): void {
    let ver = readUserVersion(db);
    if (ver >= LocalIndex.SCHEMA_VERSION) {
      return;
    }
    if (ver === 0) {
      db.exec(INITIAL_SCHEMA_SQL);
      ver = 1;
      db.exec("PRAGMA user_version = 1");
    }
    if (ver === 1) {
      db.exec(SCHEDULER_V2_MIGRATION_SQL);
      ver = 2;
      db.exec("PRAGMA user_version = 2");
    }
    if (ver !== LocalIndex.SCHEMA_VERSION) {
      throw new Error(
        `Unsupported local index schema version: ${String(ver)} (expected 0, 1, or ${String(LocalIndex.SCHEMA_VERSION)})`,
      );
    }
  }

  constructor(private readonly db: Database) {}

  upsert(item: NimbusItem): void {
    const meta = JSON.stringify(item.rawMeta ?? {});
    if (Buffer.byteLength(meta, "utf8") > RAW_META_MAX_BYTES) {
      throw new Error(`raw_meta for item "${item.id}" exceeds 64 KB limit`);
    }
    this.db.run(
      `INSERT INTO items (
        id, service, item_type, name, mime_type, size_bytes, created_at, modified_at, url, parent_id, raw_meta
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        service = excluded.service,
        item_type = excluded.item_type,
        name = excluded.name,
        mime_type = excluded.mime_type,
        size_bytes = excluded.size_bytes,
        created_at = excluded.created_at,
        modified_at = excluded.modified_at,
        url = excluded.url,
        parent_id = excluded.parent_id,
        raw_meta = excluded.raw_meta`,
      [
        item.id,
        item.service,
        item.itemType,
        item.name,
        item.mimeType ?? null,
        item.sizeBytes ?? null,
        item.createdAt ?? null,
        item.modifiedAt ?? null,
        item.url ?? null,
        item.parentId ?? null,
        meta,
      ],
    );
  }

  delete(id: string): void {
    this.db.run("DELETE FROM items WHERE id = ?", [id]);
  }

  search(query: IndexSearchQuery): NimbusItem[] {
    const limit = Math.min(500, Math.max(1, query.limit ?? 50));
    const nameQ = query.name?.trim() ?? "";
    const useFts = nameQ.length > 0;
    const fts = useFts ? ftsNameMatchQuery(nameQ) : "";

    if (useFts && fts === "") {
      return [];
    }

    const filters: string[] = [];
    const params: Array<string | number> = [];

    if (query.service !== undefined && query.service !== "") {
      filters.push("i.service = ?");
      params.push(query.service);
    }
    if (query.itemType !== undefined && query.itemType !== "") {
      filters.push("i.item_type = ?");
      params.push(query.itemType);
    }

    const whereExtra = filters.length > 0 ? `AND ${filters.join(" AND ")}` : "";

    if (useFts) {
      const sql = `
        SELECT i.* FROM items i
        INNER JOIN items_fts ON i.rowid = items_fts.rowid
        WHERE items_fts MATCH ? ${whereExtra}
        LIMIT ?
      `;
      params.unshift(fts);
      params.push(limit);
      const rows = this.db.query(sql).all(...params) as ItemRow[];
      return rows.map(rowToItem);
    }

    const sql =
      filters.length > 0
        ? `SELECT i.* FROM items i WHERE ${filters.join(" AND ")} LIMIT ?`
        : `SELECT i.* FROM items i LIMIT ?`;
    params.push(limit);
    const rows = this.db.query(sql).all(...params) as ItemRow[];
    return rows.map(rowToItem);
  }

  recordSync(connectorId: string, token: string): void {
    const now = Date.now();
    this.db.run(
      `INSERT INTO sync_state (connector_id, last_sync_at, next_sync_token)
       VALUES (?, ?, ?)
       ON CONFLICT(connector_id) DO UPDATE SET
         last_sync_at = excluded.last_sync_at,
         next_sync_token = excluded.next_sync_token`,
      [connectorId, now, token],
    );
  }

  getLastSyncToken(connectorId: string): string | null {
    const row = this.db
      .query("SELECT next_sync_token FROM sync_state WHERE connector_id = ?")
      .get(connectorId) as { next_sync_token: string | null } | null | undefined;
    const t = row?.next_sync_token;
    return t == null || t === "" ? null : t;
  }

  recordAudit(entry: {
    actionType: string;
    hitlStatus: AuditEntry["hitlStatus"];
    actionJson: string;
    timestamp: number;
  }): void {
    this.db.run(
      `INSERT INTO audit_log (action_type, hitl_status, action_json, timestamp)
       VALUES (?, ?, ?, ?)`,
      [entry.actionType, entry.hitlStatus, entry.actionJson, entry.timestamp],
    );
  }

  /**
   * Best-effort WAL checkpoint and close the DB (gateway shutdown).
   */
  close(): void {
    try {
      this.db.run("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch {
      /* ignore */
    }
    this.db.close();
  }

  listAudit(limit: number): AuditEntry[] {
    const capped = Math.min(1000, Math.max(1, Math.floor(limit)));
    const rows = this.db
      .query(
        `SELECT id, action_type, hitl_status, action_json, timestamp
         FROM audit_log
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(capped) as Array<{
      id: number;
      action_type: string;
      hitl_status: string;
      action_json: string;
      timestamp: number;
    }>;

    return rows.map((r) => {
      const status = r.hitl_status;
      if (status !== "approved" && status !== "rejected" && status !== "not_required") {
        throw new Error("Corrupt audit_log row: invalid hitl_status");
      }
      return {
        id: r.id,
        actionType: r.action_type,
        hitlStatus: status,
        actionJson: r.action_json,
        timestamp: r.timestamp,
      };
    });
  }
}
