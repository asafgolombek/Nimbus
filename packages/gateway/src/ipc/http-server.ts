/**
 * Read-only local HTTP API (Phase 3.5) — dedicated SQLITE_OPEN_READONLY connection.
 * Binds 127.0.0.1 only.
 */

import { Database } from "bun:sqlite";
import { getAllConnectorHealth } from "../connectors/health.ts";
import { buildItemListSql, parseRelativeSinceToWindowMs } from "../index/item-list-query.ts";

export type ReadOnlyHttpServerHandle = {
  readonly stop: () => void;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function parsePositiveInt(raw: string | null, fallback: number, max: number): number {
  if (raw === null || raw === "") {
    return fallback;
  }
  return Math.min(max, Math.max(1, Math.floor(Number.parseInt(raw, 10))));
}

function parseItemsListTimeFilters(
  url: URL,
  nowMs: number,
): {
  sinceMs: number | undefined;
  untilMs: number | undefined;
} {
  let sinceMs: number | undefined;
  const sinceRel = url.searchParams.get("since");
  if (sinceRel !== null && sinceRel.trim() !== "") {
    const rel = parseRelativeSinceToWindowMs(sinceRel, nowMs);
    if (rel !== undefined) {
      sinceMs = rel;
    }
  }
  const sinceMsParam = url.searchParams.get("sinceMs");
  if (sinceMs === undefined && sinceMsParam !== null && sinceMsParam !== "") {
    const n = Number(sinceMsParam);
    if (Number.isFinite(n)) {
      sinceMs = Math.floor(n);
    }
  }
  let untilMs: number | undefined;
  const untilMsParam = url.searchParams.get("untilMs");
  if (untilMsParam !== null && untilMsParam !== "") {
    const n = Number(untilMsParam);
    if (Number.isFinite(n)) {
      untilMs = Math.floor(n);
    }
  }
  return { sinceMs, untilMs };
}

function handleItemsList(url: URL, db: Database): Response {
  const services = url.searchParams.getAll("service");
  const type = url.searchParams.get("type") ?? undefined;
  const types = type === undefined || type === "" ? [] : [type];
  const limit = parsePositiveInt(url.searchParams.get("limit"), 50, 1000);
  const { sinceMs, untilMs } = parseItemsListTimeFilters(url, Date.now());
  const { sql, vals } = buildItemListSql({
    services,
    types,
    limit,
    ...(sinceMs === undefined ? {} : { sinceMs }),
    ...(untilMs === undefined ? {} : { untilMs }),
  });
  const rows = db.query(sql).all(...vals) as Record<string, unknown>[];
  return json({ data: rows, meta: { total: rows.length, limit, offset: 0 } });
}

function handleItemByPath(path: string, db: Database): Response {
  const id = decodeURIComponent(path.slice("/v1/items/".length));
  if (id === "") {
    return json({ error: "missing id" }, 400);
  }
  const row = db
    .query("SELECT * FROM item WHERE id = ? OR external_id = ? LIMIT 1")
    .get(id, id) as Record<string, unknown> | null;
  return json({ data: row });
}

function handleConnectors(db: Database): Response {
  const health = getAllConnectorHealth(db);
  return json({
    data: health,
    meta: { total: health.length, limit: health.length, offset: 0 },
  });
}

function handlePeopleList(db: Database): Response {
  const rows = db
    .query("SELECT * FROM person ORDER BY display_name COLLATE NOCASE LIMIT 500")
    .all() as Record<string, unknown>[];
  return json({ data: rows, meta: { total: rows.length, limit: rows.length, offset: 0 } });
}

function handlePersonByPath(path: string, db: Database): Response {
  const id = decodeURIComponent(path.slice("/v1/people/".length));
  if (id === "") {
    return json({ error: "missing id" }, 400);
  }
  const row = db.query("SELECT * FROM person WHERE id = ?").get(id) as Record<
    string,
    unknown
  > | null;
  return json({ data: row });
}

function handleAudit(url: URL, db: Database): Response {
  const lim = parsePositiveInt(url.searchParams.get("limit"), 50, 200);
  const rows = db
    .query(
      "SELECT id, action_type, hitl_status, action_json, timestamp FROM audit_log ORDER BY id DESC LIMIT ?",
    )
    .all(lim) as Record<string, unknown>[];
  return json({ data: rows, meta: { total: rows.length, limit: lim, offset: 0 } });
}

function dispatchReadOnlyGet(path: string, url: URL, db: Database): Response {
  if (path === "/v1/health") {
    return json({ status: "ok", gateway: "read_only_http" });
  }
  if (path === "/v1/items") {
    return handleItemsList(url, db);
  }
  if (path.startsWith("/v1/items/")) {
    return handleItemByPath(path, db);
  }
  if (path === "/v1/connectors") {
    return handleConnectors(db);
  }
  if (path === "/v1/people") {
    return handlePeopleList(db);
  }
  if (path.startsWith("/v1/people/")) {
    return handlePersonByPath(path, db);
  }
  if (path === "/v1/audit") {
    return handleAudit(url, db);
  }
  return new Response("Not Found", { status: 404 });
}

/**
 * @param dbPath Absolute path to `nimbus.db`
 */
export function startReadOnlyHttpServer(dbPath: string, port: number): ReadOnlyHttpServerHandle {
  const db = new Database(dbPath, { readonly: true, create: false });
  db.run("PRAGMA query_only = ON");

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch(req: Request): Response {
      if (req.method !== "GET") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      const url = new URL(req.url);
      const path = url.pathname;
      try {
        return dispatchReadOnlyGet(path, url, db);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 500);
      }
    },
  });

  return {
    stop(): void {
      try {
        server.stop();
      } catch {
        /* ignore */
      }
      try {
        db.close();
      } catch {
        /* ignore */
      }
    },
  };
}
