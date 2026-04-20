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

const VALID_LLM_TASKS = new Set(["classification", "reasoning", "summarisation", "agent_step"]);
const VALID_LLM_PROVIDERS = new Set(["ollama", "llamacpp", "remote"]);
const LOCAL_PROVIDERS = ["ollama", "llamacpp"] as const;
type LocalProvider = (typeof LOCAL_PROVIDERS)[number];

function requireLocalProvider(provider: string): LocalProvider {
  if (provider !== "ollama" && provider !== "llamacpp") {
    throw new LlmRpcError(-32602, `Unsupported provider: ${provider}`);
  }
  return provider;
}

function requireModelParams(
  params: unknown,
  action: string,
): { provider: LocalProvider; modelName: string } {
  const p = params as { provider?: string; modelName?: string } | null;
  if (p === null || typeof p.modelName !== "string") {
    throw new LlmRpcError(-32602, `${action} requires modelName`);
  }
  return { provider: requireLocalProvider(p.provider ?? "ollama"), modelName: p.modelName };
}

async function handlePullModel(
  params: unknown,
  ctx: LlmRpcContext,
): Promise<{ kind: "hit"; value: unknown }> {
  const { provider, modelName } = requireModelParams(params, "pullModel");
  const pullId = `pull_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
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

async function handleLoadOrUnload(
  action: "load" | "unload",
  params: unknown,
  ctx: LlmRpcContext,
): Promise<{ kind: "hit"; value: unknown }> {
  const { provider, modelName } = requireModelParams(params, `${action}Model`);
  if (action === "load") {
    await ctx.registry.loadModel(provider, modelName);
    ctx.notify("llm.modelLoaded", { provider, modelName });
    return { kind: "hit", value: { isLoaded: true } };
  }
  await ctx.registry.unloadModel(provider, modelName);
  ctx.notify("llm.modelUnloaded", { provider, modelName });
  return { kind: "hit", value: { isLoaded: false } };
}

async function handleSetDefault(
  params: unknown,
  ctx: LlmRpcContext,
): Promise<{ kind: "hit"; value: unknown }> {
  const p = params as { taskType?: string; provider?: string; modelName?: string } | null;
  if (
    p === null ||
    typeof p.taskType !== "string" ||
    !VALID_LLM_TASKS.has(p.taskType) ||
    typeof p.provider !== "string" ||
    !VALID_LLM_PROVIDERS.has(p.provider) ||
    typeof p.modelName !== "string"
  ) {
    throw new LlmRpcError(-32602, "setDefault requires valid taskType, provider, modelName");
  }
  await ctx.registry.setDefault(
    p.taskType as "classification" | "reasoning" | "summarisation" | "agent_step",
    p.provider as "ollama" | "llamacpp" | "remote",
    p.modelName,
  );
  return {
    kind: "hit",
    value: { taskType: p.taskType, provider: p.provider, modelName: p.modelName },
  };
}

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
    case "llm.pullModel":
      return handlePullModel(params, ctx);
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
    case "llm.loadModel":
      return handleLoadOrUnload("load", params, ctx);
    case "llm.unloadModel":
      return handleLoadOrUnload("unload", params, ctx);
    case "llm.getRouterStatus": {
      const decisions = await ctx.registry.getRouterStatus();
      return { kind: "hit", value: { decisions } };
    }
    case "llm.setDefault":
      return handleSetDefault(params, ctx);
    default:
      return { kind: "miss" };
  }
}
