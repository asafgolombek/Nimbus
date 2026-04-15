/**
 * Shared `item` list SQL for `index.queryItems` (IPC) and read-only HTTP `/v1/items`.
 */

export type ItemListQueryParams = {
  readonly services: readonly string[];
  readonly types: readonly string[];
  readonly sinceMs?: number;
  readonly untilMs?: number;
  readonly limit: number;
};

export function buildItemListSql(params: ItemListQueryParams): {
  sql: string;
  vals: Array<string | number>;
} {
  const filters: string[] = [];
  const vals: Array<string | number> = [];
  if (params.services.length > 0) {
    const ph = params.services.map(() => "?").join(", ");
    filters.push(`service IN (${ph})`);
    vals.push(...params.services);
  }
  if (params.types.length === 1 && params.types[0] !== undefined) {
    filters.push("type = ?");
    vals.push(params.types[0]);
  } else if (params.types.length > 1) {
    const ph = params.types.map(() => "?").join(", ");
    filters.push(`type IN (${ph})`);
    vals.push(...params.types);
  }
  if (params.sinceMs !== undefined) {
    filters.push("modified_at >= ?");
    vals.push(params.sinceMs);
  }
  if (params.untilMs !== undefined) {
    filters.push("modified_at <= ?");
    vals.push(params.untilMs);
  }
  const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
  const sql = `SELECT * FROM item ${where} ORDER BY modified_at DESC LIMIT ?`;
  vals.push(params.limit);
  return { sql, vals };
}

/**
 * Parses compact relative windows: `7d`, `24h`, `30m`, `10s` (UTC ms cutoff = now - window).
 */
export function parseRelativeSinceToWindowMs(raw: string, nowMs: number): number | undefined {
  const s = raw.trim();
  const m = /^(\d+)\s*(d|h|m|s)$/i.exec(s);
  if (m === null) {
    return undefined;
  }
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0) {
    return undefined;
  }
  const unit = m[2]?.toLowerCase() ?? "";
  let windowMs = 0;
  switch (unit) {
    case "d":
      windowMs = n * 24 * 60 * 60 * 1000;
      break;
    case "h":
      windowMs = n * 60 * 60 * 1000;
      break;
    case "m":
      windowMs = n * 60 * 1000;
      break;
    case "s":
      windowMs = n * 1000;
      break;
    default:
      return undefined;
  }
  return nowMs - Math.floor(windowMs);
}
