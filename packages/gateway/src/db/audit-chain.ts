import { blake3 } from "@noble/hashes/blake3";
import { bytesToHex } from "@noble/hashes/utils";

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
