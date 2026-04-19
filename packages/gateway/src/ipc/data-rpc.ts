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

async function handleDataExport(
  rec: Record<string, unknown>,
  ctx: DataRpcContext,
): Promise<unknown> {
  const { index, vault } = requireDeps(ctx);
  const output = rec["output"];
  const passphrase = rec["passphrase"];
  const includeIndex = rec["includeIndex"] === true;
  if (typeof output !== "string" || output === "")
    throw new DataRpcError(-32602, "Missing param: output");
  if (typeof passphrase !== "string" || passphrase === "")
    throw new DataRpcError(-32602, "Missing param: passphrase");
  return runDataExport({
    output,
    passphrase,
    includeIndex,
    vault,
    index,
    platform: ctx.platform,
    nimbusVersion: ctx.nimbusVersion,
    ...(ctx.kdfParams === undefined ? {} : { kdfParams: ctx.kdfParams }),
  });
}

async function handleDataImport(
  rec: Record<string, unknown>,
  ctx: DataRpcContext,
): Promise<unknown> {
  const { index, vault } = requireDeps(ctx);
  const bundlePath = rec["bundlePath"];
  const passphrase = rec["passphrase"];
  const recoverySeed = rec["recoverySeed"];
  if (typeof bundlePath !== "string" || bundlePath === "")
    throw new DataRpcError(-32602, "Missing param: bundlePath");
  return runDataImport({
    bundlePath,
    ...(typeof passphrase === "string" ? { passphrase } : {}),
    ...(typeof recoverySeed === "string" ? { recoverySeed } : {}),
    vault,
    index,
  });
}

async function handleDataDelete(
  rec: Record<string, unknown>,
  ctx: DataRpcContext,
): Promise<unknown> {
  const { index, vault } = requireDeps(ctx);
  const service = rec["service"];
  const dryRun = rec["dryRun"] === true;
  if (typeof service !== "string" || service === "")
    throw new DataRpcError(-32602, "Missing param: service");
  return runDataDelete({ service, dryRun, vault, index });
}

export async function dispatchDataRpc(
  method: string,
  params: unknown,
  ctx: DataRpcContext,
): Promise<RpcResult> {
  const rec = asRecord(params);
  if (method === "data.export") return { kind: "hit", value: await handleDataExport(rec, ctx) };
  if (method === "data.import") return { kind: "hit", value: await handleDataImport(rec, ctx) };
  if (method === "data.delete") return { kind: "hit", value: await handleDataDelete(rec, ctx) };
  return { kind: "miss" };
}
