import type { Database } from "bun:sqlite";

import type { HybridIndexedItem, HybridSearchOptions, HybridSearchResult } from "./hybrid-types.ts";
import { vectorSearchChunks } from "./vec-store.ts";

function rrfTerm(rank: number, k: number): number {
  return 1 / (k + rank);
}

/** Best (smallest) 1-based rank per item in chunk order. */
function bestVectorRanksByItem(hits: readonly { itemId: string }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < hits.length; i++) {
    const id = hits[i]?.itemId;
    if (id === undefined) {
      continue;
    }
    const r = i + 1;
    const prev = m.get(id);
    if (prev === undefined || r < prev) {
      m.set(id, r);
    }
  }
  return m;
}

function chunkContextLines(
  db: Database,
  itemId: string,
  model: string,
  centerIndex: number,
  contextChunks: number,
): string[] {
  const n = Math.min(8, Math.max(0, Math.floor(contextChunks)));
  if (n === 0) {
    return [];
  }
  const low = Math.max(0, centerIndex - n);
  const high = centerIndex + n;
  const rows = db
    .query(
      `SELECT chunk_text FROM embedding_chunk
       WHERE item_id = ? AND model = ? AND chunk_index >= ? AND chunk_index <= ?
       ORDER BY chunk_index ASC`,
    )
    .all(itemId, model, low, high) as Array<{ chunk_text: string }>;
  return rows.map((r) => r.chunk_text);
}

/**
 * Reciprocal Rank Fusion over BM25-ordered items and sqlite-vec chunk KNN (collapsed per item).
 */
export async function hybridSearch(
  db: Database,
  opts: HybridSearchOptions,
): Promise<HybridSearchResult[]> {
  const nameQ = opts.query.trim();
  const k = opts.rrfK ?? 60;
  const wB = opts.bm25Weight ?? 0.6;
  const wV = opts.vectorWeight ?? 0.4;
  const limit = Math.min(500, Math.max(1, Math.floor(opts.limit)));
  const semantic = opts.semantic ?? true;
  const contextN = Math.min(8, Math.max(0, Math.floor(opts.contextChunks ?? 2)));

  let serviceFilter: string | undefined;
  if (opts.service !== undefined && opts.service !== "") {
    serviceFilter = opts.service;
  }

  const fts = ftsMatchQuery(nameQ);
  const useFts = nameQ.length > 0 && fts !== "";

  type Bm25Hit = { item: HybridIndexedItem; rank: number };
  const bm25Hits: Bm25Hit[] = [];

  if (useFts) {
    const params: Array<string | number> = [];
    let whereExtra = "";
    if (serviceFilter !== undefined) {
      whereExtra += " AND i.service = ?";
      params.push(serviceFilter);
    }
    if (opts.itemType !== undefined && opts.itemType !== "") {
      whereExtra += " AND i.type = ?";
      params.push(opts.itemType);
    }
    if (opts.since !== undefined && opts.since > 0) {
      whereExtra += " AND i.modified_at >= ?";
      params.push(opts.since);
    }
    const cap = Math.min(500, limit * 15);
    const sql = `
      SELECT i.id AS id, i.service AS service, i.type AS type, i.external_id AS external_id,
             i.title AS title, i.body_preview AS body_preview, i.url AS url, i.canonical_url AS canonical_url,
             i.modified_at AS modified_at, i.author_id AS author_id, i.metadata AS metadata,
             i.synced_at AS synced_at, i.pinned AS pinned
      FROM item i
      INNER JOIN item_fts ON i.rowid = item_fts.rowid
      WHERE item_fts MATCH ? ${whereExtra}
      ORDER BY rank
      LIMIT ?
    `;
    const rows = db.query(sql).all(fts, ...params, cap) as HybridIndexedItem[];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row !== undefined) {
        bm25Hits.push({ item: row, rank: i + 1 });
      }
    }
  }

  const bm25RankById = new Map<string, number>();
  for (const h of bm25Hits) {
    bm25RankById.set(h.item.id, h.rank);
  }

  let vecHitsRaw: ReturnType<typeof vectorSearchChunks> = [];
  if (semantic && opts.queryEmbedding !== undefined && nameQ.length > 0) {
    const vecOpts: {
      queryEmbedding: Float32Array;
      model: string;
      limit: number;
      service?: string;
      itemType?: string;
      since?: number;
    } = {
      queryEmbedding: opts.queryEmbedding,
      model: opts.embeddingModel,
      limit: Math.min(500, limit * 25),
    };
    if (serviceFilter !== undefined) {
      vecOpts.service = serviceFilter;
    }
    if (opts.itemType !== undefined && opts.itemType !== "") {
      vecOpts.itemType = opts.itemType;
    }
    if (opts.since !== undefined && opts.since > 0) {
      vecOpts.since = opts.since;
    }
    vecHitsRaw = vectorSearchChunks(db, vecOpts);
  }

  const vecBestRank = bestVectorRanksByItem(vecHitsRaw);
  const winningChunkByItem = new Map<string, (typeof vecHitsRaw)[0]>();
  for (const h of vecHitsRaw) {
    if (winningChunkByItem.has(h.itemId)) {
      continue;
    }
    winningChunkByItem.set(h.itemId, h);
  }

  const itemIds = new Set<string>();
  for (const h of bm25Hits) {
    itemIds.add(h.item.id);
  }
  for (const id of vecBestRank.keys()) {
    itemIds.add(id);
  }

  const scored: HybridSearchResult[] = [];
  for (const id of itemIds) {
    const rb = bm25RankById.get(id);
    const rv = vecBestRank.get(id);
    const rrfB = rb === undefined ? 0 : wB * rrfTerm(rb, k);
    const rrfV = rv === undefined ? 0 : wV * rrfTerm(rv, k);
    const rrfScore = rrfB + rrfV;
    if (rrfScore > 0) {
      const row =
        bm25Hits.find((h) => h.item.id === id)?.item ??
        (db
          .query(`SELECT i.id AS id, i.service AS service, i.type AS type, i.external_id AS external_id,
            i.title AS title, i.body_preview AS body_preview, i.url AS url, i.canonical_url AS canonical_url,
            i.modified_at AS modified_at, i.author_id AS author_id, i.metadata AS metadata,
            i.synced_at AS synced_at, i.pinned AS pinned
            FROM item i WHERE i.id = ?`)
          .get(id) as HybridIndexedItem | null);
      if (row !== null && row !== undefined) {
        const win = winningChunkByItem.get(id);
        let semanticSnippet: string | undefined;
        if (win !== undefined) {
          const parts =
            contextN > 0
              ? chunkContextLines(db, id, opts.embeddingModel, win.chunkIndex, contextN)
              : [win.chunkText];
          semanticSnippet = parts.join("\n---\n");
        }
        const hit: HybridSearchResult = {
          item: row,
          bm25Rank: rb ?? null,
          vectorRank: rv ?? null,
          rrfScore,
        };
        if (semanticSnippet !== undefined) {
          hit.semanticSnippet = semanticSnippet;
        }
        scored.push(hit);
      }
    }
  }

  scored.sort((a, b) => {
    if (b.rrfScore !== a.rrfScore) {
      return b.rrfScore - a.rrfScore;
    }
    return b.item.modified_at - a.item.modified_at;
  });

  const deduped = dedupeHybridByCanonicalUrl(scored);
  return deduped.slice(0, limit);
}

function ftsMatchQuery(name: string): string {
  const tokens = name
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) {
    return "";
  }
  return tokens
    .map((t) => {
      const escaped = t.replaceAll('"', '""');
      return `(title : "${escaped}"* OR body_preview : "${escaped}"*)`;
    })
    .join(" AND ");
}

function dedupeHybridByCanonicalUrl(results: HybridSearchResult[]): HybridSearchResult[] {
  const out: HybridSearchResult[] = [];
  const canonicalToIdx = new Map<string, number>();
  for (const r of results) {
    const canon = r.item.canonical_url;
    if (canon === null || canon === undefined || canon.trim() === "") {
      out.push(r);
      continue;
    }
    const c = canon.trim();
    const idx = canonicalToIdx.get(c);
    if (idx === undefined) {
      canonicalToIdx.set(c, out.length);
      out.push(r);
      continue;
    }
    const prev = out[idx];
    if (prev === undefined) {
      out.push(r);
      continue;
    }
    const dups = [...(prev.duplicates ?? []), r.item.service];
    out[idx] = { ...prev, duplicates: dups };
  }
  return out;
}
