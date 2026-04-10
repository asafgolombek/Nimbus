import type { Database } from "bun:sqlite";
import type { NimbusItem } from "@nimbus-dev/sdk";

import {
  clearSchedulerCursor,
  countItemsForService,
  deleteSchedulerStateRow,
  listAllSchedulerStates,
  loadSchedulerState,
  type SchedulerStateRow,
  setPaused,
  upsertSchedulerRegistration,
} from "../sync/scheduler-store.ts";
import type { SyncStatus } from "../sync/types.ts";
import {
  deleteAllItemsForService,
  deleteItemByPrimaryKey,
  upsertNimbusItemIntoItemTable,
} from "./item-store.ts";
import { prunePeopleAfterServiceRemoval } from "../people/prune.ts";
import { runIndexedSchemaMigrations } from "./migrations/runner.ts";

export { RAW_META_MAX_BYTES } from "./constants.ts";

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

/** Row shape from `SELECT i.* FROM item i` */
type ItemRow = {
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

function itemTypeFromRowType(raw: string): NimbusItem["itemType"] {
  if (
    raw === "file" ||
    raw === "folder" ||
    raw === "email" ||
    raw === "event" ||
    raw === "photo" ||
    raw === "task"
  ) {
    return raw;
  }
  return "file";
}

function ftsTitleMatchQuery(name: string): string {
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
      return `(title : "${escaped}"* OR body_preview : "${escaped}"*)`;
    })
    .join(" AND ");
}

function applyItemMetadataColumn(item: NimbusItem, metadata: string): void {
  try {
    const parsed: unknown = JSON.parse(metadata);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return;
    }
    const rec = parsed as Record<string, unknown>;
    item.rawMeta = { ...rec };
    const mt = rec["mime_type"];
    if (typeof mt === "string") {
      item.mimeType = mt;
    }
    const sb = rec["size_bytes"];
    if (typeof sb === "number" && Number.isFinite(sb)) {
      item.sizeBytes = sb;
    }
    const pid = rec["parent_id"];
    if (typeof pid === "string") {
      item.parentId = pid;
    }
    const ca = rec["created_at"];
    if (typeof ca === "number" && Number.isFinite(ca)) {
      item.createdAt = ca;
    }
    delete item.rawMeta["mime_type"];
    delete item.rawMeta["size_bytes"];
    delete item.rawMeta["parent_id"];
    delete item.rawMeta["created_at"];
    delete item.rawMeta["legacy_raw_meta"];
    if (Object.keys(item.rawMeta).length === 0) {
      delete item.rawMeta;
    }
  } catch {
    /* leave rawMeta unset */
  }
}

function rowToItem(row: ItemRow): NimbusItem {
  const item: NimbusItem = {
    id: String(row.external_id),
    service: String(row.service),
    itemType: itemTypeFromRowType(String(row.type)),
    name: String(row.title),
  };
  item.modifiedAt = Number(row.modified_at);
  if (row.url != null && row.url !== "") {
    item.url = String(row.url);
  }
  if (row.metadata != null && row.metadata !== "") {
    applyItemMetadataColumn(item, String(row.metadata));
  }
  return item;
}

export class LocalIndex {
  static readonly SCHEMA_VERSION = 4;

  /**
   * Applies bundled migrations when `user_version` is below `SCHEMA_VERSION`.
   */
  static ensureSchema(db: Database): void {
    runIndexedSchemaMigrations(db, LocalIndex.SCHEMA_VERSION);
  }

  constructor(private readonly db: Database) {}

  /** Gateway IPC only — OAuth retention checks after connector removal. */
  getDatabase(): Database {
    return this.db;
  }

  private static rowToPersistedSyncStatus(db: Database, row: SchedulerStateRow): SyncStatus {
    let status: SyncStatus["status"] = "ok";
    if (row.paused === 1) {
      status = "paused";
    } else if (row.status === "error") {
      status = "error";
    } else if (row.status === "backoff") {
      status = "backoff";
    }
    return {
      serviceId: row.service_id,
      status,
      lastSyncAt: row.last_sync_at,
      nextSyncAt: row.next_sync_at,
      intervalMs: row.interval_ms,
      itemCount: countItemsForService(db, row.service_id),
      lastError: row.error_msg,
      consecutiveFailures: row.consecutive_failures,
    };
  }

  /**
   * Sync rows persisted in `scheduler_state` (no in-process "syncing" flag — use {@link SyncScheduler#getStatus} when wired).
   */
  persistedConnectorStatuses(serviceIdFilter?: string): SyncStatus[] {
    if (serviceIdFilter !== undefined && serviceIdFilter !== "") {
      const row = loadSchedulerState(this.db, serviceIdFilter);
      if (row === null) {
        return [];
      }
      return [LocalIndex.rowToPersistedSyncStatus(this.db, row)];
    }
    const rows = listAllSchedulerStates(this.db);
    return rows.map((r) => LocalIndex.rowToPersistedSyncStatus(this.db, r));
  }

  ensureConnectorSchedulerRegistration(serviceId: string, intervalMs: number, now: number): void {
    upsertSchedulerRegistration(this.db, serviceId, intervalMs, now, false);
  }

  pauseConnectorSync(serviceId: string): void {
    if (loadSchedulerState(this.db, serviceId) === null) {
      throw new Error(`Unknown connector: ${serviceId}`);
    }
    setPaused(this.db, serviceId, true);
  }

  resumeConnectorSync(serviceId: string): void {
    if (loadSchedulerState(this.db, serviceId) === null) {
      throw new Error(`Unknown connector: ${serviceId}`);
    }
    setPaused(this.db, serviceId, false);
  }

  setConnectorSyncIntervalMs(serviceId: string, intervalMs: number, now: number): void {
    upsertSchedulerRegistration(this.db, serviceId, intervalMs, now, true);
  }

  clearConnectorSyncCursor(serviceId: string): void {
    if (loadSchedulerState(this.db, serviceId) === null) {
      throw new Error(`Unknown connector: ${serviceId}`);
    }
    clearSchedulerCursor(this.db, serviceId);
  }

  /**
   * Deletes index + scheduler + legacy sync_state rows for one connector (SQLite transaction).
   * Returns how many items were removed.
   */
  removeConnectorIndexData(serviceId: string): number {
    return this.db.transaction(() => {
      const n = countItemsForService(this.db, serviceId);
      deleteAllItemsForService(this.db, serviceId);
      deleteSchedulerStateRow(this.db, serviceId);
      this.db.run("DELETE FROM sync_state WHERE connector_id = ?", [serviceId]);
      prunePeopleAfterServiceRemoval(this.db, serviceId);
      return n;
    })();
  }

  /**
   * Items whose `author_id` matches (newest first). Used by `people.items` IPC.
   */
  listItemsForAuthor(personId: string, limit: number): NimbusItem[] {
    const lim = Math.min(200, Math.max(1, Math.floor(limit)));
    const rows = this.db
      .query(
        `SELECT * FROM item WHERE author_id = ? ORDER BY modified_at DESC LIMIT ?`,
      )
      .all(personId, lim) as ItemRow[];
    return rows.map(rowToItem);
  }

  upsert(item: NimbusItem): void {
    upsertNimbusItemIntoItemTable(this.db, item, Date.now());
  }

  delete(id: string): void {
    const byPk = this.db.query("SELECT id FROM item WHERE id = ?").get(id) as
      | { id: string }
      | null
      | undefined;
    if (byPk !== null && byPk !== undefined) {
      deleteItemByPrimaryKey(this.db, byPk.id);
      return;
    }
    const rows = this.db.query("SELECT id FROM item WHERE external_id = ?").all(id) as {
      id: string;
    }[];
    if (rows.length === 0) {
      return;
    }
    if (rows.length > 1) {
      throw new Error("delete id is ambiguous across services");
    }
    const pk = rows[0]?.id;
    if (pk !== undefined) {
      deleteItemByPrimaryKey(this.db, pk);
    }
  }

  private static searchFiltersAndParams(query: IndexSearchQuery): {
    filters: string[];
    params: Array<string | number>;
    whereExtra: string;
  } {
    const filters: string[] = [];
    const params: Array<string | number> = [];

    if (query.service !== undefined && query.service !== "") {
      filters.push("i.service = ?");
      params.push(query.service);
    }
    if (query.itemType !== undefined && query.itemType !== "") {
      filters.push("i.type = ?");
      params.push(query.itemType);
    }

    const whereExtra = filters.length > 0 ? `AND ${filters.join(" AND ")}` : "";
    return { filters, params, whereExtra };
  }

  private searchWithFts(
    fts: string,
    whereExtra: string,
    params: Array<string | number>,
    limit: number,
  ): NimbusItem[] {
    const sql = `
        SELECT i.* FROM item i
        INNER JOIN item_fts ON i.rowid = item_fts.rowid
        WHERE item_fts MATCH ? ${whereExtra}
        LIMIT ?
      `;
    const allParams = [fts, ...params, limit];
    const rows = this.db.query(sql).all(...allParams) as ItemRow[];
    return rows.map(rowToItem);
  }

  private searchWithoutFts(
    filters: string[],
    params: Array<string | number>,
    limit: number,
  ): NimbusItem[] {
    const sql =
      filters.length > 0
        ? `SELECT i.* FROM item i WHERE ${filters.join(" AND ")} LIMIT ?`
        : `SELECT i.* FROM item i LIMIT ?`;
    const allParams = [...params, limit];
    const rows = this.db.query(sql).all(...allParams) as ItemRow[];
    return rows.map(rowToItem);
  }

  search(query: IndexSearchQuery): NimbusItem[] {
    const limit = Math.min(500, Math.max(1, query.limit ?? 50));
    const nameQ = query.name?.trim() ?? "";
    const useFts = nameQ.length > 0;
    const fts = useFts ? ftsTitleMatchQuery(nameQ) : "";

    if (useFts && fts === "") {
      return [];
    }

    const { filters, params, whereExtra } = LocalIndex.searchFiltersAndParams(query);

    if (useFts) {
      return this.searchWithFts(fts, whereExtra, params, limit);
    }
    return this.searchWithoutFts(filters, params, limit);
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
