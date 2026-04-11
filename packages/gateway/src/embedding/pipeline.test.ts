import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { upsertIndexedItem } from "../index/item-store.ts";
import { LocalIndex } from "../index/local-index.ts";
import { SqliteEmbeddingPipeline } from "./pipeline.ts";
import type { Embedder } from "./types.ts";

function mockEmbedder(dim: number, model: string): Embedder {
  return {
    model,
    dims: dim,
    async embed(texts: string[]) {
      return texts.map(() => new Float32Array(dim).fill(0.01));
    },
  };
}

describe("SqliteEmbeddingPipeline", () => {
  test("embedItem writes chunks and vectors; item delete cascades", async () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    const now = Date.now();
    upsertIndexedItem(db, {
      service: "filesystem",
      type: "file",
      externalId: "f1",
      title: "alpha",
      bodyPreview: "beta gamma",
      modifiedAt: now,
      syncedAt: now,
    });
    const itemId = "filesystem:f1";

    const pipeline = new SqliteEmbeddingPipeline({
      db,
      embedder: mockEmbedder(384, "test-model"),
    });
    await pipeline.embedItem({
      id: itemId,
      title: "alpha",
      body_preview: "beta gamma",
    });

    const chunkCount = db.query("SELECT COUNT(*) AS c FROM embedding_chunk").get() as { c: number };
    expect(chunkCount.c).toBeGreaterThanOrEqual(1);
    const vecCount = db.query("SELECT COUNT(*) AS c FROM vec_items_384").get() as { c: number };
    expect(vecCount.c).toBe(chunkCount.c);

    db.run("DELETE FROM item WHERE id = ?", [itemId]);
    expect((db.query("SELECT COUNT(*) AS c FROM embedding_chunk").get() as { c: number }).c).toBe(
      0,
    );
    expect((db.query("SELECT COUNT(*) AS c FROM vec_items_384").get() as { c: number }).c).toBe(0);
  });

  test("deleteItemEmbeddings removes rows without deleting item", async () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    const now = Date.now();
    upsertIndexedItem(db, {
      service: "s",
      type: "file",
      externalId: "x",
      title: "t",
      modifiedAt: now,
      syncedAt: now,
    });
    const itemId = "s:x";
    const pipeline = new SqliteEmbeddingPipeline({ db, embedder: mockEmbedder(384, "m2") });
    await pipeline.embedItem({ id: itemId, title: "t", body_preview: null });
    await pipeline.deleteItemEmbeddings(itemId);
    expect((db.query("SELECT COUNT(*) AS c FROM embedding_chunk").get() as { c: number }).c).toBe(
      0,
    );
    const row = db.query("SELECT id FROM item WHERE id = ?").get(itemId);
    expect(row).not.toBeNull();
  });

  test("backfillAll embeds items missing the current model", async () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    const now = Date.now();
    for (const ext of ["a", "b"]) {
      upsertIndexedItem(db, {
        service: "s",
        type: "file",
        externalId: ext,
        title: `title ${ext}`,
        modifiedAt: now,
        syncedAt: now,
      });
    }
    const pipeline = new SqliteEmbeddingPipeline({
      db,
      embedder: mockEmbedder(384, "bf"),
      backfillBatchSize: 1,
    });
    let last: [number, number] = [0, 0];
    await pipeline.backfillAll((done, total) => {
      last = [done, total];
    });
    expect(last[1]).toBe(2);
    expect(last[0]).toBe(2);
    const c = db
      .query("SELECT COUNT(DISTINCT item_id) AS c FROM embedding_chunk WHERE model = 'bf'")
      .get() as {
      c: number;
    };
    expect(c.c).toBe(2);
  });
});
