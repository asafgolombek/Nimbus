import type { Database } from "bun:sqlite";
import { blake3 } from "@noble/hashes/blake3.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** Genesis hash used for the first audit row. 64 hex zeros. */
export const GENESIS_HASH = "0".repeat(64);

export type AuditRowHashInput = {
  prevHash: string;
  actionType: string;
  hitlStatus: string;
  actionJson: string;
  timestamp: number;
};

/**
 * Compute `row_hash = BLAKE3(prev_hash || action_type || hitl_status || action_json || timestamp)`.
 *
 * Ordering and serialisation must stay stable: if we ever change field order,
 * every historical row_hash becomes invalid and `nimbus audit verify` breaks.
 * That is the point of the chain — so treat this function as a load-bearing
 * spec, not an implementation detail.
 */
export function computeAuditRowHash(input: AuditRowHashInput): string {
  const encoder = new TextEncoder();
  const payload = encoder.encode(
    `${input.prevHash}|${input.actionType}|${input.hitlStatus}|${input.actionJson}|${String(input.timestamp)}`,
  );
  return bytesToHex(blake3(payload));
}

export interface AppendAuditEntryFields {
  readonly actionType: string;
  readonly hitlStatus: string;
  readonly actionJson: string;
  readonly timestamp: number;
}

/**
 * Reads the previous row hash, computes the new row hash, and INSERTs a new
 * audit_log row in one call. Both LocalIndex.recordAudit and the gateway's
 * out-of-band audit writers (e.g. emitRunCompletedAudit in workflow-runner)
 * delegate here so the chain-append recipe is single-sourced.
 */
export function appendAuditEntry(db: Database, fields: AppendAuditEntryFields): void {
  const rawPrev = db.query(`SELECT row_hash FROM audit_log ORDER BY id DESC LIMIT 1`).get() as
    | { row_hash: string | null }
    | undefined;
  const h = rawPrev?.row_hash;
  const prevHash = typeof h === "string" && h.length === 64 ? h : GENESIS_HASH;
  const rowHash = computeAuditRowHash({
    prevHash,
    actionType: fields.actionType,
    hitlStatus: fields.hitlStatus,
    actionJson: fields.actionJson,
    timestamp: fields.timestamp,
  });
  db.run(
    `INSERT INTO audit_log (action_type, hitl_status, action_json, timestamp, row_hash, prev_hash)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [fields.actionType, fields.hitlStatus, fields.actionJson, fields.timestamp, rowHash, prevHash],
  );
}
