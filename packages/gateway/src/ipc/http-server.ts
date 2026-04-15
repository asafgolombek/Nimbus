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
        if (path === "/v1/health") {
          return json({ status: "ok", gateway: "read_only_http" });
        }

        if (path === "/v1/items") {
          const services = url.searchParams.getAll("service");
          const type = url.searchParams.get("type") ?? undefined;
          const sinceMs = url.searchParams.get("sinceMs");
          const untilMs = url.searchParams.get("untilMs");
          const limitRaw = url.searchParams.get("limit");
          const limit =
            limitRaw !== null && limitRaw !== ""
              ? Math.min(1000, Math.max(1, Math.floor(Number.parseInt(limitRaw, 10))))
              : 50;
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

        if (path.startsWith("/v1/items/")) {
          const id = decodeURIComponent(path.slice("/v1/items/".length));
          if (id === "") {
            return json({ error: "missing id" }, 400);
          }
          const row = db
            .query("SELECT * FROM item WHERE id = ? OR external_id = ? LIMIT 1")
            .get(id, id) as Record<string, unknown> | null;
          return json({ data: row });
        }

        if (path === "/v1/connectors") {
          const health = getAllConnectorHealth(db);
          return json({
            data: health,
            meta: { total: health.length, limit: health.length, offset: 0 },
          });
        }

        if (path === "/v1/people") {
          const rows = db
            .query("SELECT * FROM person ORDER BY display_name COLLATE NOCASE LIMIT 500")
            .all() as Record<string, unknown>[];
          return json({ data: rows, meta: { total: rows.length, limit: rows.length, offset: 0 } });
        }

        if (path.startsWith("/v1/people/")) {
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

        if (path === "/v1/audit") {
          const limRaw = url.searchParams.get("limit");
          const lim =
            limRaw !== null && limRaw !== ""
              ? Math.min(200, Math.max(1, Math.floor(Number.parseInt(limRaw, 10))))
              : 50;
          const rows = db
            .query(
              "SELECT id, action_type, hitl_status, action_json, timestamp FROM audit_log ORDER BY id DESC LIMIT ?",
            )
            .all(lim) as Record<string, unknown>[];
          return json({ data: rows, meta: { total: rows.length, limit: lim, offset: 0 } });
        }

        return new Response("Not Found", { status: 404 });
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
