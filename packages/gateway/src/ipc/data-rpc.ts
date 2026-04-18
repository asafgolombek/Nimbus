import { runDataDelete } from "../commands/data-delete.ts";
import { runDataExport } from "../commands/data-export.ts";
import { runDataImport } from "../commands/data-import.ts";
import type { KdfParams } from "../db/data-vault-crypto.ts";
import type { LocalIndex } from "../index/local-index.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";

export type DataRpcContext = {
  index: LocalIndex | undefined;
  vault: NimbusVault | undefined;
  platform: "win32" | "darwin" | "linux";
  nimbusVersion: string;
  /** Optional — tests override Argon2id params to keep runtime small. */
  kdfParams?: KdfParams;
};

type RpcResult = { kind: "hit"; value: unknown } | { kind: "miss" };

export class DataRpcError extends Error {
  readonly rpcCode: number;
  constructor(rpcCode: number, message: string) {
    super(message);
    this.name = "DataRpcError";
    this.rpcCode = rpcCode;
  }
}

function asRecord(params: unknown): Record<string, unknown> {
  if (params === null || typeof params !== "object") return {};
  return params as Record<string, unknown>;
}

function requireDeps(ctx: DataRpcContext): { index: LocalIndex; vault: NimbusVault } {
  if (ctx.index === undefined || ctx.vault === undefined) {
    throw new DataRpcError(-32603, "data RPC unavailable: index or vault not configured");
  }
  return { index: ctx.index, vault: ctx.vault };
}

export async function dispatchDataRpc(
  method: string,
  params: unknown,
  ctx: DataRpcContext,
): Promise<RpcResult> {
  const rec = asRecord(params);

  if (method === "data.export") {
    const { index, vault } = requireDeps(ctx);
    const output = rec["output"];
    const passphrase = rec["passphrase"];
    const includeIndex = rec["includeIndex"] === true;
    if (typeof output !== "string" || output === "")
      throw new DataRpcError(-32602, "Missing param: output");
    if (typeof passphrase !== "string" || passphrase === "")
      throw new DataRpcError(-32602, "Missing param: passphrase");
    const result = await runDataExport({
      output,
      passphrase,
      includeIndex,
      vault,
      index,
      platform: ctx.platform,
      nimbusVersion: ctx.nimbusVersion,
      ...(ctx.kdfParams !== undefined ? { kdfParams: ctx.kdfParams } : {}),
    });
    return { kind: "hit", value: result };
  }

  if (method === "data.import") {
    const { index, vault } = requireDeps(ctx);
    const bundlePath = rec["bundlePath"];
    const passphrase = rec["passphrase"];
    const recoverySeed = rec["recoverySeed"];
    if (typeof bundlePath !== "string" || bundlePath === "")
      throw new DataRpcError(-32602, "Missing param: bundlePath");
    const result = await runDataImport({
      bundlePath,
      ...(typeof passphrase === "string" ? { passphrase } : {}),
      ...(typeof recoverySeed === "string" ? { recoverySeed } : {}),
      vault,
      index,
    });
    return { kind: "hit", value: result };
  }

  if (method === "data.delete") {
    const { index, vault } = requireDeps(ctx);
    const service = rec["service"];
    const dryRun = rec["dryRun"] === true;
    if (typeof service !== "string" || service === "")
      throw new DataRpcError(-32602, "Missing param: service");
    const result = await runDataDelete({ service, dryRun, vault, index });
    return { kind: "hit", value: result };
  }

  return { kind: "miss" };
}
