import type { Database } from "bun:sqlite";
import type { Logger } from "pino";

import { chunkText, itemTextForEmbedding } from "./chunker.ts";
import type { Embedder, EmbeddingPipeline, IndexedItem } from "./types.ts";

const DEFAULT_BACKFILL_BATCH = 50;

export type SqliteEmbeddingPipelineOptions = {
  db: Database;
  embedder: Embedder;
  backfillBatchSize?: number;
  logger?: Logger;
};

/**
 * Writes embeddings to `vec_items_384` + `embedding_chunk` for the local index (schema v6+).
 */
export class SqliteEmbeddingPipeline implements EmbeddingPipeline {
  private readonly db: Database;
  private readonly embedder: Embedder;
  private readonly backfillBatchSize: number;
  private readonly logger: Logger | undefined;

  constructor(options: SqliteEmbeddingPipelineOptions) {
    this.db = options.db;
    this.embedder = options.embedder;
    this.backfillBatchSize = Math.max(1, options.backfillBatchSize ?? DEFAULT_BACKFILL_BATCH);
    this.logger = options.logger;
  }

  async embedItem(item: IndexedItem): Promise<void> {
    const fullText = itemTextForEmbedding(item);
    const pieces = chunkText(fullText);
    if (pieces.length === 0) {
      return;
    }

    const vectors = await this.embedder.embed(pieces);
    if (vectors.length !== pieces.length) {
      throw new Error(`embedder returned ${vectors.length} vectors for ${pieces.length} chunks`);
    }
    for (const v of vectors) {
      if (v.length !== this.embedder.dims) {
        throw new Error(
          `expected ${String(this.embedder.dims)}-dim embedding, got ${String(v.length)}`,
        );
      }
    }

    const model = this.embedder.model;
    const dims = this.embedder.dims;
    const now = Date.now();
    const itemId = item.id;

    this.db.transaction(() => {
      this.db.run(`DELETE FROM embedding_chunk WHERE item_id = ? AND model = ?`, [itemId, model]);

      const maxRow = this.db
        .query(`SELECT COALESCE(MAX(rowid), 0) AS m FROM vec_items_384`)
        .get() as { m: number | bigint };
      let nextRowid = Number(maxRow.m) + 1;

      const insertVec = this.db.prepare(
        `INSERT INTO vec_items_384(rowid, embedding) VALUES (?, vec_f32(?))`,
      );
      const insertChunk = this.db.prepare(
        `INSERT INTO embedding_chunk (item_id, chunk_index, chunk_text, vec_rowid, model, dims, embedded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );

      for (let i = 0; i < pieces.length; i++) {
        const text = pieces[i] ?? "";
        const vec = vectors[i];
        if (vec === undefined) {
          throw new Error(`missing vector for chunk ${String(i)}`);
        }
        const rowid = nextRowid;
        nextRowid += 1;
        insertVec.run(BigInt(rowid), new Float32Array(vec));
        insertChunk.run(itemId, i, text, rowid, model, dims, now);
      }
    })();
  }

  async deleteItemEmbeddings(itemId: string): Promise<void> {
    this.db.run(`DELETE FROM embedding_chunk WHERE item_id = ?`, [itemId]);
  }

  async backfillAll(onProgress?: (done: number, total: number) => void): Promise<void> {
    const model = this.embedder.model;
    const totalRow = this.db
      .query(
        `SELECT COUNT(*) AS c FROM item i WHERE NOT EXISTS (
           SELECT 1 FROM embedding_chunk c
           WHERE c.item_id = i.id AND c.model = ?
         )`,
      )
      .get(model) as { c: number };
    const total = totalRow.c;
    let done = 0;

    while (true) {
      const rows = this.db
        .query(
          `SELECT i.id AS id, i.title AS title, i.body_preview AS body_preview
           FROM item i WHERE NOT EXISTS (
             SELECT 1 FROM embedding_chunk c
             WHERE c.item_id = i.id AND c.model = ?
           )
           ORDER BY i.modified_at DESC
           LIMIT ?`,
        )
        .all(model, this.backfillBatchSize) as IndexedItem[];

      if (rows.length === 0) {
        break;
      }
      for (const row of rows) {
        try {
          await this.embedItem(row);
        } catch (err) {
          this.logger?.warn({ err, itemId: row.id }, "embedding backfill item failed");
        }
        done += 1;
        onProgress?.(done, total);
      }
    }
  }
}
