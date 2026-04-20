import { verifyAuditChain } from "../db/audit-verify.ts";
import type { LocalIndex } from "../index/local-index.ts";

export type AuditRpcContext = { index: LocalIndex | undefined };
type RpcResult = { kind: "hit"; value: unknown } | { kind: "miss" };

export class AuditRpcError extends Error {
  readonly rpcCode: number;
  constructor(rpcCode: number, message: string) {
    super(message);
    this.name = "AuditRpcError";
    this.rpcCode = rpcCode;
  }
}

function ensureIndex(ctx: AuditRpcContext): LocalIndex {
  if (ctx.index === undefined) {
    throw new AuditRpcError(-32603, "audit RPC unavailable: LocalIndex not configured");
  }
  return ctx.index;
}

export async function dispatchAuditRpc(
  method: string,
  params: unknown,
  ctx: AuditRpcContext,
): Promise<RpcResult> {
  if (method === "audit.verify") {
    const idx = ensureIndex(ctx);
    const full =
      params !== null &&
      typeof params === "object" &&
      (params as Record<string, unknown>)["full"] === true;
    const fromId = full ? 0 : idx.getAuditVerifiedThroughId();
    const result = verifyAuditChain(idx, { fromId });
    if (result.ok) idx.setAuditVerifiedThroughId(result.lastVerifiedId);
    return { kind: "hit", value: result };
  }
  if (method === "audit.exportAll" || method === "audit.export") {
    const idx = ensureIndex(ctx);
    return { kind: "hit", value: idx.listAuditWithChain(10_000) };
  }
  if (method === "audit.getSummary") {
    const idx = ensureIndex(ctx);
    return { kind: "hit", value: idx.getAuditSummary() };
  }
  return { kind: "miss" };
}
