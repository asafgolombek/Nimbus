/**
 * Read-only local HTTP API (Phase 3.5) — dedicated SQLITE_OPEN_READONLY connection.
 * Binds 127.0.0.1 only.
 */

import { Database } from "bun:sqlite";
import { getAllConnectorHealth } from "../connectors/health.ts";

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

function handleItemsList(url: URL, db: Database): Response {
  const services = url.searchParams.getAll("service");
  const type = url.searchParams.get("type") ?? undefined;
  const sinceMs = url.searchParams.get("sinceMs");
  const untilMs = url.searchParams.get("untilMs");
  const limit = parsePositiveInt(url.searchParams.get("limit"), 50, 1000);
  const filters: string[] = [];
  const vals: Array<string | number> = [];
  if (services.length > 0) {
    const ph = services.map(() => "?").join(", ");
    filters.push(`service IN (${ph})`);
    vals.push(...services);
  }
  if (type !== undefined && type !== "") {
    filters.push("type = ?");
    vals.push(type);
  }
  if (sinceMs !== null && sinceMs !== "" && Number.isFinite(Number(sinceMs))) {
    filters.push("modified_at >= ?");
    vals.push(Math.floor(Number(sinceMs)));
  }
  if (untilMs !== null && untilMs !== "" && Number.isFinite(Number(untilMs))) {
    filters.push("modified_at <= ?");
    vals.push(Math.floor(Number(untilMs)));
  }
  const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
  const sql = `SELECT * FROM item ${where} ORDER BY modified_at DESC LIMIT ?`;
  vals.push(limit);
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
