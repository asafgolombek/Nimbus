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
  notify: (method: string, params: unknown) => void;
};

const activePulls = new Map<string, AbortController>();

export async function dispatchLlmRpc(
  method: string,
  params: unknown,
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
    case "llm.pullModel": {
      const p = params as { provider?: string; modelName?: string } | null;
      if (p === null || typeof p.modelName !== "string") {
        throw new LlmRpcError(-32602, "pullModel requires modelName");
      }
      const provider = p.provider ?? "ollama";
      if (provider !== "ollama" && provider !== "llamacpp") {
        throw new LlmRpcError(-32602, `Unsupported provider: ${provider}`);
      }
      const modelName = p.modelName;
      const pullId = `pull_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const controller = new AbortController();
      activePulls.set(pullId, controller);
      void ctx.registry
        .pullModel(provider, modelName, {
          signal: controller.signal,
          onProgress: (c) => ctx.notify("llm.pullProgress", { pullId, provider, modelName, ...c }),
        })
        .then(() => ctx.notify("llm.pullCompleted", { pullId, provider, modelName }))
        .catch((err: unknown) =>
          ctx.notify("llm.pullFailed", {
            pullId,
            provider,
            modelName,
            error: err instanceof Error ? err.message : String(err),
          }),
        )
        .finally(() => activePulls.delete(pullId));
      return { kind: "hit", value: { pullId } };
    }
    case "llm.cancelPull": {
      const p = params as { pullId?: string } | null;
      if (p === null || typeof p.pullId !== "string") {
        throw new LlmRpcError(-32602, "cancelPull requires pullId");
      }
      const controller = activePulls.get(p.pullId);
      const cancelled = controller !== undefined;
      controller?.abort();
      return { kind: "hit", value: { cancelled } };
    }
    default:
      return { kind: "miss" };
  }
}
