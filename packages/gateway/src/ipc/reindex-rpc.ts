import { type ReindexDepth, reindexConnector } from "../connectors/reindex.ts";
import type { ToolExecutor } from "../engine/executor.ts";
import type { LocalIndex } from "../index/local-index.ts";

export type ReindexRpcContext = {
  index: LocalIndex | undefined;
  /**
   * Optional `ToolExecutor` for HITL-gating destructive `full`-depth reindexes
   * (S1-F7). When omitted (e.g. internal callers without an IPC consent
   * channel), the gate is skipped and reindex runs unguarded — the caller
   * is responsible for upstream authorization.
   */
  toolExecutor?: ToolExecutor;
};
type RpcResult = { kind: "hit"; value: unknown } | { kind: "miss" };

export class ReindexRpcError extends Error {
  readonly rpcCode: number;
  constructor(rpcCode: number, message: string) {
    super(message);
    this.name = "ReindexRpcError";
    this.rpcCode = rpcCode;
  }
}

const VALID_DEPTHS = new Set<ReindexDepth>(["metadata_only", "summary", "full"]);

export async function dispatchReindexRpc(
  method: string,
  params: unknown,
  ctx: ReindexRpcContext,
): Promise<RpcResult> {
  if (method !== "connector.reindex") return { kind: "miss" };
  if (ctx.index === undefined) {
    throw new ReindexRpcError(-32603, "reindex RPC unavailable: LocalIndex not configured");
  }
  const rec =
    params !== null && typeof params === "object" ? (params as Record<string, unknown>) : {};
  const service = rec["service"];
  const depthRaw = rec["depth"];
  if (typeof service !== "string" || service === "") {
    throw new ReindexRpcError(-32602, "Missing or invalid param: service");
  }
  const depth = typeof depthRaw === "string" ? (depthRaw as ReindexDepth) : "metadata_only";
  if (!VALID_DEPTHS.has(depth)) {
    throw new ReindexRpcError(-32602, "Invalid depth: must be metadata_only|summary|full");
  }
  // S1-F7 — only `full` (deep, irreversible) reindex requires consent.
  // `metadata_only` and `summary` are administrative and run without a gate
  // to preserve the existing CLI/automation flow. Internal callers (no
  // toolExecutor) bypass the gate by design.
  if (depth === "full" && ctx.toolExecutor !== undefined) {
    const gateResult = await ctx.toolExecutor.gate({
      type: "connector.reindex",
      payload: { service, depth },
    });
    if (gateResult !== "proceed" && gateResult.status === "rejected") {
      throw new ReindexRpcError(-32000, gateResult.reason);
    }
  }
  const result = await reindexConnector({ index: ctx.index, service, depth });
  return { kind: "hit", value: result };
}
