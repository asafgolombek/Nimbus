import type { Database } from "bun:sqlite";
import { join } from "node:path";
import type { Logger } from "pino";

import { readIndexedUserVersion } from "../index/migrations/runner.ts";
import { ensureSqliteVecForConnection } from "../index/sqlite-vec-load.ts";
import { createLocalEmbedder } from "./model.ts";
import { SqliteEmbeddingPipeline } from "./pipeline.ts";
import type { IndexedItem } from "./types.ts";

/**
 * Returns a fire-and-forget callback that lazily loads the ONNX embedder on first use.
 */
export function createLazyItemEmbeddingScheduler(
  db: Database,
  dataDir: string,
  logger: Logger,
): (itemId: string) => void {
  let pipeline: SqliteEmbeddingPipeline | null = null;
  let loading: Promise<SqliteEmbeddingPipeline | null> | null = null;

  async function ensurePipeline(): Promise<SqliteEmbeddingPipeline | null> {
    const uv = readIndexedUserVersion(db);
    if (uv < 6) {
      return null;
    }
    if (!ensureSqliteVecForConnection(db, uv)) {
      logger.warn("sqlite-vec unavailable; semantic embeddings disabled for this process");
      return null;
    }
    if (pipeline !== null) {
      return pipeline;
    }
    if (loading === null) {
      loading = (async (): Promise<SqliteEmbeddingPipeline | null> => {
        try {
          const embedder = await createLocalEmbedder({ cacheDir: join(dataDir, "models") });
          return new SqliteEmbeddingPipeline({ db, embedder, logger });
        } catch (err) {
          logger.warn({ err }, "failed to initialize local embedding pipeline");
          return null;
        }
      })();
    }
    const resolved = await loading;
    loading = null;
    if (resolved !== null) {
      pipeline = resolved;
    }
    return resolved;
  }

  return (itemId: string) => {
    void (async () => {
      const p = await ensurePipeline();
      if (p === null) {
        return;
      }
      const row = db.query(`SELECT id, title, body_preview FROM item WHERE id = ?`).get(itemId) as
        | IndexedItem
        | null
        | undefined;
      if (row === null || row === undefined) {
        return;
      }
      await p.embedItem(row);
    })().catch((err: unknown) => {
      logger.warn({ err, itemId }, "embedding item failed");
    });
  };
}
