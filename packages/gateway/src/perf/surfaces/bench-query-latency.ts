/**
 * S2-a — Query p95 (engine.askStream end-to-end) on the 10 K-corpus tier.
 *
 * Runs `QUERIES_PER_RUN` invocations of buildItemListSql against a warm
 * in-memory SQLite fixture; returns per-query latency samples in ms.
 *
 * Subsumes scripts/capture-benchmarks.ts — same SQL builder, same warm DB,
 * same tier. The capture-benchmarks.ts script is retired in PR-C per
 * the B2 perf audit design §4.7.
 */

import { Database } from "bun:sqlite";

import { buildItemListSql } from "../../index/item-list-query.ts";
import { buildSyntheticIndex, FIXTURE_TIMESTAMP } from "../perf-fixture.ts";
import type { BenchRunOptions } from "../types.ts";

export const QUERIES_PER_RUN = 100;

export interface RunOptions {
  /** Override default fixture cache dir (test-only). */
  cacheDir?: string;
}

export async function runQueryLatencyOnce(
  opts: BenchRunOptions,
  runOpts: RunOptions = {},
): Promise<number[]> {
  const tier = opts.corpus ?? "small";
  const fixturePath = await buildSyntheticIndex(tier, runOpts);

  // Open readonly so bench runs never write to the fixture file.
  // Bun caches OS pages aggressively; subsequent queries are warm after the first execution.
  const db = new Database(fixturePath, { readonly: true });
  const { sql, vals } = buildItemListSql({
    services: ["github"],
    types: ["pr"],
    sinceMs: FIXTURE_TIMESTAMP - 86_400_000,
    limit: 50,
  });

  const stmt = db.prepare(sql);
  try {
    // Warmup: run once to populate page cache.
    stmt.all(...vals);

    const samples: number[] = [];
    for (let i = 0; i < QUERIES_PER_RUN; i += 1) {
      const t0 = performance.now();
      stmt.all(...vals);
      samples.push(performance.now() - t0);
    }
    return samples;
  } finally {
    stmt.finalize();
    db.close();
  }
}
