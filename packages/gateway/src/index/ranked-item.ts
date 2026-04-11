import type { NimbusItem } from "@nimbus-dev/sdk";

/** Enriched row from {@link LocalIndex.searchRanked} (Q2 §7.2 / §7.0). */
export type RankedIndexItem = NimbusItem & {
  score: number;
  indexPrimaryKey: string;
  /** Raw `item.type` in SQLite (e.g. `pr`, `message`); use with {@link LocalIndex.fetchMoreItems}. */
  indexedType: string;
  /** Present when row had `canonical_url` (used for §7.2 deduplication). */
  canonicalUrl?: string;
  duplicates?: readonly string[];
  /** Phase 3 hybrid search — fused chunk context for the best-matching embedding. */
  semanticSnippet?: string;
  bm25Rank?: number | null;
  vectorRank?: number | null;
};
