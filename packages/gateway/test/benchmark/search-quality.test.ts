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
import { isVecLoaded, tryLoadSqliteVec } from "../../src/index/sqlite-vec-load.ts";
import { hybridSearch } from "../../src/search/hybrid.ts";
import type { HybridSearchResult } from "../../src/search/hybrid-types.ts";

const MODEL = "search-quality-bench";
const K = 10;

function vecAvailable(): boolean {
  const db = new Database(":memory:");
  tryLoadSqliteVec(db);
  const ok = isVecLoaded(db);
  db.close();
  return ok;
}
const VEC_AVAILABLE = vecAvailable();

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

function insertVec384AndEmbeddingChunk(
  db: Database,
  rowid: number,
  embedding: Float32Array,
  itemId: string,
  chunkText: string,
  embeddedAt: number,
): void {
  db.run(`INSERT INTO vec_items_384(rowid, embedding) VALUES (?, vec_f32(?))`, [
    BigInt(rowid),
    embedding,
  ]);
  db.run(
    `INSERT INTO embedding_chunk (item_id, chunk_index, chunk_text, vec_rowid, model, dims, embedded_at)
     VALUES (?, 0, ?, ?, ?, 384, ?)`,
    [itemId, chunkText, rowid, MODEL, embeddedAt],
  );
}

async function bm25ThenHybridWithEmbedding(
  db: Database,
  query: string,
  queryEmbedding: Float32Array,
): Promise<{ bm25: HybridSearchResult[]; hybrid: HybridSearchResult[] }> {
  const common = { query, limit: 50, embeddingModel: MODEL, semantic: true as const };
  const bm25 = await hybridSearch(db, common);
  const hybrid = await hybridSearch(db, { ...common, queryEmbedding });
  return { bm25, hybrid };
}

describe.skipIf(!VEC_AVAILABLE)("search quality (hybrid vs BM25 MRR@10)", () => {
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

    insertVec384AndEmbeddingChunk(db, 1, vChaff, "bench:chaff", "chaff chunk", now);
    insertVec384AndEmbeddingChunk(db, 2, vRenewal, "bench:renewal", "renewal chunk", now);

    const queryA = "refresh OAuth tokens";
    const { bm25: bm25A, hybrid: hybridA } = await bm25ThenHybridWithEmbedding(db, queryA, qOAuth);
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
    insertVec384AndEmbeddingChunk(db, 3, vFts, "bench:fts", "fts chunk", now + 1);
    insertVec384AndEmbeddingChunk(db, 4, vVecOnly, "bench:vec", "vec chunk", now + 1);

    const queryB = "keyword";
    const qKw = new Float32Array(384);
    qKw[0] = 1;
    qKw[1] = 0.03;
    const { bm25: bm25B, hybrid: hybridB } = await bm25ThenHybridWithEmbedding(db, queryB, qKw);
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
    insertVec384AndEmbeddingChunk(db, 5, vDecoyZ, "bench:decoy", "decoy z", now + 2);
    insertVec384AndEmbeddingChunk(db, 6, vTargetZ, "bench:target", "target z chunk", now + 2);

    const queryC = "Zurich project budget";
    const qZ = new Float32Array(384);
    qZ[5] = 1;
    qZ[6] = 0.35;
    const { bm25: bm25C, hybrid: hybridC } = await bm25ThenHybridWithEmbedding(db, queryC, qZ);
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

describe.skipIf(!VEC_AVAILABLE)("search quality (code_symbol body vs title)", () => {
  test("hybrid surfaces semantic body match when title omits query wording", async () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    const now = Date.now();

    upsertIndexedItem(db, {
      service: "bench",
      type: "code_symbol",
      externalId: "decoy-fn",
      title: "parseDate",
      bodyPreview: "legacy date parser",
      modifiedAt: now,
      syncedAt: now,
    });
    upsertIndexedItem(db, {
      service: "bench",
      type: "code_symbol",
      externalId: "target-fn",
      title: "normalizeUserInput",
      bodyPreview: "sanitizes credentials and refresh token handling",
      modifiedAt: now,
      syncedAt: now,
    });

    const vDecoy = vecPrimarily(384, 20, 1);
    const vTarget = vecPrimarily(384, 7, 0.99);
    vTarget[8] = 0.12;
    insertVec384AndEmbeddingChunk(db, 11, vDecoy, "bench:decoy-fn", "decoy chunk", now);
    insertVec384AndEmbeddingChunk(db, 12, vTarget, "bench:target-fn", "target chunk", now);

    const query = "refresh token handling";
    const qEmbed = new Float32Array(384);
    qEmbed[7] = 1;
    qEmbed[8] = 0.1;
    const { bm25, hybrid } = await bm25ThenHybridWithEmbedding(db, query, qEmbed);

    expect(
      reciprocalRankAtK(
        "bench:target-fn",
        bm25.map((r) => r.item.id),
        K,
      ),
    ).toBe(0);
    expect(
      reciprocalRankAtK(
        "bench:target-fn",
        hybrid.map((r) => r.item.id),
        K,
      ),
    ).toBeGreaterThan(0);
  });
});
