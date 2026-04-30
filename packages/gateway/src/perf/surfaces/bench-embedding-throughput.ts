/**
 * S8 — embedding throughput across the (length × batch) cross-product.
 *
 * Cell registration happens in bench-cli.ts via
 *   for (const length of S8_LENGTHS)
 *     for (const batch of S8_BATCHES)
 *       SURFACE_REGISTRY[`S8-l${length}-b${batch}`] = ...
 * which lands one threshold per cell in slo.md (PR-C work).
 *
 * Warm-up: one throwaway embed call BEFORE the timer starts. This
 * excludes model load + ONNX cache prime from the metric (spec §6.3).
 * Tests inject the embedder; production uses createLocalEmbedder.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalEmbedder } from "../../embedding/model.ts";
import type { Embedder } from "../../embedding/types.ts";
import { synthesizeText } from "../fixtures/synthetic-text.ts";
import type { CorpusTier, S8Batch, S8Length } from "../types.ts";

export interface EmbeddingThroughputOptions {
  length: S8Length;
  batch: S8Batch;
  /**
   * Total items in the corpus per run. Default is `batch × multiplier`,
   * where multiplier is corpus-derived (see `CORPUS_BATCH_MULTIPLIER`).
   * Explicit values override the corpus-derived default.
   */
  totalItems?: number;
  /**
   * Workload tier. Scales the default multiplier so CI matrix runs (which
   * pass `--corpus small`) fit inside the 45-min per-OS job budget without
   * sacrificing the canonical 1000×batch workload that the reference run
   * (M1 Air, `--reference`) is calibrated against.
   *   - small  →   10× batch   (CI budget)
   *   - medium →  100× batch
   *   - large  → 1000× batch   (canonical, matches unset)
   * Unset preserves pre-existing 1000×batch behaviour for local-dev runs.
   *
   * The `small` tier is intentionally aggressive: ONNX per-batch time at
   * length=5000 (l5000-b{32,64}) scales linearly with batch size and
   * dominates wall time, so 10 batches × 5 runs is the largest workload
   * that keeps every cell under ~5 min on ubuntu-24.04 GHA.
   */
  corpus?: CorpusTier;
  /** Test-injectable embedder; production uses createLocalEmbedder. */
  embedder?: Embedder;
  /** Override default model cache dir. */
  cacheDir?: string;
}

/** Canonical reference workload. Reserved for `--corpus large` and unset. */
const DEFAULT_BATCH_MULTIPLIER = 1_000;

const CORPUS_BATCH_MULTIPLIER: Record<CorpusTier, number> = {
  small: 10,
  medium: 100,
  large: DEFAULT_BATCH_MULTIPLIER,
};

function resolveBatchMultiplier(corpus: CorpusTier | undefined): number {
  return corpus === undefined ? DEFAULT_BATCH_MULTIPLIER : CORPUS_BATCH_MULTIPLIER[corpus];
}

async function getEmbedder(opts: EmbeddingThroughputOptions): Promise<Embedder> {
  if (opts.embedder !== undefined) return opts.embedder;
  return createLocalEmbedder({
    cacheDir: opts.cacheDir ?? join(tmpdir(), "nimbus-bench-models"),
  });
}

export async function runEmbeddingThroughputOnce(
  opts: EmbeddingThroughputOptions,
): Promise<number[]> {
  const totalItems = opts.totalItems ?? opts.batch * resolveBatchMultiplier(opts.corpus);
  const texts = synthesizeText({ length: opts.length, count: totalItems });
  const embedder = await getEmbedder(opts);

  // Warm-up — model load + ONNX cache + tokenizer prime happen here,
  // not inside the timed window. Result is discarded.
  await embedder.embed([texts[0] ?? "warm-up"]);

  const t0 = performance.now();
  for (let i = 0; i < texts.length; i += opts.batch) {
    await embedder.embed(texts.slice(i, i + opts.batch));
  }
  const elapsed = performance.now() - t0;
  if (elapsed <= 0) return [0];
  const itemsPerSec = texts.length / (elapsed / 1000);
  return [itemsPerSec];
}
