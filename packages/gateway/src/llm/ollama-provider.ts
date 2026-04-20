import type {
  LlmGenerateOptions,
  LlmGenerateResult,
  LlmModelInfo,
  LlmProvider,
  PullProgressChunk,
} from "./types.ts";

type OllamaTagsModel = {
  name?: unknown;
  details?: { parameter_size?: unknown; quantization_level?: unknown };
  size?: unknown;
};

type OllamaTagsResponse = {
  models?: OllamaTagsModel[];
};

type OllamaGenerateChunk = {
  response?: string;
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
};

function parseBillions(raw: unknown): number | undefined {
  if (typeof raw !== "string") return undefined;
  const m = /^([\d.]+)B$/i.exec(raw.trim());
  if (m === null) return undefined;
  const n = Number.parseFloat(m[1] ?? "");
  return Number.isFinite(n) ? n : undefined;
}

function parseVramMb(sizeBytes: unknown): number | undefined {
  if (typeof sizeBytes !== "number" || !Number.isFinite(sizeBytes)) return undefined;
  return Math.round(sizeBytes / (1024 * 1024));
}

function processStreamLine(
  line: string,
  state: { text: string; tokensIn: number; tokensOut: number },
  onToken?: (token: string) => void,
): void {
  const trimmed = line.trim();
  if (trimmed === "") return;
  try {
    const chunk = JSON.parse(trimmed) as OllamaGenerateChunk;
    const token = chunk.response ?? "";
    if (token !== "") {
      state.text += token;
      onToken?.(token);
    }
    if (chunk.done === true) {
      state.tokensIn = chunk.prompt_eval_count ?? 0;
      state.tokensOut = chunk.eval_count ?? 0;
    }
  } catch {
    /* ignore malformed chunk lines */
  }
}

function parseOllamaModel(raw: OllamaTagsModel): LlmModelInfo | undefined {
  if (typeof raw.name !== "string" || raw.name === "") return undefined;
  const parameterCount = parseBillions(raw.details?.parameter_size);
  const quantizationLevel = raw.details?.quantization_level;
  const quantization = typeof quantizationLevel === "string" ? quantizationLevel : undefined;
  const vramEstimateMb = parseVramMb(raw.size);
  return {
    provider: "ollama",
    modelName: raw.name,
    ...(parameterCount !== undefined && { parameterCount }),
    ...(quantization !== undefined && { quantization }),
    ...(vramEstimateMb !== undefined && { vramEstimateMb }),
  };
}

export class OllamaProvider implements LlmProvider {
  readonly providerId = "ollama" as const;
  private readonly baseUrl: string;
  private readonly modelName: string;

  constructor(baseUrl = "http://127.0.0.1:11434", modelName = "llama3.2") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.modelName = modelName;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<LlmModelInfo[]> {
    const resp = await fetch(`${this.baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      throw new Error(`Ollama listModels HTTP ${resp.status}`);
    }
    const data = (await resp.json()) as OllamaTagsResponse;
    if (!Array.isArray(data.models)) return [];
    const out: LlmModelInfo[] = [];
    for (const m of data.models) {
      const parsed = parseOllamaModel(m);
      if (parsed !== undefined) out.push(parsed);
    }
    return out;
  }

  async generate(opts: LlmGenerateOptions): Promise<LlmGenerateResult> {
    if (opts.stream === true) {
      return this.generateStream(opts);
    }
    return this.generateBatch(opts);
  }

  private async generateBatch(opts: LlmGenerateOptions): Promise<LlmGenerateResult> {
    const body = {
      model: this.modelName,
      prompt: opts.prompt,
      system: opts.systemPrompt,
      stream: false,
      options: {
        num_predict: opts.maxTokens ?? 2048,
        temperature: opts.temperature ?? 0.7,
      },
    };
    const resp = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    if (!resp.ok) throw new Error(`Ollama generate HTTP ${resp.status}`);
    const data = (await resp.json()) as OllamaGenerateChunk;
    return {
      text: typeof data.response === "string" ? data.response : "",
      tokensIn: data.prompt_eval_count ?? 0,
      tokensOut: data.eval_count ?? 0,
      modelUsed: this.modelName,
      isLocal: true,
      provider: "ollama",
    };
  }

  private async generateStream(opts: LlmGenerateOptions): Promise<LlmGenerateResult> {
    const body = {
      model: this.modelName,
      prompt: opts.prompt,
      system: opts.systemPrompt,
      stream: true,
      options: {
        num_predict: opts.maxTokens ?? 2048,
        temperature: opts.temperature ?? 0.7,
      },
    };
    const resp = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    if (!resp.ok) throw new Error(`Ollama stream HTTP ${resp.status}`);

    const reader = resp.body?.getReader();
    if (reader === undefined) throw new Error("No response body");

    const decoder = new TextDecoder();
    const state = { text: "", tokensIn: 0, tokensOut: 0 };
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        processStreamLine(line, state, opts.onToken);
      }
    }
    return {
      text: state.text,
      tokensIn: state.tokensIn,
      tokensOut: state.tokensOut,
      modelUsed: this.modelName,
      isLocal: true,
      provider: "ollama",
    };
  }

  async pullModel(
    modelName: string,
    opts: { signal?: AbortSignal; onProgress?: (p: PullProgressChunk) => void } = {},
  ): Promise<void> {
    const resp = await fetch(`${this.baseUrl}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelName, stream: true }),
      signal: opts.signal ?? null,
    });
    if (!resp.ok) throw new Error(`Ollama pullModel HTTP ${resp.status}`);
    const reader = resp.body?.getReader();
    if (reader === undefined) throw new Error("No response body");
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === "") continue;
        try {
          const chunk = JSON.parse(trimmed) as {
            status?: unknown;
            completed?: unknown;
            total?: unknown;
          };
          const progress: PullProgressChunk = {
            status: typeof chunk.status === "string" ? chunk.status : "",
            ...(typeof chunk.completed === "number" && { completedBytes: chunk.completed }),
            ...(typeof chunk.total === "number" && { totalBytes: chunk.total }),
          };
          opts.onProgress?.(progress);
        } catch {
          /* ignore malformed chunk */
        }
      }
    }
  }
}
