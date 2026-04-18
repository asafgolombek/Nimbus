import type { LlmRegistry } from "../llm/registry.ts";

export class LlmRpcError extends Error {
  readonly rpcCode: number;
  constructor(rpcCode: number, message: string) {
    super(message);
    this.name = "LlmRpcError";
    this.rpcCode = rpcCode;
  }
}

export type LlmRpcContext = {
  registry: LlmRegistry;
};

export async function dispatchLlmRpc(
  method: string,
  _params: unknown,
  ctx: LlmRpcContext,
): Promise<{ kind: "hit"; value: unknown } | { kind: "miss" }> {
  switch (method) {
    case "llm.listModels": {
      const models = await ctx.registry.listAllModels();
      return { kind: "hit", value: { models } };
    }
    case "llm.getStatus": {
      const available = await ctx.registry.checkAvailability();
      return { kind: "hit", value: { available } };
    }
    default:
      return { kind: "miss" };
  }
}
