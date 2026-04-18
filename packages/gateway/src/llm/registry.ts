import type { Database } from "bun:sqlite";
import { LlmRouter, type LlmRouterConfig } from "./router.ts";
import type { LlmModelInfo, LlmProvider } from "./types.ts";

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
