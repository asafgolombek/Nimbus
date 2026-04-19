import { ManifestFetchError, type Updater } from "../updater/updater.ts";

export class UpdaterRpcError extends Error {
  readonly rpcCode: number;
  constructor(rpcCode: number, message: string) {
    super(message);
    this.name = "UpdaterRpcError";
    this.rpcCode = rpcCode;
  }
}

export interface UpdaterRpcContext {
  updater: Updater | undefined;
}

export async function dispatchUpdaterRpc(
  method: string,
  _params: unknown,
  ctx: UpdaterRpcContext,
): Promise<unknown> {
  if (!ctx.updater) {
    throw new UpdaterRpcError(
      -32602,
      "ERR_UPDATER_NOT_CONFIGURED: updater service not initialised",
    );
  }
  switch (method) {
    case "updater.getStatus":
      return ctx.updater.getStatus();
    case "updater.checkNow":
      try {
        return await ctx.updater.checkNow();
      } catch (err) {
        if (err instanceof ManifestFetchError) {
          throw new UpdaterRpcError(-32603, `ERR_UPDATER_MANIFEST_UNREACHABLE: ${err.message}`);
        }
        throw err;
      }
    case "updater.applyUpdate":
      try {
        await ctx.updater.applyUpdate();
        return { jobId: Date.now().toString(36) };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/signature|hash/i.test(message)) {
          throw new UpdaterRpcError(-32603, `ERR_UPDATER_SIGNATURE_INVALID: ${message}`);
        }
        throw err;
      }
    case "updater.rollback":
      return { ok: true };
    default:
      throw new UpdaterRpcError(-32601, `ERR_UPDATER_UNKNOWN_METHOD: ${method}`);
  }
}
