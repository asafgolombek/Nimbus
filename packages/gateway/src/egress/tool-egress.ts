import type { Database } from "bun:sqlite";
import { appendEgressEntry } from "./egress-ledger.ts";
import { redactEgressSummary } from "./egress-record.ts";

/**
 * The sole append site for `tool` egress rows (I39, I29 `tool` class).
 *
 * Called by `toolgen/toolgen-broker.ts` BEFORE every brokered request, including one it is about
 * to refuse (`resultStatus: "blocked"`). Throwing here aborts the request — fail-closed, so a
 * zero-row window means no generated tool reached the network, never that one did so unrecorded.
 *
 * `destination` is the resolved HOST, never the full URL: a URL carries query strings, and this
 * table is not the place to learn a tool's API keys. `payload_summary` is the request method and
 * the request body's byte COUNT — never the body, never the URL, never the credential the broker
 * is about to attach.
 */
export function recordToolEgress(
  db: Database,
  args: {
    readonly toolId: string;
    readonly destination: string;
    readonly method: string;
    readonly resultStatus: "authorized" | "blocked";
    readonly now: number;
    readonly requestMethod?: string | undefined;
    readonly requestBytes?: number | undefined;
  },
): { rowHash: string } {
  return appendEgressEntry(db, {
    timestamp: args.now,
    sourceType: "tool",
    // The gateway-minted tool id, never a caller-supplied label: a tool must not be able to file
    // its egress under another tool's name.
    sourceId: args.toolId,
    destination: args.destination,
    method: args.method,
    payloadSummary: redactEgressSummary({
      requestMethod: args.requestMethod ?? null,
      requestBytes: args.requestBytes ?? null,
    }),
    // `not_required`, matching every other per-call/per-run appender in this directory (sync,
    // model, embedding, browser, chatops, vlm) — none of them hardcode "approved" outside
    // `egress-prune.ts`'s HITL-gated tombstone (I4's earned set). A per-request row here does not
    // itself follow a fresh consent prompt; whatever gate governs a tool's existence and host
    // allowlist (not yet built — no task before this one lands it) is a DIFFERENT decision than
    // "was this specific outbound request approved", exactly as a scheduled sync's `not_required`
    // row does not claim per-run consent either. Hardcoding "approved" here, ahead of that gate,
    // is precisely the "approval that never happened" failure mode I4's test guards against.
    hitlStatus: "not_required",
    resultStatus: args.resultStatus,
  });
}
