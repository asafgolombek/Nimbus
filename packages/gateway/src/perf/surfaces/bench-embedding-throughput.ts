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
import type { S8Batch, S8Length } from "../types.ts";

export interface EmbeddingThroughputOptions {
  length: S8Length;
  batch: S8Batch;
  /** Total items in the corpus per run. Default 1000 × batch (spec §6.3). */
  totalItems?: number;
  /** Test-injectable embedder; production uses createLocalEmbedder. */
  embedder?: Embedder;
  /** Override default model cache dir. */
  cacheDir?: string;
}

const DEFAULT_BATCH_MULTIPLIER = 1_000;

async function getEmbedder(opts: EmbeddingThroughputOptions): Promise<Embedder> {
  if (opts.embedder !== undefined) return opts.embedder;
  return createLocalEmbedder({
    cacheDir: opts.cacheDir ?? join(tmpdir(), "nimbus-bench-models"),
  });
}

export async function runEmbeddingThroughputOnce(
  opts: EmbeddingThroughputOptions,
): Promise<number[]> {
  const totalItems = opts.totalItems ?? opts.batch * DEFAULT_BATCH_MULTIPLIER;
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
