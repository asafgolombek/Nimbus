import type { AuditExportRow } from "../../../ipc/types";

export interface AuditDisplayRow {
  readonly id: number;
  /** ISO timestamp string from the wire `timestamp` ms epoch. */
  readonly tsIso: string;
  /** First segment of `actionType` (e.g., "github.sync" → "github"). Falls back to the full string. */
  readonly service: string;
  /** Remainder of `actionType` after the first dot (e.g., "github.sync" → "sync"). Falls back to the full string. */
  readonly action: string;
  /** Mirrors the wire `hitlStatus`. */
  readonly outcome: "approved" | "rejected" | "not_required";
  /** Parsed `actor` field from `actionJson`, or empty string when absent / parse fails. */
  readonly actor: string;
  /** Echoes the wire `rowHash` (omit for `audit.list` rows that don't carry it). */
  readonly rowHash: string;
}

/** Splits `actionType` into `{ service, action }` using the first `.`. */
export function splitActionType(actionType: string): { service: string; action: string } {
  const dot = actionType.indexOf(".");
  if (dot === -1) return { service: actionType, action: actionType };
  return { service: actionType.slice(0, dot), action: actionType.slice(dot + 1) };
}

/** Best-effort actor extraction from a JSON-encoded action payload. Never throws. */
export function extractActor(actionJson: string): string {
  if (actionJson === "" || actionJson === "{}") return "";
  try {
    const parsed = JSON.parse(actionJson) as unknown;
    if (parsed !== null && typeof parsed === "object" && "actor" in parsed) {
      const actor = (parsed as { actor: unknown }).actor;
      if (typeof actor === "string") return actor;
    }
  } catch {
    /* ignore */
  }
  return "";
}

/** Materialises a wire `audit.export` row into the display shape. */
export function toDisplayRow(row: AuditExportRow): AuditDisplayRow {
  const { service, action } = splitActionType(row.actionType);
  return {
    id: row.id,
    tsIso: new Date(row.timestamp).toISOString(),
    service,
    action,
    outcome: row.hitlStatus,
    actor: extractActor(row.actionJson),
    rowHash: row.rowHash,
  };
}

/** RFC 4180 — quote a field if it contains `,`, `"`, or any newline; double interior `"`. */
export function csvEscape(field: string): string {
  if (field === "") return "";
  const needsQuote = /[",\r\n]/.test(field);
  const escaped = field.replaceAll('"', '""');
  return needsQuote ? `"${escaped}"` : escaped;
}

/**
 * Flattens `audit.export` rows into a CSV string with the fixed 6-column whitelist
 * `timestamp,service,actor,action,outcome,rowHash` — matching the spec §2.1 contract.
 * Nested payload blobs in `actionJson` are dropped on purpose (preserved in the JSON
 * export path). The header row is always emitted, even for an empty result set.
 */
export function rowsToCsv(rows: ReadonlyArray<AuditExportRow>): string {
  const header = "timestamp,service,actor,action,outcome,rowHash";
  const lines = rows.map((r) => {
    const d = toDisplayRow(r);
    return [d.tsIso, d.service, d.actor, d.action, d.outcome, d.rowHash].map(csvEscape).join(",");
  });
  return [header, ...lines].join("\n");
}
