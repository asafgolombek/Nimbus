import type { Database } from "bun:sqlite";
import { LlmRouter, type LlmRouterConfig } from "./router.ts";
import type { LlmModelInfo, LlmProvider, PullProgressChunk } from "./types.ts";

export type LlmRegistryOptions = {
  config: LlmRouterConfig;
  db?: Database;
};

export class LlmRegistry {
  private readonly router: LlmRouter;
  private readonly db: Database | undefined;

  constructor(opts: LlmRegistryOptions) {
    this.router = new LlmRouter(opts.config);
    this.db = opts.db;
  }

  addProvider(provider: LlmProvider): void {
    this.router.registerProvider(provider);
  }

  get llmRouter(): LlmRouter {
    return this.router;
  }

  async listAllModels(): Promise<LlmModelInfo[]> {
    const results: LlmModelInfo[] = [];
    const providerIds = ["ollama", "llamacpp", "remote"] as const;
    for (const id of providerIds) {
      try {
        const provider = (
          this.router as unknown as { providers: Map<string, LlmProvider> }
        ).providers?.get(id);
        if (provider === undefined) continue;
        if (!(await provider.isAvailable())) continue;
        const models = await provider.listModels();
        results.push(...models);
        this.syncModelsToDb(models);
      } catch {
        /* provider error — skip */
      }
    }
    return results;
  }

  async checkAvailability(): Promise<Record<string, boolean>> {
    const result: Record<string, boolean> = {};
    const providerIds = ["ollama", "llamacpp", "remote"] as const;
    for (const id of providerIds) {
      try {
        const provider = (
          this.router as unknown as { providers: Map<string, LlmProvider> }
        ).providers?.get(id);
        if (provider === undefined) continue;
        result[id] = await provider.isAvailable();
      } catch {
        result[id] = false;
      }
    }
    return result;
  }

  async loadModel(provider: "ollama" | "llamacpp", modelName: string): Promise<void> {
    const p = (this.router as unknown as { providers: Map<string, LlmProvider> }).providers?.get(
      provider,
    );
    if (p === undefined) throw new Error(`Provider not registered: ${provider}`);
    if (typeof (p as unknown as { loadModel?: unknown }).loadModel === "function") {
      await (p as unknown as { loadModel: (m: string) => Promise<void> }).loadModel(modelName);
    }
    // Ollama auto-loads on first generate; this is a no-op for Ollama.
  }

  async unloadModel(provider: "ollama" | "llamacpp", modelName: string): Promise<void> {
    const p = (this.router as unknown as { providers: Map<string, LlmProvider> }).providers?.get(
      provider,
    );
    if (p === undefined) throw new Error(`Provider not registered: ${provider}`);
    if (typeof (p as unknown as { unloadModel?: unknown }).unloadModel === "function") {
      await (p as unknown as { unloadModel: (m: string) => Promise<void> }).unloadModel(modelName);
    }
  }

  async pullModel(
    provider: "ollama" | "llamacpp",
    modelName: string,
    opts: { signal?: AbortSignal; onProgress?: (p: PullProgressChunk) => void } = {},
  ): Promise<void> {
    const p = (this.router as unknown as { providers: Map<string, LlmProvider> }).providers?.get(
      provider,
    );
    if (p === undefined) throw new Error(`Provider not registered: ${provider}`);
    if (typeof p.pullModel !== "function") {
      throw new Error(`Provider ${provider} does not support pullModel`);
    }
    await p.pullModel(modelName, opts);
  }

  async setDefault(
    taskType: "classification" | "embedding" | "reasoning" | "generation",
    provider: "ollama" | "llamacpp" | "remote",
    modelName: string,
  ): Promise<void> {
    if (this.db === undefined) return;
    this.db.run(
      `INSERT INTO llm_task_defaults (task_type, provider, model_name, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(task_type) DO UPDATE SET
         provider = excluded.provider,
         model_name = excluded.model_name,
         updated_at = excluded.updated_at`,
      [taskType, provider, modelName, Date.now()],
    );
  }

  async getRouterStatus(): Promise<Awaited<ReturnType<LlmRouter["getStatus"]>>> {
    return await this.router.getStatus();
  }

  getDefault(taskType: string): { provider: string; modelName: string } | undefined {
    if (this.db === undefined) return undefined;
    const row = this.db
      .query("SELECT provider, model_name FROM llm_task_defaults WHERE task_type = ?")
      .get(taskType) as { provider: string; model_name: string } | undefined;
    return row === undefined ? undefined : { provider: row.provider, modelName: row.model_name };
  }

  private syncModelsToDb(models: LlmModelInfo[]): void {
    if (this.db === undefined) return;
    const now = Date.now();
    for (const m of models) {
      try {
        this.db.run(
          `INSERT INTO llm_models (provider, model_name, parameter_count, context_window, quantization, vram_estimate_mb, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(provider, model_name) DO UPDATE SET
             parameter_count = excluded.parameter_count,
             context_window = excluded.context_window,
             quantization = excluded.quantization,
             vram_estimate_mb = excluded.vram_estimate_mb,
             last_seen_at = excluded.last_seen_at`,
          [
            m.provider,
            m.modelName,
            m.parameterCount ?? null,
            m.contextWindow ?? null,
            m.quantization ?? null,
            m.vramEstimateMb ?? null,
            now,
          ],
        );
      } catch {
        /* best-effort */
      }
    }
  }
}
