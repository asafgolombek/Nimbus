import { RpcMethodError } from "./jsonrpc.js";
import type { StreamRegistry } from "./engine-ask-stream.js";

export type CancelStreamParams = { streamId: string };
export type CancelStreamResult = { ok: boolean };

export function createCancelStreamHandler(
  registry: StreamRegistry,
): (params: unknown) => CancelStreamResult {
  return (params): CancelStreamResult => {
    if (typeof params !== "object" || params === null) {
      throw new RpcMethodError(-32602, "engine.cancelStream requires { streamId: string }");
    }
    const sid = (params as { streamId?: unknown }).streamId;
    if (typeof sid !== "string" || sid.length === 0) {
      throw new RpcMethodError(-32602, "engine.cancelStream requires non-empty streamId");
    }
    // Cancellation is idempotent — unknown streams resolve as ok
    registry.cancel(sid);
    return { ok: true };
  };
}
