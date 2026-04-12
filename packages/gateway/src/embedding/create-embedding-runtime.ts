import type { Database } from "bun:sqlite";
import { join } from "node:path";
import type { Logger } from "pino";

import type { NimbusEmbeddingToml } from "../config/nimbus-toml.ts";
import { readIndexedUserVersion } from "../index/migrations/runner.ts";
import { processEnvGet } from "../platform/env-access.ts";
import type { PlatformPaths } from "../platform/paths.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import type { EmbeddingRuntime } from "./embedding-runtime.ts";
import { createLazyEmbeddingRuntime } from "./lazy-scheduler.ts";
import { createOpenAIEmbedder } from "./openai-embedder.ts";
import { tryCreateEmbeddingWorkerBridge } from "./worker-bridge.ts";

/**
 * Tries the Bun embedding worker first (local provider only), then falls back to in-process lazy loading.
 */
export async function createEmbeddingRuntime(
  db: Database,
  paths: PlatformPaths,
  logger: Logger,
  tomlEmbedding: NimbusEmbeddingToml,
  envAllowsEmbeddings: boolean,
  vault: NimbusVault,
): Promise<EmbeddingRuntime | null> {
  if (processEnvGet("NIMBUS_SKIP_EMBEDDING_RUNTIME") === "1") {
    return null;
  }
  if (!envAllowsEmbeddings || !tomlEmbedding.enabled) {
    return null;
  }
  if (readIndexedUserVersion(db) < 6) {
    return null;
  }

  const slice = {
    chunkTokens: tomlEmbedding.chunkTokens,
    chunkOverlapTokens: tomlEmbedding.chunkOverlapTokens,
    backfillBatchSize: tomlEmbedding.backfillBatchSize,
  };

  if (tomlEmbedding.provider === "openai") {
    let apiKey = processEnvGet("OPENAI_API_KEY")?.trim() ?? "";
    if (apiKey === "") {
      const v = await vault.get("openai.api_key");
      apiKey = typeof v === "string" ? v.trim() : "";
    }
    if (apiKey === "") {
      logger.warn("OpenAI embedding: set OPENAI_API_KEY or vault key openai.api_key");
      return null;
    }
    let openaiModel = tomlEmbedding.model.trim();
    if (
      openaiModel === "" ||
      openaiModel.includes("MiniLM") ||
      openaiModel.toLowerCase().includes("xenova")
    ) {
      openaiModel = "text-embedding-3-small";
    }
    try {
      const embedder = await createOpenAIEmbedder({ apiKey, model: openaiModel, dimensions: 384 });
      return createLazyEmbeddingRuntime(db, paths.dataDir, logger, slice, embedder);
    } catch (err) {
      logger.warn({ err }, "OpenAI embedder init failed");
      return null;
    }
  }

  const dbPath = join(paths.dataDir, "nimbus.db");
  const worker = await tryCreateEmbeddingWorkerBridge(dbPath, paths.dataDir, slice, logger);
  if (worker !== null) {
    return worker;
  }
  return createLazyEmbeddingRuntime(db, paths.dataDir, logger, slice);
}
