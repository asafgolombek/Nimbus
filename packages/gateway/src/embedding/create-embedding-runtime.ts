import type { Database } from "bun:sqlite";
import { join } from "node:path";
import type { Logger } from "pino";

import type { NimbusEmbeddingToml } from "../config/nimbus-toml.ts";
import { readIndexedUserVersion } from "../index/migrations/runner.ts";
import { processEnvGet } from "../platform/env-access.ts";
import type { PlatformPaths } from "../platform/paths.ts";
import type { EmbeddingRuntime } from "./embedding-runtime.ts";
import { createLazyEmbeddingRuntime } from "./lazy-scheduler.ts";
import { tryCreateEmbeddingWorkerBridge } from "./worker-bridge.ts";

/**
 * Tries the Bun embedding worker first, then falls back to in-process lazy loading.
 */
export async function createEmbeddingRuntime(
  db: Database,
  paths: PlatformPaths,
  logger: Logger,
  tomlEmbedding: NimbusEmbeddingToml,
  envAllowsEmbeddings: boolean,
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
  if (tomlEmbedding.provider === "openai") {
    logger.warn(
      "OpenAI embedding provider is not implemented yet; semantic features stay disabled",
    );
    return null;
  }

  const dbPath = join(paths.dataDir, "nimbus.db");
  const slice = {
    chunkTokens: tomlEmbedding.chunkTokens,
    chunkOverlapTokens: tomlEmbedding.chunkOverlapTokens,
    backfillBatchSize: tomlEmbedding.backfillBatchSize,
  };

  const worker = await tryCreateEmbeddingWorkerBridge(dbPath, paths.dataDir, slice, logger);
  if (worker !== null) {
    return worker;
  }
  return createLazyEmbeddingRuntime(db, paths.dataDir, logger, slice);
}
