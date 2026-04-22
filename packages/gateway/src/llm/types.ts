export type LlmTaskType = "classification" | "reasoning" | "summarisation" | "agent_step";

export type LlmProviderKind = "ollama" | "llamacpp" | "remote";

export type LlmModelInfo = {
  provider: LlmProviderKind;
  modelName: string;
  /** Model parameter count in billions (optional — Ollama populates this). */
  parameterCount?: number;
  /** Maximum context window in tokens. */
  contextWindow?: number;
  /** Quantization tag, e.g. "Q4_K_M". */
  quantization?: string;
  /** Estimated VRAM usage in MB. */
  vramEstimateMb?: number;
};

export type LlmGenerateOptions = {
  task: LlmTaskType;
  /** The full prompt to send (caller assembles system + user turn). */
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  /** When true the provider streams tokens via onToken. */
  stream?: boolean;
  onToken?: (token: string) => void;
};

export type LlmGenerateResult = {
  text: string;
  tokensIn: number;
  tokensOut: number;
  modelUsed: string;
  isLocal: boolean;
  provider: LlmProviderKind;
};

export type PullProgressChunk = {
  status: string;
  completedBytes?: number;
  totalBytes?: number;
};

export interface LlmProvider {
  readonly providerId: LlmProviderKind;
  isAvailable(): Promise<boolean>;
  listModels(): Promise<LlmModelInfo[]>;
  generate(opts: LlmGenerateOptions): Promise<LlmGenerateResult>;
  pullModel?(
    modelName: string,
    opts: { signal?: AbortSignal; onProgress?: (p: PullProgressChunk) => void },
  ): Promise<void>;
}
