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

const LOCAL_PROVIDER_IDS: ReadonlySet<LlmProviderKind> = new Set(["ollama", "llamacpp"]);

export class LlmRouter {
  private readonly providers = new Map<LlmProviderKind, LlmProvider>();
  private readonly config: LlmRouterConfig;

  constructor(config: LlmRouterConfig) {
    this.config = config;
  }

  registerProvider(provider: LlmProvider): void {
    this.providers.set(provider.providerId, provider);
  }

  async selectProvider(task: LlmTaskType): Promise<LlmProvider | undefined> {
    const orderedIds = this.providerPriority(task);
    for (const id of orderedIds) {
      if (this.config.enforceAirGap && !LOCAL_PROVIDER_IDS.has(id)) {
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
    return provider.generate(opts);
  }

  private providerPriority(_task: LlmTaskType): LlmProviderKind[] {
    if (this.config.preferLocal) {
      return ["ollama", "llamacpp", "remote"];
    }
    return ["remote", "ollama", "llamacpp"];
  }
}
