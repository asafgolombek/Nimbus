import type {
  LlmGenerateOptions,
  LlmGenerateResult,
  LlmProvider,
  LlmProviderKind,
  LlmTaskType,
} from "./types.ts";

export type LlmRouterConfig = {
  preferLocal: boolean;
  remoteModel: string;
  localModel: string;
  minReasoningParams: number;
  enforceAirGap: boolean;
};

export type ProviderMeta = {
  parameterCount?: number;
  contextWindow?: number;
};

const LOCAL_PROVIDER_IDS: ReadonlySet<LlmProviderKind> = new Set(["ollama", "llamacpp"]);
const CONTEXT_OVERFLOW_THRESHOLD = 0.85;
const TOKENS_PER_CHAR = 4;

export function midTruncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const keep = Math.floor(maxChars / 2);
  return `${text.slice(0, keep)}\n[...truncated...]\n${text.slice(-keep)}`;
}

export class LlmRouter {
  private readonly providers = new Map<LlmProviderKind, LlmProvider>();
  private readonly providerMeta = new Map<LlmProviderKind, ProviderMeta>();
  private readonly config: LlmRouterConfig;

  constructor(config: LlmRouterConfig) {
    this.config = config;
  }

  registerProvider(provider: LlmProvider, meta: ProviderMeta = {}): void {
    this.providers.set(provider.providerId, provider);
    this.providerMeta.set(provider.providerId, meta);
  }

  async selectProvider(task: LlmTaskType): Promise<LlmProvider | undefined> {
    const orderedIds = this.providerPriority(task);
    for (const id of orderedIds) {
      if (this.config.enforceAirGap && !LOCAL_PROVIDER_IDS.has(id)) {
        continue;
      }
      if (!this.meetsCapabilityFloor(id, task)) {
        continue;
      }
      const provider = this.providers.get(id);
      if (provider === undefined) continue;
      try {
        if (await provider.isAvailable()) return provider;
      } catch {
        /* treat availability check failure as unavailable */
      }
    }
    return undefined;
  }

  async generate(opts: LlmGenerateOptions): Promise<LlmGenerateResult> {
    const provider = await this.selectProvider(opts.task);
    if (provider === undefined) {
      throw new Error(`No LLM provider available for task: ${opts.task}`);
    }

    const meta = this.providerMeta.get(provider.providerId);
    if (meta?.contextWindow !== undefined) {
      const estimatedTokens = Math.ceil(opts.prompt.length / TOKENS_PER_CHAR);
      const tokenLimit = Math.floor(meta.contextWindow * CONTEXT_OVERFLOW_THRESHOLD);

      if (estimatedTokens > tokenLimit) {
        if (opts.task === "summarisation" || opts.task === "classification") {
          opts = { ...opts, prompt: midTruncate(opts.prompt, tokenLimit * TOKENS_PER_CHAR) };
        } else {
          // reasoning / agent_step: try remote fallback
          if (this.config.enforceAirGap) {
            throw new Error(
              `Prompt exceeds provider context window and air-gap mode prevents remote fallback`,
            );
          }
          const remote = this.providers.get("remote");
          if (remote !== undefined) {
            try {
              if (await remote.isAvailable()) {
                return remote.generate(opts);
              }
            } catch {
              /* treat as unavailable */
            }
          }
          // No remote available: truncate as last resort
          opts = { ...opts, prompt: midTruncate(opts.prompt, tokenLimit * TOKENS_PER_CHAR) };
        }
      }
    }

    return provider.generate(opts);
  }

  private meetsCapabilityFloor(id: LlmProviderKind, task: LlmTaskType): boolean {
    if (task !== "reasoning" && task !== "agent_step") return true;
    const meta = this.providerMeta.get(id);
    if (meta?.parameterCount === undefined) return true;
    return meta.parameterCount >= this.config.minReasoningParams;
  }

  async getStatus(): Promise<
    Record<LlmTaskType, { providerId: string; modelName: string; reason: string } | undefined>
  > {
    const tasks: LlmTaskType[] = ["classification", "reasoning", "summarisation", "agent_step"];
    const out: Partial<
      Record<LlmTaskType, { providerId: string; modelName: string; reason: string } | undefined>
    > = {};
    for (const t of tasks) {
      const provider = await this.selectProvider(t);
      if (provider === undefined) {
        out[t] = undefined;
        continue;
      }
      const isLocal = LOCAL_PROVIDER_IDS.has(provider.providerId);
      const reason = !isLocal && this.config.enforceAirGap ? "air-gap bypassed" : "default";
      out[t] = { providerId: provider.providerId, modelName: "", reason };
    }
    return out as Record<
      LlmTaskType,
      { providerId: string; modelName: string; reason: string } | undefined
    >;
  }

  private providerPriority(_task: LlmTaskType): LlmProviderKind[] {
    if (this.config.preferLocal) {
      return ["ollama", "llamacpp", "remote"];
    }
    return ["remote", "ollama", "llamacpp"];
  }
}
