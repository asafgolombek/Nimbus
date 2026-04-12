/**
 * Phase 3 — hybrid vs BM25 quality gate (MRR@10 on a tiny held-out set).
 *
 * Uses synthetic embeddings (not Xenova) so CI stays deterministic. The plan checklist
 * references `search-quality.bench.ts`; this file is that gate under Bun's `*.test.ts` discovery.
 */
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { upsertIndexedItem } from "../../src/index/item-store.ts";
import { LocalIndex } from "../../src/index/local-index.ts";
import { hybridSearch } from "../../src/search/hybrid.ts";

const MODEL = "search-quality-bench";
const K = 10;

function reciprocalRankAtK(relevantId: string, orderedIds: readonly string[], k: number): number {
  const cap = Math.min(k, orderedIds.length);
  for (let i = 0; i < cap; i++) {
    if (orderedIds[i] === relevantId) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

function vecPrimarily(dim: number, primary: number, strength = 1): Float32Array {
  const v = new Float32Array(dim);
  v[primary] = strength;
  return v;
}

describe("search quality (hybrid vs BM25 MRR@10)", () => {
  test("mean hybrid MRR@10 improves BM25 by ≥10% or rescues zero-recall queries", async () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    const now = Date.now();

    // --- Case A: keyword chaff in title; relevant doc only in body without OAuth token wording ---
    upsertIndexedItem(db, {
      service: "bench",
      type: "doc",
      externalId: "chaff",
      title: "refresh OAuth tokens glossary",
      bodyPreview: "navigation index",
      modifiedAt: now,
      syncedAt: now,
    });
    upsertIndexedItem(db, {
      service: "bench",
      type: "doc",
      externalId: "renewal",
      title: "credential rotation worker",
      bodyPreview: "renews expired access using the refresh grant flow",
      modifiedAt: now,
      syncedAt: now,
    });

    const qOAuth = new Float32Array(384);
    qOAuth[0] = 1;
    qOAuth[1] = 0.05;
    const vChaff = vecPrimarily(384, 2, 1);
    const vRenewal = vecPrimarily(384, 0, 0.99);
    vRenewal[1] = 0.08;

    db.run(`INSERT INTO vec_items_384(rowid, embedding) VALUES (?, vec_f32(?))`, [1n, vChaff]);
    db.run(
      `INSERT INTO embedding_chunk (item_id, chunk_index, chunk_text, vec_rowid, model, dims, embedded_at)
       VALUES (?, 0, 'chaff chunk', 1, ?, 384, ?)`,
      ["bench:chaff", MODEL, now],
    );
    db.run(`INSERT INTO vec_items_384(rowid, embedding) VALUES (?, vec_f32(?))`, [2n, vRenewal]);
    db.run(
      `INSERT INTO embedding_chunk (item_id, chunk_index, chunk_text, vec_rowid, model, dims, embedded_at)
       VALUES (?, 0, 'renewal chunk', 2, ?, 384, ?)`,
      ["bench:renewal", MODEL, now],
    );

    const queryA = "refresh OAuth tokens";
    const bm25A = await hybridSearch(db, {
      query: queryA,
      limit: 50,
      embeddingModel: MODEL,
      semantic: true,
    });
    const hybridA = await hybridSearch(db, {
      query: queryA,
      limit: 50,
      embeddingModel: MODEL,
      semantic: true,
      queryEmbedding: qOAuth,
    });
    const mrrBm25A = reciprocalRankAtK(
      "bench:renewal",
      bm25A.map((r) => r.item.id),
      K,
    );
    const mrrHybridA = reciprocalRankAtK(
      "bench:renewal",
      hybridA.map((r) => r.item.id),
      K,
    );
    expect(mrrBm25A).toBe(0);
    expect(mrrHybridA).toBeGreaterThan(0);

    // --- Case B: same shape as hybrid.test — vector-only relevant row for the query term ---
    upsertIndexedItem(db, {
      service: "bench",
      type: "file",
      externalId: "fts",
      title: "keyword match here",
      bodyPreview: "none",
      modifiedAt: now + 1,
      syncedAt: now + 1,
    });
    upsertIndexedItem(db, {
      service: "bench",
      type: "file",
      externalId: "vec",
      title: "unrelated title",
      bodyPreview: "other",
      modifiedAt: now + 1,
      syncedAt: now + 1,
    });
    const vFts = vecPrimarily(384, 3, 1);
    const vVecOnly = vecPrimarily(384, 0, 0.99);
    vVecOnly[1] = 0.02;
    db.run(`INSERT INTO vec_items_384(rowid, embedding) VALUES (?, vec_f32(?))`, [3n, vFts]);
    db.run(
      `INSERT INTO embedding_chunk (item_id, chunk_index, chunk_text, vec_rowid, model, dims, embedded_at)
       VALUES (?, 0, 'fts chunk', 3, ?, 384, ?)`,
      ["bench:fts", MODEL, now + 1],
    );
    db.run(`INSERT INTO vec_items_384(rowid, embedding) VALUES (?, vec_f32(?))`, [4n, vVecOnly]);
    db.run(
      `INSERT INTO embedding_chunk (item_id, chunk_index, chunk_text, vec_rowid, model, dims, embedded_at)
       VALUES (?, 0, 'vec chunk', 4, ?, 384, ?)`,
      ["bench:vec", MODEL, now + 1],
    );

    const queryB = "keyword";
    const qKw = new Float32Array(384);
    qKw[0] = 1;
    qKw[1] = 0.03;
    const bm25B = await hybridSearch(db, {
      query: queryB,
      limit: 50,
      embeddingModel: MODEL,
      semantic: true,
    });
    const hybridB = await hybridSearch(db, {
      query: queryB,
      limit: 50,
      embeddingModel: MODEL,
      semantic: true,
      queryEmbedding: qKw,
    });
    const mrrBm25B = reciprocalRankAtK(
      "bench:vec",
      bm25B.map((r) => r.item.id),
      K,
    );
    const mrrHybridB = reciprocalRankAtK(
      "bench:vec",
      hybridB.map((r) => r.item.id),
      K,
    );
    expect(mrrBm25B).toBe(0);
    expect(mrrHybridB).toBeGreaterThan(0);

    // --- Case C: both rows in BM25; decoy ranks ahead unless vector pulls the target up ---
    upsertIndexedItem(db, {
      service: "bench",
      type: "note",
      externalId: "decoy",
      title: "Zurich project budget overview table of contents",
      bodyPreview: "index",
      modifiedAt: now + 2,
      syncedAt: now + 2,
    });
    upsertIndexedItem(db, {
      service: "bench",
      type: "note",
      externalId: "target",
      title: "weekly rollup",
      bodyPreview: "Zurich project budget variance analysis for leadership",
      modifiedAt: now + 2,
      syncedAt: now + 2,
    });
    const vDecoyZ = vecPrimarily(384, 10, 1);
    const vTargetZ = vecPrimarily(384, 5, 1);
    vTargetZ[6] = 0.4;
    db.run(`INSERT INTO vec_items_384(rowid, embedding) VALUES (?, vec_f32(?))`, [5n, vDecoyZ]);
    db.run(
      `INSERT INTO embedding_chunk (item_id, chunk_index, chunk_text, vec_rowid, model, dims, embedded_at)
       VALUES (?, 0, 'decoy z', 5, ?, 384, ?)`,
      ["bench:decoy", MODEL, now + 2],
    );
    db.run(`INSERT INTO vec_items_384(rowid, embedding) VALUES (?, vec_f32(?))`, [6n, vTargetZ]);
    db.run(
      `INSERT INTO embedding_chunk (item_id, chunk_index, chunk_text, vec_rowid, model, dims, embedded_at)
       VALUES (?, 0, 'target z chunk', 6, ?, 384, ?)`,
      ["bench:target", MODEL, now + 2],
    );

    const queryC = "Zurich project budget";
    const qZ = new Float32Array(384);
    qZ[5] = 1;
    qZ[6] = 0.35;
    const bm25C = await hybridSearch(db, {
      query: queryC,
      limit: 50,
      embeddingModel: MODEL,
      semantic: true,
    });
    const hybridC = await hybridSearch(db, {
      query: queryC,
      limit: 50,
      embeddingModel: MODEL,
      semantic: true,
      queryEmbedding: qZ,
    });
    const mrrBm25C = reciprocalRankAtK(
      "bench:target",
      bm25C.map((r) => r.item.id),
      K,
    );
    const mrrHybridC = reciprocalRankAtK(
      "bench:target",
      hybridC.map((r) => r.item.id),
      K,
    );
    expect(mrrBm25C).toBeGreaterThan(0);
    expect(mrrHybridC).toBeGreaterThan(0);
    expect(mrrHybridC).toBeGreaterThanOrEqual(mrrBm25C * 1.1 - 1e-9);

    const meanBm25 = (mrrBm25A + mrrBm25B + mrrBm25C) / 3;
    const meanHybrid = (mrrHybridA + mrrHybridB + mrrHybridC) / 3;
    expect(meanHybrid).toBeGreaterThan(meanBm25 * 1.1 - 1e-9);
  });
});
