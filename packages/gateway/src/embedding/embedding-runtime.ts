/**
 * Shared interface for in-process lazy embedding vs Bun worker embedding.
 */
export type EmbeddingRuntime = {
  scheduleItemEmbedding: (itemId: string) => void;
  embedQuery: (text: string) => Promise<Float32Array | null>;
  /** Best-effort progress from background backfill (worker only). */
  getBackfillProgress: () => { done: number; total: number } | null;
  /** Idempotent — worker backfills automatically; lazy runtime starts backfill here. */
  startBackgroundJobs: () => void;
  terminate: () => void;
};
